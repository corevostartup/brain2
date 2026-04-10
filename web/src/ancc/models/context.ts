import type { MemoryClass, MemoryNote } from "@/ancc/models/memory";
import type { MemoryLink } from "@/ancc/models/link";

/** Correlação enriquecida com origem no vault (para montar contexto sem ligar tudo a tudo). */
export type VaultCorrelationHit = {
  path: string;
  noteTitle: string;
  relevance: number;
  matchedTopics: string[];
  snippet?: string;
};

export type AssembledContext = {
  activeTopics: string[];
  wikiLinksFormatted: string[];
  linksWithStrength: Array<{ link: string; strength: number; linkType: MemoryLink["type"] }>;
  priorityMemoryClass: MemoryClass;
  recentContextBullets: string[];
  vaultCorrelations: VaultCorrelationHit[];
  behavioralGuidance: string[];
};

export type ANCCProcessResult = {
  rawInterpretation: string;
  topics: string[];
  links: MemoryLink[];
  memoryClass: MemoryClass;
  assembled: AssembledContext;
  /** Bloco pronto para injetar junto ao system prompt (ou mensagem system adicional). */
  hiddenSystemBlock: string;
  /** Nota consolidada desta interação (persistência fica a cargo da app). */
  memoryNote: MemoryNote;
  notePreview: {
    title: string;
    topics: string[];
    links: MemoryLink[];
    memoryClass: MemoryClass;
  };
};
