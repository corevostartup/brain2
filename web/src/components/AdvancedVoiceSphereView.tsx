"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import { X, Mic, MicOff } from "lucide-react";
import * as THREE from "three";
import BrainGraphView from "@/components/BrainGraphView";
import type { VaultGraph } from "@/lib/vault";
import { computeLiveSpeechHighlights } from "@/lib/liveSpeechBrainHighlight";

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
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [livePulsePhase, setLivePulsePhase] = useState(0);

  const combinedTranscript = useMemo(
    () => [finalTranscript, interimTranscript].filter(Boolean).join(" ").trim(),
    [finalTranscript, interimTranscript]
  );

  const { nodeStrength, linkKeys } = useMemo(
    () => computeLiveSpeechHighlights(combinedTranscript, vaultGraph ?? null),
    [combinedTranscript, vaultGraph]
  );

  useEffect(() => {
    const syncTheme = () => {
      setThemeMode(resolveThemeMode());
    };
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    if (document.body) {
      observer.observe(document.body, { attributes: true, attributeFilter: ["data-theme"] });
    }
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 28) {
        last = t;
        setLivePulsePhase((p) => p + 0.09);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const W = window as Window & {
      SpeechRecognition?: new () => unknown;
      webkitSpeechRecognition?: new () => unknown;
    };
    const SR = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!SR) {
      setSpeechError("unsupported");
      return;
    }

    let cancelled = false;
    let fatalSpeech = false;
    const recognition = new SR() as {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      start: () => void;
      stop: () => void;
      abort: () => void;
      onresult: ((ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
      onerror: ((ev: { error: string }) => void) | null;
      onend: (() => void) | null;
    };
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "pt-BR";

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i][0]?.transcript ?? "";
        if (event.results[i].isFinal) {
          setFinalTranscript((prev) => `${prev} ${piece}`.trim());
        } else {
          interim += piece;
        }
      }
      setInterimTranscript(interim.trim());
    };

    recognition.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        fatalSpeech = true;
        setSpeechError("permission");
      } else if (ev.error !== "no-speech" && ev.error !== "aborted") {
        setSpeechError(ev.error);
      }
    };

    recognition.onend = () => {
      if (cancelled || fatalSpeech) return;
      try {
        recognition.start();
      } catch {
        /* já activo */
      }
    };

    try {
      recognition.start();
    } catch {
      setSpeechError("start-failed");
    }

    return () => {
      cancelled = true;
      try {
        recognition.stop();
        recognition.abort();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const noop = useCallback(() => {}, []);

  const palette = themeMode === "light" ? LIGHT_PALETTE : DARK_PALETTE;

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

      <div className="advanced-voice-center-orb">
        <div className="advanced-voice-glass-ring" aria-hidden />
        <div className="advanced-voice-brain-host">
          <BrainGraphView
            onClose={noop}
            graph={vaultGraph ?? null}
            loading={vaultGraphLoading}
            variant="spectator"
            compactChrome
            hideCloseButton
            liveSpeechNodeStrength={nodeStrength}
            liveSpeechLinkKeys={linkKeys}
            liveSpeechPulsePhase={livePulsePhase}
          />
        </div>
      </div>

      <div className="advanced-voice-transcript-wrap">
        <div className="advanced-voice-transcript-head">
          {speechError === "unsupported" ? (
            <MicOff size={14} strokeWidth={2} aria-hidden />
          ) : (
            <Mic size={14} strokeWidth={2} aria-hidden />
          )}
          <span>Transcrição ao vivo</span>
        </div>
        <div className="advanced-voice-transcript-body" role="log" aria-live="polite">
          {speechError === "unsupported" ? (
            <p className="advanced-voice-transcript-hint">
              O navegador não suporta reconhecimento de voz neste dispositivo. O Your Brain continua visível em modo leitura.
            </p>
          ) : null}
          {speechError === "permission" ? (
            <p className="advanced-voice-transcript-hint">Permita o microfone para ver a transcrição e as correlações em tempo real.</p>
          ) : null}
          {speechError && speechError !== "unsupported" && speechError !== "permission" ? (
            <p className="advanced-voice-transcript-hint">Voz: {speechError}</p>
          ) : null}
          {!speechError || speechError === "no-speech" ? (
            <p className="advanced-voice-transcript-text">
              {combinedTranscript ? (
                <>
                  {finalTranscript}
                  {interimTranscript ? (
                    <>
                      {" "}
                      <span className="advanced-voice-interim">{interimTranscript}</span>
                    </>
                  ) : null}
                </>
              ) : (
                <span className="advanced-voice-placeholder">
                  Fale naturalmente — o modelo Your Brain reage quando as tuas palavras encontram notas no vault.
                </span>
              )}
            </p>
          ) : null}
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

        .advanced-voice-center-orb {
          position: absolute;
          left: 50%;
          top: 48%;
          transform: translate(-50%, -50%);
          z-index: 10;
          width: min(78vmin, 640px);
          height: min(78vmin, 640px);
          pointer-events: none;
        }

        .advanced-voice-glass-ring {
          position: absolute;
          inset: -3px;
          border-radius: 50%;
          background: conic-gradient(
            from 210deg,
            hsla(185, 85%, 58%, 0.35),
            hsla(275, 72%, 52%, 0.28),
            hsla(185, 85%, 58%, 0.35)
          );
          opacity: 0.85;
          filter: blur(0.5px);
          animation: advanced-voice-orbit-glow 10s linear infinite;
        }

        @keyframes advanced-voice-orbit-glow {
          to {
            transform: rotate(360deg);
          }
        }

        .advanced-voice-brain-host {
          position: absolute;
          inset: 10px;
          border-radius: 50%;
          overflow: hidden;
          pointer-events: auto;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(8, 9, 12, 0.35);
          backdrop-filter: blur(18px);
          box-shadow:
            0 0 0 1px rgba(255, 255, 255, 0.06) inset,
            0 24px 80px rgba(0, 0, 0, 0.45),
            0 0 120px rgba(120, 160, 255, 0.08);
        }

        .advanced-voice-root--light .advanced-voice-brain-host {
          background: rgba(255, 255, 255, 0.42);
          border-color: rgba(0, 0, 0, 0.08);
          box-shadow:
            0 0 0 1px rgba(0, 0, 0, 0.04) inset,
            0 20px 60px rgba(0, 0, 0, 0.08);
        }

        .advanced-voice-brain-host :global(.brain-graph-root) {
          height: 100%;
        }

        .advanced-voice-transcript-wrap {
          position: absolute;
          left: 50%;
          bottom: clamp(16px, 4vh, 36px);
          transform: translateX(-50%);
          z-index: 20;
          width: min(720px, calc(100% - 32px));
          pointer-events: none;
        }

        .advanced-voice-transcript-head {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          border-radius: 999px;
          background: rgba(10, 11, 14, 0.55);
          border: 1px solid var(--bar-border);
          color: rgba(200, 206, 218, 0.82);
          font-family: "Inter", sans-serif;
          font-size: 10px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          margin-bottom: 10px;
          backdrop-filter: blur(14px);
        }

        .advanced-voice-root--light .advanced-voice-transcript-head {
          background: rgba(255, 255, 255, 0.65);
          color: rgba(60, 66, 76, 0.88);
        }

        .advanced-voice-transcript-body {
          padding: 14px 18px;
          border-radius: 16px;
          background: rgba(9, 10, 13, 0.62);
          border: 1px solid rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(16px);
          min-height: 72px;
          max-height: min(28vh, 200px);
          overflow-y: auto;
          box-shadow: 0 18px 60px rgba(0, 0, 0, 0.35);
        }

        .advanced-voice-root--light .advanced-voice-transcript-body {
          background: rgba(255, 255, 255, 0.72);
          border-color: rgba(0, 0, 0, 0.06);
        }

        .advanced-voice-transcript-text {
          margin: 0;
          font-family: "Inter", sans-serif;
          font-size: clamp(0.78rem, 1.35vw, 0.92rem);
          line-height: 1.55;
          color: rgba(220, 226, 236, 0.92);
        }

        .advanced-voice-root--light .advanced-voice-transcript-text {
          color: rgba(40, 44, 52, 0.92);
        }

        .advanced-voice-interim {
          color: rgba(160, 200, 255, 0.85);
          font-style: italic;
        }

        .advanced-voice-root--light .advanced-voice-interim {
          color: rgba(80, 110, 180, 0.9);
        }

        .advanced-voice-placeholder {
          color: rgba(170, 178, 192, 0.65);
        }

        .advanced-voice-root--light .advanced-voice-placeholder {
          color: rgba(90, 96, 108, 0.72);
        }

        .advanced-voice-transcript-hint {
          margin: 0;
          font-size: 0.78rem;
          line-height: 1.45;
          color: rgba(230, 186, 120, 0.92);
        }

        @media (max-width: 640px) {
          .advanced-voice-center-orb {
            width: min(92vmin, 100%);
            height: min(72vmin, 420px);
            top: 44%;
          }

          .advanced-voice-brain-host {
            border-radius: 22px;
          }

          .advanced-voice-glass-ring {
            border-radius: 26px;
            inset: -2px;
          }
        }
      `}</style>
    </div>
  );
}
