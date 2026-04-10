import { stripYamlFrontmatter } from "@/lib/markdownFrontmatter";
import { interpretUserInput } from "@/ancc/agents/input-agent";
import { extractTopics } from "@/ancc/agents/topic-agent";
import { correlateVaultFiles, noteTitleFromFileName, type VaultFileSnapshot } from "@/ancc/pipeline/vault-correlation";
import type { VaultCorrelationHit } from "@/ancc/models/context";
import { splitTextIntoChunks } from "@/ancc/pipeline/text-chunks";

export const HYBRID_RETRIEVAL = {
  lexicalMin: 0.1,
  maxLexicalCandidates: 36,
  maxChunksTotal: 96,
  maxChunksPerFile: 8,
  chunkMaxChars: 1800,
  chunkOverlap: 200,
  maxOutputHits: 14,
  /** Peso da similaridade semântica (cosseno) no score híbrido. */
  wSemantic: 0.48,
  wLexical: 0.35,
  wRecency: 0.12,
  wPath: 0.05,
} as const;

export function buildRetrievalQueryText(input: {
  userMessage: string;
  sessionSummary?: string;
  recentBullets?: string[];
}): string {
  const parts: string[] = [input.userMessage.trim()];
  if (input.sessionSummary?.trim()) {
    parts.push(input.sessionSummary.trim());
  }
  if (input.recentBullets?.length) {
    parts.push(input.recentBullets.filter(Boolean).join("\n"));
  }
  return parts.join("\n\n").trim();
}

function recency01(modifiedAt: number, nowMs: number): number {
  const ageDays = (nowMs - modifiedAt) / 86_400_000;
  return Math.max(0, Math.min(1, 1 - ageDays / 90));
}

function pathKeywordScore(queryLower: string, filePath: string): number {
  const pathLower = filePath.replace(/\\/g, "/").toLowerCase();
  const words = queryLower.split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) {
    return 0.5;
  }
  let hit = 0;
  for (const w of words) {
    if (pathLower.includes(w)) {
      hit += 1;
    }
  }
  return Math.min(1, hit / Math.min(8, words.length));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

export type HybridRetrievalEmbedder = (texts: string[]) => Promise<number[][]>;

export type HybridVaultRetrieveResult = {
  hits: VaultCorrelationHit[];
  mode: "hybrid" | "lexical";
};

/**
 * Recuperação híbrida: candidatos lexicais → chunks → embeddings → score combinado.
 */
