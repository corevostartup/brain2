"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import { X, Mic, MicOff } from "lucide-react";
import * as THREE from "three";
import BrainGraphView from "@/components/BrainGraphView";
import type { VaultGraph } from "@/lib/vault";

type AdvancedVoiceSphereViewProps = {
  onClose: () => void;
  vaultGraph?: VaultGraph | null;
  vaultGraphLoading?: boolean;
};

type WaveBarProps = {
  index: number;
  total: number;
  radius: number;
  color: string;
  emissive: string;
};

type ThemeMode = "dark" | "light";

type ScenePalette = {
  fogColor: string;
  primaryLightColor: string;
  secondaryLightColor: string;
  coreColor: string;
  coreEmissive: string;
  shellColor: string;
  particleColor: string;
  barColor: string;
  barEmissive: string;
};

const BAR_COUNT = 30;
const ADVANCED_VOICE_CLUSTER_SCALE = 0.5;

const DARK_PALETTE: ScenePalette = {
  fogColor: "#0c0d10",
  primaryLightColor: "#d0d5e1",
  secondaryLightColor: "#656c7b",
  coreColor: "#c7ccd6",
  coreEmissive: "#555d6c",
  shellColor: "#d5dae4",
  particleColor: "#c9cfda",
  barColor: "#d0d4dd",
  barEmissive: "#585f6d",
};

const LIGHT_PALETTE: ScenePalette = {
  fogColor: "#eeeff2",
  primaryLightColor: "#fefefe",
  secondaryLightColor: "#8f97a6",
  coreColor: "#525965",
  coreEmissive: "#232833",
  shellColor: "#69717f",
  particleColor: "#6f7684",
  barColor: "#454c58",
  barEmissive: "#252b36",
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

function OrganicCore({ color, emissive }: { color: string; emissive: string }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((_state, delta) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.y += delta * 0.26;
    meshRef.current.rotation.x += delta * 0.08;
  });

  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      <icosahedronGeometry args={[0.84, 64]} />
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={0.62}
        roughness={0.18}
        metalness={0.46}
      />
    </mesh>
  );
}

function PulseShell({ color }: { color: string }) {
  const shellRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!shellRef.current) return;
    const t = state.clock.elapsedTime;
    const scale = 1.42 + Math.sin(t * 1.65) * 0.05;
    shellRef.current.scale.setScalar(scale);
    shellRef.current.rotation.y = t * 0.07;
  });

  return (
    <mesh ref={shellRef}>
      <icosahedronGeometry args={[0.9, 2]} />
      <meshBasicMaterial color={color} transparent opacity={0.12} wireframe />
    </mesh>
  );
}

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

function WaveBar({ index, total, radius, color, emissive }: WaveBarProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const angle = (index / total) * Math.PI * 2;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;
    const pulse = Math.sin(t * 2.8 + index * 0.52) * 0.5 + 0.5;
    const altitude = Math.sin(t * 1.35 + index * 0.28) * 0.5 + 0.5;
    const scaleY = 0.32 + pulse * 1.05;

    meshRef.current.scale.y = scaleY;
    meshRef.current.position.y = -0.16 + scaleY * 0.11 + altitude * 0.04;
  });

  return (
    <mesh ref={meshRef} position={[x, -0.08, z]} rotation={[0, -angle, 0]}>
      <boxGeometry args={[0.03, 0.36, 0.03]} />
      <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.34} roughness={0.44} metalness={0.26} />
    </mesh>
  );
}

function WaveRing({ color, emissive }: { color: string; emissive: string }) {
  return (
    <group>
      {Array.from({ length: BAR_COUNT }, (_, index) => (
        <WaveBar key={index} index={index} total={BAR_COUNT} radius={1.72} color={color} emissive={emissive} />
      ))}
    </group>
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
        analyser.smoothingTimeConstant = 0.65;
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
          smoothRef.current = smoothRef.current * 0.82 + instant * 0.18;
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

  return (
    <div className={`advanced-voice-root advanced-voice-root--${themeMode}`}>
      <div className="advanced-voice-bg" aria-hidden>
        <Canvas camera={{ position: [0, 0, 5.4], fov: 40 }} dpr={[1, 2]} gl={{ alpha: true }} style={{ background: "transparent" }}>
          <fog attach="fog" args={[palette.fogColor, 4.2, 8.6]} />
          <ambientLight intensity={0.26} />
          <pointLight position={[3.2, 2.2, 2.2]} intensity={1.02} color={palette.primaryLightColor} />
          <pointLight position={[-3.6, -1.9, -2.2]} intensity={0.66} color={palette.secondaryLightColor} />
          <ParticleHalo color={palette.particleColor} />
          <group scale={ADVANCED_VOICE_CLUSTER_SCALE}>
            <Float speed={1.02} rotationIntensity={0.26} floatIntensity={0.32}>
              <OrganicCore color={palette.coreColor} emissive={palette.coreEmissive} />
              <PulseShell color={palette.shellColor} />
            </Float>
            <WaveRing color={palette.barColor} emissive={palette.barEmissive} />
          </group>
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

      <div className="advanced-voice-mic-bar" aria-live="polite">
        {micStatus === "denied" || micStatus === "unsupported" ? (
          <MicOff size={14} strokeWidth={2} aria-hidden />
        ) : (
          <Mic size={14} strokeWidth={2} aria-hidden />
        )}
        <span>{micLabel}</span>
        {micStatus === "listening" ? (
          <span className="advanced-voice-mic-meter" style={{ transform: `scaleX(${0.08 + micLevel * 0.92})` }} />
        ) : null}
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

        .advanced-voice-mic-bar {
          position: absolute;
          left: 50%;
          bottom: clamp(14px, 3vh, 28px);
          transform: translateX(-50%);
          z-index: 30;
          display: flex;
          align-items: center;
          gap: 10px;
          max-width: min(560px, calc(100% - 28px));
          padding: 8px 14px;
          border-radius: 999px;
          border: 1px solid var(--bar-border);
          background: rgba(10, 11, 14, 0.42);
          color: rgba(198, 204, 216, 0.88);
          font-family: "Inter", sans-serif;
          font-size: 11px;
          letter-spacing: 0.04em;
          backdrop-filter: blur(12px);
          pointer-events: none;
        }

        .advanced-voice-root--light .advanced-voice-mic-bar {
          background: rgba(255, 255, 255, 0.55);
          color: rgba(52, 58, 68, 0.9);
        }

        .advanced-voice-mic-meter {
          margin-left: 4px;
          height: 4px;
          width: 72px;
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(120, 200, 255, 0.35), rgba(180, 140, 255, 0.55));
          transform-origin: left center;
          transition: transform 0.08s ease-out;
        }
      `}</style>
    </div>
  );
}
