"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { X, Mic, MicOff } from "lucide-react";
import * as THREE from "three";
import BrainGraphView from "@/components/BrainGraphView";
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
  const smoothRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

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
      setMicStatus("unsupported");
      return;
    }

    let cancelled = false;
    let raf = 0;
    const buf = new Uint8Array(2048);

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
        analyser.smoothingTimeConstant = 0.82;
        src.connect(analyser);
        setMicStatus("listening");

        let frame = 0;
        const loop = () => {
          if (cancelled) return;
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i += 1) {
            const v = (buf[i]! - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          const instant = Math.min(1, rms * 3.2);
          smoothRef.current = smoothRef.current * 0.91 + instant * 0.09;
          frame += 1;
          if (frame % 2 === 0) {
            setMicLevel(smoothRef.current);
          }
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

        .advanced-voice-mic-wrap {
          position: absolute;
          left: 50%;
          bottom: clamp(18px, 4vh, 36px);
          transform: translateX(-50%);
          z-index: 30;
          width: 52px;
          height: 52px;
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
