"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Loader2, X, Mic, MicOff, Send, Volume2, VolumeX } from "lucide-react";
import * as THREE from "three";
import BrainGraphView from "@/components/BrainGraphView";
import {
  getDefaultLiveTranscriptionTiming,
  getSpeechRecognitionConstructor,
  shouldUseWebKitStableMode,
  startLiveTranscription,
} from "@/lib/browserSpeechRecognition";
import { computeVoiceGraphCorrelation } from "@/lib/voiceTranscriptGraphCorrelation";
import {
  cancelBrowserSpeech,
  isBrowserSpeechSynthesisAvailable,
  speakBrowserText,
} from "@/lib/browserSpeechSynthesis";
import type { VaultGraph } from "@/lib/vault";

type AdvancedVoiceSphereViewProps = {
  onClose: () => void;
  vaultGraph?: VaultGraph | null;
  vaultGraphLoading?: boolean;
  /** Continuar vs. sessão nova é decidido na página (histórico do chat). */
  onSubmitTranscript?: (opts: { text: string }) => Promise<void>;
  isLlmLoading?: boolean;
  lastAssistantText?: string | null;
  /** Incrementa a cada nova mensagem do assistente (inclui texto repetido). */
  assistantReplyEpoch?: number;
  llmError?: string | null;
};

type ThemeMode = "dark" | "light";

type ScenePalette = {
  fogColor: string;
  primaryLightColor: string;
  secondaryLightColor: string;
  particleColor: string;
};

const DARK_PALETTE: ScenePalette = {
  fogColor: "#0c0d10",
  primaryLightColor: "#d0d5e1",
  secondaryLightColor: "#656c7b",
  particleColor: "#c9cfda",
};

const LIGHT_PALETTE: ScenePalette = {
  fogColor: "#eeeff2",
  primaryLightColor: "#fefefe",
  secondaryLightColor: "#8f97a6",
  particleColor: "#6f7684",
};

/** Sem novos tokens de STT durante este intervalo ⇒ envio automático (app nativo: pausa um pouco mais longa). */
const AUTO_SEND_AFTER_PAUSE_MS_NATIVE = 1780;
const AUTO_SEND_AFTER_PAUSE_MS_WEB = 1360;

function resolveThemeMode(): ThemeMode {
  if (typeof document === "undefined") {
    return "dark";
  }
  const htmlTheme = document.documentElement.getAttribute("data-theme");
  const bodyTheme = document.body?.getAttribute("data-theme");
  return htmlTheme === "light" || bodyTheme === "light" ? "light" : "dark";
}

