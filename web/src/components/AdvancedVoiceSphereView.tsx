"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Loader2, X, Mic, MicOff, RotateCcw, Send, Square, Volume2, VolumeX } from "lucide-react";
import * as THREE from "three";
import BrainGraphView from "@/components/BrainGraphView";
import {
  getDefaultLiveTranscriptionTiming,
  getSpeechRecognitionConstructor,
  shouldUseWebKitStableMode,
  startLiveTranscription,
} from "@/lib/browserSpeechRecognition";
import { computeVoiceGraphCorrelation } from "@/lib/voiceTranscriptGraphCorrelation";
import { isBrowserSpeechSynthesisAvailable, speakBrowserText } from "@/lib/browserSpeechSynthesis";
import { loadLlmConfig } from "@/lib/llmClientConfig";
import {
  cancelAllAssistantSpeech,
  playOpenAiSpeech,
  readOpenAiTtsOutputEnabled,
  setOpenAiTtsOutputEnabled,
} from "@/lib/openAiSpeech";
import { transcribeAudioBlobWithOpenAI } from "@/lib/whisperTranscribe";
import type { VaultGraph } from "@/lib/vault";

/** Cópia defensiva — referência estável para o BrainGraphView não reiniciar a física quando o vault refresca. */
function cloneVaultGraph(g: VaultGraph): VaultGraph {
  return {
    nodes: g.nodes.map((n) => ({ ...n })),
    edges: g.edges.map((e) => ({ ...e })),
  };
}

