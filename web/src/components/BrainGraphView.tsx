"use client";

import dynamic from "next/dynamic";
import type { ComponentType, MutableRefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { X, Loader2 } from "lucide-react";
import type { VaultGraph } from "@/lib/vault";
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
};

// ── Mock data ─────────────────────────────────────────────────────────
const mockNodes = [
  { id: "brain2", label: "Brain2 Project", group: "project" },
  { id: "arch", label: "Arquitetura do Sistema", group: "tech" },
  { id: "roadmap", label: "Roadmap do Produto", group: "project" },
  { id: "llm", label: "LLM & Modelos de IA", group: "tech" },
  { id: "rag", label: "RAG Pipeline", group: "tech" },
  { id: "embeddings", label: "Embeddings Vetoriais", group: "tech" },
  { id: "onboarding", label: "Onboarding de Usuários", group: "product" },
  { id: "ux", label: "UX & Design System", group: "product" },
  { id: "pricing", label: "Modelo de Pricing", group: "business" },
  { id: "competitors", label: "Análise de Concorrentes", group: "business" },
  { id: "notion", label: "Notion", group: "business" },
  { id: "obsidian", label: "Obsidian", group: "business" },
  { id: "meeting-notes", label: "Notas de Reunião - 02/04", group: "notes" },
  { id: "meeting-notes-2", label: "Notas de Reunião - 15/03", group: "notes" },
  { id: "api-design", label: "API Design & Endpoints", group: "tech" },
  { id: "auth", label: "Autenticação & Auth Flow", group: "tech" },
  { id: "nextjs", label: "Next.js Frontend", group: "tech" },
  { id: "swift-ios", label: "Swift iOS App", group: "tech" },
  { id: "swift-macos", label: "Swift macOS App", group: "tech" },
  { id: "marketplace", label: "Marketplace de Plugins", group: "product" },
  { id: "agents", label: "Agentes Autônomos", group: "tech" },
  { id: "memory", label: "Sistema de Memória", group: "tech" },
  { id: "graph-view", label: "Graph View Feature", group: "product" },
  { id: "checklist-launch", label: "Checklist de Lançamento", group: "project" },
  { id: "investor-deck", label: "Deck para Investidores", group: "business" },
  { id: "user-research", label: "Pesquisa de Usuários", group: "product" },
  { id: "data-privacy", label: "Privacidade de Dados", group: "tech" },
  { id: "sync-engine", label: "Motor de Sincronização", group: "tech" },
  { id: "search-engine", label: "Motor de Busca Semântica", group: "tech" },
  { id: "prompt-eng", label: "Prompt Engineering", group: "tech" },
  { id: "daily-log", label: "Daily Log - Abril", group: "notes" },
  { id: "ideias-produto", label: "Ideias de Produto", group: "product" },
];

const mockEdges = [
  { source: "brain2", target: "arch" },
  { source: "brain2", target: "roadmap" },
  { source: "brain2", target: "checklist-launch" },
  { source: "brain2", target: "investor-deck" },
  { source: "arch", target: "api-design" },
  { source: "arch", target: "nextjs" },
  { source: "arch", target: "swift-ios" },
  { source: "arch", target: "swift-macos" },
  { source: "arch", target: "sync-engine" },
  { source: "arch", target: "auth" },
  { source: "roadmap", target: "graph-view" },
  { source: "roadmap", target: "marketplace" },
  { source: "roadmap", target: "agents" },
  { source: "roadmap", target: "onboarding" },
  { source: "llm", target: "rag" },
  { source: "llm", target: "embeddings" },
  { source: "llm", target: "agents" },
  { source: "llm", target: "prompt-eng" },
  { source: "rag", target: "embeddings" },
  { source: "rag", target: "search-engine" },
  { source: "rag", target: "memory" },
  { source: "embeddings", target: "search-engine" },
  { source: "onboarding", target: "ux" },
  { source: "onboarding", target: "user-research" },
  { source: "ux", target: "nextjs" },
  { source: "ux", target: "graph-view" },
  { source: "pricing", target: "competitors" },
  { source: "pricing", target: "investor-deck" },
  { source: "competitors", target: "notion" },
  { source: "competitors", target: "obsidian" },
  { source: "meeting-notes", target: "roadmap" },
  { source: "meeting-notes", target: "pricing" },
  { source: "meeting-notes-2", target: "arch" },
  { source: "meeting-notes-2", target: "user-research" },
  { source: "api-design", target: "auth" },
  { source: "api-design", target: "rag" },
  { source: "nextjs", target: "swift-ios" },
  { source: "nextjs", target: "swift-macos" },
  { source: "swift-ios", target: "sync-engine" },
  { source: "swift-macos", target: "sync-engine" },
  { source: "agents", target: "memory" },
  { source: "agents", target: "prompt-eng" },
  { source: "memory", target: "sync-engine" },
  { source: "graph-view", target: "obsidian" },
  { source: "checklist-launch", target: "meeting-notes" },
  { source: "investor-deck", target: "competitors" },
  { source: "data-privacy", target: "auth" },
  { source: "data-privacy", target: "sync-engine" },
  { source: "daily-log", target: "meeting-notes" },
  { source: "daily-log", target: "ideias-produto" },
  { source: "ideias-produto", target: "marketplace" },
  { source: "ideias-produto", target: "graph-view" },
  { source: "user-research", target: "ux" },
  { source: "search-engine", target: "memory" },
];

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

