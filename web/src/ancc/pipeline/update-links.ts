import type { MemoryNote } from "@/ancc/models/memory";
import type { MemoryLink } from "@/ancc/models/link";
import { mergeWithPlasticity, type PlasticityAgentState } from "@/ancc/agents/plasticity-agent";

/**
 * Ajusta o grafo em memória: aplica plasticidade às ligações da nota e grava `updatedAt`.
 */
export function adjustNoteLinks(
  note: MemoryNote,
  links: MemoryLink[],
  plasticity: PlasticityAgentState,
  nowMs: number
): MemoryNote {
  const merged = mergeWithPlasticity(links, plasticity, nowMs);
  return {
    ...note,
    links: merged,
    updatedAt: new Date(nowMs).toISOString(),
  };
}
