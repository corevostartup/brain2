/**
 * Memórias próprias do assistente (ANCC): conclusões inferidas, não factos do utilizador.
 * Persistência principal: localStorage (sempre); opcional: ficheiros em `_Brain2/ANCC_Model_Memory/`
 * no vault preset (API). Não entram no grafo «Your Brain» (ver `buildGraphFromVault`).
 */

import type { InteractionOutcome } from "@/ancc/models/metadata";
import type { FinalizeInteractionResult } from "@/ancc/pipeline/finalize-interaction";
import type { StructuredMemoryItem } from "@/lib/anccModelMemoryStructured";

export const ANCC_MODEL_MEMORY_FOLDER = "_Brain2/ANCC_Model_Memory";

export type ModelMemoryUserVerdict = "pending" | "accepted" | "partial" | "rejected";

export type ModelMemoryEntry = {
  id: string;
  /** Texto curto: o que o assistente «decidiu» guardar */
  summary: string;
  /** Tópicos para wikilinks e plasticidade */
  topics: string[];
  confidence: number;
  outcome: InteractionOutcome;
  createdAt: string;
  updatedAt: string;
  /** Versões anteriores (mudança de ideia) */
  supersededIds: string[];
  userVerdict: ModelMemoryUserVerdict;
  /** Quando o utilizador questiona / discorda */
  userNote?: string;
};

export type ModelMemoryState = {
  version: 1;
  entries: ModelMemoryEntry[];
};

const LS_KEY = "brain2-ancc-model-memory-v1";

export function isAnccModelMemoryVaultPath(path: string): boolean {
  const p = path.replace(/\\/g, "/").toLowerCase();
  return p.includes(`${ANCC_MODEL_MEMORY_FOLDER.toLowerCase()}/`) || p.endsWith(`/${ANCC_MODEL_MEMORY_FOLDER.toLowerCase()}`);
}

export function loadModelMemoryState(): ModelMemoryState {
  if (typeof window === "undefined") {
    return { version: 1, entries: [] };
  }
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return { version: 1, entries: [] };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { version: 1, entries: [] };
    const s = parsed as Partial<ModelMemoryState>;
    if (s.version !== 1 || !Array.isArray(s.entries)) return { version: 1, entries: [] };
    return { version: 1, entries: s.entries.filter(isValidEntry) };
  } catch {
    return { version: 1, entries: [] };
  }
}

function isValidEntry(e: unknown): e is ModelMemoryEntry {
  if (!e || typeof e !== "object") return false;
  const x = e as ModelMemoryEntry;
  return (
    typeof x.id === "string" &&
    typeof x.summary === "string" &&
    Array.isArray(x.topics) &&
    typeof x.confidence === "number"
  );
}

export function saveModelMemoryState(state: ModelMemoryState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* quota */
  }
}

/** Texto compacto para o contexto ANCC (próximo turno). */
export function formatModelMemoryForAnccContext(state: ModelMemoryState, maxChars = 900): string {
  const active = state.entries
    .filter((e) => e.userVerdict !== "rejected")
    .slice(-12)
    .map((e) => {
      const v =
        e.userVerdict === "partial"
          ? "(parcial)"
          : e.userVerdict === "accepted"
            ? "(ok)"
            : "";
      const topics = e.topics.slice(0, 4).join(", ");
      return `- ${e.summary.slice(0, 220)} ${v} [${topics}] conf~${e.confidence.toFixed(2)}`;
    })
    .join("\n");
  if (!active.trim()) return "";
  return active.length > maxChars ? `${active.slice(0, maxChars)}…` : active;
}

const CHALLENGE_RE =
  /\b(n[aã]o\s+concordo|discordo|desconfio|revisa|rev[eê]|corrige|est[aá]\s+errado|parcialmente)\b/i;

export function applyUserMessageToModelMemories(
  state: ModelMemoryState,
  userMessage: string
): ModelMemoryState {
  const trimmed = userMessage.trim();
  if (!trimmed || state.entries.length === 0) return state;
  if (!CHALLENGE_RE.test(trimmed)) return state;

  const last = [...state.entries].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )[0];
  if (!last || last.userVerdict === "rejected") return state;

  const partial = /\bparcial|parcialmente\b/i.test(trimmed);
  const strong = /\b(n[aã]o\s+concordo|discordo|errado)\b/i.test(trimmed);

  const nextVerdict: ModelMemoryUserVerdict = partial ? "partial" : strong ? "rejected" : "partial";

  const entries = state.entries.map((e) =>
    e.id === last.id
      ? {
          ...e,
          updatedAt: new Date().toISOString(),
          userVerdict: nextVerdict,
          userNote: trimmed.slice(0, 500),
        }
      : e
  );

  return { ...state, entries };
}

function summarizeAssistant(text: string, maxLen = 320): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen).trim()}…`;
}

function newId(): string {
  return `mm-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function heuristicConfidence(finalized: FinalizeInteractionResult, topicCount: number): number {
  return Math.min(
    0.95,
    0.35 + finalized.outcomeConfidence * 0.45 + (topicCount > 2 ? 0.08 : 0)
  );
}

/**
 * Gera ou atualiza uma entrada a partir do outcome, tópicos, bloco estruturado opcional ou micro-endpoint.
 * Plasticidade: outcome «corrected» reduz confiança das entradas com overlap de tópicos.
 */
