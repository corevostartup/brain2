import type { VaultGraph } from "@/lib/vault";
import { formatConversationDisplayTitle } from "@/lib/vault";

function linkKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function tokenize(text: string): Set<string> {
  const t = stripDiacritics(text.toLowerCase());
  const words = new Set<string>();
  for (const raw of t.split(/[^a-z0-9]+/)) {
    if (raw.length >= 3) {
      words.add(raw);
    }
  }
  return words;
}

/**
 * Correlaciona o discurso em tempo real com nós/arestas do Your Brain (vault).
 * Leve o suficiente para correr a cada atualização de transcrição (interim ou final).
 */
export function computeLiveSpeechHighlights(
  transcript: string,
  graph: VaultGraph | null | undefined
): { nodeStrength: Map<string, number>; linkKeys: Set<string> } {
  const nodeStrength = new Map<string, number>();
  const linkKeys = new Set<string>();
  if (!graph?.nodes?.length) {
    return { nodeStrength, linkKeys };
  }

  const lower = stripDiacritics(transcript.toLowerCase());
  const words = tokenize(transcript);

  for (const n of graph.nodes) {
    const rawLabel = formatConversationDisplayTitle(n.label).trim() || n.label;
    const label = stripDiacritics(rawLabel.toLowerCase());
    if (!label) {
      continue;
    }

    let score = 0;

    if (label.length >= 5 && lower.includes(label)) {
      score = Math.max(score, 0.92);
    }

    for (const w of words) {
      if (w.length >= 4 && (label.includes(w) || w.includes(label))) {
        score = Math.max(score, 0.42 + Math.min(0.48, w.length * 0.04));
      }
    }

    for (const part of label.split(/[^a-z0-9]+/)) {
      if (part.length >= 4 && words.has(part)) {
        score = Math.max(score, 0.78);
      }
    }

    if (score > 0.18) {
      nodeStrength.set(n.id, Math.min(1, score));
    }
  }

  for (const e of graph.edges) {
    const sa = nodeStrength.get(e.source) ?? 0;
    const sb = nodeStrength.get(e.target) ?? 0;
    if (sa > 0.22 && sb > 0.22) {
      linkKeys.add(linkKey(e.source, e.target));
    }
  }

  return { nodeStrength, linkKeys };
}
