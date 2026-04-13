"use client";

import dynamic from "next/dynamic";
import type { ComponentType, MutableRefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { formatConversationDisplayTitle, type VaultGraph } from "@/lib/vault";
import { forceCenter, forceX, forceY } from "d3-force-3d";
import { emitNativeDebug } from "@/lib/nativeDebug";
import type {
  ForceGraphMethods,
  GraphData,
  LinkObject,
  NodeObject,
} from "react-force-graph-2d";

const ForceGraph2D = dynamic(
  () => import("react-force-graph-2d").then((m) => m.default),
  { ssr: false, loading: () => null }
) as ComponentType<
  Record<string, unknown> & { ref?: MutableRefObject<ForceGraphMethods | undefined> }
>;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Física estilo “organismo”: molas + repulsão + inércia (via d3) + simulação mais longa
const PHYSICS = {
  chargeStrength: -320,
  nativeChargeStrength: -560,
  velocityDecay: 0.28,
  /** Passo 1+4: atrito moderado — suave sem ficar eternamente em oscilação. */
  nativeVelocityDecay: 0.5,
  alphaDecay: 0.011,
  alphaMin: 0.006,
  /** Passo 4: alpha um pouco mais lento para movimentos mais suaves. */
  nativeAlphaDecay: 0.015,
  nativeAlphaMin: 0.001,
  baseLinkDistance: 92,
  degreeDistanceBoost: 20,
  degreeMismatchBoost: 3,
  linkStrengthMin: 0.35,
  linkStrengthMax: 0.95,
  warmupTicks: 140,
  cooldownMs: 22000,
  /** Menos tempo de “motor ligado” = menos agitação contínua (antes 120s era excessivo). */
  nativeCooldownMs: 14000,
  /** Ancora o conjunto no centro do espaço do grafo (0,0); o utilizador continua a poder pan/zoom na vista. */
  centerStrength: 0.35,
  /** Passo 2: mais forte no nativo para o grupo não “cair” da vista. */
  nativeCenterStrength: 0.26,
  pullToOriginStrength: 0.045,
  nativePullToOriginStrength: 0.072,
  /** Passo 4: molas um pouco mais “moles” (multiplicador na força link). */
  nativeLinkStrengthScale: 0.82,
  /** Conversa avançada: centro fixo em (0,0) com força reforçada para o conjunto não “vagar”. */
  spectatorCenterStrengthMul: 2.5,
  spectatorPullToOriginMul: 3.2,
  /** Amortecimento alto + alpha lento = movimento contínuo e sem solavancos. */
  spectatorVelocityDecay: 0.58,
  spectatorAlphaDecay: 0.0065,
  spectatorAlphaMin: 0.0028,
  spectatorCooldownMs: 120000,
  /** Máx. ~32% de “respiração” na repulsão com o áudio (antes 82% era brusco). */
  spectatorChargeAudioMul: 0.32,
  /** macOS / WKWebView: entrada costuma ser mais baixa — espelhar melhor a fala. */
  spectatorChargeAudioMulNative: 0.62,
  /** Suavização da energia de áudio (~420 ms para ~63% do alvo). */
  spectatorEnergyTauSec: 0.42,
  spectatorEnergyTauNativeSec: 0.13,
  /** Evita reheat a 60 Hz — só reaquece a simulação ocasionalmente. */
  spectatorReheatMinMs: 380,
  spectatorReheatMinMsNative: 260,
  spectatorParticleSpeedBase: 0.0026,
  spectatorParticleSpeedMul: 0.011,
  spectatorParticleSpeedBaseNative: 0.0032,
  spectatorParticleSpeedMulNative: 0.02,
};

const GROUP_COLORS: Record<string, string> = {
  project: "#c0c0c0",
  tech: "#b6b6b6",
  product: "#adadad",
  business: "#c8c8c8",
  notes: "#9e9e9e",
};

const GROUP_COLORS_DIM: Record<string, string> = {
  project: "#4f4f4f",
  tech: "#4a4a4a",
  product: "#474747",
  business: "#525252",
  notes: "#3d3d3d",
};

const VAULT_NODE_COLOR = "#b8b8b8";
const VAULT_NODE_COLOR_DIM = "#4a4a4a";

/** Destaque do nó em foco (arrastar/segurar): azul escuro próximo do roxo. */
const TECH_DRAG_NODE = "#4338ca";
const TECH_DRAG_LINK = "rgba(67, 56, 202, 0.82)";
/** Nós/ligações fora do subgrafo direto: ~80% transparente (α ≈ 0,2). */
const UNRELATED_NODE_ALPHA = 0.2;
const UNRELATED_LINK_ALPHA = 0.14 * UNRELATED_NODE_ALPHA;

function rgbFromHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function withAlpha(hex: string, alpha: number): string {
  const rgb = rgbFromHex(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

type BrainGraphViewProps = {
  onClose: () => void;
  graph?: VaultGraph | null;
  loading?: boolean;
  onOpenConversationFromNode?: (nodeId: string, nodeLabel: string) => void;
  /** Espectador: sem arrastar nós nem abrir conversas; destaque opcional por voz em tempo real. */
  variant?: "default" | "spectator";
  liveSpeechNodeStrength?: Map<string, number>;
  liveSpeechLinkKeys?: Set<string>;
  /** Arestas sintéticas (sem wikilink directo) entre assuntos activos — visual mais subtil que `liveSpeechLinkKeys`. */
  liveSpeechWeakLinkKeys?: Set<string>;
  /** Arestas do vault no caminho mais curto entre assuntos sem ligação directa — mais visível que a corda sintética, mais discreto que o destaque directo. */
  liveSpeechPathLinkKeys?: Set<string>;
  /** Fase (rad) para pulsar ligações/nós correlacionados ao discurso. */
  liveSpeechPulsePhase?: number;
  /** Esconder legenda + rodapé ANCC (embutido noutro ecrã). */
  compactChrome?: boolean;
  /** O painel pai pode fornecir o botão fechar. */
  hideCloseButton?: boolean;
  /** No modo espectador: bloqueia zoom e pan (vista fixa). */
  spectatorLockZoom?: boolean;
  liveAudioEnergy?: number;
};

type BrainNode = {
  id: string;
  name: string;
  group: string;
  val: number;
};

type BrainLink = {
  source: string;
  target: string;
  distance: number;
  strength: number;
};

type ForceGraphSnapshot = {
  graphData?: () => GraphData<BrainNode, BrainLink>;
};

function linkKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function nodeIdOf(n: unknown): string {
  if (n && typeof n === "object" && "id" in n && typeof (n as { id: unknown }).id === "string") {
    return (n as { id: string }).id;
  }
  return String(n);
}

/** Igual a `nodeRelSize` no ForceGraph2D — usado para posicionar o rótulo abaixo do círculo. */
const NODE_REL_SIZE = 5;

function truncateCanvasLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ell = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const slice = text.slice(0, mid) + ell;
    if (ctx.measureText(slice).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return (lo > 0 ? text.slice(0, lo) : "") + ell;
}

export default function BrainGraphView({
  onClose,
  graph,
  loading,
  onOpenConversationFromNode,
  variant = "default",
  liveSpeechNodeStrength,
  liveSpeechLinkKeys,
  liveSpeechWeakLinkKeys,
  liveSpeechPathLinkKeys,
  liveSpeechPulsePhase = 0,
  compactChrome = false,
  hideCloseButton = false,
  spectatorLockZoom = false,
  liveAudioEnergy,
}: BrainGraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const liveAudioEnergyRef = useRef(0);
  const spectatorSmoothEnergyRef = useRef(0);
  const spectatorRafPrevMsRef = useRef<number | null>(null);
  const spectatorLastReheatMsRef = useRef(0);

  const [dims, setDims] = useState({ w: 640, h: 480 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [highlightLinks, setHighlightLinks] = useState<Set<string>>(new Set());
  const fitDoneKey = useRef<string>("");
  const dragAccumRef = useRef(0);
  const suppressClickUntil = useRef(0);
  const nativeSpreadRecoveryRef = useRef(false);
  const hoverIdRef = useRef<string | null>(null);
  const dragSessionRef = useRef<string | null>(null);
  const canvasGripRef = useRef(false);
  const [holdFocusId, setHoldFocusId] = useState<string | null>(null);
  const [dragRootId, setDragRootId] = useState<string | null>(null);
  /** Segurar no canvas (pointerdown) ou arrastar: quem define o subgrafo “direto”. */
  const focusRootId = holdFocusId ?? dragRootId;
  const isNativeShell =
    typeof document !== "undefined" &&
    document.documentElement.hasAttribute("data-brain2-native");

  useEffect(() => {
    liveAudioEnergyRef.current = Math.max(0, Math.min(1, liveAudioEnergy ?? 0));
  }, [liveAudioEnergy]);

  const useVault = Boolean(graph && graph.nodes.length > 0);
  const activeNodes = useMemo(
    () =>
      useVault && graph
        ? graph.nodes.map((n) => ({ id: n.id, label: n.label, group: "vault" }))
        : [],
    [useVault, graph]
  );
  const activeEdges = useMemo(
    () => (useVault && graph ? graph.edges : []),
    [useVault, graph]
  );

  const degreeMap = useMemo(() => {
    const m: Record<string, number> = {};
    activeNodes.forEach((n) => {
      m[n.id] = 0;
    });
    activeEdges.forEach((e) => {
      m[e.source] = (m[e.source] || 0) + 1;
      m[e.target] = (m[e.target] || 0) + 1;
    });
    return m;
  }, [activeNodes, activeEdges]);

  const groupMap = useMemo(() => {
    const m: Record<string, string> = {};
    activeNodes.forEach((n) => {
      m[n.id] = n.group;
    });
    return m;
  }, [activeNodes]);

  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of activeEdges) {
      if (!m.has(e.source)) m.set(e.source, new Set());
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.source)!.add(e.target);
      m.get(e.target)!.add(e.source);
    }
    return m;
  }, [activeEdges]);

  /** Só estrutura do vault — não muda com a fala (evita “refresh” do force graph / zoom). */
  const topologyGraphKey = useMemo(
    () => `${useVault ? "v" : "m"}-${activeNodes.length}-${activeEdges.length}`,
    [useVault, activeNodes.length, activeEdges.length],
  );

  /** Cordas “fracas” desenhadas no pós-frame — não entram no `graphData` para não reiniciar a física. */
  const spectatorWeakKeysRef = useRef<Set<string> | undefined>(undefined);
  const spectatorPulseRef = useRef(0);
  useEffect(() => {
    spectatorWeakKeysRef.current = liveSpeechWeakLinkKeys;
  }, [liveSpeechWeakLinkKeys]);
  useEffect(() => {
    spectatorPulseRef.current = liveSpeechPulsePhase;
  }, [liveSpeechPulsePhase]);

  const dragEgoSet = useMemo(() => {
    if (!focusRootId) return null as Set<string> | null;
    const s = new Set<string>([focusRootId]);
    const neigh = adjacency.get(focusRootId);
    if (neigh) neigh.forEach((id) => s.add(id));
    return s;
  }, [focusRootId, adjacency]);

  const graphData = useMemo((): GraphData<BrainNode, BrainLink> => {
    const baseRadius = Math.max(180, Math.min(dims.w, dims.h) * 0.34);
    const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // phyllotaxis
    const nodes: NodeObject<BrainNode>[] = activeNodes.map((n, index) => {
      const deg = degreeMap[n.id] || 1;
      const t = (index + 1) / Math.max(1, activeNodes.length);
      const r = Math.sqrt(t) * baseRadius;
      const a = index * goldenAngle;
      const nativeKick = isNativeShell && useVault ? 0.03 : 0.12;
      return {
        id: n.id,
        name: n.label,
        group: n.group,
        val: clamp(1 + Math.log1p(deg) * 1.4, 1, 12),
        // Evita "nascer no centro" no WKWebView quando a simulação não aquece bem.
        x: r * Math.cos(a),
        y: r * Math.sin(a),
        vx: Math.cos(a + Math.PI / 2) * nativeKick,
        vy: Math.sin(a + Math.PI / 2) * nativeKick,
      };
    });

    const vaultLinks: LinkObject<BrainNode, BrainLink>[] = activeEdges.map((e) => {
      const ds = degreeMap[e.source] || 1;
      const dt = degreeMap[e.target] || 1;
      const avg = (ds + dt) / 2;
      const mismatch = Math.abs(ds - dt);
      const sameGroup = groupMap[e.source] === groupMap[e.target];
      const lowDegBoost = 1 + 0.85 / (1 + avg);
      const hubDamp = 1 / (1 + Math.log1p(Math.max(ds, dt)) * 0.42);
      const groupAff = sameGroup ? 1.14 : 0.9;
      const strength = clamp(groupAff * lowDegBoost * (0.55 + hubDamp * 0.45), PHYSICS.linkStrengthMin, PHYSICS.linkStrengthMax);
      const distance =
        PHYSICS.baseLinkDistance +
        Math.log1p(avg) * PHYSICS.degreeDistanceBoost +
        mismatch * PHYSICS.degreeMismatchBoost;
      return {
        source: e.source,
        target: e.target,
        distance,
        strength,
      };
    });

    return { nodes, links: vaultLinks };
  }, [
    activeNodes,
    activeEdges,
    degreeMap,
    groupMap,
    dims.h,
    dims.w,
    isNativeShell,
    useVault,
  ]);

  /** Traços fracos entre assuntos (só vault no `graphData`); callback estável para não invalidar o canvas. */
  const onRenderFramePostSpectatorWeak = useCallback(
    (ctx: CanvasRenderingContext2D, globalScale: number) => {
      const keys = spectatorWeakKeysRef.current;
      if (!keys?.size) return;
      const fg = fgRef.current as unknown as
        | { graphData?: () => GraphData<BrainNode, BrainLink> }
        | undefined;
      const data = fg?.graphData?.();
      const nodes = data?.nodes;
      if (!nodes?.length) return;
      const pos = new Map<string, { x: number; y: number }>();
      for (const n of nodes) {
        const id = String(n.id);
        const x = n.x;
        const y = n.y;
        if (Number.isFinite(x) && Number.isFinite(y)) {
          pos.set(id, { x: x!, y: y! });
        }
      }
      const phase = spectatorPulseRef.current;
      ctx.save();
      ctx.lineCap = "round";
      const dash = 3.2 / Math.max(globalScale, 0.08);
      ctx.setLineDash([dash, dash * 0.85]);
      for (const k of keys) {
        const sep = k.indexOf("|");
        if (sep <= 0) continue;
        const a = k.slice(0, sep);
        const b = k.slice(sep + 1);
        const pa = pos.get(a);
        const pb = pos.get(b);
        if (!pa || !pb) continue;
        const pulse = 0.38 + 0.62 * Math.sin(phase * 0.92);
        ctx.strokeStyle = `hsla(262, 36%, 56%, ${0.09 + pulse * 0.1})`;
        ctx.lineWidth = (0.28 + pulse * 0.32) / Math.max(globalScale, 0.08);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
      ctx.restore();
    },
    [],
  );

  useEffect(() => {
    if (loading) return;
    const root = containerRef.current;
    if (!root) return;

    const onPointerDown = (ev: PointerEvent) => {
      const canvas = root.querySelector("canvas");
      if (!canvas || ev.target !== canvas) return;
      const id = hoverIdRef.current;
      if (!id) return;
      canvasGripRef.current = true;
      setHoldFocusId(id);
    };

    const onPointerUp = () => {
      if (!canvasGripRef.current) return;
      canvasGripRef.current = false;
      window.setTimeout(() => setHoldFocusId(null), 0);
    };

    root.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);

    return () => {
      root.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
    };
  }, [loading, topologyGraphKey]);

  useLayoutEffect(() => {
    if (loading) return;
    const el = containerRef.current;
    if (!el) return;

    let rafId = 0;
    let cancelled = false;

    const isNativeShell =
      typeof document !== "undefined" &&
      document.documentElement.hasAttribute("data-brain2-native");

    const measure = () => {
      if (cancelled) return;
      const rect = el.getBoundingClientRect();
      let w = Math.round(rect.width);
      let h = Math.round(rect.height);

      if (w < 48 || h < 48) {
        const root = el.closest(".brain-graph-root");
        const outer = root?.getBoundingClientRect();
        if (outer && outer.width >= 48 && outer.height >= 48) {
          w = Math.round(outer.width);
          h = Math.round(outer.height);
        } else if (typeof window !== "undefined" && isNativeShell) {
          const sidebarReserve = 300;
          w = Math.max(w, Math.floor(window.innerWidth - sidebarReserve));
          h = Math.max(h, window.innerHeight);
        }
      }

      if (w > 0 && h > 0) {
        setDims((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      }
    };

    measure();

    const ro = new ResizeObserver(() => {
      requestAnimationFrame(measure);
    });
    ro.observe(el);

    const onWinResize = () => {
      requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onWinResize);

    const retryMs = isNativeShell
      ? [16, 32, 64, 120, 240, 400, 700]
      : [16, 48, 120];
    const timeouts = retryMs.map((ms) =>
      window.setTimeout(() => {
        rafId = requestAnimationFrame(measure);
      }, ms),
    );

    return () => {
      cancelled = true;
      ro.disconnect();
      window.removeEventListener("resize", onWinResize);
      timeouts.forEach(clearTimeout);
      cancelAnimationFrame(rafId);
    };
  }, [loading]);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    const applyForces = () => {
      if (cancelled) return;
      const fg = fgRef.current;
      if (!fg) {
        if (attempts++ < 900) requestAnimationFrame(applyForces);
        return;
      }

      const linkForce = fg.d3Force("link") as unknown as {
        distance?: (fn: (l: LinkObject<BrainNode, BrainLink>) => number) => void;
        strength?: (fn: (l: LinkObject<BrainNode, BrainLink>) => number) => void;
      };

      if (linkForce && typeof linkForce.distance === "function") {
        linkForce.distance((l) => Number(l.distance));
        const scale =
          isNativeShell && useVault ? PHYSICS.nativeLinkStrengthScale : 1;
        linkForce.strength?.((l) => Number(l.strength) * scale);
        const lf = linkForce as unknown as { iterations?: (n: number) => void };
        lf.iterations?.(isNativeShell && useVault ? 2 : 1);
      }

      const charge = fg.d3Force("charge") as unknown as { strength?: (v: number) => void };
      charge?.strength?.(isNativeShell && useVault ? PHYSICS.nativeChargeStrength : PHYSICS.chargeStrength);

      fg.d3Force(
        "center",
        forceCenter(0, 0, 0).strength(
          isNativeShell && useVault ? PHYSICS.nativeCenterStrength : PHYSICS.centerStrength
        )
      );
      fg.d3Force(
        "x",
        forceX(0).strength(
          isNativeShell && useVault ? PHYSICS.nativePullToOriginStrength : PHYSICS.pullToOriginStrength
        )
      );
      fg.d3Force(
        "y",
        forceY(0).strength(
          isNativeShell && useVault ? PHYSICS.nativePullToOriginStrength : PHYSICS.pullToOriginStrength
        )
      );

      fg.d3ReheatSimulation();
    };

    requestAnimationFrame(applyForces);
    return () => {
      cancelled = true;
    };
  }, [topologyGraphKey, dims.w, dims.h, isNativeShell, useVault, variant]);

  /** Movimento “orgânico” do grafo em função do nível de áudio (conversa avançada). */
  useEffect(() => {
    if (variant !== "spectator" || !useVault || loading) {
      return;
    }
    spectatorSmoothEnergyRef.current = 0;
    spectatorRafPrevMsRef.current = null;
    spectatorLastReheatMsRef.current = 0;

    let raf = 0;
    const tick = () => {
      const fg = fgRef.current;
      const now = performance.now();
      const prev = spectatorRafPrevMsRef.current ?? now;
      spectatorRafPrevMsRef.current = now;
      const dt = Math.min(1 / 24, (now - prev) / 1000);

      const target = liveAudioEnergyRef.current;
      let s = spectatorSmoothEnergyRef.current;
      const tau = isNativeShell ? PHYSICS.spectatorEnergyTauNativeSec : PHYSICS.spectatorEnergyTauSec;
      s += (target - s) * Math.min(1, dt / tau);
      spectatorSmoothEnergyRef.current = s;
      const e = s;

      if (fg) {
        const baseCharge = isNativeShell && useVault ? PHYSICS.nativeChargeStrength : PHYSICS.chargeStrength;
        const chargeMul = isNativeShell ? PHYSICS.spectatorChargeAudioMulNative : PHYSICS.spectatorChargeAudioMul;
        const charge = fg.d3Force("charge") as unknown as { strength?: (v: number) => void };
        charge?.strength?.(baseCharge * (1 + e * chargeMul));

        const baseCenter =
          isNativeShell && useVault ? PHYSICS.nativeCenterStrength : PHYSICS.centerStrength;
        const basePull =
          isNativeShell && useVault ? PHYSICS.nativePullToOriginStrength : PHYSICS.pullToOriginStrength;
        const centerFactor = isNativeShell ? 0.94 + e * 0.06 : 0.97 + e * 0.03;
        const pullFactor = isNativeShell ? 0.965 + e * 0.035 : 0.985 + e * 0.015;
        const centerStr = baseCenter * PHYSICS.spectatorCenterStrengthMul * centerFactor;
        const pullStr = basePull * PHYSICS.spectatorPullToOriginMul * pullFactor;

        fg.d3Force("center", forceCenter(0, 0, 0).strength(centerStr));
        fg.d3Force("x", forceX(0).strength(pullStr));
        fg.d3Force("y", forceY(0).strength(pullStr));

        const reheatMs = isNativeShell ? PHYSICS.spectatorReheatMinMsNative : PHYSICS.spectatorReheatMinMs;
        if (now - spectatorLastReheatMsRef.current >= reheatMs) {
          fg.d3ReheatSimulation();
          spectatorLastReheatMsRef.current = now;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [variant, useVault, loading, topologyGraphKey, isNativeShell]);

  useEffect(() => {
    nativeSpreadRecoveryRef.current = false;
  }, [topologyGraphKey]);

  useEffect(() => {
    if (!isNativeShell || !useVault || loading) {
      return;
    }

    let frameCount = 0;
    let rafId = 0;
    let disposed = false;

    const countFrames = () => {
      if (disposed) return;
      frameCount += 1;
      rafId = requestAnimationFrame(countFrames);
    };
    rafId = requestAnimationFrame(countFrames);

    const timer = window.setInterval(() => {
      const fg = fgRef.current;
      const snapshot = (fg as unknown as ForceGraphSnapshot | undefined)?.graphData?.();
      const nodes = (snapshot?.nodes ?? []) as Array<NodeObject<BrainNode>>;
      const links = snapshot?.links?.length ?? 0;

      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      let finiteNodes = 0;
      let nonFiniteNodes = 0;

      for (const node of nodes) {
        const x = node.x;
        const y = node.y;
        if (Number.isFinite(x) && Number.isFinite(y)) {
          finiteNodes += 1;
          minX = Math.min(minX, x!);
          maxX = Math.max(maxX, x!);
          minY = Math.min(minY, y!);
          maxY = Math.max(maxY, y!);
        } else {
          nonFiniteNodes += 1;
        }
      }

      const spreadW = finiteNodes > 0 ? maxX - minX : 0;
      const spreadH = finiteNodes > 0 ? maxY - minY : 0;
      const fps = frameCount;
      frameCount = 0;

      emitNativeDebug("brain-graph-stats", {
        graphKey: topologyGraphKey,
        dimsW: dims.w,
        dimsH: dims.h,
        nodes: nodes.length,
        links,
        finiteNodes,
        nonFiniteNodes,
        spreadW: Math.round(spreadW),
        spreadH: Math.round(spreadH),
        hoverId: hoverId ?? "",
        highlightLinks: highlightLinks.size,
        fpsApprox: fps,
      });
    }, 1000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      cancelAnimationFrame(rafId);
    };
  }, [dims.h, dims.w, topologyGraphKey, highlightLinks.size, hoverId, isNativeShell, loading, useVault]);

  useEffect(() => {
    if (!isNativeShell || !useVault || dims.w < 64 || dims.h < 64) {
      return;
    }

    const timer = window.setTimeout(() => {
      const fg = fgRef.current;
      const snapshot = (fg as unknown as {
        graphData?: () => GraphData<BrainNode, BrainLink>;
      })?.graphData?.();
      const nodes = (snapshot?.nodes ?? []) as Array<NodeObject<BrainNode>>;

      if (nodes.length < 18) {
        return;
      }

      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      let validCount = 0;

      for (const node of nodes) {
        const x = node.x;
        const y = node.y;
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          continue;
        }
        validCount += 1;
        minX = Math.min(minX, x!);
        maxX = Math.max(maxX, x!);
        minY = Math.min(minY, y!);
        maxY = Math.max(maxY, y!);
      }

      if (validCount < 18 || nativeSpreadRecoveryRef.current) {
        return;
      }

      const spreadW = Math.max(0, maxX - minX);
      const spreadH = Math.max(0, maxY - minY);
      const minExpectedSpread = Math.min(dims.w, dims.h) * 0.16;
      const visiblyClustered = spreadW < minExpectedSpread && spreadH < minExpectedSpread;

      if (!visiblyClustered) {
        return;
      }

      nativeSpreadRecoveryRef.current = true;
      const charge = fg?.d3Force("charge") as unknown as { strength?: (v: number) => void } | undefined;
      charge?.strength?.(PHYSICS.nativeChargeStrength * 1.18);
      fg?.d3Force("center", forceCenter(0, 0, 0).strength(PHYSICS.nativeCenterStrength * 0.35));
      fg?.d3Force("x", forceX(0).strength(PHYSICS.nativePullToOriginStrength * 0.35));
      fg?.d3Force("y", forceY(0).strength(PHYSICS.nativePullToOriginStrength * 0.35));
      fg?.d3ReheatSimulation();

      window.setTimeout(() => {
        fg?.zoomToFit(500, 38);
      }, 360);
    }, 1400);

    return () => {
      window.clearTimeout(timer);
    };
  }, [dims.h, dims.w, topologyGraphKey, isNativeShell, useVault]);

  const highlightSet = useMemo(() => {
    if (!hoverId) return null as Set<string> | null;
    const set = new Set<string>([hoverId]);
    const neigh = adjacency.get(hoverId);
    if (neigh) neigh.forEach((id) => set.add(id));
    return set;
  }, [hoverId, adjacency]);

  const updateLinkHighlight = useCallback(
    (centerId: string | null) => {
      if (!centerId) {
        setHighlightLinks(new Set());
        return;
      }
      const neigh = adjacency.get(centerId);
      const keys = new Set<string>();
      if (neigh) {
        for (const nb of neigh) {
          keys.add(linkKey(centerId, nb));
        }
      }
      setHighlightLinks(keys);
    },
    [adjacency]
  );

  const nodeColor = useCallback(
    (node: NodeObject<BrainNode>) => {
      const id = String(node.id);
      const isVault = node.group === "vault";
      const base = isVault ? VAULT_NODE_COLOR : GROUP_COLORS[node.group] || "#b0b0b0";

      if (
        variant === "spectator" &&
        liveSpeechNodeStrength &&
        liveSpeechNodeStrength.size > 0
      ) {
        const s = liveSpeechNodeStrength.get(id);
        if (s != null && s > 0) {
          const pulse = 0.78 + 0.22 * Math.sin(liveSpeechPulsePhase);
          const hue = 156 + s * 54;
          const light = 50 + s * 18 * pulse;
          return `hsl(${hue}, 91%, ${Math.min(78, light)}%)`;
        }
        return withAlpha(base, isNativeShell ? 0.34 : 0.26);
      }

      if (focusRootId && dragEgoSet) {
        if (!dragEgoSet.has(id)) return withAlpha(base, UNRELATED_NODE_ALPHA);
        if (id === focusRootId) return TECH_DRAG_NODE;
        return base;
      }

      if (isNativeShell) {
        return base;
      }
      if (!highlightSet) return base;
      if (highlightSet.has(id)) return base;
      return isVault ? VAULT_NODE_COLOR_DIM : GROUP_COLORS_DIM[node.group] || "#484848";
    },
    [
      highlightSet,
      isNativeShell,
      focusRootId,
      dragEgoSet,
      variant,
      liveSpeechNodeStrength,
      liveSpeechPulsePhase,
    ]
  );

  const linkColor = useCallback(
    (link: LinkObject<BrainNode, BrainLink>) => {
      const a = nodeIdOf(link.source);
      const b = nodeIdOf(link.target);
      const k = linkKey(a, b);
      const base = "rgba(255,255,255,0.14)";
      const baseDim = `rgba(255,255,255,${UNRELATED_LINK_ALPHA})`;
      const hi = "rgba(255,255,255,0.38)";
      const faded = "rgba(255,255,255,0.045)";

      if (
        variant === "spectator" &&
        liveSpeechLinkKeys &&
        liveSpeechLinkKeys.size > 0 &&
        liveSpeechLinkKeys.has(k)
      ) {
        const pulse = 0.48 + 0.52 * Math.sin(liveSpeechPulsePhase * 1.18);
        return `hsla(282, 88%, 58%, ${0.38 + pulse * 0.52})`;
      }
      if (
        variant === "spectator" &&
        liveSpeechPathLinkKeys &&
        liveSpeechPathLinkKeys.size > 0 &&
        liveSpeechPathLinkKeys.has(k)
      ) {
        const pulse = 0.4 + 0.6 * Math.sin(liveSpeechPulsePhase * 1.02);
        return `hsla(248, 64%, 64%, ${0.26 + pulse * 0.18})`;
      }
      if (
        variant === "spectator" &&
        liveSpeechNodeStrength &&
        liveSpeechNodeStrength.size > 0
      ) {
        return "rgba(255,255,255,0.038)";
      }
      if (variant === "spectator" && (!liveSpeechLinkKeys || liveSpeechLinkKeys.size === 0)) {
        const e = Math.min(1, Math.max(0, liveAudioEnergy ?? 0));
        const alpha = 0.1 + e * (isNativeShell ? 0.32 : 0.24);
        return `rgba(255,255,255,${alpha})`;
      }

      if (focusRootId && dragEgoSet) {
        const bothInEgo = dragEgoSet.has(a) && dragEgoSet.has(b);
        if (!bothInEgo) return baseDim;
        if (a === focusRootId || b === focusRootId) return TECH_DRAG_LINK;
        return baseDim;
      }

      if (isNativeShell) {
        return base;
      }
      if (highlightLinks.size === 0) return base;
      return highlightLinks.has(k) ? hi : faded;
    },
    [
      highlightLinks,
      isNativeShell,
      focusRootId,
      dragEgoSet,
      variant,
      liveSpeechLinkKeys,
      liveSpeechPathLinkKeys,
      liveSpeechNodeStrength,
      liveSpeechPulsePhase,
      liveAudioEnergy,
    ]
  );

  const linkWidth = useCallback(
    (link: LinkObject<BrainNode, BrainLink>) => {
      const a = nodeIdOf(link.source);
      const b = nodeIdOf(link.target);
      const k = linkKey(a, b);
      if (
        variant === "spectator" &&
        liveSpeechLinkKeys &&
        liveSpeechLinkKeys.has(k)
      ) {
        const pulse = 0.62 + 0.38 * Math.sin(liveSpeechPulsePhase * 1.05);
        return 0.95 + pulse * 1.35;
      }
      if (variant === "spectator" && liveSpeechPathLinkKeys && liveSpeechPathLinkKeys.has(k)) {
        const pulse = 0.45 + 0.55 * Math.sin(liveSpeechPulsePhase * 0.98);
        return 0.72 + pulse * 0.78;
      }
      if (variant === "spectator" && (!liveSpeechLinkKeys || liveSpeechLinkKeys.size === 0)) {
        const e = Math.min(1, Math.max(0, liveAudioEnergy ?? 0));
        return 0.48 + e * (isNativeShell ? 1.35 : 1.05);
      }
      if (focusRootId && dragEgoSet) {
        const bothInEgo = dragEgoSet.has(a) && dragEgoSet.has(b);
        if (!bothInEgo) return 0.45;
        if (a === focusRootId || b === focusRootId) return 1.15;
        return 0.45;
      }
      if (isNativeShell) {
        return 0.9;
      }
      return highlightLinks.has(linkKey(a, b)) ? 1.25 : 0.65;
    },
    [
      highlightLinks,
      isNativeShell,
      focusRootId,
      dragEgoSet,
      variant,
      liveSpeechLinkKeys,
      liveSpeechPathLinkKeys,
      liveSpeechPulsePhase,
      liveAudioEnergy,
    ]
  );

  const linkDirectionalParticles = useCallback(
    (link: LinkObject<BrainNode, BrainLink>) => {
      if (variant !== "spectator") return 0;
      const a = nodeIdOf(link.source);
      const b = nodeIdOf(link.target);
      const k = linkKey(a, b);
      if (liveSpeechLinkKeys?.size && liveSpeechLinkKeys.has(k)) {
        return 6;
      }
      if (liveSpeechPathLinkKeys?.has(k)) {
        return 4;
      }
      if (liveSpeechLinkKeys?.size) {
        return 0;
      }
      return 1;
    },
    [variant, liveSpeechLinkKeys, liveSpeechPathLinkKeys]
  );

  const linkDirectionalParticleWidth = useCallback(
    (link: LinkObject<BrainNode, BrainLink>) => {
      if (variant !== "spectator") return 0;
      const k = linkKey(nodeIdOf(link.source), nodeIdOf(link.target));
      if (liveSpeechPathLinkKeys?.has(k)) {
        return 1.62;
      }
      return 1.35;
    },
    [variant, liveSpeechPathLinkKeys]
  );

  const nodeCanvasObjectMode = useCallback(() => "after" as const, []);

  const nodeCanvasObject = useCallback(
    (node: NodeObject<BrainNode>, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const rawLabel = (node.name ?? "").trim() || String(node.id ?? "");
      const label = formatConversationDisplayTitle(rawLabel) || rawLabel;
      const r = Math.sqrt(Math.max(0, node.val || 1)) * NODE_REL_SIZE;
      const k = Math.max(globalScale, 0.04);
      const fontPx = 11 / k;
      const pad = 5 / k;
      ctx.font = `${fontPx}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      const id = String(node.id);
      let fill: string;
      if (focusRootId && dragEgoSet) {
        if (!dragEgoSet.has(id)) {
          fill = isNativeShell
            ? `rgba(220, 220, 220, ${0.96 * UNRELATED_NODE_ALPHA})`
            : `rgba(115, 115, 115, ${0.72 * UNRELATED_NODE_ALPHA})`;
        } else if (id === focusRootId) {
          fill = "rgba(67, 56, 202, 0.96)";
        } else if (isNativeShell) {
          fill = "rgba(220, 220, 220, 0.96)";
        } else if (!highlightSet) {
          fill = "rgba(200, 200, 200, 0.94)";
        } else if (highlightSet.has(id)) {
          fill = "rgba(240, 240, 240, 0.98)";
        } else {
          fill = "rgba(115, 115, 115, 0.72)";
        }
      } else if (isNativeShell) {
        fill = "rgba(220, 220, 220, 0.96)";
      } else if (!highlightSet) {
        fill = "rgba(200, 200, 200, 0.94)";
      } else if (highlightSet.has(id)) {
        fill = "rgba(240, 240, 240, 0.98)";
      } else {
        fill = "rgba(115, 115, 115, 0.72)";
      }
      ctx.fillStyle = fill;

      const maxW = 168 / k;
      const truncated = truncateCanvasLabel(ctx, label, maxW);
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      ctx.fillText(truncated, x, y + r + pad);
    },
    [highlightSet, isNativeShell, focusRootId, dragEgoSet]
  );

  const onNodeHover = useCallback(
    (node: NodeObject<BrainNode> | null) => {
      const id = node?.id != null ? String(node.id) : null;
      hoverIdRef.current = id;
      if (dragSessionRef.current || canvasGripRef.current) return;
      setHoverId(id);
      updateLinkHighlight(id);
    },
    [updateLinkHighlight]
  );

  const onNodeClick = useCallback(
    (node: NodeObject<BrainNode>, _event: MouseEvent) => {
      if (performance.now() < suppressClickUntil.current) return;
      if (!onOpenConversationFromNode) return;
      if (isNativeShell) {
        const id = String(node.id);
        hoverIdRef.current = id;
        setHoverId(id);
        updateLinkHighlight(id);
        emitNativeDebug("brain-node-click-native", {
          id,
          label: node.name ?? "",
          x: typeof node.x === "number" ? Math.round(node.x) : null,
          y: typeof node.y === "number" ? Math.round(node.y) : null,
        });
        onOpenConversationFromNode(id, node.name ?? "");
        return;
      }
      emitNativeDebug("brain-node-click-web", {
        id: String(node.id),
        label: node.name ?? "",
      });
      onOpenConversationFromNode(String(node.id), node.name);
    },
    [isNativeShell, onOpenConversationFromNode, updateLinkHighlight]
  );

  const onNodeDrag = useCallback(
    (node: NodeObject<BrainNode>, translate: { x: number; y: number }) => {
      const id = String(node.id);
      if (!dragSessionRef.current) {
        dragSessionRef.current = id;
        setDragRootId(id);
        updateLinkHighlight(id);
      }
      dragAccumRef.current += Math.hypot(translate.x, translate.y);
    },
    [updateLinkHighlight]
  );

  const onNodeDragEnd = useCallback(
    (_node: NodeObject<BrainNode>, _translate: { x: number; y: number }) => {
      if (dragAccumRef.current > 3) {
        suppressClickUntil.current = performance.now() + 240;
      }
      dragAccumRef.current = 0;
      dragSessionRef.current = null;
      setDragRootId(null);
      const h = hoverIdRef.current;
      updateLinkHighlight(h);

      fgRef.current?.d3ReheatSimulation();
    },
    [updateLinkHighlight]
  );

  const onEngineStop = useCallback(() => {
    if (dims.w < 48 || dims.h < 48) return;
    const fitKey = `${topologyGraphKey}|${dims.w}x${dims.h}`;
    if (fitDoneKey.current === fitKey) return;
    fitDoneKey.current = fitKey;
    emitNativeDebug("brain-engine-stop", { graphKey: topologyGraphKey, fitKey, dimsW: dims.w, dimsH: dims.h });
    fgRef.current?.zoomToFit(480, 36);
  }, [topologyGraphKey, dims.w, dims.h]);

  const onBackgroundClick = useCallback((_event: MouseEvent) => {
    hoverIdRef.current = null;
    setHoverId(null);
    setHighlightLinks(new Set());
    emitNativeDebug("brain-background-click", { graphKey: topologyGraphKey });
  }, [topologyGraphKey]);

  return (
    <div className="brain-graph-root">
      {!hideCloseButton ? (
        <button
          className="brain-graph-close"
          onClick={onClose}
          aria-label="Fechar visualização"
          type="button"
        >
          <X size={16} strokeWidth={2} />
        </button>
      ) : null}

      {loading ? (
        <div className="brain-graph-loading">
          <Loader2 size={24} strokeWidth={1.5} className="spin" />
          <span>Lendo vault...</span>
        </div>
      ) : useVault && graph ? (
        <>
          <div ref={containerRef} className="brain-graph-container">
            <ForceGraph2D
              ref={fgRef as MutableRefObject<ForceGraphMethods | undefined>}
              width={dims.w}
              height={dims.h}
              graphData={graphData}
              backgroundColor="rgba(0,0,0,0)"
              nodeId="id"
              nodeLabel={() => ""}
              linkLabel={() => ""}
              nodeVal="val"
              nodeRelSize={NODE_REL_SIZE}
              nodeCanvasObjectMode={nodeCanvasObjectMode}
              nodeCanvasObject={nodeCanvasObject}
              autoPauseRedraw={false}
              nodeColor={nodeColor}
              linkColor={linkColor}
              linkWidth={linkWidth}
              linkDirectionalParticles={variant === "spectator" ? linkDirectionalParticles : 0}
              linkDirectionalParticleSpeed={
                variant === "spectator"
                  ? () => {
                      const e = Math.min(1, Math.max(0, liveAudioEnergy ?? 0));
                      const base = isNativeShell
                        ? PHYSICS.spectatorParticleSpeedBaseNative
                        : PHYSICS.spectatorParticleSpeedBase;
                      const mul = isNativeShell
                        ? PHYSICS.spectatorParticleSpeedMulNative
                        : PHYSICS.spectatorParticleSpeedMul;
                      return base + e * mul;
                    }
                  : 0
              }
              linkDirectionalParticleWidth={variant === "spectator" ? linkDirectionalParticleWidth : 0}
              d3VelocityDecay={
                variant === "spectator"
                  ? PHYSICS.spectatorVelocityDecay
                  : isNativeShell && useVault
                    ? PHYSICS.nativeVelocityDecay
                    : PHYSICS.velocityDecay
              }
              d3AlphaDecay={
                variant === "spectator"
                  ? PHYSICS.spectatorAlphaDecay
                  : isNativeShell && useVault
                    ? PHYSICS.nativeAlphaDecay
                    : PHYSICS.alphaDecay
              }
              d3AlphaMin={
                variant === "spectator"
                  ? PHYSICS.spectatorAlphaMin
                  : isNativeShell && useVault
                    ? PHYSICS.nativeAlphaMin
                    : PHYSICS.alphaMin
              }
              warmupTicks={PHYSICS.warmupTicks}
              cooldownTime={
                variant === "spectator"
                  ? PHYSICS.spectatorCooldownMs
                  : isNativeShell && useVault
                    ? PHYSICS.nativeCooldownMs
                    : PHYSICS.cooldownMs
              }
              enableNodeDrag={variant !== "spectator"}
              enableZoomInteraction={!(variant === "spectator" && spectatorLockZoom)}
              enablePanInteraction={!(variant === "spectator" && spectatorLockZoom)}
              minZoom={0.12}
              maxZoom={8}
              showNavInfo={false}
              onNodeClick={variant === "spectator" ? () => {} : onNodeClick}
              onNodeHover={variant === "spectator" ? () => undefined : onNodeHover}
              onNodeDrag={onNodeDrag}
              onNodeDragEnd={onNodeDragEnd}
              onBackgroundClick={variant === "spectator" ? () => undefined : onBackgroundClick}
              onEngineStop={onEngineStop}
              onRenderFramePost={variant === "spectator" ? onRenderFramePostSpectatorWeak : undefined}
            />
          </div>
        </>
      ) : (
        <div ref={containerRef} className="brain-graph-container brain-graph-empty">
          <p className="brain-graph-empty-msg">Nenhuma nota no vault para desenhar o grafo.</p>
        </div>
      )}

      {!compactChrome ? (
        <footer className="brain-graph-footer-stack" role="contentinfo">
          {!loading && useVault && graph ? (
            <div className="brain-graph-legend">
              <span className="legend-item">
                <span className="legend-dot" style={{ background: VAULT_NODE_COLOR }} />
                {graph.nodes.length} notas &middot; {graph.edges.length} conexões
              </span>
            </div>
          ) : null}
          <p className="brain-graph-ancc">
            Brain2 is powered by an Artificial Neuroplastic Cognitive Correlation model (
            <span className="brain-graph-ancc-abbr">ANCC</span>)
          </p>
        </footer>
      ) : null}

      <style jsx>{`
        .brain-graph-root {
          position: relative;
          width: 100%;
          height: 100%;
          min-width: 0;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }

        .brain-graph-close {
          position: absolute;
          top: 12px;
          right: 12px;
          z-index: 20;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border: 1px solid var(--bar-border);
          border-radius: 10px;
          background: var(--bar-bg);
          color: var(--muted);
          transition: background 0.15s ease, color 0.15s ease;
        }

        .brain-graph-close:hover {
          background: var(--pill-active);
          color: var(--muted-hover);
        }

        .brain-graph-footer-stack {
          position: absolute;
          bottom: 12px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 20;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          max-width: min(560px, 94vw);
          pointer-events: none;
        }

        .brain-graph-legend {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 6px 14px;
          border-radius: 10px;
          background: rgba(20, 20, 20, 0.85);
          border: 1px solid var(--bar-border);
          backdrop-filter: blur(8px);
        }

        .brain-graph-ancc {
          margin: 0;
          padding: 0 8px;
          font-family: "Inter", system-ui, sans-serif;
          font-size: clamp(8px, 1.1vw, 9.5px);
          font-weight: 400;
          font-style: italic;
          line-height: 1.45;
          letter-spacing: 0.02em;
          color: rgba(148, 148, 156, 0.52);
          text-align: center;
        }

        .brain-graph-ancc-abbr {
          font-style: normal;
          font-weight: 500;
          letter-spacing: 0.14em;
          color: rgba(168, 168, 176, 0.62);
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 5px;
          font-family: "Inter", sans-serif;
          font-size: 10px;
          color: #888;
          letter-spacing: 0.02em;
          white-space: nowrap;
        }

        .legend-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .brain-graph-container {
          flex: 1;
          width: 100%;
          min-width: 0;
          min-height: 0;
          cursor: grab;
        }

        .brain-graph-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: default;
        }

        .brain-graph-empty-msg {
          margin: 0;
          max-width: 280px;
          text-align: center;
          font-family: "Inter", sans-serif;
          font-size: 12px;
          line-height: 1.45;
          color: var(--muted);
        }

        .brain-graph-container :global(canvas) {
          outline: none;
        }

        .brain-graph-loading {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          color: var(--muted);
          font-family: "Inter", sans-serif;
          font-size: 12px;
        }

        .brain-graph-loading :global(.spin) {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