export async function hybridRetrieveVaultCorrelationHits(opts: {
  userMessage: string;
  sessionSummary?: string;
  recentBullets?: string[];
  vaultFiles: VaultFileSnapshot[];
  embedTexts: HybridRetrievalEmbedder;
  nowMs?: number;
}): Promise<HybridVaultRetrieveResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const raw = interpretUserInput(opts.userMessage);
  const vaultTitles = opts.vaultFiles.map((f) => f.name.replace(/\.md$/i, ""));
  const topics = extractTopics({
    text: [raw.normalizedText, opts.sessionSummary?.trim() ?? ""].filter(Boolean).join("\n"),
    vaultNoteTitles: vaultTitles,
  });

  const lexicalHits = correlateVaultFiles(topics, opts.vaultFiles, HYBRID_RETRIEVAL.lexicalMin).slice(
    0,
    HYBRID_RETRIEVAL.maxLexicalCandidates
  );

  if (lexicalHits.length === 0) {
    return { hits: [], mode: "lexical" };
  }

  const fileByPath = new Map(opts.vaultFiles.map((f) => [f.path.replace(/\\/g, "/").toLowerCase(), f]));

  type ChunkMeta = { path: string; noteTitle: string; text: string; lexical: number; modifiedAt: number };
  const chunkMetas: ChunkMeta[] = [];
  let chunkBudget = HYBRID_RETRIEVAL.maxChunksTotal;

  for (const hit of lexicalHits) {
    if (chunkBudget <= 0) {
      break;
    }
    const f =
      fileByPath.get(hit.path.replace(/\\/g, "/").toLowerCase()) ??
      opts.vaultFiles.find((x) => x.path === hit.path);
    if (!f) {
      continue;
    }
    const body = stripYamlFrontmatter(f.content);
    const chunks = splitTextIntoChunks(body, {
      maxChars: HYBRID_RETRIEVAL.chunkMaxChars,
      overlapChars: HYBRID_RETRIEVAL.chunkOverlap,
    }).slice(0, HYBRID_RETRIEVAL.maxChunksPerFile);
    for (const text of chunks) {
      if (chunkBudget <= 0) {
        break;
      }
      chunkMetas.push({
        path: f.path,
        noteTitle: noteTitleFromFileName(f.name),
        text,
        lexical: hit.relevance,
        modifiedAt: f.modifiedAt,
      });
      chunkBudget -= 1;
    }
  }

  if (chunkMetas.length === 0) {
    return {
      hits: lexicalHits.slice(0, HYBRID_RETRIEVAL.maxOutputHits).map((h) => ({
        ...h,
        retrievalMode: "lexical" as const,
      })),
      mode: "lexical",
    };
  }

  const queryText = buildRetrievalQueryText({
    userMessage: opts.userMessage,
    sessionSummary: opts.sessionSummary,
    recentBullets: opts.recentBullets,
  });

  let queryEmbedding: number[];
  let chunkEmbeddings: number[][];
  try {
    const embedded = await opts.embedTexts([queryText, ...chunkMetas.map((c) => c.text)]);
    queryEmbedding = embedded[0];
    chunkEmbeddings = embedded.slice(1);
    if (!queryEmbedding?.length || chunkEmbeddings.length !== chunkMetas.length) {
      throw new Error("embedding_shape");
    }
  } catch {
    return {
      hits: lexicalHits.slice(0, HYBRID_RETRIEVAL.maxOutputHits),
      mode: "lexical",
    };
  }

  const queryLower = queryText.toLowerCase();
  const byPathBest = new Map<
    string,
    { score: number; snippet: string; noteTitle: string; cos: number; lexical: number }
  >();

  for (let i = 0; i < chunkMetas.length; i += 1) {
    const meta = chunkMetas[i];
    const cos = Math.max(0, cosineSimilarity(queryEmbedding, chunkEmbeddings[i]));
    const rec = recency01(meta.modifiedAt, nowMs);
    const pathS = pathKeywordScore(queryLower, meta.path);
    const hybrid =
      HYBRID_RETRIEVAL.wSemantic * cos +
      HYBRID_RETRIEVAL.wLexical * meta.lexical +
      HYBRID_RETRIEVAL.wRecency * rec +
      HYBRID_RETRIEVAL.wPath * pathS;

    const prev = byPathBest.get(meta.path);
    const snippet = meta.text.replace(/\s+/g, " ").trim().slice(0, 320);
    if (!prev || hybrid > prev.score) {
      byPathBest.set(meta.path, {
        score: hybrid,
        snippet,
        noteTitle: meta.noteTitle,
        cos,
        lexical: meta.lexical,
      });
    }
  }

  const matchedTopics = topics.slice(0, 8);
  const merged: VaultCorrelationHit[] = [];

  for (const [path, best] of byPathBest) {
    merged.push({
      path,
      noteTitle: best.noteTitle,
      relevance: Math.min(1, best.score),
      matchedTopics,
      snippet: best.snippet.length ? best.snippet : undefined,
      semanticSimilarity: Math.min(1, best.cos),
      retrievalMode: "hybrid",
    });
  }

  merged.sort((a, b) => b.relevance - a.relevance);

  return {
    hits: merged.slice(0, HYBRID_RETRIEVAL.maxOutputHits),
    mode: "hybrid",
  };
}