type AdvancedVoiceSphereViewProps = {
  onClose: () => void;
  vaultGraph?: VaultGraph | null;
  vaultGraphLoading?: boolean;
  /** Continuar vs. sessão nova é decidido na página (histórico do chat). */
  onSubmitTranscript?: (opts: { text: string }) => Promise<void>;
  /** Utilizador fala por cima da resposta — cancelar pedido ao LLM e TTS. */
  onInterruptResponse?: () => void;
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

/** Deteção de interrupção: energia no micro acima disto durante HOLD ms (web vs app nativo). */
const INTERRUPT_MIC_THRESH_WEB = 0.34;
const INTERRUPT_MIC_THRESH_NATIVE = 0.52;
const INTERRUPT_MIC_HOLD_MS = 120;
/** Enquanto o LLM gera (sem TTS), texto novo no STT indica fala do utilizador — sem eco do assistente. */
const INTERRUPT_STT_MIN_CHARS = 5;

const WHISPER_STT_STORAGE_KEY = "brain2-advanced-whisper-stt";
/** OpenAI Whisper — segmento por pausa na fala (browser com stream contínuo). */
const WHISPER_SPEECH_ENV = 0.28;
const WHISPER_SILENCE_HOLD_MS = 750;
const WHISPER_MIN_BYTES = 3200;
const WHISPER_TIMESLICE_MS = 380;
/**
 * Após o envio, o microfone ainda capta a cauda da voz do utilizador — sem isto a "interrupção"
 * abortava o pedido imediatamente e a IA parecia nunca responder.
 */
const LLM_INTERRUPT_GRACE_MS = 1300;

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
    pointsRef.current.rotation.y = state.clock.elapsedTime * 0.005;
    pointsRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.028) * 0.06;
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
  onInterruptResponse,
  isLlmLoading = false,
  lastAssistantText = null,
  assistantReplyEpoch = 0,
  llmError = null,
}: AdvancedVoiceSphereViewProps) {
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [micLevel, setMicLevel] = useState(0);
  const [micStatus, setMicStatus] = useState<"idle" | "listening" | "denied" | "unsupported">("idle");
  const speechEnvelopeRef = useRef(0);
  /** Mesmo valor visual que `micLevel`, actualizado no loop de áudio para deteção de interrupção sem atraso de React. */
  const interruptMicLevelRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [liveTranscript, setLiveTranscript] = useState("");
  /** Transcrição com debounce só para o grafo — evita “refresh” da simulação a cada token do STT. */
  const [transcriptForGraph, setTranscriptForGraph] = useState("");
  /**
   * Snapshot do grafo na 1.ª vez que o vault deixa de carregar — mantém referência e topologia fixas
   * durante toda a sessão de conversa avançada (evita reinício da simulação quando `vaultGraph` do pai
   * é recalculado após guardar conversa / refrescar o vault).
   */
  const [pinnedVaultGraph, setPinnedVaultGraph] = useState<VaultGraph | undefined>(undefined);
  const [sttHint, setSttHint] = useState<string | null>(null);
  const [speechPulsePhase, setSpeechPulsePhase] = useState(0);
  const [localSubmitError, setLocalSubmitError] = useState<string | null>(null);
  /** Whisper OpenAI em vez de Web Speech API (só browser com microfone contínuo). */
  const [whisperSttEnabled, setWhisperSttEnabled] = useState(false);
  const [hasLiveAudioStream, setHasLiveAudioStream] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  /** Voz via OpenAI TTS (mesma API key); em alternativa à síntese do browser. */
  const [openAiTtsOutput, setOpenAiTtsOutput] = useState(() => readOpenAiTtsOutputEnabled());
  /** Erro explícito quando a voz OpenAI falha (evita fallback silencioso para síntese robótica). */
  const [openAiTtsError, setOpenAiTtsError] = useState<string | null>(null);
  /** Reinicia o STT após pausar para TTS. */
  const [sttResumeNonce, setSttResumeNonce] = useState(0);
  const stopSttRef = useRef<(() => void) | null>(null);
  const shouldPlayAssistantTtsRef = useRef(false);
  /** Índice final (exclusivo) sincronizado com `boundary` da síntese; fallback temporal usa o mesmo ref. */
  const ttsBoundaryEndRef = useRef(0);
  const [ttsRevealLength, setTtsRevealLength] = useState(0);
  const liveTranscriptRef = useRef("");
  const sendInFlightRef = useRef(false);
  const isLlmLoadingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const handleSendToModelRef = useRef<() => Promise<void>>(async () => {});
  /** Evita disparar várias vezes a mesma interrupção até a resposta terminar. */
  const userInterruptionFiredRef = useRef(false);
  /** Baseline do STT quando começa `isLlmLoading` (interrupção por texto durante geração). */
  const llmSttBaselineLenRef = useRef(0);
  /** Até este instante não se trata microfone/STT como interrupção durante só a fase de geração LLM. */
  const llmInterruptGraceUntilRef = useRef(0);
  const wasLlmLoadingRef = useRef(false);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  const assistantResponseScrollRef = useRef<HTMLDivElement>(null);
  const advancedVoiceRootRef = useRef<HTMLDivElement>(null);

  const autoSendPauseMs = useMemo(
    () => (isBrain2NativeShell() ? AUTO_SEND_AFTER_PAUSE_MS_NATIVE : AUTO_SEND_AFTER_PAUSE_MS_WEB),
    [],
  );

  useEffect(() => {
    queueMicrotask(() => setTtsSupported(isBrowserSpeechSynthesisAvailable()));
  }, []);

  useEffect(() => {
    const syncOpenAiTts = () => setOpenAiTtsOutput(readOpenAiTtsOutputEnabled());
    window.addEventListener("brain2-openai-tts-changed", syncOpenAiTts);
    return () => window.removeEventListener("brain2-openai-tts-changed", syncOpenAiTts);
  }, []);

  useEffect(() => {
    try {
      setWhisperSttEnabled(window.localStorage.getItem(WHISPER_STT_STORAGE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    return () => {
      cancelAllAssistantSpeech();
    };
  }, []);

  useEffect(() => {
    if (pinnedVaultGraph !== undefined) return;
    if (vaultGraphLoading) return;
    setPinnedVaultGraph(vaultGraph == null ? { nodes: [], edges: [] } : cloneVaultGraph(vaultGraph));
  }, [vaultGraph, vaultGraphLoading, pinnedVaultGraph]);

  /** Safari / WebKit: primeiro toque no ecrã desbloqueia áudio para `HTMLAudioElement.play()` (TTS OpenAI). */
  useLayoutEffect(() => {
    const el = advancedVoiceRootRef.current;
    if (!el) {
      return;
    }
    const unlock = () => {
      try {
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctor) {
          const ctx = new Ctor();
          void ctx.resume().finally(() => {
            ctx.close().catch(() => {});
          });
        }
      } catch {
        /* ignore */
      }
      el.removeEventListener("pointerdown", unlock);
    };
    el.addEventListener("pointerdown", unlock);
    return () => el.removeEventListener("pointerdown", unlock);
  }, []);

  const llmCfgForVoice = loadLlmConfig();
  const hasLlmApiKey = Boolean(llmCfgForVoice?.apiKey?.trim());
  const openAiPlaybackAvailable = Boolean(hasLlmApiKey && readOpenAiTtsOutputEnabled());
  const canAssistantTts = ttsSupported || openAiPlaybackAvailable;

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
        queueMicrotask(() => setHasLiveAudioStream(true));
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
          interruptMicLevelRef.current = env;

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
      queueMicrotask(() => setHasLiveAudioStream(false));
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
      const mic = Math.min(1, Math.max(breath, fromVoice * 0.92 + breath * 0.08));
      interruptMicLevelRef.current = mic;
      setMicLevel(mic);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [micStatus]);

  useEffect(() => {
    if (micStatus !== "listening") {
      return;
    }
    const cfg = loadLlmConfig();
    const useWhisper =
      whisperSttEnabled &&
      Boolean(cfg?.apiKey?.trim()) &&
      hasLiveAudioStream &&
      !isBrain2NativeShell();
    if (useWhisper) {
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
  }, [micStatus, sttResumeNonce, whisperSttEnabled, hasLiveAudioStream]);

  /** Transcrição OpenAI Whisper por segmentos (pausa na fala). */
  useEffect(() => {
    if (micStatus !== "listening") {
      return;
    }
    /**
     * Com o MediaRecorder activo, o micro continua a “prender” o pipeline de áudio em vários
     * browsers (Safari/WebKit): o TTS por áudio da API (`<audio>`) pode ficar mudo, enquanto a
     * síntese do sistema (`speechSynthesis`) ainda passa. Parar a gravação durante a fala do assistente.
     */
    if (isSpeaking) {
      return;
    }
    const cfg = loadLlmConfig();
    const apiKey = cfg?.apiKey?.trim();
    if (!whisperSttEnabled || !apiKey || !hasLiveAudioStream || isBrain2NativeShell()) {
      return;
    }
    const stream = streamRef.current;
    if (!stream) {
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch {
      queueMicrotask(() =>
        setSttHint("Gravação de áudio indisponível. Use o reconhecimento do browser ou outro dispositivo."),
      );
      return;
    }

    const phraseChunks: Blob[] = [];
    let collecting = false;
    let silenceAccumMs = 0;
    let lastFrameT = performance.now();
    let whisperBusy = false;
    let raf = 0;

    const flushPhrase = () => {
      if (phraseChunks.length === 0) {
        return;
      }
      const blob = new Blob(phraseChunks, { type: recorder.mimeType });
      phraseChunks.length = 0;
      collecting = false;
      silenceAccumMs = 0;
      if (blob.size < WHISPER_MIN_BYTES) {
        return;
      }
      if (whisperBusy) {
        return;
      }
      whisperBusy = true;
      queueMicrotask(() => setSttHint("A transcrever (Whisper)…"));
      void transcribeAudioBlobWithOpenAI(blob, apiKey, { mimeTypeHint: recorder.mimeType })
        .then((text) => {
          const t = text.trim();
          if (t) {
            setLiveTranscript((prev) => (prev ? `${prev} ${t}` : t).trim());
          }
          setSttHint(null);
        })
        .catch((e: unknown) => {
          setSttHint(e instanceof Error ? e.message : "Falha na transcrição Whisper.");
        })
        .finally(() => {
          whisperBusy = false;
        });
    };

    recorder.addEventListener("dataavailable", (ev: BlobEvent) => {
      if (!collecting || !ev.data?.size) {
        return;
      }
      phraseChunks.push(ev.data);
    });

    try {
      recorder.start(WHISPER_TIMESLICE_MS);
    } catch {
      queueMicrotask(() => setSttHint("Não foi possível iniciar a gravação para Whisper."));
      return;
    }

    const tick = () => {
      if (isLlmLoadingRef.current) {
        collecting = false;
        silenceAccumMs = 0;
        phraseChunks.length = 0;
      }
      const now = performance.now();
      const dt = Math.min(120, now - lastFrameT);
      lastFrameT = now;
      const env = speechEnvelopeRef.current;
      if (env >= WHISPER_SPEECH_ENV) {
        collecting = true;
        silenceAccumMs = 0;
      } else if (collecting) {
        silenceAccumMs += dt;
        if (silenceAccumMs >= WHISPER_SILENCE_HOLD_MS) {
          flushPhrase();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      try {
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      } catch {
        /* ignore */
      }
      phraseChunks.length = 0;
      queueMicrotask(() => {
        setSttHint(null);
      });
    };
  }, [micStatus, sttResumeNonce, whisperSttEnabled, hasLiveAudioStream, isSpeaking]);

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

  const stopAssistantAudioOnly = useCallback(() => {
    cancelAllAssistantSpeech();
    const len = lastAssistantText?.trim().length ?? 0;
    ttsBoundaryEndRef.current = len;
    setTtsRevealLength(len);
    setIsSpeaking(false);
    setSttResumeNonce((n) => n + 1);
  }, [lastAssistantText]);

  const handleStopVoice = useCallback(() => {
    stopAssistantAudioOnly();
  }, [stopAssistantAudioOnly]);

  const triggerUserInterrupt = useCallback(() => {
    if (userInterruptionFiredRef.current) {
      return;
    }
    if (!isLlmLoadingRef.current && !isSpeakingRef.current) {
      return;
    }
    if (
      isLlmLoadingRef.current &&
      !isSpeakingRef.current &&
      performance.now() < llmInterruptGraceUntilRef.current
    ) {
      return;
    }
    userInterruptionFiredRef.current = true;
    shouldPlayAssistantTtsRef.current = false;
    stopAssistantAudioOnly();
    onInterruptResponse?.();
  }, [stopAssistantAudioOnly, onInterruptResponse]);

  /** Ao começar a gerar resposta, ignorar interrupções durante GRACE (cauda da fala no micro). */
  useEffect(() => {
    if (isLlmLoading && !wasLlmLoadingRef.current) {
      llmInterruptGraceUntilRef.current = performance.now() + LLM_INTERRUPT_GRACE_MS;
    }
    wasLlmLoadingRef.current = isLlmLoading;
  }, [isLlmLoading]);

  useEffect(() => {
    if (!isLlmLoading && !isSpeaking) {
      userInterruptionFiredRef.current = false;
    }
  }, [isLlmLoading, isSpeaking]);

  useEffect(() => {
    if (isLlmLoading) {
      queueMicrotask(() => {
        llmSttBaselineLenRef.current = liveTranscriptRef.current.trim().length;
      });
    }
  }, [isLlmLoading]);

  /** Interrupção por texto enquanto o modelo gera (sem voz do assistente — evita eco no STT). */
  useEffect(() => {
    if (!onInterruptResponse) {
      return;
    }
    if (!isLlmLoading || isSpeaking) {
      return;
    }
    const len = liveTranscript.trim().length;
    if (len < INTERRUPT_STT_MIN_CHARS || len <= llmSttBaselineLenRef.current) {
      return;
    }
    triggerUserInterrupt();
  }, [liveTranscript, isLlmLoading, isSpeaking, onInterruptResponse, triggerUserInterrupt]);

  /** Interrupção por energia de voz (LLM ou TTS). */
  useEffect(() => {
    if (!onInterruptResponse) {
      return;
    }
    const native = isBrain2NativeShell();
    const thresh = native ? INTERRUPT_MIC_THRESH_NATIVE : INTERRUPT_MIC_THRESH_WEB;
    let raf = 0;
    let loudSince: number | null = null;

    const loop = () => {
      const busy = isLlmLoadingRef.current || isSpeakingRef.current;
      if (!busy) {
        loudSince = null;
      } else if (!userInterruptionFiredRef.current) {
        if (
          isLlmLoadingRef.current &&
          !isSpeakingRef.current &&
          performance.now() < llmInterruptGraceUntilRef.current
        ) {
          loudSince = null;
        } else {
          const level = interruptMicLevelRef.current;
          if (level >= thresh) {
            if (loudSince === null) {
              loudSince = performance.now();
            } else if (performance.now() - loudSince >= INTERRUPT_MIC_HOLD_MS) {
              triggerUserInterrupt();
              loudSince = null;
            }
          } else if (level < thresh * 0.65) {
            loudSince = null;
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [onInterruptResponse, triggerUserInterrupt]);

  const runAssistantTts = useCallback((trimmed: string) => {
    const fullLen = trimmed.length;
    ttsBoundaryEndRef.current = 0;
    setTtsRevealLength(0);

    const cfg = loadLlmConfig();
    const preferOpenAiTts = readOpenAiTtsOutputEnabled();
    const useOpenAi = Boolean(cfg?.apiKey?.trim() && preferOpenAiTts);

    const finishBrowserStyle = () => {
      ttsBoundaryEndRef.current = fullLen;
      setTtsRevealLength(fullLen);
      setIsSpeaking(false);
      setOpenAiTtsError(null);
      setSttResumeNonce((n) => n + 1);
    };

    const runBrowser = () => {
      if (!isBrowserSpeechSynthesisAvailable()) {
        finishBrowserStyle();
        return;
      }
      /** Imediato — para o Whisper `MediaRecorder` antes da síntese (mesma razão que OpenAI TTS). */
      setIsSpeaking(true);
      speakBrowserText(trimmed, {
        onStart: () => {
          setIsSpeaking(true);
        },
        onBoundary: (ev) => {
          const end = ev.charIndex + (ev.charLength ?? 0);
          ttsBoundaryEndRef.current = Math.max(ttsBoundaryEndRef.current, end);
          setTtsRevealLength((prev) => Math.min(fullLen, Math.max(prev, ttsBoundaryEndRef.current)));
        },
        onEnd: finishBrowserStyle,
        onError: finishBrowserStyle,
      });
    };

    if (useOpenAi && cfg?.apiKey) {
      cancelAllAssistantSpeech();
      setOpenAiTtsError(null);
      setIsSpeaking(true);
      void playOpenAiSpeech(trimmed, cfg.apiKey, {
        onStart: () => setIsSpeaking(true),
        onTimeUpdate: (ratio) => {
          const end = Math.min(fullLen, Math.max(1, Math.floor(ratio * fullLen)));
          ttsBoundaryEndRef.current = end;
          setTtsRevealLength(end);
        },
        onEnd: () => {
          finishBrowserStyle();
        },
        onError: (msg) => {
          setOpenAiTtsError(
            `${msg} — A tentar voz do browser (a API OpenAI pode estar bloqueada pelo autoplay até tocar no ecrã).`,
          );
          if (isBrowserSpeechSynthesisAvailable()) {
            runBrowser();
          } else {
            finishBrowserStyle();
          }
        },
      });
      return;
    }

    runBrowser();
  }, []);

  const handleReplayVoice = useCallback(() => {
    const t = lastAssistantText?.trim();
    if (!t || !canAssistantTts || !ttsEnabled || isLlmLoading) {
      return;
    }
    stopSttRef.current?.();
    runAssistantTts(t);
  }, [lastAssistantText, canAssistantTts, ttsEnabled, isLlmLoading, runAssistantTts]);

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
    const cfg = loadLlmConfig();
    const openAiOk = Boolean(cfg?.apiKey?.trim() && readOpenAiTtsOutputEnabled());
    if (!isBrowserSpeechSynthesisAvailable() && !openAiOk) {
      shouldPlayAssistantTtsRef.current = false;
      return;
    }

    shouldPlayAssistantTtsRef.current = false;

    stopSttRef.current?.();
    runAssistantTts(text);
  }, [isLlmLoading, lastAssistantText, ttsEnabled, assistantReplyEpoch, runAssistantTts]);

  /** Se o motor não emitir `boundary`, avança o texto a um ritmo compatível com a fala. */
  useEffect(() => {
    if (!isSpeaking) {
      return;
    }
    const full = (lastAssistantText ?? "").trim();
    const fullLen = full.length;
    if (!fullLen) {
      return;
    }
    const t0 = performance.now();
    const charsPerSec = 14;
    const tick = () => {
      const elapsed = (performance.now() - t0) / 1000;
      const fallbackEnd = Math.min(fullLen, Math.floor(elapsed * charsPerSec));
      setTtsRevealLength((prev) =>
        Math.min(fullLen, Math.max(prev, ttsBoundaryEndRef.current, fallbackEnd)),
      );
    };
    tick();
    const id = window.setInterval(tick, 45);
    return () => window.clearInterval(id);
  }, [isSpeaking, lastAssistantText]);

  const combinedLlmError = localSubmitError || llmError;

  /** Texto visível da resposta: em TTS activo, revela em sincronia com a fala (`boundary` + fallback). */
  const assistantVisibleText = useMemo(() => {
    const raw = lastAssistantText ?? "";
    const spoken = raw.trim();
    if (!spoken) {
      return raw;
    }
    if (!ttsEnabled || !isSpeaking) {
      return raw;
    }
    const n = Math.max(ttsRevealLength, 1);
    return spoken.slice(0, Math.min(n, spoken.length));
  }, [lastAssistantText, ttsEnabled, isSpeaking, ttsRevealLength]);

  const assistantSpokenLen = (lastAssistantText ?? "").trim().length;
  const showAssistantTypingCaret =
    Boolean(lastAssistantText) && ttsEnabled && isSpeaking && assistantSpokenLen > 0 && ttsRevealLength < assistantSpokenLen;

  /** Mantém a transcrição e a resposta visíveis na última linha (efeito “tempo real”). */
  const scrollPanelToBottom = useCallback((el: HTMLDivElement | null) => {
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    scrollPanelToBottom(transcriptScrollRef.current);
  }, [liveTranscript, micStatus, sttHint, scrollPanelToBottom]);

  useLayoutEffect(() => {
    scrollPanelToBottom(assistantResponseScrollRef.current);
  }, [
    assistantVisibleText,
    isLlmLoading,
    lastAssistantText,
    ttsRevealLength,
    showAssistantTypingCaret,
    scrollPanelToBottom,
  ]);

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

  const nativeShell = isBrain2NativeShell();

  const graphForBrain: VaultGraph | null =
    pinnedVaultGraph !== undefined ? pinnedVaultGraph : (vaultGraph ?? null);
  const graphLoadingForBrain = pinnedVaultGraph !== undefined ? false : vaultGraphLoading;

  return (
    <div
      ref={advancedVoiceRootRef}
      className={`advanced-voice-root advanced-voice-root--${themeMode}${nativeShell ? " advanced-voice-root--native-shell" : ""}`}
    >
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
          graph={graphForBrain}
          loading={graphLoadingForBrain}
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
        <div className="advanced-voice-user-chat-card">
          <div
            ref={transcriptScrollRef}
            className="advanced-voice-transcript-body"
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
            <div className="advanced-voice-user-chat-toolbar">
              {hasLlmApiKey ? (
                <label
                  className="advanced-voice-toggle-compact advanced-voice-toggle-compact--in-user-chat"
                  title="Transcrição via Whisper (OpenAI). Custo por áudio."
                >
                  <input
                    type="checkbox"
                    checked={whisperSttEnabled}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setWhisperSttEnabled(v);
                      try {
                        window.localStorage.setItem(WHISPER_STT_STORAGE_KEY, v ? "1" : "0");
                      } catch {
                        /* ignore */
                      }
                      setSttResumeNonce((n) => n + 1);
                      if (v) {
                        setSttHint(null);
                      }
                    }}
                  />
                  <span>Whisper</span>
                </label>
              ) : null}
              <div className="advanced-voice-user-chat-actions" aria-label="Acções da transcrição">
                <button
                  type="button"
                  className="advanced-voice-action-icon advanced-voice-send-now"
                  onClick={() => void handleSendToModel()}
                  disabled={!liveTranscript.trim() || isLlmLoading || !onSubmitTranscript}
                  aria-label="Enviar agora"
                  title="Enviar agora"
                >
                  {isLlmLoading ? (
                    <Loader2 size={14} strokeWidth={1.8} className="spin" aria-hidden />
                  ) : (
                    <Send size={14} strokeWidth={2} aria-hidden />
                  )}
                </button>
                {canAssistantTts && lastAssistantText && !isLlmLoading ? (
                  isSpeaking ? (
                    <button
                      type="button"
                      className="advanced-voice-action-icon"
                      onClick={handleStopVoice}
                      aria-label="Parar áudio"
                      title="Parar áudio"
                    >
                      <Square size={14} strokeWidth={2} aria-hidden />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="advanced-voice-action-icon"
                      onClick={handleReplayVoice}
                      disabled={!ttsEnabled}
                      aria-label="Ouvir de novo"
                      title="Ouvir de novo"
                    >
                      <RotateCcw size={14} strokeWidth={2} aria-hidden />
                    </button>
                  )
                ) : null}
                {canAssistantTts ? (
                  <button
                    type="button"
                    className={`advanced-voice-action-icon advanced-voice-tts-icon${ttsEnabled ? " advanced-voice-tts-icon--on" : ""}`}
                    onClick={() => {
                      setTtsEnabled((prev) => {
                        if (prev) {
                          cancelAllAssistantSpeech();
                          setIsSpeaking(false);
                          setSttResumeNonce((n) => n + 1);
                        }
                        return !prev;
                      });
                    }}
                    aria-pressed={ttsEnabled}
                    aria-label="Resposta em voz"
                    title="Resposta em voz"
                  >
                    {ttsEnabled ? (
                      <Volume2 size={14} strokeWidth={2} aria-hidden />
                    ) : (
                      <VolumeX size={14} strokeWidth={2} aria-hidden />
                    )}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {onSubmitTranscript ? (
          <div className="advanced-voice-llm-panel">
            {combinedLlmError ? (
              <p className="advanced-voice-llm-error" role="alert">
                {combinedLlmError}
              </p>
            ) : null}
            {openAiTtsError ? (
              <p className="advanced-voice-llm-error advanced-voice-llm-error--soft" role="status">
                {openAiTtsError}
              </p>
            ) : null}
            {!canAssistantTts ? (
              <p className="advanced-voice-tts-unavailable">
                Voz indisponível: API key (TTS OpenAI) ou síntese do browser.
              </p>
            ) : null}
            <div className="advanced-voice-reply-row">
              <div className="advanced-voice-assistant-col">
                {isLlmLoading || lastAssistantText ? (
                  <div className="advanced-voice-assistant-out">
                    <div ref={assistantResponseScrollRef} className="advanced-voice-assistant-body">
                      {isLlmLoading ? (
                        <div className="advanced-voice-assistant-loading">
                          <Loader2 size={16} strokeWidth={1.8} className="spin" aria-hidden />
                          <span>A gerar resposta…</span>
                        </div>
                      ) : null}
                      {lastAssistantText ? (
                        <>
                          <p className="advanced-voice-assistant-label">Resposta</p>
                          <p className="advanced-voice-assistant-text">
                            {assistantVisibleText}
                            {showAssistantTypingCaret ? (
                              <span className="advanced-voice-assistant-tts-caret" aria-hidden />
                            ) : null}
                          </p>
                        </>
                      ) : null}
                    </div>
                    {hasLlmApiKey ? (
                      <div className="advanced-voice-assistant-toolbar">
                        <label
                          className="advanced-voice-toggle-compact advanced-voice-toggle-compact--in-llm"
                          title="Ler respostas com OpenAI TTS (mesma API key). Custo por carácter."
                        >
                          <input
                            type="checkbox"
                            checked={openAiTtsOutput}
                            onChange={(e) => {
                              const v = e.target.checked;
                              setOpenAiTtsOutput(v);
                              setOpenAiTtsOutputEnabled(v);
                              setSttResumeNonce((n) => n + 1);
                            }}
                          />
                          <span>Voz API</span>
                        </label>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="advanced-voice-assistant-out advanced-voice-assistant-out--placeholder">
                    <div className="advanced-voice-assistant-body">
                      <p className="advanced-voice-assistant-label">Resposta</p>
                      <p className="advanced-voice-assistant-placeholder">Ainda sem resposta.</p>
                    </div>
                    {hasLlmApiKey ? (
                      <div className="advanced-voice-assistant-toolbar">
                        <label
                          className="advanced-voice-toggle-compact advanced-voice-toggle-compact--in-llm"
                          title="Ler respostas com OpenAI TTS (mesma API key). Custo por carácter."
                        >
                          <input
                            type="checkbox"
                            checked={openAiTtsOutput}
                            onChange={(e) => {
                              const v = e.target.checked;
                              setOpenAiTtsOutput(v);
                              setOpenAiTtsOutputEnabled(v);
                              setSttResumeNonce((n) => n + 1);
                            }}
                          />
                          <span>Voz API</span>
                        </label>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
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

        /* Desktop (browser) e app nativo (macOS / shell): chats alinhados à esquerda */
        @media (min-width: 900px) {
          .advanced-voice-voice-dock {
            align-items: flex-start;
          }

          .advanced-voice-user-chat-card,
          .advanced-voice-llm-panel {
            margin-left: 0;
            margin-right: auto;
          }

          .advanced-voice-reply-row {
            justify-content: flex-start;
          }

          .advanced-voice-assistant-col {
            align-self: flex-start;
          }

          .advanced-voice-llm-panel .advanced-voice-llm-error,
          .advanced-voice-llm-panel .advanced-voice-tts-unavailable {
            text-align: left;
          }
        }

        .advanced-voice-root--native-shell .advanced-voice-voice-dock {
          align-items: flex-start;
        }

        .advanced-voice-root--native-shell .advanced-voice-user-chat-card,
        .advanced-voice-root--native-shell .advanced-voice-llm-panel {
          margin-left: 0;
          margin-right: auto;
        }

        .advanced-voice-root--native-shell .advanced-voice-reply-row {
          justify-content: flex-start;
        }

        .advanced-voice-root--native-shell .advanced-voice-assistant-col {
          align-self: flex-start;
        }

        .advanced-voice-root--native-shell .advanced-voice-llm-panel .advanced-voice-llm-error,
        .advanced-voice-root--native-shell .advanced-voice-llm-panel .advanced-voice-tts-unavailable {
          text-align: left;
        }

        .advanced-voice-user-chat-card {
          display: flex;
          flex-direction: column;
          width: min(640px, 96vw);
          margin: 0 auto;
          border-radius: 14px;
          border: 1px solid var(--bar-border);
          background: rgba(10, 11, 14, 0.58);
          backdrop-filter: blur(14px);
          box-sizing: border-box;
          overflow: hidden;
          pointer-events: auto;
        }

        .advanced-voice-root--light .advanced-voice-user-chat-card {
          background: rgba(255, 255, 255, 0.72);
        }

        .advanced-voice-transcript-body {
          max-height: min(30vh, 220px);
          min-height: 52px;
          overflow-x: hidden;
          overflow-y: auto;
          padding: 12px 14px;
          box-sizing: border-box;
        }

        .advanced-voice-user-chat-toolbar {
          display: flex;
          flex-direction: row;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 8px 10px;
          border-top: 1px solid var(--bar-border);
          background: rgba(8, 9, 12, 0.35);
        }

        .advanced-voice-root--light .advanced-voice-user-chat-toolbar {
          background: rgba(255, 255, 255, 0.4);
        }

        .advanced-voice-user-chat-actions {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
          margin-left: auto;
        }

        .advanced-voice-action-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          min-height: 36px;
          padding: 0;
          border-radius: 10px;
          border: 1px solid var(--bar-border);
          background: rgba(10, 11, 14, 0.55);
          color: var(--muted);
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease, opacity 0.15s ease, border-color 0.15s ease;
        }

        .advanced-voice-root--light .advanced-voice-action-icon {
          background: rgba(255, 255, 255, 0.65);
        }

        .advanced-voice-action-icon:hover:not(:disabled) {
          background: rgba(80, 140, 220, 0.12);
          color: var(--foreground);
        }

        .advanced-voice-action-icon:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .advanced-voice-tts-icon--on {
          border-color: rgba(120, 200, 255, 0.45);
          color: var(--foreground);
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
          width: min(640px, 96vw);
          display: flex;
          flex-direction: column;
          gap: 5px;
          pointer-events: auto;
          margin: 0 auto;
        }

        .advanced-voice-reply-row {
          display: flex;
          flex-direction: row;
          align-items: stretch;
          justify-content: center;
          width: 100%;
          min-height: 0;
        }

        .advanced-voice-toggle-compact {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin: 0;
          padding: 6px 8px;
          border-radius: 8px;
          border: 1px solid var(--bar-border);
          background: rgba(10, 11, 14, 0.4);
          font-family: 'Inter', system-ui, sans-serif;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.02em;
          line-height: 1.2;
          color: var(--muted);
          cursor: pointer;
          user-select: none;
          white-space: nowrap;
        }

        .advanced-voice-root--light .advanced-voice-toggle-compact {
          background: rgba(255, 255, 255, 0.55);
        }

        .advanced-voice-toggle-compact input {
          margin: 0;
          flex-shrink: 0;
        }

        .advanced-voice-toggle-compact--in-user-chat {
          margin: 0;
        }

        .advanced-voice-toggle-compact--in-llm {
          width: 100%;
          justify-content: flex-start;
        }

        .advanced-voice-assistant-col {
          flex: 1 1 auto;
          min-width: 0;
          display: flex;
          flex-direction: column;
          min-height: 0;
          width: 100%;
          max-width: min(640px, 96vw);
        }

        .advanced-voice-assistant-toolbar {
          flex-shrink: 0;
          padding: 5px 8px;
          border-top: 1px solid var(--bar-border);
          background: rgba(8, 9, 12, 0.28);
        }

        .advanced-voice-root--light .advanced-voice-assistant-toolbar {
          background: rgba(255, 255, 255, 0.35);
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

        .advanced-voice-llm-error--soft {
          font-size: 11px;
          color: #c9a227;
          text-align: left;
        }

        .advanced-voice-root--light .advanced-voice-llm-error--soft {
          color: #8a6d1a;
        }

        .advanced-voice-root--light .advanced-voice-llm-error {
          color: #c43d3d;
        }

        .advanced-voice-assistant-out {
          display: flex;
          flex-direction: column;
          min-height: 48px;
          max-height: min(20vh, 132px);
          border-radius: 10px;
          border: 1px solid var(--bar-border);
          background: rgba(10, 11, 14, 0.5);
          backdrop-filter: blur(12px);
          overflow: hidden;
        }

        .advanced-voice-assistant-body {
          flex: 1;
          min-height: 0;
          overflow: auto;
          padding: 6px 8px;
        }

        .advanced-voice-assistant-out--placeholder {
          opacity: 0.85;
        }

        .advanced-voice-assistant-out--placeholder .advanced-voice-assistant-body {
          flex: 1;
        }

        .advanced-voice-assistant-placeholder {
          margin: 0;
          font-size: 11px;
          line-height: 1.35;
          color: var(--muted);
          font-style: italic;
        }

        .advanced-voice-root--light .advanced-voice-assistant-out {
          background: rgba(255, 255, 255, 0.65);
        }

        .advanced-voice-assistant-loading {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          color: var(--muted);
          margin-bottom: 4px;
        }

        .advanced-voice-assistant-loading:last-child {
          margin-bottom: 0;
        }

        .advanced-voice-assistant-label {
          margin: 0 0 3px;
          font-size: 9px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--muted);
        }

        .advanced-voice-assistant-text {
          margin: 0;
          font-size: 12px;
          line-height: 1.38;
          color: var(--foreground);
          white-space: pre-wrap;
          word-break: break-word;
        }

        .advanced-voice-assistant-tts-caret {
          display: inline-block;
          width: 2px;
          height: 1em;
          margin-left: 1px;
          vertical-align: text-bottom;
          background: var(--foreground);
          opacity: 0.55;
          animation: advanced-voice-caret-blink 0.92s step-end infinite;
        }

        @keyframes advanced-voice-caret-blink {
          50% {
            opacity: 0;
          }
        }

        .advanced-voice-send-now {
          border-style: dashed;
        }

        .advanced-voice-send-now:hover:not(:disabled) {
          background: rgba(80, 140, 220, 0.12);
          color: var(--foreground);
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
          align-self: center;
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
