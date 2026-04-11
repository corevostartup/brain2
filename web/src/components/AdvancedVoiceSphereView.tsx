"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { X, Mic, MicOff } from "lucide-react";
import * as THREE from "three";
import BrainGraphView from "@/components/BrainGraphView";
import { getSpeechRecognitionConstructor, startLiveTranscription } from "@/lib/browserSpeechRecognition";
import type { VaultGraph } from "@/lib/vault";

type AdvancedVoiceSphereViewProps = {
  onClose: () => void;
  vaultGraph?: VaultGraph | null;
  vaultGraphLoading?: boolean;
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
}: AdvancedVoiceSphereViewProps) {
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [micLevel, setMicLevel] = useState(0);
  const [micStatus, setMicStatus] = useState<"idle" | "listening" | "denied" | "unsupported">("idle");
  const speechEnvelopeRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [sttHint, setSttHint] = useState<string | null>(null);

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
        analyser.smoothingTimeConstant = native ? 0.45 : 0.72;
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

          const rmsGain = native ? 11.2 : 5.4;
          const rmsNorm = Math.min(1, rms * rmsGain);
          const combined = Math.min(1, rmsNorm * 0.36 + bandNorm * 0.64);
          const knee = native ? 3.7 : 2.55;
          const lifted = 1 - Math.exp(-combined * knee);

          let env = speechEnvelopeRef.current;
          const attack = native ? 0.62 : 0.48;
          const release = native ? 0.34 : 0.26;
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

    const stop = startLiveTranscription(
      {
        onText: (text) => {
          setLiveTranscript(text);
          setSttHint(null);
        },
        onError: (code) => {
          if (code === "denied") {
            setSttHint("Permissão de microfone ou reconhecimento de voz recusada.");
          } else if (code === "unsupported") {
            setSttHint("Reconhecimento de voz indisponível neste browser.");
          } else if (code !== "aborted") {
            setSttHint("Reconhecimento interrompido. Fale de novo para continuar.");
          }
        },
      },
      { lang: "pt-BR" },
    );

    return () => {
      stop();
      queueMicrotask(() => {
        setLiveTranscript("");
        setSttHint(null);
      });
    };
  }, [micStatus]);

  const noop = useCallback(() => {}, []);

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
                À escuta… fale — a transcrição aparece aqui em tempo real.
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
