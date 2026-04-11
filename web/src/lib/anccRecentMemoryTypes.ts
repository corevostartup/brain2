/**
 * Forma canónica da memória recente ANCC (localStorage hoje; espelho futuro em Firestore).
 */

export type RecentMemoryEntry = {
  id: string;
  text: string;
  createdAt: number;
};

export type RecentMemoryState = {
  version: 1;
  entries: RecentMemoryEntry[];
};
