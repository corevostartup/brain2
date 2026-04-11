/**
 * Memória recente entre conversas (localStorage) — fundida na query de retrieval ANCC
 * para correlacionar perguntas vagas com planos ou detalhes de sessões anteriores.
 */

const STORAGE_KEY = "brain2-ancc-recent-memory-v1";

const MAX_ENTRIES = 32;
const MAX_ENTRY_USER_CHARS = 160;
const MAX_ENTRY_ASSISTANT_CHARS = 220;
/** Caracteres máximos injectados na query (decaimento por idade + orçamento). */
const MAX_QUERY_CHARS = 1800;
/** Dias para meia-vida do peso exp(-age/tau). */
const DECAY_TAU_DAYS = 5;

export type RecentMemoryEntry = {
  id: string;
  /** Linha compacta: opcionalmente com prefixo de data ISO. */
  text: string;
  createdAt: number;
};

export type RecentMemoryState = {
  version: 1;
  entries: RecentMemoryEntry[];
};

function emptyState(): RecentMemoryState {
  return { version: 1, entries: [] };
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function loadRecentMemoryState(): RecentMemoryState {
  if (typeof window === "undefined") {
    return emptyState();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return emptyState();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return emptyState();
    }
    const p = parsed as Partial<RecentMemoryState>;
    if (p.version !== 1 || !Array.isArray(p.entries)) {
      return emptyState();
    }
    const entries: RecentMemoryEntry[] = [];
    for (const e of p.entries) {
      if (
        e &&
        typeof e === "object" &&
        typeof (e as RecentMemoryEntry).id === "string" &&
        typeof (e as RecentMemoryEntry).text === "string" &&
        typeof (e as RecentMemoryEntry).createdAt === "number"
      ) {
        const text = (e as RecentMemoryEntry).text.replace(/\s+/g, " ").trim().slice(0, 900);
        if (text.length > 0) {
          entries.push({
            id: (e as RecentMemoryEntry).id,
            text,
            createdAt: (e as RecentMemoryEntry).createdAt,
          });
        }
      }
    }
    return { version: 1, entries: entries.slice(0, MAX_ENTRIES) };
  } catch {
    return emptyState();
  }
}

function saveRecentMemoryState(state: RecentMemoryState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota */
  }
}

/**
 * Após uma resposta bem-sucedida do assistente, regista um extracto deste turno
 * (atravessa conversas / pastas).
 */
export function appendRecentMemoryAfterTurn(userMessage: string, assistantMessage: string): void {
  const u = userMessage.replace(/\s+/g, " ").trim().slice(0, MAX_ENTRY_USER_CHARS);
  const a = assistantMessage.replace(/\s+/g, " ").trim().slice(0, MAX_ENTRY_ASSISTANT_CHARS);
  if (u.length < 4 && a.length < 4) {
    return;
  }
  const day = new Date().toISOString().slice(0, 10);
  const text = `${day} · User: ${u}${a ? ` · Brain2: ${a}` : ""}`;

  const state = loadRecentMemoryState();
  state.entries.unshift({
    id: randomId(),
    text,
    createdAt: Date.now(),
  });
  state.entries = state.entries.slice(0, MAX_ENTRIES);
  saveRecentMemoryState(state);
}

/**
 * Texto para fundir na query híbrida: entradas mais recentes e mais pesadas (decaimento exponencial),
 * até esgotar orçamento de caracteres.
 */
export function getRecentMemoryQueryText(nowMs: number = Date.now()): string {
  const state = loadRecentMemoryState();
  if (state.entries.length === 0) {
    return "";
  }

  const scored = state.entries.map((e) => {
    const ageDays = Math.max(0, (nowMs - e.createdAt) / 86_400_000);
    const weight = Math.exp(-ageDays / DECAY_TAU_DAYS);
    return { e, weight };
  });

  scored.sort((a, b) => b.weight - a.weight);

  const parts: string[] = [];
  let used = 0;
  for (const { e, weight } of scored) {
    if (weight < 0.04) {
      break;
    }
    const line = weight >= 0.75 ? e.text : `[context ~${Math.round(weight * 100)}%] ${e.text}`;
    if (used + line.length + 2 > MAX_QUERY_CHARS) {
      break;
    }
    parts.push(line);
    used += line.length + 2;
  }

  return parts.join("\n").trim();
}

export function clearRecentMemory(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
