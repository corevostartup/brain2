/**
 * Bloco opcional no fim da resposta do assistente: :::brain2_model_memory ... JSON ... :::
 * Permite que o modelo redija o que persiste como memória própria (ANCC).
 */

export type StructuredMemoryItem = {
  summary: string;
  topics?: string[];
  /** 0–1; se omitido, calcula-se a partir do outcome ANCC. */
  confidence?: number;
  /** Predefinição true quando há summary não vazio. */
  store?: boolean;
};

/** Lembrete ligado a uma data (calendário local do utilizador). */
export type StructuredTemporalItem = {
  /** YYYY-MM-DD */
  dueLocalDate: string;
  summary: string;
  store?: boolean;
  /** Aniversários / datas anuais — após lembrar, reagenda para o ano seguinte. */
  recurrence?: "none" | "yearly";
};

export type ParsedAssistantModelMemoryFence = {
  /** Texto mostrado ao utilizador (sem o fence). */
  displayText: string;
  memories: StructuredMemoryItem[];
  temporal: StructuredTemporalItem[];
  /** Encontrou delimitadores :::brain2_model_memory / :::. */
  hadFence: boolean;
  /** JSON dentro do fence inválido — a heurística de memória pode actuar como fallback. */
  parseError: boolean;
};

function normalizeMemories(raw: unknown): StructuredMemoryItem[] {
  if (!Array.isArray(raw)) return [];
  const out: StructuredMemoryItem[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const summary = typeof o.summary === "string" ? o.summary.trim() : "";
    if (!summary) continue;
    const topics = Array.isArray(o.topics)
      ? o.topics.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      : undefined;
    let confidence: number | undefined;
    if (typeof o.confidence === "number" && Number.isFinite(o.confidence)) {
      confidence = Math.max(0, Math.min(1, o.confidence));
    }
    const store = typeof o.store === "boolean" ? o.store : true;
    out.push({ summary, topics, confidence, store });
  }
  return out;
}

export function normalizeStructuredTemporalArray(raw: unknown): StructuredTemporalItem[] {
  if (!Array.isArray(raw)) return [];
  const out: StructuredTemporalItem[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const dueLocalDate = typeof o.dueLocalDate === "string" ? o.dueLocalDate.trim() : "";
    const summary = typeof o.summary === "string" ? o.summary.trim() : "";
    if (!dueLocalDate || !summary) continue;
    const store = typeof o.store === "boolean" ? o.store : true;
    let recurrence: "none" | "yearly" | undefined;
    if (o.recurrence === "yearly" || o.recurrence === "none") {
      recurrence = o.recurrence;
    }
    out.push({
      dueLocalDate,
      summary,
      store,
      recurrence: recurrence ?? "none",
    });
  }
  return out;
}

/**
 * Remove o fence final e interpreta JSON `{ "memories": [...], "temporal": [...] }`.
 */
export function stripBrain2ModelMemoryFence(raw: string): ParsedAssistantModelMemoryFence {
  const trimmedEnd = raw.trimEnd();
  const re = /\n?:::brain2_model_memory\s*\r?\n([\s\S]*?)\r?\n\s*:::\s*$/;
  const m = trimmedEnd.match(re);
  if (!m) {
    return {
      displayText: trimmedEnd.trim(),
      memories: [],
      temporal: [],
      hadFence: false,
      parseError: false,
    };
  }

  const displayText = trimmedEnd.slice(0, m.index ?? 0).trimEnd().trim();
  const jsonText = (m[1] ?? "").trim();
  if (!jsonText) {
    return {
      displayText,
      memories: [],
      temporal: [],
      hadFence: true,
      parseError: false,
    };
  }

  try {
    const parsed = JSON.parse(jsonText) as { memories?: unknown; temporal?: unknown };
    return {
      displayText,
      memories: normalizeMemories(parsed?.memories),
      temporal: normalizeStructuredTemporalArray(parsed?.temporal),
      hadFence: true,
      parseError: false,
    };
  } catch {
    return {
      displayText,
      memories: [],
      temporal: [],
      hadFence: true,
      parseError: true,
    };
  }
}

export function pickStorableStructuredMemories(items: StructuredMemoryItem[]): StructuredMemoryItem[] {
  return items.filter((s) => s.store !== false && s.summary.trim().length > 0);
}

export function pickStorableTemporalItems(items: StructuredTemporalItem[]): StructuredTemporalItem[] {
  return items.filter((s) => s.store !== false && s.summary.trim().length > 0 && s.dueLocalDate.trim().length > 0);
}