/** Passo 6: destaque ao arrastar — azul tech. */
const TECH_DRAG_NODE = "#22d3ee";
const TECH_DRAG_LINK = "rgba(34, 211, 238, 0.78)";

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
}: BrainGraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);

  const [dims, setDims] = useState({ w: 640, h: 480 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [highlightLinks, setHighlightLinks] = useState<Set<string>>(new Set());
  const fitDoneKey = useRef<string>("");
  const dragAccumRef = useRef(0);
  const suppressClickUntil = useRef(0);
  const nativeSpreadRecoveryRef = useRef(false);
  const hoverIdRef = useRef<string | null>(null);
  const dragSessionRef = useRef<string | null>(null);
  const [dragRootId, setDragRootId] = useState<string | null>(null);
  const isNativeShell =
    typeof document !== "undefined" &&
    document.documentElement.hasAttribute("data-brain2-native");

  const useVault = graph && graph.nodes.length > 0;
  const activeNodes = useMemo(
    () =>
      useVault
        ? graph.nodes.map((n) => ({ id: n.id, label: n.label, group: "vault" }))
        : mockNodes,
    [useVault, graph]
  );
  const activeEdges = useMemo(() => (useVault ? graph.edges : mockEdges), [useVault, graph]);

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

  const dragEgoSet = useMemo(() => {
    if (!dragRootId) return null as Set<string> | null;
    const s = new Set<string>([dragRootId]);
    const neigh = adjacency.get(dragRootId);
    if (neigh) neigh.forEach((id) => s.add(id));
    return s;
  }, [dragRootId, adjacency]);

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

    const links: LinkObject<BrainNode, BrainLink>[] = activeEdges.map((e) => {
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

    return { nodes, links };
  }, [activeNodes, activeEdges, degreeMap, groupMap, dims.h, dims.w, isNativeShell, useVault]);

  const graphKey = useMemo(
    () => `${useVault ? "v" : "m"}-${graphData.nodes.length}-${graphData.links.length}`,
    [useVault, graphData.nodes.length, graphData.links.length]
  );

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
  }, [graphData, graphKey, dims.w, dims.h, isNativeShell, useVault]);

  useEffect(() => {
    nativeSpreadRecoveryRef.current = false;
  }, [graphKey]);

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
        graphKey,
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
  }, [dims.h, dims.w, graphKey, highlightLinks.size, hoverId, isNativeShell, loading, useVault]);

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
  }, [dims.h, dims.w, graphKey, isNativeShell, useVault]);

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

      if (dragRootId && dragEgoSet) {
        if (!dragEgoSet.has(id)) return withAlpha(base, 0.8);
        if (id === dragRootId) return TECH_DRAG_NODE;
        return base;
      }

      if (isNativeShell) {
        return base;
      }
      if (!highlightSet) return base;
      if (highlightSet.has(id)) return base;
      return isVault ? VAULT_NODE_COLOR_DIM : GROUP_COLORS_DIM[node.group] || "#484848";
    },
    [highlightSet, isNativeShell, dragRootId, dragEgoSet]
  );

  const linkColor = useCallback(
    (link: LinkObject<BrainNode, BrainLink>) => {
      const a = nodeIdOf(link.source);
      const b = nodeIdOf(link.target);
      const k = linkKey(a, b);
      const base = "rgba(255,255,255,0.14)";
      const baseDim = "rgba(255,255,255,0.112)";
      const hi = "rgba(255,255,255,0.38)";
      const faded = "rgba(255,255,255,0.045)";

      if (dragRootId && dragEgoSet) {
        const bothInEgo = dragEgoSet.has(a) && dragEgoSet.has(b);
        if (!bothInEgo) return baseDim;
        if (a === dragRootId || b === dragRootId) return TECH_DRAG_LINK;
        return base;
      }

      if (isNativeShell) {
        return base;
      }
      if (highlightLinks.size === 0) return base;
      return highlightLinks.has(k) ? hi : faded;
    },
    [highlightLinks, isNativeShell, dragRootId, dragEgoSet]
  );

  const linkWidth = useCallback(
    (link: LinkObject<BrainNode, BrainLink>) => {
      const a = nodeIdOf(link.source);
      const b = nodeIdOf(link.target);
      if (dragRootId && dragEgoSet) {
        const bothInEgo = dragEgoSet.has(a) && dragEgoSet.has(b);
        if (!bothInEgo) return 0.55;
        if (a === dragRootId || b === dragRootId) return 1.15;
        return 0.85;
      }
      if (isNativeShell) {
        return 0.9;
      }
      return highlightLinks.has(linkKey(a, b)) ? 1.25 : 0.65;
    },
    [highlightLinks, isNativeShell, dragRootId, dragEgoSet]
  );

  const nodeCanvasObjectMode = useCallback(() => "after" as const, []);

  const nodeCanvasObject = useCallback(
    (node: NodeObject<BrainNode>, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const label = (node.name ?? "").trim() || String(node.id ?? "");
      const r = Math.sqrt(Math.max(0, node.val || 1)) * NODE_REL_SIZE;
      const k = Math.max(globalScale, 0.04);
      const fontPx = 11 / k;
      const pad = 5 / k;
      ctx.font = `${fontPx}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      const id = String(node.id);
      let fill: string;
      if (dragRootId && dragEgoSet) {
        if (!dragEgoSet.has(id)) {
          fill = isNativeShell ? "rgba(220, 220, 220, 0.77)" : "rgba(115, 115, 115, 0.58)";
        } else if (id === dragRootId) {
          fill = "rgba(34, 211, 238, 0.96)";
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
    [highlightSet, isNativeShell, dragRootId, dragEgoSet]
  );

  const onNodeHover = useCallback(
    (node: NodeObject<BrainNode> | null) => {
      const id = node?.id != null ? String(node.id) : null;
      hoverIdRef.current = id;
      if (dragSessionRef.current) return;
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
    const fitKey = `${graphKey}|${dims.w}x${dims.h}`;
    if (fitDoneKey.current === fitKey) return;
    fitDoneKey.current = fitKey;
    emitNativeDebug("brain-engine-stop", { graphKey, fitKey, dimsW: dims.w, dimsH: dims.h });
    fgRef.current?.zoomToFit(480, 36);
  }, [graphKey, dims.w, dims.h]);

  const onBackgroundClick = useCallback((_event: MouseEvent) => {
    hoverIdRef.current = null;
    setHoverId(null);
    setHighlightLinks(new Set());
    emitNativeDebug("brain-background-click", { graphKey });
  }, [graphKey]);

  return (
    <div className="brain-graph-root">
      <button
        className="brain-graph-close"
        onClick={onClose}
        aria-label="Fechar visualização"
        type="button"
      >
        <X size={16} strokeWidth={2} />
      </button>

      {loading ? (
        <div className="brain-graph-loading">
          <Loader2 size={24} strokeWidth={1.5} className="spin" />
          <span>Lendo vault...</span>
        </div>
      ) : (
        <>
          <div className="brain-graph-legend">
            {useVault ? (
              <span className="legend-item">
                <span className="legend-dot" style={{ background: VAULT_NODE_COLOR }} />
                {graph!.nodes.length} notas &middot; {graph!.edges.length} conexões
              </span>
            ) : (
              Object.entries(GROUP_COLORS).map(([group, color]) => (
                <span key={group} className="legend-item">
                  <span className="legend-dot" style={{ background: color }} />
                  {group === "project"
                    ? "Projeto"
                    : group === "tech"
                      ? "Tecnologia"
                      : group === "product"
                        ? "Produto"
                        : group === "business"
                          ? "Negócio"
                          : "Notas"}
                </span>
              ))
            )}
          </div>

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
              linkDirectionalParticles={0}
              d3VelocityDecay={
                isNativeShell && useVault ? PHYSICS.nativeVelocityDecay : PHYSICS.velocityDecay
              }
              d3AlphaDecay={isNativeShell && useVault ? PHYSICS.nativeAlphaDecay : PHYSICS.alphaDecay}
              d3AlphaMin={isNativeShell && useVault ? PHYSICS.nativeAlphaMin : PHYSICS.alphaMin}
              warmupTicks={PHYSICS.warmupTicks}
              cooldownTime={isNativeShell && useVault ? PHYSICS.nativeCooldownMs : PHYSICS.cooldownMs}
              enableNodeDrag
              enableZoomInteraction
              enablePanInteraction
              minZoom={0.12}
              maxZoom={8}
              showNavInfo={false}
              onNodeClick={onNodeClick}
              onNodeHover={onNodeHover}
              onNodeDrag={onNodeDrag}
              onNodeDragEnd={onNodeDragEnd}
              onBackgroundClick={onBackgroundClick}
              onEngineStop={onEngineStop}
            />
          </div>
        </>
      )}

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

        .brain-graph-legend {
          position: absolute;
          bottom: 16px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 20;
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 6px 14px;
          border-radius: 10px;
          background: rgba(20, 20, 20, 0.85);
          border: 1px solid var(--bar-border);
          backdrop-filter: blur(8px);
          pointer-events: none;
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
