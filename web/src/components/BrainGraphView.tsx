"use client";

import dynamic from "next/dynamic";
import type { ComponentType, MutableRefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { X, Loader2 } from "lucide-react";
import type { VaultGraph } from "@/lib/vault";
import { forceCenter, forceX, forceY } from "d3-force-3d";
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
  velocityDecay: 0.28,
  alphaDecay: 0.011,
  alphaMin: 0.006,
  baseLinkDistance: 92,
  degreeDistanceBoost: 20,
  degreeMismatchBoost: 3,
  linkStrengthMin: 0.35,
  linkStrengthMax: 0.95,
  warmupTicks: 140,
  cooldownMs: 22000,
  /** Ancora o conjunto no centro do espaço do grafo (0,0); o utilizador continua a poder pan/zoom na vista. */
  centerStrength: 1,
  pullToOriginStrength: 0.045,
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

  const graphData = useMemo((): GraphData<BrainNode, BrainLink> => {
    const nodes: NodeObject<BrainNode>[] = activeNodes.map((n) => {
      const deg = degreeMap[n.id] || 1;
      return {
        id: n.id,
        name: n.label,
        group: n.group,
        val: clamp(1 + Math.log1p(deg) * 1.4, 1, 12),
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
  }, [activeNodes, activeEdges, degreeMap, groupMap]);

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
        if (attempts++ < 90) requestAnimationFrame(applyForces);
        return;
      }

      const linkForce = fg.d3Force("link") as unknown as {
        distance?: (fn: (l: LinkObject<BrainNode, BrainLink>) => number) => void;
        strength?: (fn: (l: LinkObject<BrainNode, BrainLink>) => number) => void;
      };

      if (linkForce && typeof linkForce.distance === "function") {
        linkForce.distance((l) => Number(l.distance));
        linkForce.strength?.((l) => Number(l.strength));
      }

      const charge = fg.d3Force("charge") as unknown as { strength?: (v: number) => void };
      charge?.strength?.(PHYSICS.chargeStrength);

      fg.d3Force(
        "center",
        forceCenter(0, 0, 0).strength(PHYSICS.centerStrength)
      );
      fg.d3Force("x", forceX(0).strength(PHYSICS.pullToOriginStrength));
      fg.d3Force("y", forceY(0).strength(PHYSICS.pullToOriginStrength));

      fg.d3ReheatSimulation();
    };

    requestAnimationFrame(applyForces);
    return () => {
      cancelled = true;
    };
  }, [graphData, graphKey, dims.w, dims.h]);

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
      const isVault = node.group === "vault";
      const base = isVault ? VAULT_NODE_COLOR : GROUP_COLORS[node.group] || "#b0b0b0";
      if (!highlightSet) return base;
      if (highlightSet.has(String(node.id))) return base;
      return isVault ? VAULT_NODE_COLOR_DIM : GROUP_COLORS_DIM[node.group] || "#484848";
    },
    [highlightSet]
  );

  const linkColor = useCallback(
    (link: LinkObject<BrainNode, BrainLink>) => {
      const a = nodeIdOf(link.source);
      const b = nodeIdOf(link.target);
      const k = linkKey(a, b);
      const base = "rgba(255,255,255,0.14)";
      const hi = "rgba(255,255,255,0.38)";
      const faded = "rgba(255,255,255,0.045)";
      if (highlightLinks.size === 0) return base;
      return highlightLinks.has(k) ? hi : faded;
    },
    [highlightLinks]
  );

  const linkWidth = useCallback(
    (link: LinkObject<BrainNode, BrainLink>) => {
      const a = nodeIdOf(link.source);
      const b = nodeIdOf(link.target);
      return highlightLinks.has(linkKey(a, b)) ? 1.25 : 0.65;
    },
    [highlightLinks]
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
      if (!highlightSet) {
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
    [highlightSet]
  );

  const onNodeHover = useCallback(
    (node: NodeObject<BrainNode> | null) => {
      const id = node?.id != null ? String(node.id) : null;
      setHoverId(id);
      updateLinkHighlight(id);
    },
    [updateLinkHighlight]
  );

  const onNodeClick = useCallback(
    (node: NodeObject<BrainNode>, _event: MouseEvent) => {
      if (performance.now() < suppressClickUntil.current) return;
      if (!onOpenConversationFromNode) return;
      onOpenConversationFromNode(String(node.id), node.name);
    },
    [onOpenConversationFromNode]
  );

  const onNodeDrag = useCallback(
    (_node: NodeObject<BrainNode>, translate: { x: number; y: number }) => {
      dragAccumRef.current += Math.hypot(translate.x, translate.y);
    },
    []
  );

  const onNodeDragEnd = useCallback((_node: NodeObject<BrainNode>, _translate: { x: number; y: number }) => {
    if (dragAccumRef.current > 3) {
      suppressClickUntil.current = performance.now() + 240;
    }
    dragAccumRef.current = 0;
    fgRef.current?.d3ReheatSimulation();
  }, []);

  const onEngineStop = useCallback(() => {
    if (dims.w < 48 || dims.h < 48) return;
    const fitKey = `${graphKey}|${dims.w}x${dims.h}`;
    if (fitDoneKey.current === fitKey) return;
    fitDoneKey.current = fitKey;
    fgRef.current?.zoomToFit(480, 36);
  }, [graphKey, dims.w, dims.h]);

  const onBackgroundClick = useCallback((_event: MouseEvent) => {
    setHoverId(null);
    setHighlightLinks(new Set());
  }, []);

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
              nodeLabel="name"
              nodeVal="val"
              nodeRelSize={NODE_REL_SIZE}
              nodeCanvasObjectMode={nodeCanvasObjectMode}
              nodeCanvasObject={nodeCanvasObject}
              autoPauseRedraw={false}
              nodeColor={nodeColor}
              linkColor={linkColor}
              linkWidth={linkWidth}
              linkDirectionalParticles={0}
              d3VelocityDecay={PHYSICS.velocityDecay}
              d3AlphaDecay={PHYSICS.alphaDecay}
              d3AlphaMin={PHYSICS.alphaMin}
              warmupTicks={PHYSICS.warmupTicks}
              cooldownTime={PHYSICS.cooldownMs}
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
