import type { VaultCorrelationHit } from "@/ancc/models/context";
import type { VaultFileSnapshot } from "@/ancc/pipeline/vault-correlation";
import { intentRelevanceMultiplier, type RetrievalIntent } from "@/ancc/pipeline/retrieval-intent";
import { entityOverlapScore } from "@/ancc/pipeline/stable-entities";
import { expandHitsWithWikiGraph } from "@/ancc/pipeline/vault-graph-expand";
import { normalizeVaultPathKey } from "@/ancc/agents/plasticity-agent";

export type EnrichVaultHitsOptions = {
  vaultFiles: VaultFileSnapshot[];
  intent: RetrievalIntent;
  /** Entidades canónicas da sessão + mensagem. */
  entityHints: string[];
  /** Peso -1…1 por path normalizado (feedback persistido). */
  pathFeedback: Record<string, number>;
};

function feedbackMultiplier(weight: number | undefined): number {
  if (weight === undefined || weight === 0) {
    return 1;
  }
  /** -1 → ~0.88, +1 → ~1.12 */
  return Math.max(0.72, Math.min(1.18, 1 + 0.12 * weight));
}

function pathFeedbackLookup(path: string, map: Record<string, number>): number | undefined {
  const k = normalizeVaultPathKey(path);
  if (map[k] !== undefined) {
    return map[k];
  }
  /** Alguns clientes podem guardar só basename. */
  const tail = k.split("/").pop();
  if (tail && map[tail] !== undefined) {
    return map[tail];
  }
  return undefined;
}

/**
 * Re-ranking composto + expansão por grafo (wikilinks) + intenção + feedback.
 */
export function enrichVaultCorrelationHits(
  hits: VaultCorrelationHit[],
  opts: EnrichVaultHitsOptions,
): VaultCorrelationHit[] {
  if (hits.length === 0) {
    return hits;
  }

  const intentMul = intentRelevanceMultiplier(opts.intent);

  let working = hits.map((h) => ({
    ...h,
    relevance: Math.min(1, h.relevance * intentMul),
  }));

  working = expandHitsWithWikiGraph(working, opts.vaultFiles, {
    maxAdded: opts.intent === "recall" ? 10 : 7,
    decay: opts.intent === "recall" ? 0.42 : 0.35,
  });

  const reranked: VaultCorrelationHit[] = [];

  for (const h of working) {
    const fb = feedbackMultiplier(pathFeedbackLookup(h.path, opts.pathFeedback));
    const ent = entityOverlapScore(h.noteTitle, h.snippet, opts.entityHints);
    const graphBoost = h.graphExpanded ? 0.72 : 1;
    const base = h.relevance * fb;
    /** Re-ranking: combina relevância ajustada, sobreposição de entidades e ligação ao grafo. */
    const composite =
      0.52 * base + 0.28 * ent + 0.12 * graphBoost + 0.08 * (h.semanticSimilarity ?? base);

    reranked.push({
      ...h,
      relevance: Math.min(1, Math.max(0, composite)),
      rerankScore: composite,
      intentAdjusted: true,
    });
  }

  reranked.sort((a, b) => (b.rerankScore ?? b.relevance) - (a.rerankScore ?? a.relevance));

  /** Normalizar relevância final ao intervalo útil (preserva ordenação). */
  const maxR = reranked[0]?.relevance ?? 1;
  const scale = maxR > 0 ? 1 / maxR : 1;
  return reranked.map((h) => ({
    ...h,
    relevance: Math.min(1, h.relevance * scale),
  }));
}
