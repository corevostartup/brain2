"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import { X } from "lucide-react";
import * as THREE from "three";

type AdvancedVoiceSphereViewProps = {
  onClose: () => void;
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

  useFrame((state, delta) => {
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

export default function AdvancedVoiceSphereView({ onClose }: AdvancedVoiceSphereViewProps) {
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");

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

    return () => {
      observer.disconnect();
    };
  }, []);

  const palette = themeMode === "light" ? LIGHT_PALETTE : DARK_PALETTE;

  return (
    <div className={`advanced-voice-root advanced-voice-root--${themeMode}`}>
      <div className="advanced-voice-header">
        <div className="advanced-voice-headings">
          <h2>Conversa Avançada</h2>
          <p>Interface sensorial visual</p>
        </div>
        <button className="advanced-voice-close" type="button" onClick={onClose} aria-label="Fechar conversa avançada">
          <X size={15} strokeWidth={2} />
          Fechar
        </button>
      </div>

      <div className="advanced-voice-stage">
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

        <div className="advanced-voice-hud">
          <p className="advanced-voice-kicker">Modo sensorial</p>
          <h2>Presenca visual em tempo real</h2>
          <p>
            Esta e uma pre-visualizacao WebGL da conversa avançada. A reatividade ao audio real sera conectada na proxima etapa.
          </p>
        </div>
      </div>

      <style jsx>{`
        .advanced-voice-root {
          width: 100%;
          height: 100%;
          min-height: 0;
          display: flex;
          flex-direction: column;
          background: transparent;
        }

        .advanced-voice-header {
          display: flex;
          justify-content: space-between;
          gap: 14px;
          align-items: center;
          padding: 18px 24px 14px;
          flex-shrink: 0;
        }

        .advanced-voice-headings {
          min-width: 0;
        }

        .advanced-voice-headings h2 {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          font-weight: 500;
          color: var(--foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .advanced-voice-headings p {
          margin: 3px 0 0;
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          color: var(--muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .advanced-voice-close {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          justify-content: center;
          height: 32px;
          padding: 0 11px;
          border: 1px solid var(--bar-border);
          border-radius: 9px;
          background: transparent;
          color: var(--muted);
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          height: 32px;
          transition: background 0.15s ease, color 0.15s ease;
          flex-shrink: 0;
        }

        .advanced-voice-close:hover {
          background: var(--pill-active);
          color: var(--muted-hover);
        }

        .advanced-voice-stage {
          position: relative;
          flex: 1;
          min-height: 0;
          background: transparent;
        }

        .advanced-voice-hud {
          position: absolute;
          left: clamp(14px, 4vw, 34px);
          bottom: clamp(20px, 4vh, 42px);
          width: min(460px, calc(100% - 28px));
          pointer-events: none;
          color: rgba(216, 221, 231, 0.72);
          text-shadow: 0 4px 24px rgba(0, 0, 0, 0.36);
        }

        .advanced-voice-root--light .advanced-voice-hud {
          color: rgba(78, 85, 97, 0.7);
          text-shadow: 0 3px 14px rgba(255, 255, 255, 0.28);
        }

        .advanced-voice-kicker {
          margin: 0;
          font-family: 'Inter', sans-serif;
          font-size: 9px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: rgba(181, 188, 201, 0.58);
        }

        .advanced-voice-root--light .advanced-voice-kicker {
          color: rgba(102, 110, 123, 0.62);
        }

        .advanced-voice-hud h2 {
          margin: 6px 0 0;
          font-family: 'Inter', sans-serif;
          font-size: clamp(1.02rem, 2.4vw, 1.38rem);
          letter-spacing: 0.02em;
          font-weight: 460;
        }

        .advanced-voice-hud p {
          margin: 8px 0 0;
          font-family: 'Inter', sans-serif;
          font-size: clamp(0.68rem, 1.25vw, 0.8rem);
          line-height: 1.55;
          color: rgba(200, 206, 217, 0.72);
          max-width: 52ch;
        }

        .advanced-voice-root--light .advanced-voice-hud p {
          color: rgba(79, 86, 98, 0.72);
        }

        @media (max-width: 760px) {
          .advanced-voice-header {
            padding: 16px 14px 12px;
          }

          .advanced-voice-hud {
            left: 12px;
            right: 12px;
            width: auto;
            bottom: 16px;
          }
        }
      `}</style>
    </div>
  );
}