/** App macOS (WKWebView) — microfone costuma vir com nível mais baixo no WebKit. */
function isBrain2NativeShell(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.hasAttribute("data-brain2-native");
}

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Partículas em esfera — único elemento 3D de fundo (esferas flutuantes). */
function ParticleHalo({ color }: { color: string }) {
  const pointsRef = useRef<THREE.Points>(null);

  const positions = useMemo(() => {
    const count = 1300;
    const data = new Float32Array(count * 3);

    for (let i = 0; i < count; i += 1) {
      const stride = i * 3;
      const radiusNoise = pseudoRandom(i + 1);
      const thetaNoise = pseudoRandom(i + 1001);
      const phiNoise = pseudoRandom(i + 2003);
      const radius = 2.45 + radiusNoise * 1.95;
      const theta = thetaNoise * Math.PI * 2;
      const phi = Math.acos(2 * phiNoise - 1);

      data[stride] = radius * Math.sin(phi) * Math.cos(theta);
      data[stride + 1] = radius * Math.cos(phi);
      data[stride + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }

    return data;
  }, []);

  useFrame((state) => {
    if (!pointsRef.current) return;
    pointsRef.current.rotation.y = state.clock.elapsedTime * 0.024;
    pointsRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.11) * 0.06;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color={color} size={0.014} sizeAttenuation transparent opacity={0.34} depthWrite={false} />
    </points>
  );
}

export default function AdvancedVoiceSphereView({
  onClose,
  vaultGraph,
  vaultGraphLoading = false,
  onSubmitTranscript,
  isLlmLoading = false,
  lastAssistantText = null,
  assistantReplyEpoch = 0,
  llmError = null,
}: AdvancedVoiceSphereViewProps) {
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [micLevel, setMicLevel] = useState(0);
  const [micStatus, setMicStatus] = useState<"idle" | "listening" | "denied" | "unsupported">("idle");
  const speechEnvelopeRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [liveTranscript, setLiveTranscript] = useState("");
  /** Transcrição com debounce só para o grafo — evita “refresh” da simulação a cada token do STT. */
  const [transcriptForGraph, setTranscriptForGraph] = useState("");
  const [sttHint, setSttHint] = useState<string | null>(null);
  const [speechPulsePhase, setSpeechPulsePhase] = useState(0);
  const [localSubmitError, setLocalSubmitError] = useState<string | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  /** Reinicia o STT após pausar para TTS. */
  const [sttResumeNonce, setSttResumeNonce] = useState(0);
  const stopSttRef = useRef<(() => void) | null>(null);
  const shouldPlayAssistantTtsRef = useRef(false);
  const liveTranscriptRef = useRef("");
  const sendInFlightRef = useRef(false);
  const isLlmLoadingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const handleSendToModelRef = useRef<() => Promise<void>>(async () => {});

  const autoSendPauseMs = useMemo(
    () => (isBrain2NativeShell() ? AUTO_SEND_AFTER_PAUSE_MS_NATIVE : AUTO_SEND_AFTER_PAUSE_MS_WEB),
    [],
  );

  useEffect(() => {
    queueMicrotask(() => setTtsSupported(isBrowserSpeechSynthesisAvailable()));
  }, []);

  useEffect(() => {
    return () => {
      cancelBrowserSpeech();
    };
  }, []);

  useEffect(() => {
    if (!liveTranscript.trim()) {
      queueMicrotask(() => setTranscriptForGraph(""));
      return;
    }
    const ms = 110;
    const id = window.setTimeout(() => setTranscriptForGraph(liveTranscript), ms);
    return () => window.clearTimeout(id);
  }, [liveTranscript]);

  const voiceGraphCorrelation = useMemo(
    () => computeVoiceGraphCorrelation(vaultGraph ?? null, transcriptForGraph),
    [vaultGraph, transcriptForGraph],
  );

  useEffect(() => {
    const syncTheme = () => setThemeMode(resolveThemeMode());
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    if (document.body) {
      observer.observe(document.body, { attributes: true, attributeFilter: ["data-theme"] });
    }
    return () => observer.disconnect();
  }, []);

  /** No app macOS (WKWebView), manter Web Audio + getUserMedia activo disputa o HAL com o serviço de voz da Apple (erro kAFAssistant 1101). */
  const nativeVoiceActivityRef = useRef(0);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      queueMicrotask(() => setMicStatus("unsupported"));
      return;
    }

    let cancelled = false;
    let raf = 0;
    const native = isBrain2NativeShell();

    void (async () => {
      try {
        if (native) {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          stream.getTracks().forEach((t) => t.stop());
          queueMicrotask(() => setMicStatus("listening"));
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        if (ctx.state === "suspended") {
          await ctx.resume();
        }
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.72;
        src.connect(analyser);
        setMicStatus("listening");

        const floatBuf = new Float32Array(analyser.fftSize);
        const freqBuf = new Uint8Array(analyser.frequencyBinCount);
        speechEnvelopeRef.current = 0;

        const loop = () => {
          if (cancelled) return;

          analyser.getFloatTimeDomainData(floatBuf);
          let sum = 0;
          for (let i = 0; i < floatBuf.length; i += 1) {
            const v = floatBuf[i]!;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / floatBuf.length);

          analyser.getByteFrequencyData(freqBuf);
          const binW = ctx.sampleRate / analyser.fftSize;
          const iLo = Math.max(2, Math.floor(100 / binW));
          const iHi = Math.min(freqBuf.length - 1, Math.ceil(4200 / binW));
          let bandAcc = 0;
          const nBins = Math.max(1, iHi - iLo + 1);
          for (let i = iLo; i <= iHi; i += 1) {
            bandAcc += freqBuf[i]!;
          }
          const bandNorm = bandAcc / (nBins * 255);

          const rmsGain = 5.4;
          const rmsNorm = Math.min(1, rms * rmsGain);
          const combined = Math.min(1, rmsNorm * 0.36 + bandNorm * 0.64);
          const knee = 2.55;
          const lifted = 1 - Math.exp(-combined * knee);

          let env = speechEnvelopeRef.current;
          const attack = 0.48;
          const release = 0.26;
          if (lifted > env) {
            env += (lifted - env) * attack;
          } else {
            env += (lifted - env) * release;
          }
          speechEnvelopeRef.current = env;

          setMicLevel(env);
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      } catch {
        setMicStatus("denied");
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      void audioCtxRef.current?.close();
      audioCtxRef.current = null;
    };
  }, []);

  /** Pulsar do anel no Mac: animação suave + pico quando chega texto do STT (sem captura contínua). */
  useEffect(() => {
    if (!isBrain2NativeShell() || micStatus !== "listening") {
      return;
    }
    let raf = 0;
    const tick = () => {
      const t = performance.now();
      nativeVoiceActivityRef.current *= 0.94;
      const breath = 0.16 + 0.12 * Math.sin(t / 480);
      const fromVoice = nativeVoiceActivityRef.current;
      setMicLevel(Math.min(1, Math.max(breath, fromVoice * 0.92 + breath * 0.08)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [micStatus]);

  useEffect(() => {
    if (micStatus !== "listening") {
      return;
    }
    if (!getSpeechRecognitionConstructor()) {
      queueMicrotask(() => {
        setSttHint("Reconhecimento de voz indisponível neste browser. Use Chrome ou Safari recente.");
      });
      return;
    }

    const timing = getDefaultLiveTranscriptionTiming();
    const stop = startLiveTranscription(
      {
        onText: (text) => {
          if (isBrain2NativeShell()) {
            nativeVoiceActivityRef.current = 0.9;
          }
          setLiveTranscript(text);
          setSttHint(null);
        },
        onError: (code) => {
          if (code === "denied") {
            setSttHint("Permissão de microfone ou reconhecimento de voz recusada.");
            return;
          }
          if (code === "unsupported") {
            setSttHint("Reconhecimento de voz indisponível neste browser.");
            return;
          }
          /** App macOS / WKWebView: o motor dispara códigos transitórios; não assustar o utilizador. */
          if (isBrain2NativeShell() || shouldUseWebKitStableMode()) {
            setSttHint(null);
            return;
          }
          const transient = new Set([
            "aborted",
            "network",
            "interrupted",
            "no-speech",
            "audio-capture",
            "no-match",
            "service-not-allowed",
            "bad-grammar",
            "language-not-supported",
          ]);
          if (transient.has(code)) {
            setSttHint(null);
            return;
          }
          setSttHint("Reconhecimento interrompido. Fale de novo para continuar.");
        },
      },
      {
        lang: "pt-BR",
        webkitStableMode: timing.webkitStableMode,
        /** Após libertar o stream do pedido de permissão, dar tempo ao HAL antes do STT. */
        startDelayMs: isBrain2NativeShell() ? Math.max(timing.startDelayMs, 680) : timing.startDelayMs,
      },
    );

    stopSttRef.current = stop;

    return () => {
      stopSttRef.current = null;
      stop();
      queueMicrotask(() => {
        setLiveTranscript("");
        setSttHint(null);
      });
    };
  }, [micStatus, sttResumeNonce]);

  useEffect(() => {
    const hasSpeechHighlight =
      voiceGraphCorrelation.linkKeys.size > 0 ||
      voiceGraphCorrelation.nodeStrength.size > 0 ||
      voiceGraphCorrelation.weakLinkKeys.size > 0 ||
      voiceGraphCorrelation.pathLinkKeys.size > 0;
    if (!hasSpeechHighlight) {
      queueMicrotask(() => setSpeechPulsePhase(0));
      return;
    }
    const id = window.setInterval(() => {
      setSpeechPulsePhase((performance.now() / 1000) * Math.PI * 2 * 0.85);
    }, 45);
    return () => window.clearInterval(id);
  }, [
    voiceGraphCorrelation.linkKeys.size,
    voiceGraphCorrelation.nodeStrength.size,
    voiceGraphCorrelation.weakLinkKeys.size,
    voiceGraphCorrelation.pathLinkKeys.size,
  ]);

  const noop = useCallback(() => {}, []);

  const handleSendToModel = useCallback(async () => {
    if (!onSubmitTranscript) {
      return;
    }
    if (sendInFlightRef.current) {
      return;
    }
    if (isLlmLoadingRef.current) {
      return;
    }

    const snapshot = liveTranscriptRef.current.trim();
    if (!snapshot) {
      return;
    }

    sendInFlightRef.current = true;
    setLocalSubmitError(null);
    shouldPlayAssistantTtsRef.current = true;
    setLiveTranscript("");
    liveTranscriptRef.current = "";

    try {
      await onSubmitTranscript({ text: snapshot });
    } catch (e) {
      shouldPlayAssistantTtsRef.current = false;
      setLiveTranscript(snapshot);
      liveTranscriptRef.current = snapshot;
      setLocalSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      sendInFlightRef.current = false;
    }
  }, [onSubmitTranscript]);

  useEffect(() => {
    handleSendToModelRef.current = handleSendToModel;
  }, [handleSendToModel]);

  /** Pausa na fala (sem novos tokens) ⇒ envio automático. */
  useEffect(() => {
    if (!onSubmitTranscript) {
      return;
    }
    if (micStatus !== "listening") {
      return;
    }
    if (isLlmLoading || isSpeaking) {
      return;
    }
    const trimmed = liveTranscript.trim();
    if (!trimmed) {
      return;
    }

    const id = window.setTimeout(() => {
      if (isLlmLoadingRef.current || isSpeakingRef.current || sendInFlightRef.current) {
        return;
      }
      const latest = liveTranscriptRef.current.trim();
      if (!latest) {
        return;
      }
      void handleSendToModelRef.current();
    }, autoSendPauseMs);

    return () => window.clearTimeout(id);
  }, [
    liveTranscript,
    micStatus,
    onSubmitTranscript,
    autoSendPauseMs,
    isLlmLoading,
    isSpeaking,
  ]);

  const handleStopVoice = useCallback(() => {
    cancelBrowserSpeech();
    setIsSpeaking(false);
    setSttResumeNonce((n) => n + 1);
  }, []);

  const handleReplayVoice = useCallback(() => {
    const t = lastAssistantText?.trim();
    if (!t || !ttsSupported || !ttsEnabled || isLlmLoading) {
      return;
    }
    stopSttRef.current?.();
    speakBrowserText(t, {
      onStart: () => setIsSpeaking(true),
      onEnd: () => {
        setIsSpeaking(false);
        setSttResumeNonce((n) => n + 1);
      },
      onError: () => {
        setIsSpeaking(false);
        setSttResumeNonce((n) => n + 1);
      },
    });
  }, [lastAssistantText, ttsSupported, ttsEnabled, isLlmLoading]);

  useEffect(() => {
    if (isLlmLoading) {
      return;
    }
    const text = lastAssistantText?.trim();
    if (!text) {
      return;
    }
    if (!shouldPlayAssistantTtsRef.current) {
      return;
    }
    if (!ttsEnabled) {
      shouldPlayAssistantTtsRef.current = false;
      return;
    }
    if (!isBrowserSpeechSynthesisAvailable()) {
      shouldPlayAssistantTtsRef.current = false;
      return;
    }

    shouldPlayAssistantTtsRef.current = false;

    stopSttRef.current?.();
    speakBrowserText(text, {
      onStart: () => setIsSpeaking(true),
      onEnd: () => {
        setIsSpeaking(false);
        setSttResumeNonce((n) => n + 1);
      },
      onError: () => {
        setIsSpeaking(false);
        setSttResumeNonce((n) => n + 1);
      },
    });
  }, [isLlmLoading, lastAssistantText, ttsEnabled, assistantReplyEpoch]);

  const combinedLlmError = localSubmitError || llmError;
  const palette = themeMode === "light" ? LIGHT_PALETTE : DARK_PALETTE;

  const micLabel = useMemo(() => {
    if (micStatus === "unsupported") return "Microfone não disponível neste browser.";
    if (micStatus === "denied") return "Permissão do microfone necessária para animar o grafo.";
    if (micStatus === "idle") return "A preparar áudio…";
    return "À escuta — o Your Brain reage ao som.";
  }, [micStatus]);

  const micRingStyle = useMemo(
    () =>
      micStatus === "listening"
        ? {
            opacity: 0.45 + micLevel * 0.55,
            transform: `scale(${1 + micLevel * 0.12})`,
          }
        : { opacity: 0.2, transform: "scale(1)" },
    [micStatus, micLevel]
  );

  liveTranscriptRef.current = liveTranscript;
  isLlmLoadingRef.current = isLlmLoading;
  isSpeakingRef.current = isSpeaking;

  return (
    <div className={`advanced-voice-root advanced-voice-root--${themeMode}`}>
      <div className="advanced-voice-bg" aria-hidden>
        <Canvas camera={{ position: [0, 0, 5.4], fov: 40 }} dpr={[1, 2]} gl={{ alpha: true }} style={{ background: "transparent" }}>
          <fog attach="fog" args={[palette.fogColor, 4.2, 8.6]} />
          <ambientLight intensity={0.26} />
          <pointLight position={[3.2, 2.2, 2.2]} intensity={1.02} color={palette.primaryLightColor} />
          <pointLight position={[-3.6, -1.9, -2.2]} intensity={0.66} color={palette.secondaryLightColor} />
          <ParticleHalo color={palette.particleColor} />
        </Canvas>
      </div>

      <button className="advanced-voice-fab-close" type="button" onClick={onClose} aria-label="Fechar conversa avançada">
        <X size={16} strokeWidth={2} />
      </button>

      <div className="advanced-voice-brain-layer">
        <BrainGraphView
          onClose={noop}
          graph={vaultGraph ?? null}
          loading={vaultGraphLoading}
          variant="spectator"
          compactChrome
          hideCloseButton
          spectatorLockZoom
          liveAudioEnergy={micLevel}
          liveSpeechPulsePhase={speechPulsePhase}
          liveSpeechLinkKeys={
            voiceGraphCorrelation.linkKeys.size > 0 ? voiceGraphCorrelation.linkKeys : undefined
          }
          liveSpeechWeakLinkKeys={
            voiceGraphCorrelation.weakLinkKeys.size > 0 ? voiceGraphCorrelation.weakLinkKeys : undefined
          }
          liveSpeechPathLinkKeys={
            voiceGraphCorrelation.pathLinkKeys.size > 0 ? voiceGraphCorrelation.pathLinkKeys : undefined
          }
          liveSpeechNodeStrength={
            voiceGraphCorrelation.nodeStrength.size > 0 ? voiceGraphCorrelation.nodeStrength : undefined
          }
        />
      </div>

      <div className="advanced-voice-voice-dock">
        <div
          className="advanced-voice-transcript-wrap"
          aria-live="polite"
          aria-relevant="additions text"
          role="log"
        >
          {micStatus === "listening" ? (
            liveTranscript ? (
              <p className="advanced-voice-transcript-text">{liveTranscript}</p>
            ) : sttHint ? (
              <p className="advanced-voice-transcript-hint">{sttHint}</p>
            ) : (
              <p className="advanced-voice-transcript-placeholder">
                À escuta… a transcrição aparece aqui. Faça uma pausa breve no fim da frase para enviar
                automaticamente.
              </p>
            )
          ) : micStatus === "denied" ? (
            <p className="advanced-voice-transcript-hint">Microfone bloqueado — transcrição indisponível.</p>
          ) : micStatus === "unsupported" ? (
            <p className="advanced-voice-transcript-hint">Microfone não disponível neste ambiente.</p>
          ) : (
            <p className="advanced-voice-transcript-placeholder">A preparar áudio…</p>
          )}
        </div>

        {onSubmitTranscript ? (
          <div className="advanced-voice-llm-panel">
            <p className="advanced-voice-session-hint">
              Segue o chat actual: com mensagens continua; com o vazio (nova conversa), inicia sessão nova. O envio após
              pausa é automático; use “Enviar agora” se quiser forçar.
            </p>
            {ttsSupported ? (
              <div className="advanced-voice-tts-row">
                <button
                  type="button"
                  className={`advanced-voice-tts-toggle${ttsEnabled ? " advanced-voice-tts-toggle--on" : ""}`}
                  onClick={() => {
                    setTtsEnabled((prev) => {
                      if (prev) {
                        cancelBrowserSpeech();
                        setIsSpeaking(false);
                        setSttResumeNonce((n) => n + 1);
                      }
                      return !prev;
                    });
                  }}
                  aria-pressed={ttsEnabled}
                >
                  {ttsEnabled ? (
                    <Volume2 size={15} strokeWidth={2} aria-hidden />
                  ) : (
                    <VolumeX size={15} strokeWidth={2} aria-hidden />
                  )}
                  Resposta em voz
                </button>
                {lastAssistantText && !isLlmLoading ? (
                  isSpeaking ? (
                    <button type="button" className="advanced-voice-tts-secondary" onClick={handleStopVoice}>
                      Parar áudio
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="advanced-voice-tts-secondary"
                      onClick={handleReplayVoice}
                      disabled={!ttsEnabled}
                    >
                      Ouvir de novo
                    </button>
                  )
                ) : null}
              </div>
            ) : (
              <p className="advanced-voice-tts-unavailable">Síntese de voz não disponível neste browser.</p>
            )}
            {combinedLlmError ? (
              <p className="advanced-voice-llm-error" role="alert">
                {combinedLlmError}
              </p>
            ) : null}
            {isLlmLoading || lastAssistantText ? (
              <div className="advanced-voice-assistant-out">
                {isLlmLoading ? (
                  <div className="advanced-voice-assistant-loading">
                    <Loader2 size={16} strokeWidth={1.8} className="spin" aria-hidden />
                    <span>A gerar resposta (ANCC + LLM)…</span>
                  </div>
                ) : null}
                {lastAssistantText ? (
                  <>
                    <p className="advanced-voice-assistant-label">Resposta</p>
                    <p className="advanced-voice-assistant-text">{lastAssistantText}</p>
                  </>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              className="advanced-voice-send-now"
              onClick={() => void handleSendToModel()}
              disabled={!liveTranscript.trim() || isLlmLoading || !onSubmitTranscript}
            >
              {isLlmLoading ? (
                <Loader2 size={14} strokeWidth={1.8} className="spin" aria-hidden />
              ) : (
                <Send size={14} strokeWidth={2} aria-hidden />
              )}
              Enviar agora
            </button>
          </div>
        ) : null}

        <div className="advanced-voice-mic-wrap">
          <span className="advanced-voice-mic-ring" style={micRingStyle} aria-hidden />
          <button
            type="button"
            className="advanced-voice-fab-mic"
            aria-label={micLabel}
            title={micLabel}
            disabled={micStatus === "unsupported"}
          >
            {micStatus === "denied" || micStatus === "unsupported" ? (
              <MicOff size={18} strokeWidth={2} aria-hidden />
            ) : (
              <Mic size={18} strokeWidth={2} aria-hidden />
            )}
          </button>
        </div>
      </div>

      <style jsx>{`
        .advanced-voice-root {
          position: relative;
          width: 100%;
          height: 100%;
          min-height: 0;
          overflow: hidden;
          background: var(--background);
        }

        .advanced-voice-bg {
          position: absolute;
          inset: 0;
          z-index: 0;
          pointer-events: none;
        }

        .advanced-voice-fab-close {
          position: absolute;
          top: 18px;
          right: 18px;
          z-index: 40;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          border-radius: 12px;
          border: 1px solid var(--bar-border);
          background: rgba(12, 13, 16, 0.45);
          color: var(--muted);
          backdrop-filter: blur(12px);
          transition: background 0.18s ease, color 0.18s ease, transform 0.18s ease;
        }

        .advanced-voice-root--light .advanced-voice-fab-close {
          background: rgba(255, 255, 255, 0.55);
        }

        .advanced-voice-fab-close:hover {
          background: var(--pill-active);
          color: var(--muted-hover);
          transform: scale(1.03);
        }

        .advanced-voice-brain-layer {
          position: absolute;
          inset: 0;
          z-index: 10;
          pointer-events: auto;
          background: transparent;
        }

        .advanced-voice-brain-layer :global(.brain-graph-root) {
          height: 100%;
          background: transparent;
        }

        .advanced-voice-voice-dock {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 30;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 0 14px clamp(18px, 4vh, 36px);
          pointer-events: none;
        }

        .advanced-voice-transcript-wrap {
          width: min(520px, 94vw);
          max-height: min(30vh, 220px);
          min-height: 52px;
          overflow-x: hidden;
          overflow-y: auto;
          padding: 12px 14px;
          border-radius: 14px;
          border: 1px solid var(--bar-border);
          background: rgba(10, 11, 14, 0.58);
          backdrop-filter: blur(14px);
          pointer-events: auto;
          box-sizing: border-box;
        }

        .advanced-voice-root--light .advanced-voice-transcript-wrap {
          background: rgba(255, 255, 255, 0.72);
        }

        .advanced-voice-transcript-text {
          margin: 0;
          font-family: 'Inter', system-ui, sans-serif;
          font-size: 13px;
          font-weight: 450;
          line-height: 1.5;
          color: var(--foreground);
          white-space: pre-wrap;
          word-break: break-word;
        }

        .advanced-voice-transcript-placeholder {
          margin: 0;
          font-family: 'Inter', system-ui, sans-serif;
          font-size: 12px;
          font-weight: 400;
          line-height: 1.45;
          color: var(--muted);
          font-style: italic;
        }

        .advanced-voice-transcript-hint {
          margin: 0;
          font-family: 'Inter', system-ui, sans-serif;
          font-size: 12px;
          line-height: 1.45;
          color: #c9a227;
        }

        .advanced-voice-root--light .advanced-voice-transcript-hint {
          color: #8a6d1a;
        }

        .advanced-voice-llm-panel {
          width: min(520px, 94vw);
          display: flex;
          flex-direction: column;
          gap: 10px;
          pointer-events: auto;
        }

        .advanced-voice-session-hint {
          margin: 0;
          font-family: 'Inter', system-ui, sans-serif;
          font-size: 11px;
          line-height: 1.45;
          color: var(--muted);
          text-align: center;
        }

        .advanced-voice-tts-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: center;
          gap: 8px 12px;
        }

        .advanced-voice-tts-toggle {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-family: 'Inter', system-ui, sans-serif;
          font-size: 12px;
          font-weight: 500;
          padding: 6px 12px;
          border-radius: 999px;
          border: 1px solid var(--bar-border);
          background: rgba(10, 11, 14, 0.38);
          color: var(--muted);
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        }

        .advanced-voice-root--light .advanced-voice-tts-toggle {
          background: rgba(255, 255, 255, 0.5);
        }

        .advanced-voice-tts-toggle--on {
          border-color: rgba(120, 200, 255, 0.45);
          color: var(--foreground);
        }

        .advanced-voice-tts-secondary {
          font-family: 'Inter', system-ui, sans-serif;
          font-size: 11px;
          font-weight: 500;
          padding: 5px 10px;
          border-radius: 8px;
          border: 1px solid var(--bar-border);
          background: transparent;
          color: var(--foreground);
          cursor: pointer;
        }

        .advanced-voice-tts-secondary:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .advanced-voice-tts-unavailable {
          margin: 0;
          font-size: 11px;
          color: var(--muted);
          text-align: center;
        }

        .advanced-voice-llm-error {
          margin: 0;
          font-size: 12px;
          line-height: 1.4;
          color: #e85d5d;
          text-align: center;
        }

        .advanced-voice-root--light .advanced-voice-llm-error {
          color: #c43d3d;
        }

        .advanced-voice-assistant-out {
          max-height: min(28vh, 200px);
          overflow: auto;
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid var(--bar-border);
          background: rgba(10, 11, 14, 0.5);
          backdrop-filter: blur(12px);
        }

        .advanced-voice-root--light .advanced-voice-assistant-out {
          background: rgba(255, 255, 255, 0.65);
        }

        .advanced-voice-assistant-loading {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--muted);
          margin-bottom: 8px;
        }

        .advanced-voice-assistant-loading:last-child {
          margin-bottom: 0;
        }

        .advanced-voice-assistant-label {
          margin: 0 0 6px;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--muted);
        }

        .advanced-voice-assistant-text {
          margin: 0;
          font-size: 13px;
          line-height: 1.5;
          color: var(--foreground);
          white-space: pre-wrap;
          word-break: break-word;
        }

        .advanced-voice-send-now {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          align-self: center;
          min-height: 34px;
          padding: 0 12px;
          border-radius: 10px;
          border: 1px dashed var(--bar-border);
          background: transparent;
          color: var(--muted);
          font-family: 'Inter', system-ui, sans-serif;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease, opacity 0.15s ease;
        }

        .advanced-voice-send-now:hover:not(:disabled) {
          background: rgba(80, 140, 220, 0.12);
          color: var(--foreground);
        }

        .advanced-voice-send-now:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .spin {
          animation: advanced-voice-spin 0.85s linear infinite;
        }

        @keyframes advanced-voice-spin {
          to {
            transform: rotate(360deg);
          }
        }

        .advanced-voice-mic-wrap {
          position: relative;
          width: 52px;
          height: 52px;
          flex-shrink: 0;
          pointer-events: none;
        }

        .advanced-voice-mic-ring {
          position: absolute;
          inset: -6px;
          border-radius: 50%;
          border: 2px solid rgba(120, 200, 255, 0.45);
          transition: opacity 0.12s ease-out, transform 0.08s ease-out;
        }

        .advanced-voice-fab-mic {
          position: absolute;
          inset: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          border: 1px solid var(--bar-border);
          background: rgba(10, 11, 14, 0.5);
          color: rgba(198, 204, 216, 0.95);
          backdrop-filter: blur(12px);
          pointer-events: auto;
          cursor: default;
          transition: background 0.18s ease, color 0.18s ease;
        }

        .advanced-voice-root--light .advanced-voice-fab-mic {
          background: rgba(255, 255, 255, 0.6);
          color: rgba(52, 58, 68, 0.95);
        }

        .advanced-voice-fab-mic:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
