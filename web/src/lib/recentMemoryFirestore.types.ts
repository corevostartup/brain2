/**
 * Contrato futuro para sincronizar `RecentMemoryState` no Firebase (Firestore).
 *
 * - **Não** ligar ao grafo do vault nem a ficheiros `.md`.
 * - Documento sugerido: `users/{uid}/settings/anccRecentMemory` ou subcoleção dedicada.
 * - Migração: na primeira abertura com login, fundir doc remoto com estado local (LWW por `updatedAt`).
 *
 * Implementação pendente: cliente com `onSnapshot` + cache em memória; `page.tsx` passará a
 * `await` onde hoje é síncrono, ou usará um store React com hidratação.
 */

import type { RecentMemoryState } from "@/lib/anccRecentMemoryTypes";

/** Metadados para o documento Firestore (espelho de RecentMemoryState + controlo). */
export type RecentMemoryFirestoreDocument = RecentMemoryState & {
  /** ISO ou millis — última escrita no servidor */
  updatedAt: string;
  /** Opcional: versão do cliente que escreveu */
  clientSchemaVersion?: number;
};
