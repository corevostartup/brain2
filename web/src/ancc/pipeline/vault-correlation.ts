import { parseWikiLinksFromText } from "@/ancc/models/link";
import type { VaultCorrelationHit } from "@/ancc/models/context";

export type VaultFileSnapshot = {
  path: string;
  name: string;
  content: string;
  modifiedAt: number;
};

export function noteTitleFromFileName(name: string): string {
  return name.replace(/\.md$/i, "").trim();
}

/**
 * Índice leve do vault: títulos de nota e alvos de wikilink para correlação sem ligar tudo a tudo.
 */
export function buildVaultIndex(files: VaultFileSnapshot[]): {
  titlesLower: Set<string>;
  wikiTargetsLower: Set<string>;
} {
  const titlesLower = new Set<string>();
  const wikiTargetsLower = new Set<string>();

  for (const f of files) {
    titlesLower.add(noteTitleFromFileName(f.name).toLowerCase());
    for (const w of parseWikiLinksFromText(f.content)) {
      wikiTargetsLower.add(w.trim().toLowerCase());
    }
  }

  return { titlesLower, wikiTargetsLower };
}

function countSubstantiveOverlap(topicLower: string, textLower: string): number {
  if (topicLower.length < 3) {
    return 0;
  }
  let n = 0;
  let idx = textLower.indexOf(topicLower);
  while (idx !== -1) {
    n += 1;
    idx = textLower.indexOf(topicLower, idx + topicLower.length);
  }
  return n;
}

/** Relevância 0–1 entre um tópico e um ficheiro (comportamento «humano»: só forte se co-ocorrência faz sentido). */
export function scoreTopicFileCorrelation(
  topic: string,
  file: VaultFileSnapshot,
  index: { titlesLower: Set<string>; wikiTargetsLower: Set<string> }
): number {
  const topicLower = topic.trim().toLowerCase();
  const title = noteTitleFromFileName(file.name);
  const titleLower = title.toLowerCase();
  const body = file.content.toLowerCase();

  let score = 0;

  if (titleLower === topicLower) {
    score += 0.55;
  } else if (titleLower.includes(topicLower) || topicLower.includes(titleLower)) {
    score += 0.38;
  }

  if (index.titlesLower.has(topicLower)) {
    score += 0.08;
  }
  if (index.wikiTargetsLower.has(topicLower)) {
    score += 0.12;
  }

  const hits = countSubstantiveOverlap(topicLower, body);
  score += Math.min(0.28, hits * 0.07);

  const tokenOverlap = topicLower.split(/\s+/).filter((w) => w.length > 2 && body.includes(w)).length;
  score += Math.min(0.15, tokenOverlap * 0.04);

  return Math.min(1, score);
}

export function correlateVaultFiles(
  topics: string[],
  files: VaultFileSnapshot[],
  minRelevance = 0.18
): VaultCorrelationHit[] {
  if (files.length === 0 || topics.length === 0) {
    return [];
  }

  const index = buildVaultIndex(files);
  const hits: VaultCorrelationHit[] = [];

  for (const file of files) {
    let best = 0;
    const matched = new Set<string>();
    for (const t of topics) {
      const r = scoreTopicFileCorrelation(t, file, index);
      if (r > best) {
        best = r;
      }
      if (r >= minRelevance) {
        matched.add(t);
      }
    }

    if (best < minRelevance) {
      continue;
    }

    const snippet = file.content.replace(/\s+/g, " ").trim().slice(0, 220);
    hits.push({
      path: file.path,
      noteTitle: noteTitleFromFileName(file.name),
      relevance: best,
      matchedTopics: [...matched].slice(0, 8),
      snippet: snippet.length ? snippet : undefined,
    });
  }

  return hits.sort((a, b) => b.relevance - a.relevance).slice(0, 16);
}
