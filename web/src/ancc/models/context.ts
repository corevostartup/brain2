import type { MemoryClass, MemoryNote } from "@/ancc/models/memory";
import type { MemoryLink } from "@/ancc/models/link";
import type { InteractionOutcome } from "@/ancc/models/metadata";

/** Correlação enriquecida com origem no vault (para montar contexto sem ligar tudo a tudo). */
export type VaultCorrelationHit = {
  path: string;
  noteTitle: string;
  relevance: number;
  matchedTopics: string[];
  snippet?: string;
  /** Similaridade cosseno query↔melhor chunk (recuperação híbrida). */
  semanticSimilarity?: number;
  retrievalMode?: "hybrid" | "lexical";
};

export type AssembledContext = {
  activeTopics: string[];
  wikiLinksFormatted: string[];
  linksWithStrength: Array<{ link: string; strength: number; linkType: MemoryLink["type"] }>;
  priorityMemoryClass: MemoryClass;
  recentContextBullets: string[];
  /**
   * Notas do vault para contexto deste turno (limiar mais baixo).
   * Inclui correspondências mais fracas que **não** entram em `vaultCorrelationsPersisted`.
   */
  vaultCorrelations: VaultCorrelationHit[];
  /**
   * Subconjunto assertivo — gravado em `related_vault_notes` / arestas no grafo de conversas.
   */
  vaultCorrelationsPersisted: VaultCorrelationHit[];
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
  /** Preenchido após `finalizeInteractionAfterResponse` (resposta do modelo). */
  interactionOutcome?: InteractionOutcome;
  outcomeConfidence?: number;
  outcomeSignals?: string[];
  /** Tópicos extraídos da resposta do assistente (eixo pós-diálogo). */
  assistantTopicsAfterResponse?: string[];
};
