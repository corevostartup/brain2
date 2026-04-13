/**
 * Correlaciona a transcrição em tempo real com nós/arestas do grafo do vault
 * (rótulos de notas e ligações [[wikilink]]).
 */

import { formatConversationDisplayTitle, type VaultGraph } from "@/lib/vault";

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Palavras significativas (PT/EN), mínimo 3 caracteres. */
function significantWords(label: string): string[] {
  const n = normalizeForMatch(label);
  return n
    .split(/[\s/-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
}

function linkKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function buildAdjacency(edges: { source: string; target: string }[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!m.has(e.source)) m.set(e.source, new Set());
    if (!m.has(e.target)) m.set(e.target, new Set());
    m.get(e.source)!.add(e.target);
    m.get(e.target)!.add(e.source);
  }
  return m;
}

/** BFS: arestas do caminho mais curto (por número de saltos), ou `null` se desligado. */
function shortestPathEdgeKeys(
  start: string,
  goal: string,
  adj: Map<string, Set<string>>,
): string[] | null {
  if (start === goal) {
    return [];
  }
  const queue: string[] = [start];
  const prev = new Map<string, string | null>();
  prev.set(start, null);

  while (queue.length > 0) {
    const u = queue.shift()!;
    const neigh = adj.get(u);
    if (!neigh) continue;
    for (const v of neigh) {
      if (prev.has(v)) continue;
      prev.set(v, u);
      if (v === goal) {
        const keys: string[] = [];
        let cur: string | null = v;
        while (cur !== null && cur !== start) {
          const p = prev.get(cur);
          if (p == null) break;
          keys.push(linkKey(p, cur));
          cur = p;
        }
        return keys;
      }
      queue.push(v);
    }
  }
  return null;
}

/**
 * Pontuação 0–1: quanto o rótulo da nota “aparece” no texto falado.
 */
export function scoreNodeLabelAgainstTranscript(displayLabel: string, transcript: string): number {
  const t = normalizeForMatch(transcript);
  if (t.length < 2) {
    return 0;
  }
  const display = formatConversationDisplayTitle(displayLabel).trim() || displayLabel.trim();
  if (!display) {
    return 0;
  }
  const full = normalizeForMatch(display);
  if (full.length >= 3 && t.includes(full)) {
    return 1;
  }
  const words = significantWords(display);
  if (words.length === 0) {
    return 0;
  }
  let hits = 0;
  for (const w of words) {
    if (t.includes(w)) {
      hits += 1;
    }
  }
  const ratio = hits / words.length;
  if (hits === 0) {
    return 0;
  }
  /** Exige pelo menos uma palavra forte ou boa cobertura em títulos compostos. */
  if (words.length === 1) {
    return ratio >= 1 ? 0.88 : 0;
  }
  return Math.min(1, 0.45 + ratio * 0.55);
}

export type VoiceGraphCorrelation = {
  nodeStrength: Map<string, number>;
  linkKeys: Set<string>;
  /** Pares de notas activas na fala sem [[wikilink]] directo — correlação visual mais fraca. */
  weakLinkKeys: Set<string>;
  /** Arestas reais do vault ao longo do caminho mais curto entre esses pares (quando existe). */
  pathLinkKeys: Set<string>;
};

const NODE_THRESHOLD = 0.42;
/** Máx. arestas sintéticas “fracas” para não poluir o grafo. */
const MAX_WEAK_SPEECH_LINKS = 10;

/**
 * Ligações destacadas: ambas as pontas com menção suficiente na transcrição.
 */
export function computeVoiceGraphCorrelation(
  graph: VaultGraph | null | undefined,
  transcript: string,
): VoiceGraphCorrelation {
  const nodeStrength = new Map<string, number>();
  const linkKeys = new Set<string>();
  const weakLinkKeys = new Set<string>();
  const pathLinkKeys = new Set<string>();

  if (!graph?.nodes?.length || !transcript.trim()) {
    return { nodeStrength, linkKeys, weakLinkKeys, pathLinkKeys };
  }

  for (const n of graph.nodes) {
    const s = scoreNodeLabelAgainstTranscript(n.label, transcript);
    if (s >= NODE_THRESHOLD) {
      nodeStrength.set(n.id, s);
    }
  }

  if (nodeStrength.size === 0) {
    return { nodeStrength, linkKeys, weakLinkKeys, pathLinkKeys };
  }

  const vaultEdgeKeys = new Set<string>();
  for (const e of graph.edges) {
    vaultEdgeKeys.add(linkKey(e.source, e.target));
  }

  for (const e of graph.edges) {
    const sa = nodeStrength.get(e.source) ?? 0;
    const sb = nodeStrength.get(e.target) ?? 0;
    if (sa >= NODE_THRESHOLD && sb >= NODE_THRESHOLD) {
      linkKeys.add(linkKey(e.source, e.target));
    }
  }

  /** Mais de um assunto activo sem ligação directa no vault — sugere correlação mais fraca. */
  if (nodeStrength.size >= 2) {
    const matched = [...nodeStrength.keys()];
    type Cand = { a: string; b: string; score: number };
    const cands: Cand[] = [];
    for (let i = 0; i < matched.length; i += 1) {
      for (let j = i + 1; j < matched.length; j += 1) {
        const a = matched[i]!;
        const b = matched[j]!;
        const k = linkKey(a, b);
        if (vaultEdgeKeys.has(k)) {
          continue;
        }
        const sa = nodeStrength.get(a) ?? 0;
        const sb = nodeStrength.get(b) ?? 0;
        cands.push({ a, b, score: sa * sb });
      }
    }
    cands.sort((x, y) => y.score - x.score);
    const adj = buildAdjacency(graph.edges);
    const limit = Math.min(MAX_WEAK_SPEECH_LINKS, cands.length);
    for (let i = 0; i < limit; i += 1) {
      const { a, b } = cands[i]!;
      weakLinkKeys.add(linkKey(a, b));
      const path = shortestPathEdgeKeys(a, b, adj);
      if (path && path.length > 0) {
        for (const ek of path) {
          pathLinkKeys.add(ek);
        }
      }
    }
  }

  return { nodeStrength, linkKeys, weakLinkKeys, pathLinkKeys };
}
