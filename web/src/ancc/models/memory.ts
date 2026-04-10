import type { MemoryLink } from "@/ancc/models/link";

/** Classes de memória ao nível da nota (interação consolidada). */
export type MemoryClass =
  | "structural"
  | "recurrent"
  | "recent"
  | "experimental"
  | "disposable";

/**
 * Nota/interação no grafo ANCC.
 * Cada interação pode gerar ou atualizar uma nota com links explícitos estilo Obsidian.
 */
export type MemoryNote = {
  id: string;
  title: string;
  content: string;
  topics: string[];
  links: MemoryLink[];
  memoryClass: MemoryClass;
  createdAt: string;
  updatedAt: string;
};

export function createEmptyMemoryNote(partial: Pick<MemoryNote, "id" | "title" | "content">): MemoryNote {
  const now = new Date().toISOString();
  return {
    ...partial,
    topics: [],
    links: [],
    memoryClass: "experimental",
    createdAt: now,
    updatedAt: now,
  };
}