export function integrateFinalizeIntoModelMemory(opts: {
  state: ModelMemoryState;
  userMessage: string;
  /** Texto visível ao utilizador (sem fence JSON). */
  assistantMessage: string;
  finalized: FinalizeInteractionResult;
  /** Itens vindos do fence `:::brain2_model_memory` e/ou `/api/ancc-model-memory`. */
  structuredMemories?: StructuredMemoryItem[];
  /**
   * Fence válido com `memories: []` ou só itens com `store: false` — não cair na heurística automática.
   */
  explicitSkipHeuristicPersistence?: boolean;
}): { state: ModelMemoryState; newEntry: ModelMemoryEntry | null } {
  const { finalized, assistantMessage, userMessage } = opts;
  const now = new Date().toISOString();

  let state = applyUserMessageToModelMemories(opts.state, userMessage);

  const tl = (s: string) => s.trim().toLowerCase();
  const topicSet = new Set<string>([...finalized.assistantTopics.map(tl)]);

  const adjustConfidence = (e: ModelMemoryEntry): ModelMemoryEntry => {
    if (e.userVerdict === "rejected") return e;
    const overlap = e.topics.filter((t) => topicSet.has(tl(t))).length;
    if (finalized.outcome === "corrected" && overlap > 0) {
      return {
        ...e,
        confidence: Math.max(0.08, e.confidence * 0.55),
        updatedAt: now,
        userVerdict: e.userVerdict === "pending" ? "partial" : e.userVerdict,
      };
    }
    if (finalized.outcome === "ignored" && overlap > 0) {
      return {
        ...e,
        confidence: Math.max(0.1, e.confidence * 0.88),
        updatedAt: now,
      };
    }
    return e;
  };

  let entries = state.entries.map(adjustConfidence);

  const structured = (opts.structuredMemories ?? []).filter(
    (s) => s.store !== false && s.summary.trim().length > 0
  );
  const firstStructured = structured[0];

  const shouldAddHeuristic =
    !opts.explicitSkipHeuristicPersistence &&
    assistantMessage.trim().length > 80 &&
    (finalized.outcome === "useful" ||
      finalized.outcome === "deepened" ||
      finalized.outcome === "redirected");

  let newEntry: ModelMemoryEntry | null = null;

  if (firstStructured) {
    const topics = (
      firstStructured.topics?.length
        ? firstStructured.topics
        : finalized.assistantTopics.slice(0, 8)
    ).filter(Boolean);
    if (topics.length === 0) {
      return { state: { version: 1, entries }, newEntry: null };
    }
    const confidence =
      typeof firstStructured.confidence === "number"
        ? Math.max(0.05, Math.min(0.98, firstStructured.confidence))
        : heuristicConfidence(finalized, topics.length);
    newEntry = {
      id: newId(),
      summary: firstStructured.summary.trim().slice(0, 4000),
      topics: topics.slice(0, 12),
      confidence,
      outcome: finalized.outcome,
      createdAt: now,
      updatedAt: now,
      supersededIds: [],
      userVerdict: "pending",
    };
    entries = [...entries, newEntry].slice(-80);
    return { state: { version: 1, entries }, newEntry };
  }

  if (!shouldAddHeuristic) {
    return { state: { version: 1, entries }, newEntry: null };
  }

  const topics = finalized.assistantTopics.slice(0, 8).filter(Boolean);
  if (topics.length === 0) {
    return { state: { version: 1, entries }, newEntry: null };
  }
  const summary = summarizeAssistant(assistantMessage);
  const confidence = heuristicConfidence(finalized, topics.length);
  const entry: ModelMemoryEntry = {
    id: newId(),
    summary,
    topics,
    confidence,
    outcome: finalized.outcome,
    createdAt: now,
    updatedAt: now,
    supersededIds: [],
    userVerdict: "pending",
  };
  newEntry = entry;
  entries = [...entries, entry].slice(-80);

  return { state: { version: 1, entries }, newEntry };
}

export function formatModelMemoryMarkdown(entry: ModelMemoryEntry): string {
  const links = entry.topics.map((t) => `[[${t}]]`).join(" ");
  const fm = [
    "---",
    `ancc_model_memory: true`,
    `id: ${entry.id}`,
    `confidence: ${entry.confidence.toFixed(3)}`,
    `outcome: ${entry.outcome}`,
    `user_verdict: ${entry.userVerdict}`,
    `updated: ${entry.updatedAt}`,
    "---",
  ].join("\n");

  return `${fm}

## Reflexão do assistente (ANCC)

${entry.summary}

### Ligações
${links}

> Esta nota não aparece no grafo «Your Brain». Podes editar o campo \`user_verdict\` no frontmatter (\`accepted\`, \`partial\`, \`rejected\`) ou escrever abaixo.

${entry.userNote ? `### Nota do utilizador\n\n${entry.userNote}\n` : ""}
`;
}

export function fileNameForModelMemoryEntry(entry: ModelMemoryEntry): string {
  const day = entry.createdAt.slice(0, 10);
  const short = entry.id.replace(/[^a-z0-9-]+/gi, "-").slice(0, 24);
  return `${day}-${short}`;
}
