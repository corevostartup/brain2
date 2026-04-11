/**
 * Camada de persistência da memória recente ANCC.
 *
 * - **localStorage (defeito):** API Web estável no Safari e em WKWebView (app macOS/iOS).
 *   Não escreve no vault `.md`, não aparece no grafo «Your Brain» nem em Pastas.
 * - **Firebase (futuro):** ver `recentMemoryFirestore.types.ts` e activar quando
 *   `NEXT_PUBLIC_ANCC_RECENT_MEMORY_STORE=firebase` (requer implementação async no cliente).
 */

import type { RecentMemoryState } from "@/lib/anccRecentMemoryTypes";

export const RECENT_MEMORY_LOCAL_STORAGE_KEY = "brain2-ancc-recent-memory-v1";

export type RecentMemoryStoreKind = "localStorage" | "firebase";

/**
 * Persistência síncrona (localStorage). Firebase futuro deverá usar cache + listeners ou API async.
 */
export interface RecentMemoryPersistence {
  readonly kind: RecentMemoryStoreKind;
  load(): RecentMemoryState;
  save(state: RecentMemoryState): void;
  clear(): void;
}

class LocalStorageRecentMemoryPersistence implements RecentMemoryPersistence {
  readonly kind = "localStorage" as const;

  load(): RecentMemoryState {
    if (typeof window === "undefined") {
      return { version: 1, entries: [] };
    }
    try {
      const raw = window.localStorage.getItem(RECENT_MEMORY_LOCAL_STORAGE_KEY);
      if (!raw) {
        return { version: 1, entries: [] };
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") {
        return { version: 1, entries: [] };
      }
      const p = parsed as Partial<RecentMemoryState>;
      if (p.version !== 1 || !Array.isArray(p.entries)) {
        return { version: 1, entries: [] };
      }
      return { version: 1, entries: p.entries };
    } catch {
      return { version: 1, entries: [] };
    }
  }

  save(state: RecentMemoryState): void {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(RECENT_MEMORY_LOCAL_STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota */
    }
  }

  clear(): void {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.removeItem(RECENT_MEMORY_LOCAL_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

let singleton: RecentMemoryPersistence | null = null;

/**
 * Resolve o backend de persistência.
 * `NEXT_PUBLIC_ANCC_RECENT_MEMORY_STORE=firebase` está reservado; até haver cliente Firestore, usa localStorage.
 */
export function getRecentMemoryPersistence(): RecentMemoryPersistence {
  if (singleton) {
    return singleton;
  }
  const want = (process.env.NEXT_PUBLIC_ANCC_RECENT_MEMORY_STORE ?? "localStorage").trim().toLowerCase();
  if (want === "firebase") {
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.warn(
        "[ANCC recent memory] NEXT_PUBLIC_ANCC_RECENT_MEMORY_STORE=firebase sem implementação — a usar localStorage.",
      );
    }
  }
  singleton = new LocalStorageRecentMemoryPersistence();
  return singleton;
}

/** Para testes: injecta outra persistência. */
export function __setRecentMemoryPersistenceForTests(p: RecentMemoryPersistence | null): void {
  singleton = p;
}
