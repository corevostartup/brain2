/**
 * Memória recente entre conversas ANCC — **apenas persistência em localStorage** (WebKit / app macOS),
 * fundida na query de retrieval. **Não** grava no vault, **não** aparece no grafo «Your Brain».
 *
 * Migração futura (Firebase): ver `recentMemoryFirestore.types.ts` e `getRecentMemoryPersistence()`.
 */

import type { RecentMemoryEntry, RecentMemoryState } from "@/lib/anccRecentMemoryTypes";
import { getRecentMemoryPersistence } from "@/lib/anccRecentMemoryStorage";

export type { RecentMemoryEntry, RecentMemoryState } from "@/lib/anccRecentMemoryTypes";
export { RECENT_MEMORY_LOCAL_STORAGE_KEY } from "@/lib/anccRecentMemoryStorage";

const MAX_ENTRIES = 32;
const MAX_ENTRY_USER_CHARS = 160;
const MAX_ENTRY_ASSISTANT_CHARS = 220;
const MAX_QUERY_CHARS = 1800;
const DECAY_TAU_DAYS = 5;

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeRecentMemoryState(raw: RecentMemoryState): RecentMemoryState {
  const entries: RecentMemoryEntry[] = [];
  for (const e of raw.entries) {
    if (
      e &&
      typeof e === "object" &&
      typeof e.id === "string" &&
      typeof e.text === "string" &&
      typeof e.createdAt === "number"
    ) {
      const text = e.text.replace(/\s+/g, " ").trim().slice(0, 900);
      if (text.length > 0) {
        entries.push({
          id: e.id,
          text,
          createdAt: e.createdAt,
        });
      }
    }
  }
  return { version: 1, entries: entries.slice(0, MAX_ENTRIES) };
}

export function loadRecentMemoryState(): RecentMemoryState {
  const persistence = getRecentMemoryPersistence();
  const raw = persistence.load();
  return normalizeRecentMemoryState(raw);
}

function saveRecentMemoryState(state: RecentMemoryState): void {
  const persistence = getRecentMemoryPersistence();
  persistence.save(normalizeRecentMemoryState(state));
}

/**
 * Após uma resposta bem-sucedida do assistente, regista um extracto deste turno
 * (atravessa conversas / pastas). Armazenamento: localStorage apenas (não vault / grafo).
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
 * Texto para fundir na query híbrida: decaimento exponencial até esgotar orçamento.
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
  getRecentMemoryPersistence().clear();
}
