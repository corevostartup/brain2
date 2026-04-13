import { parseWikiLinksFromText } from "@/ancc/models/link";
import { noteTitleFromFileName, type VaultFileSnapshot } from "@/ancc/pipeline/vault-correlation";
import type { VaultCorrelationHit } from "@/ancc/models/context";

function normPathKey(p: string): string {
  return p.replace(/\\/g, "/").trim().toLowerCase();
}

/**
 * Mapa título da nota (lower) → path absoluto do ficheiro.
 */
export function buildVaultTitleToPath(files: VaultFileSnapshot[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of files) {
    m.set(noteTitleFromFileName(f.name).toLowerCase(), f.path);
  }
  return m;
}

/**
 * Para cada nota, conjunto de paths de notas ligadas por [[wikilink]].
 */
export function buildOutgoingWikiNeighbors(files: VaultFileSnapshot[]): Map<string, Set<string>> {
  const titleToPath = buildVaultTitleToPath(files);
  const out = new Map<string, Set<string>>();

  for (const f of files) {
    const nk = normPathKey(f.path);
    const set = new Set<string>();
    for (const raw of parseWikiLinksFromText(f.content)) {
      const target = raw.trim();
      const p = titleToPath.get(target.toLowerCase());
      if (p && normPathKey(p) !== nk) {
        set.add(p);
      }
    }
    out.set(nk, set);
  }
  return out;
}

export type GraphExpandOptions = {
  maxAdded?: number;
  decay?: number;
};

/**
 * Adiciona notas vizinhas (1 salto) com relevância atenuada — “efeito grafo” do Obsidian.
 */
export function expandHitsWithWikiGraph(
  hits: VaultCorrelationHit[],
  files: VaultFileSnapshot[],
  options?: GraphExpandOptions,
): VaultCorrelationHit[] {
  const maxAdded = options?.maxAdded ?? 8;
  const decay = options?.decay ?? 0.38;
  if (files.length === 0 || hits.length === 0) {
    return hits;
  }

  const neighbors = buildOutgoingWikiNeighbors(files);
  const fileByPath = new Map(files.map((f) => [normPathKey(f.path), f]));
  const byPath = new Map<string, VaultCorrelationHit>();

  for (const h of hits) {
    byPath.set(normPathKey(h.path), { ...h });
  }

  let added = 0;
  const seeds = [...byPath.values()].sort((a, b) => b.relevance - a.relevance).slice(0, 12);

  for (const seed of seeds) {
    if (added >= maxAdded) {
      break;
    }
    const nk = normPathKey(seed.path);
    const outs = neighbors.get(nk);
    if (!outs) {
      continue;
    }
    for (const nbPath of outs) {
      if (added >= maxAdded) {
        break;
      }
      const nbk = normPathKey(nbPath);
      if (byPath.has(nbk)) {
        continue;
      }
      const f = fileByPath.get(nbk);
      if (!f) {
        continue;
      }
      const rel = Math.min(1, seed.relevance * decay);
      const snippet = f.content.replace(/\s+/g, " ").trim().slice(0, 220);
      byPath.set(nbk, {
        path: f.path,
        noteTitle: noteTitleFromFileName(f.name),
        relevance: rel,
        matchedTopics: seed.matchedTopics.length ? [...seed.matchedTopics] : [],
        snippet: snippet.length ? snippet : undefined,
        semanticSimilarity: seed.semanticSimilarity,
        retrievalMode: seed.retrievalMode,
        graphExpanded: true,
      });
      added += 1;
    }
  }

  return [...byPath.values()].sort((a, b) => b.relevance - a.relevance);
}
