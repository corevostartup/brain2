import { createHash } from "node:crypto";

/** Modelo alinhado a `/api/ancc-retrieve` — a chave de cache inclui o modelo para invalidar se mudares o modelo. */
export const OPENAI_EMBEDDING_CACHE_MODEL = "text-embedding-3-small";

const MAX_ENTRIES = 2500;

/** LRU: último uso no fim do Map (Node preserva ordem de inserção). */
const embeddingCache = new Map<string, number[]>();

function cacheKey(model: string, text: string): string {
  const h = createHash("sha256").update(text, "utf8").digest("hex");
  return `${model}:${h}`;
}

function cacheGet(key: string): number[] | undefined {
  const v = embeddingCache.get(key);
  if (v === undefined) {
    return undefined;
  }
  embeddingCache.delete(key);
  embeddingCache.set(key, v);
  return v;
}

function cacheSet(key: string, vec: number[]): void {
  if (embeddingCache.has(key)) {
    embeddingCache.delete(key);
  }
  embeddingCache.set(key, vec);
  while (embeddingCache.size > MAX_ENTRIES) {
    const first = embeddingCache.keys().next().value as string | undefined;
    if (first === undefined) {
      break;
    }
    embeddingCache.delete(first);
  }
}

/**
 * Envolve um embedder em batch (ex.: OpenAI `input: string[]`) com cache em memória por `sha256(utf8)` + modelo.
 * Textos iguais no mesmo pedido ou em pedidos seguintes reutilizam o vetor — poupa custo e latência (prefixos/chunks estáveis).
 */
export function createCachedOpenAIEmbeddingTexts(
  embedBatch: (texts: string[]) => Promise<number[][]>,
  model: string = OPENAI_EMBEDDING_CACHE_MODEL
): (texts: string[]) => Promise<number[][]> {
  return async (texts: string[]): Promise<number[][]> => {
    if (texts.length === 0) {
      return [];
    }
    const out: number[][] = new Array(texts.length);
    const keys = texts.map((t) => cacheKey(model, t));
    const missIdx: number[] = [];
    for (let i = 0; i < texts.length; i++) {
      const hit = cacheGet(keys[i]);
      if (hit) {
        out[i] = hit;
      } else {
        missIdx.push(i);
      }
    }
    if (missIdx.length === 0) {
      return out;
    }

    const uniqueFirstIdx = new Map<string, number>();
    for (const i of missIdx) {
      const k = keys[i];
      if (!uniqueFirstIdx.has(k)) {
        uniqueFirstIdx.set(k, i);
      }
    }
    const toFetch = [...uniqueFirstIdx.values()].map((i) => texts[i]);
    const fetched = await embedBatch(toFetch);

    if (fetched.length !== toFetch.length) {
      throw new Error("embedding_cache_batch_shape");
    }

    let u = 0;
    for (const firstI of uniqueFirstIdx.values()) {
      cacheSet(keys[firstI], fetched[u]);
      u += 1;
    }

    for (const i of missIdx) {
      const vec = cacheGet(keys[i]);
      if (!vec) {
        throw new Error("embedding_cache_miss_after_set");
      }
      out[i] = vec;
    }

    return out;
  };
}
