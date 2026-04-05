"use client";

import { useEffect, useRef, useCallback, useMemo } from "react";
import cytoscape, { type Core, type EventObject, type NodeSingular } from "cytoscape";
import { X, Loader2 } from "lucide-react";
import type { VaultGraph } from "@/lib/vault";

// ── Force simulation config ────────────────────────────────────────────
const FORCE_CFG = {
  repulsion: 6000,      // Coulomb repulsion strength
  attraction: 0.012,    // Spring attraction along edges
  baseIdealLength: 95,
  degreeIdealBoost: 22,
  degreeMismatchLengthBoost: 3.2,
  springStretchCap: 240,
  gravity: 0.04,        // Pull toward center
  damping: 0.82,        // Velocity damping per frame
  minVelocity: 0.02,    // Below this, node is "at rest"
  maxVelocity: 20,      // Cap velocity per frame
  cooldownTicks: 600,   // Auto-stop after N idle ticks
  dragBoost: 3.0,       // Extra attraction multiplier during drag
  dragImpulse: 0.75,    // Velocity impulse from dragged node to neighbors
  dragPropagationDepth: 4,
  dragPropagationDecay: 0.62,
  dragPositionCarry: 0.42,
  dragNeighborSpring: 0.095,
  dragVelocitySmoothing: 0.28,
  dragMomentumScale: 14,
  dragReleaseBoost: 1.8,
  dragReleaseMaxImpulse: 6.5,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ── Mock data: interconnected notes/files ──────────────────────────────
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

// ── Color palette by group ─────────────────────────────────────────────
const GROUP_COLORS: Record<string, string> = {
  project: "#7c6ef0",
  tech: "#4ea8de",
  product: "#48bf84",
  business: "#e8a838",
  notes: "#888888",
};

const GROUP_COLORS_DIM: Record<string, string> = {
  project: "#3b3570",
  tech: "#264f6a",
  product: "#24603f",
  business: "#6e5020",
  notes: "#404040",
};

type BrainGraphViewProps = {
  onClose: () => void;
  graph?: VaultGraph | null;
  loading?: boolean;
  onOpenConversationFromNode?: (nodeId: string, nodeLabel: string) => void;
};

// Single color for vault-sourced nodes
const VAULT_NODE_COLOR = "#4ea8de";
const VAULT_NODE_COLOR_DIM = "#264f6a";

export default function BrainGraphView({ onClose, graph, loading, onOpenConversationFromNode }: BrainGraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const rafRef = useRef<number>(0);
  const velocities = useRef<Record<string, { vx: number; vy: number }>>({});
  const grabbedNode = useRef<string | null>(null);
  const dragLastPos = useRef<{ x: number; y: number } | null>(null);
  const dragMomentum = useRef<{ vx: number; vy: number; ts: number } | null>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const suppressNodeTapUntil = useRef(0);
  const simulationActive = useRef(true);

  const collectInfluencedNodes = useCallback((cy: Core, sourceId: string) => {
    const visited = new Set<string>([sourceId]);
    let frontier = [sourceId];
    let depth = 1;

    const influenced: Array<{ id: string; influence: number }> = [];

    while (frontier.length > 0 && depth <= FORCE_CFG.dragPropagationDepth) {
      const nextFrontier: string[] = [];

      for (const id of frontier) {
        const node = cy.getElementById(id);
        if (node.empty()) continue;

        node.connectedEdges().forEach((edge) => {
          const neighborId = edge.source().id() === id ? edge.target().id() : edge.source().id();
          if (visited.has(neighborId)) return;

          visited.add(neighborId);
          nextFrontier.push(neighborId);
          influenced.push({
            id: neighborId,
            influence: FORCE_CFG.dragImpulse * Math.pow(FORCE_CFG.dragPropagationDecay, depth - 1),
          });
        });
      }

      frontier = nextFrontier;
      depth += 1;
    }

    return influenced;
  }, []);

  const applyDragPropagation = useCallback((
    cy: Core,
    sourceId: string,
    dx: number,
    dy: number,
    momentum: { vx: number; vy: number }
  ) => {
    const deltaMagnitude = Math.hypot(dx, dy);
    if (!Number.isFinite(deltaMagnitude) || deltaMagnitude < 0.001) return;

    const vels = velocities.current;
    const influenced = collectInfluencedNodes(cy, sourceId);

    if (influenced.length === 0) return;

    const momentumX = momentum.vx * FORCE_CFG.dragMomentumScale;
    const momentumY = momentum.vy * FORCE_CFG.dragMomentumScale;

    cy.batch(() => {
      for (const target of influenced) {
        if (target.id === grabbedNode.current) continue;

        const node = cy.getElementById(target.id);
        if (node.empty()) continue;

        const velocity = vels[target.id] ?? { vx: 0, vy: 0 };
        velocity.vx += (dx + momentumX) * target.influence;
        velocity.vy += (dy + momentumY) * target.influence;
        vels[target.id] = velocity;

        const position = node.position();
        node.position({
          x: position.x + dx * target.influence * FORCE_CFG.dragPositionCarry,
          y: position.y + dy * target.influence * FORCE_CFG.dragPositionCarry,
        });
      }
    });
  }, [collectInfluencedNodes]);

  const applyReleaseInertia = useCallback((cy: Core, sourceId: string, vx: number, vy: number) => {
    const vels = velocities.current;
    const influenced = collectInfluencedNodes(cy, sourceId);
    if (influenced.length === 0) return;

    const releaseVX = clamp(vx * FORCE_CFG.dragMomentumScale * FORCE_CFG.dragReleaseBoost, -FORCE_CFG.dragReleaseMaxImpulse, FORCE_CFG.dragReleaseMaxImpulse);
    const releaseVY = clamp(vy * FORCE_CFG.dragMomentumScale * FORCE_CFG.dragReleaseBoost, -FORCE_CFG.dragReleaseMaxImpulse, FORCE_CFG.dragReleaseMaxImpulse);

    for (const target of influenced) {
      const velocity = vels[target.id] ?? { vx: 0, vy: 0 };
      velocity.vx += releaseVX * target.influence;
      velocity.vy += releaseVY * target.influence;
      vels[target.id] = velocity;
    }
  }, [collectInfluencedNodes]);

  const runForceSimulation = useCallback((cy: Core) => {
    const nodes = cy.nodes();
    const edges = cy.edges();
    const vels = velocities.current;

    // Initialize velocities
    nodes.forEach((n) => {
      if (!vels[n.id()]) vels[n.id()] = { vx: 0, vy: 0 };
    });

    let idleTicks = 0;

    const tick = () => {
      if (!simulationActive.current) return;

      const posMap: Record<string, { x: number; y: number }> = {};
      nodes.forEach((n) => {
        const pos = n.position();
        posMap[n.id()] = { x: pos.x, y: pos.y };
      });

      // Center of mass
      let cx = 0, cy2 = 0;
      nodes.forEach((n) => { cx += posMap[n.id()].x; cy2 += posMap[n.id()].y; });
      cx /= nodes.length;
      cy2 /= nodes.length;

      // Reset forces
      const forces: Record<string, { fx: number; fy: number }> = {};
      nodes.forEach((n) => { forces[n.id()] = { fx: 0, fy: 0 }; });

      // Repulsion (all pairs)
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const pa = posMap[a.id()], pb = posMap[b.id()];
          const dx = pa.x - pb.x;
          const dy = pa.y - pb.y;
          let dist = Math.sqrt(dx * dx + dy * dy) || 1;
          if (dist < 10) dist = 10;
          const f = FORCE_CFG.repulsion / (dist * dist);
          const fx = (dx / dist) * f;
          const fy = (dy / dist) * f;
          forces[a.id()].fx += fx;
          forces[a.id()].fy += fy;
          forces[b.id()].fx -= fx;
          forces[b.id()].fy -= fy;
        }
      }

      // Attraction (edges) — boosted when dragging
      const isDragging = grabbedNode.current !== null;
      const attractionK = isDragging
        ? FORCE_CFG.attraction * FORCE_CFG.dragBoost
        : FORCE_CFG.attraction;

      edges.forEach((e) => {
        const src = e.source().id();
        const tgt = e.target().id();
        const pa = posMap[src], pb = posMap[tgt];
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const edgeWeight = Number(e.data("weight")) || 1;
        const idealLength = Number(e.data("idealLength")) || FORCE_CFG.baseIdealLength;
        const stretch = clamp(
          dist - idealLength,
          -FORCE_CFG.springStretchCap,
          FORCE_CFG.springStretchCap
        );
        const f = stretch * attractionK * edgeWeight;
        forces[src].fx += (dx / dist) * f;
        forces[src].fy += (dy / dist) * f;
        forces[tgt].fx -= (dx / dist) * f;
        forces[tgt].fy -= (dy / dist) * f;
      });

      // While dragging, pull first-order neighbors directly as springs from dragged node.
      if (isDragging && grabbedNode.current) {
        const draggedId = grabbedNode.current;
        const draggedPos = posMap[draggedId];
        const draggedNode = cy.getElementById(draggedId);

        if (draggedPos && !draggedNode.empty()) {
          draggedNode.connectedEdges().forEach((edge) => {
            const neighborId = edge.source().id() === draggedId ? edge.target().id() : edge.source().id();
            const neighborPos = posMap[neighborId];
            if (!neighborPos || !forces[neighborId]) return;

            const dx = draggedPos.x - neighborPos.x;
            const dy = draggedPos.y - neighborPos.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const idealLength = Number(edge.data("idealLength")) || FORCE_CFG.baseIdealLength;
            const edgeWeight = Number(edge.data("weight")) || 1;
            const stretch = clamp(
              dist - idealLength,
              -FORCE_CFG.springStretchCap,
              FORCE_CFG.springStretchCap
            );
            const f = stretch * FORCE_CFG.dragNeighborSpring * edgeWeight;

            forces[neighborId].fx += (dx / dist) * f;
            forces[neighborId].fy += (dy / dist) * f;
          });
        }
      }

      // Gravity toward center
      nodes.forEach((n) => {
        const p = posMap[n.id()];
        forces[n.id()].fx += (cx - p.x) * FORCE_CFG.gravity;
        forces[n.id()].fy += (cy2 - p.y) * FORCE_CFG.gravity;
      });

      // Apply forces, update velocities & positions
      let totalMovement = 0;

      cy.batch(() => {
        nodes.forEach((n) => {
          const id = n.id();
          if (id === grabbedNode.current) return; // skip grabbed node

          const v = vels[id];
          v.vx = (v.vx + forces[id].fx) * FORCE_CFG.damping;
          v.vy = (v.vy + forces[id].fy) * FORCE_CFG.damping;

          // Cap velocity
          const speed = Math.sqrt(v.vx * v.vx + v.vy * v.vy);
          if (speed > FORCE_CFG.maxVelocity) {
            v.vx = (v.vx / speed) * FORCE_CFG.maxVelocity;
            v.vy = (v.vy / speed) * FORCE_CFG.maxVelocity;
          }

          if (Math.abs(v.vx) < FORCE_CFG.minVelocity) v.vx = 0;
          if (Math.abs(v.vy) < FORCE_CFG.minVelocity) v.vy = 0;

          totalMovement += Math.abs(v.vx) + Math.abs(v.vy);

          n.position({
            x: posMap[id].x + v.vx,
            y: posMap[id].y + v.vy,
          });
        });
      });

      // Auto sleep when stable (but wake on grab)
      if (totalMovement < 0.5) {
        idleTicks++;
        if (idleTicks > FORCE_CFG.cooldownTicks && !grabbedNode.current) {
          simulationActive.current = false;
          return;
        }
      } else {
        idleTicks = 0;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const wakeSimulation = useCallback(() => {
    if (!simulationActive.current && cyRef.current) {
      simulationActive.current = true;
      runForceSimulation(cyRef.current);
    }
  }, [runForceSimulation]);

  // Decide which data source to use
  const useVault = graph && graph.nodes.length > 0;
  const activeNodes = useMemo(() =>
    useVault
      ? graph.nodes.map((n) => ({ id: n.id, label: n.label, group: "vault" }))
      : mockNodes,
    [useVault, graph]
  );
  const activeEdges = useMemo(() =>
    useVault ? graph.edges : mockEdges,
    [useVault, graph]
  );

  const initGraph = useCallback(() => {
    if (!containerRef.current) return;

    if (cyRef.current) {
      cyRef.current.destroy();
    }
    cancelAnimationFrame(rafRef.current);
    simulationActive.current = true;

    // Compute degree for node sizing
    const degreeMap: Record<string, number> = {};
    activeNodes.forEach((n) => (degreeMap[n.id] = 0));
    activeEdges.forEach((e) => {
      degreeMap[e.source] = (degreeMap[e.source] || 0) + 1;
      degreeMap[e.target] = (degreeMap[e.target] || 0) + 1;
    });
    const groupMap: Record<string, string> = {};
    activeNodes.forEach((n) => {
      groupMap[n.id] = n.group;
    });

    const elements = [
      ...activeNodes.map((n) => ({
        data: {
          id: n.id,
          label: n.label,
          group: n.group,
          degree: degreeMap[n.id] || 1,
        },
      })),
      ...activeEdges.map((e, i) => {
        const sourceDegree = degreeMap[e.source] || 1;
        const targetDegree = degreeMap[e.target] || 1;
        const avgDegree = (sourceDegree + targetDegree) / 2;
        const degreeMismatch = Math.abs(sourceDegree - targetDegree);

        const sameGroup = groupMap[e.source] === groupMap[e.target];

        // Weigh links: stronger for local/low-degree pairs, softer for hub-heavy edges.
        const lowDegreeBoost = 1 + 0.9 / (1 + avgDegree);
        const hubDamping = 1 / (1 + Math.log1p(Math.max(sourceDegree, targetDegree)) * 0.42);
        const groupAffinity = sameGroup ? 1.16 : 0.92;
        const weight = clamp(groupAffinity * lowDegreeBoost * (0.72 + hubDamping), 0.35, 2.2);

        // Adaptive ideal length by local topology to reduce central clumping.
        const idealLength =
          FORCE_CFG.baseIdealLength +
          Math.log1p(avgDegree) * FORCE_CFG.degreeIdealBoost +
          degreeMismatch * FORCE_CFG.degreeMismatchLengthBoost;

        return {
          data: {
            id: `e${i}`,
            source: e.source,
            target: e.target,
            weight,
            idealLength,
          },
        };
      }),
    ];

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            width: "mapData(degree, 1, 10, 12, 36)",
            height: "mapData(degree, 1, 10, 12, 36)",
            "background-color": (ele) => {
              const g = ele.data("group");
              return g === "vault" ? VAULT_NODE_COLOR : (GROUP_COLORS[g] || "#666");
            },
            "border-width": 0,
            "font-size": "9px",
            "font-family": "Inter, sans-serif",
            "font-weight": 400,
            color: "#a0a0a0",
            "text-valign": "bottom",
            "text-halign": "center",
            "text-margin-y": 6,
            "text-max-width": "80px",
            "text-wrap": "ellipsis",
            "min-zoomed-font-size": 8,
            "overlay-opacity": 0,
            "transition-property":
              "background-color, width, height, border-width, border-color, opacity",
            "transition-duration": 300,
          } as cytoscape.Css.Node,
        },
        {
          selector: "edge",
          style: {
            width: 0.4,
            "line-color": "rgba(255,255,255,0.018)",
            "curve-style": "bezier",
            "overlay-opacity": 0,
            "transition-property": "line-color, width, opacity",
            "transition-duration": 300,
          } as cytoscape.Css.Edge,
        },
        {
          selector: "node.highlighted",
          style: {
            "background-color": (ele) => {
              const g = ele.data("group");
              return g === "vault" ? VAULT_NODE_COLOR : (GROUP_COLORS[g] || "#888");
            },
            "border-width": 2,
            "border-color": "#ffffff",
            color: "#e0e0e0",
            "font-size": "11px",
            "z-index": 10,
          } as cytoscape.Css.Node,
        },
        {
          selector: "node.neighbor",
          style: {
            "background-color": (ele) => {
              const g = ele.data("group");
              return g === "vault" ? VAULT_NODE_COLOR : (GROUP_COLORS[g] || "#666");
            },
            color: "#c0c0c0",
            "z-index": 5,
          } as cytoscape.Css.Node,
        },
        {
          selector: "node.dimmed",
          style: {
            "background-color": (ele) => {
              const g = ele.data("group");
              return g === "vault" ? VAULT_NODE_COLOR_DIM : (GROUP_COLORS_DIM[g] || "#333");
            },
            color: "#3a3a3a",
          } as cytoscape.Css.Node,
        },
        {
          selector: "edge.highlighted",
          style: {
            width: 0.8,
            "line-color": "rgba(255,255,255,0.08)",
            "z-index": 10,
          } as cytoscape.Css.Edge,
        },
        {
          selector: "edge.dimmed",
          style: {
            "line-color": "rgba(255,255,255,0.005)",
          } as cytoscape.Css.Edge,
        },
        // Grab: unconnected nodes become 75% transparent
        {
          selector: "node.grab-dimmed",
          style: {
            opacity: 0.25,
          } as cytoscape.Css.Node,
        },
        {
          selector: "edge.grab-dimmed",
          style: {
            opacity: 0.15,
          } as cytoscape.Css.Edge,
        },
        {
          selector: "node.grab-highlight",
          style: {
            "border-width": 2,
            "border-color": "#ffffff",
            "z-index": 10,
          } as cytoscape.Css.Node,
        },
        {
          selector: "edge.grab-connected",
          style: {
            "line-color": "rgba(255,255,255,0.08)",
            width: 0.8,
            "z-index": 10,
          } as cytoscape.Css.Edge,
        },
      ],
      // Use preset layout — we'll position with force simulation
      layout: {
        name: "cose",
        animate: false,
        nodeRepulsion: () => 6000,
        idealEdgeLength: () => 120,
        edgeElasticity: () => 80,
        gravity: 0.2,
        numIter: 500,
        randomize: true,
        componentSpacing: 60,
        nodeDimensionsIncludeLabels: true,
        padding: 40,
      } as cytoscape.CoseLayoutOptions,
      minZoom: 0.15,
      maxZoom: 4,
      wheelSensitivity: 0.3,
      pixelRatio: "auto",
      textureOnViewport: false,
      hideEdgesOnViewport: false,
      hideLabelsOnViewport: false,
    });

    // ── Hover interactions (Obsidian-style) ──
    cy.on("mouseover", "node", (evt: EventObject) => {
      const node = evt.target;
      const neighborhood = node.closedNeighborhood();

      cy.elements().addClass("dimmed");
      neighborhood.removeClass("dimmed");
      neighborhood.edges().addClass("highlighted");
      neighborhood.nodes().not(node).addClass("neighbor");
      node.addClass("highlighted");

      containerRef.current!.style.cursor = "pointer";
    });

    cy.on("mouseout", "node", () => {
      cy.elements()
        .removeClass("dimmed")
        .removeClass("highlighted")
        .removeClass("neighbor");
      containerRef.current!.style.cursor = "grab";
    });

    // ── Grab / drag: pin node, wake physics, dim unconnected ──
    cy.on("grab", "node", (evt: EventObject) => {
      const node = evt.target as NodeSingular;
      grabbedNode.current = node.id();
      const startPos = node.position();
      dragLastPos.current = { x: startPos.x, y: startPos.y };
      dragStartPos.current = { x: startPos.x, y: startPos.y };
      dragMomentum.current = { vx: 0, vy: 0, ts: performance.now() };

      // Dim unconnected elements
      const neighborhood = node.closedNeighborhood();
      cy.elements().addClass("grab-dimmed");
      neighborhood.removeClass("grab-dimmed");
      node.addClass("grab-highlight");
      neighborhood.edges().addClass("grab-connected");

      // Reset all velocities for a smooth response
      const vels = velocities.current;
      Object.keys(vels).forEach((id) => { vels[id].vx = 0; vels[id].vy = 0; });
      wakeSimulation();
      containerRef.current!.style.cursor = "grabbing";
    });

    cy.on("drag", "node", (evt: EventObject) => {
      const node = evt.target as NodeSingular;
      const pos = node.position();
      const last = dragLastPos.current;
      const start = dragStartPos.current;

      if (start) {
        const movedDistance = Math.hypot(pos.x - start.x, pos.y - start.y);
        if (movedDistance > 2.5) {
          suppressNodeTapUntil.current = performance.now() + 220;
        }
      }

      if (last) {
        const dx = pos.x - last.x;
        const dy = pos.y - last.y;
        const now = performance.now();
        const currentMomentum = dragMomentum.current ?? { vx: 0, vy: 0, ts: now };
        const dt = Math.max(1, now - currentMomentum.ts);
        const instantVX = dx / dt;
        const instantVY = dy / dt;
        const smooth = FORCE_CFG.dragVelocitySmoothing;
        const blendedVX = currentMomentum.vx * (1 - smooth) + instantVX * smooth;
        const blendedVY = currentMomentum.vy * (1 - smooth) + instantVY * smooth;
        dragMomentum.current = { vx: blendedVX, vy: blendedVY, ts: now };

        applyDragPropagation(cy, node.id(), dx, dy, { vx: blendedVX, vy: blendedVY });
      }
      dragLastPos.current = { x: pos.x, y: pos.y };
      wakeSimulation();
    });

    cy.on("free", "node", (evt: EventObject) => {
      const node = evt.target as NodeSingular;
      const momentum = dragMomentum.current;
      if (momentum) {
        applyReleaseInertia(cy, node.id(), momentum.vx, momentum.vy);
      }

      grabbedNode.current = null;
      dragLastPos.current = null;
      dragStartPos.current = null;
      dragMomentum.current = null;
      cy.elements()
        .removeClass("grab-dimmed")
        .removeClass("grab-highlight")
        .removeClass("grab-connected");
      wakeSimulation();
      containerRef.current!.style.cursor = "grab";
    });

    cy.on("tap", "node", (evt: EventObject) => {
      if (performance.now() < suppressNodeTapUntil.current) return;
      if (!onOpenConversationFromNode) return;

      const node = evt.target as NodeSingular;
      const nodeId = node.id();
      const nodeLabel = String(node.data("label") ?? nodeId);
      onOpenConversationFromNode(nodeId, nodeLabel);
    });

    containerRef.current.style.cursor = "grab";
    cyRef.current = cy;

    // Start continuous force simulation after initial layout
    cy.one("layoutstop", () => {
      velocities.current = {};
      runForceSimulation(cy);
    });
  }, [
    runForceSimulation,
    wakeSimulation,
    applyDragPropagation,
    applyReleaseInertia,
    onOpenConversationFromNode,
    activeNodes,
    activeEdges,
  ]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      initGraph();
    });

    return () => {
      cancelAnimationFrame(raf);
      simulationActive.current = false;
      cancelAnimationFrame(rafRef.current);
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, [initGraph]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      cyRef.current?.resize();
      cyRef.current?.fit(undefined, 40);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="brain-graph-root">
      <button
        className="brain-graph-close"
        onClick={onClose}
        aria-label="Fechar visualização"
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
                {graph.nodes.length} notas &middot; {graph.edges.length} conexões
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

          <div ref={containerRef} className="brain-graph-container" />
        </>
      )}

      <style jsx>{`
        .brain-graph-root {
          position: relative;
          width: 100%;
          height: 100%;
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
          min-height: 0;
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
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
