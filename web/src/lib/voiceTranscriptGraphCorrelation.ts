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
};

const NODE_THRESHOLD = 0.42;

/**
 * Ligações destacadas: ambas as pontas com menção suficiente na transcrição.
 */
export function computeVoiceGraphCorrelation(
  graph: VaultGraph | null | undefined,
  transcript: string,
): VoiceGraphCorrelation {
  const nodeStrength = new Map<string, number>();
  const linkKeys = new Set<string>();

  if (!graph?.nodes?.length || !transcript.trim()) {
    return { nodeStrength, linkKeys };
  }

  for (const n of graph.nodes) {
    const s = scoreNodeLabelAgainstTranscript(n.label, transcript);
    if (s >= NODE_THRESHOLD) {
      nodeStrength.set(n.id, s);
    }
  }

  if (nodeStrength.size === 0) {
    return { nodeStrength, linkKeys };
  }

  for (const e of graph.edges) {
    const sa = nodeStrength.get(e.source) ?? 0;
    const sb = nodeStrength.get(e.target) ?? 0;
    if (sa >= NODE_THRESHOLD && sb >= NODE_THRESHOLD) {
      linkKeys.add(linkKey(e.source, e.target));
    }
  }

  return { nodeStrength, linkKeys };
}
