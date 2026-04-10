import { stripYamlFrontmatter, extractYamlTagsFromMarkdown } from "@/lib/markdownFrontmatter";
import { interpretUserInput } from "@/ancc/agents/input-agent";
import { extractTopics } from "@/ancc/agents/topic-agent";
import {
  correlateVaultFiles,
  noteTitleFromFileName,
  tokenizeQueryKeywords,
  yamlTagMatchScore,
  type VaultFileSnapshot,
} from "@/ancc/pipeline/vault-correlation";
import type { VaultCorrelationHit } from "@/ancc/models/context";
import { splitVaultBodyIntoRetrievalChunks } from "@/ancc/pipeline/brain-vault-chunks";

export const HYBRID_RETRIEVAL = {
  lexicalMin: 0.1,
  maxLexicalCandidates: 40,
  maxChunksTotal: 110,
  maxChunksPerFile: 10,
  chunkMaxChars: 2200,
  chunkOverlap: 220,
  /** Prefixo do corpo (pós-YAML) para embedding por nota — espelha a Joi (~1000 chars + …). */
  filePrefixEmbedChars: 1000,
  maxOutputHits: 14,
  /** Chunk: similaridade fina pergunta↔trecho. */
  wChunkSemantic: 0.36,
  /** Nota inteira (prefixo): reforço “esta nota é sobre o assunto” (Joi). */
  wFileSemantic: 0.18,
  wLexical: 0.17,
  /** Tags YAML frontmatter vs keywords da query (Joi ~30%). */
  wTags: 0.12,
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
  const topicsFromMessage = extractTopics({
    text: raw.normalizedText,
    vaultNoteTitles: vaultTitles,
  });
  const topicsExpanded = extractTopics({
    text: [raw.normalizedText, opts.sessionSummary?.trim() ?? ""].filter(Boolean).join("\n"),
    vaultNoteTitles: vaultTitles,
  });
  const topics =
    topicsFromMessage.length > 0 ? topicsFromMessage : topicsExpanded.slice(0, 12);

  const queryText = buildRetrievalQueryText({
    userMessage: opts.userMessage,
    sessionSummary: opts.sessionSummary,
    recentBullets: opts.recentBullets,
  });
  const keywordSet = tokenizeQueryKeywords(queryText);

  const lexicalHits = correlateVaultFiles(topics, opts.vaultFiles, HYBRID_RETRIEVAL.lexicalMin, {
    tagQueryHint: queryText,
  }).slice(0, HYBRID_RETRIEVAL.maxLexicalCandidates);

  if (lexicalHits.length === 0) {
    return { hits: [], mode: "lexical" };
  }

  const normPathKey = (p: string) => p.replace(/\\/g, "/").toLowerCase();
  const fileByPath = new Map(opts.vaultFiles.map((f) => [normPathKey(f.path), f]));

  const tagScoreByPath = new Map<string, number>();
  for (const hit of lexicalHits) {
    const nk = normPathKey(hit.path);
    if (tagScoreByPath.has(nk)) {
      continue;
    }
    const f = fileByPath.get(nk) ?? opts.vaultFiles.find((x) => normPathKey(x.path) === nk);
    if (!f) {
      continue;
    }
    const yamlTags = extractYamlTagsFromMarkdown(f.content);
    tagScoreByPath.set(nk, yamlTagMatchScore(yamlTags, keywordSet));
  }

  const uniqueFiles: VaultFileSnapshot[] = [];
  const seenPaths = new Set<string>();
  for (const hit of lexicalHits) {
    const nk = normPathKey(hit.path);
    if (seenPaths.has(nk)) {
      continue;
    }
    seenPaths.add(nk);
    const f = fileByPath.get(nk) ?? opts.vaultFiles.find((x) => normPathKey(x.path) === nk);
    if (f) {
      uniqueFiles.push(f);
    }
  }

  const filePrefixes = uniqueFiles.map((f) => {
    const body = stripYamlFrontmatter(f.content);
    const maxLen = HYBRID_RETRIEVAL.filePrefixEmbedChars;
    const slice = body.slice(0, maxLen);
    return slice.length < body.length ? `${slice}…` : slice;
  });

  const pathToFileIdx = new Map<string, number>();
  uniqueFiles.forEach((f, i) => pathToFileIdx.set(normPathKey(f.path), i));

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
    const chunks = splitVaultBodyIntoRetrievalChunks(body, {
      maxChars: HYBRID_RETRIEVAL.chunkMaxChars,
      overlapChars: HYBRID_RETRIEVAL.chunkOverlap,
      maxChunks: HYBRID_RETRIEVAL.maxChunksPerFile,
    });
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

  let queryEmbedding: number[];
  let fileEmbeddings: number[][];
  let chunkEmbeddings: number[][];
  try {
    const embedded = await opts.embedTexts([queryText, ...filePrefixes, ...chunkMetas.map((c) => c.text)]);
    queryEmbedding = embedded[0];
    const fCount = filePrefixes.length;
    fileEmbeddings = embedded.slice(1, 1 + fCount);
    chunkEmbeddings = embedded.slice(1 + fCount);
    if (!queryEmbedding?.length || chunkEmbeddings.length !== chunkMetas.length) {
      throw new Error("embedding_shape");
    }
    if (fileEmbeddings.length !== fCount) {
      throw new Error("embedding_file_shape");
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
    const nk = normPathKey(meta.path);
    const cos = Math.max(0, cosineSimilarity(queryEmbedding, chunkEmbeddings[i]));
    const fIdx = pathToFileIdx.get(nk);
    const fileCos =
      fIdx !== undefined && fileEmbeddings[fIdx]?.length
        ? Math.max(0, cosineSimilarity(queryEmbedding, fileEmbeddings[fIdx]))
        : cos;
    /** Para o bloco ANCC: combina trecho + nota (prefixo), alinhado à sensação Joi “nota inteira”. */
    const blendedSem = Math.min(1, cos * 0.52 + fileCos * 0.48);
    const rec = recency01(meta.modifiedAt, nowMs);
    const pathS = pathKeywordScore(queryLower, meta.path);
    const tscore = tagScoreByPath.get(nk) ?? 0;
    const hybrid =
      HYBRID_RETRIEVAL.wChunkSemantic * cos +
      HYBRID_RETRIEVAL.wFileSemantic * fileCos +
      HYBRID_RETRIEVAL.wLexical * meta.lexical +
      HYBRID_RETRIEVAL.wTags * tscore +
      HYBRID_RETRIEVAL.wRecency * rec +
      HYBRID_RETRIEVAL.wPath * pathS;

    const prev = byPathBest.get(meta.path);
    const snippet = meta.text.replace(/\s+/g, " ").trim().slice(0, 420);
    if (!prev || hybrid > prev.score) {
      byPathBest.set(meta.path, {
        score: hybrid,
        snippet,
        noteTitle: meta.noteTitle,
        cos: blendedSem,
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
