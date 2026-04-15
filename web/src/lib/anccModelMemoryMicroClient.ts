import type { InteractionOutcome } from "@/ancc/models/metadata";
import type { StructuredMemoryItem, StructuredTemporalItem } from "@/lib/anccModelMemoryStructured";

/**
 * Fallback LLM (rota `/api/ancc-model-memory`) quando o fence `:::brain2_model_memory` não devolve JSON utilizável.
 * Desligar: `NEXT_PUBLIC_ANCC_MODEL_MEMORY_MICRO=0`.
 */
export function isAnccModelMemoryMicroEnabled(): boolean {
  if (typeof process === "undefined" || !process.env?.NEXT_PUBLIC_ANCC_MODEL_MEMORY_MICRO) {
    return true;
  }
  return process.env.NEXT_PUBLIC_ANCC_MODEL_MEMORY_MICRO !== "0";
}

export type AnccStructuredMicroResult = {
  memories: StructuredMemoryItem[];
  temporal: StructuredTemporalItem[];
};

export async function fetchAnccStructuredMicro(opts: {
  model: string;
  apiKey: string;
  userMessage: string;
  assistantMessage: string;
  outcome: InteractionOutcome;
  assistantTopics: string[];
  /** YYYY-MM-DD — «hoje» local para resolver «daqui a duas semanas», etc. */
  referenceLocalDate?: string;
  /** Epoch ms — início da conversa (metadados). */
  conversationStartedAt?: number;
}): Promise<AnccStructuredMicroResult> {
  const res = await fetch("/api/ancc-model-memory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      apiKey: opts.apiKey,
      userMessage: opts.userMessage,
      assistantMessage: opts.assistantMessage,
      outcome: opts.outcome,
      assistantTopics: opts.assistantTopics,
      referenceLocalDate: opts.referenceLocalDate,
      conversationStartedAt: opts.conversationStartedAt,
    }),
  });
  if (!res.ok) {
    return { memories: [], temporal: [] };
  }
  const data = (await res.json()) as {
    memories?: StructuredMemoryItem[];
    temporal?: StructuredTemporalItem[];
  };
  return {
    memories: Array.isArray(data.memories) ? data.memories : [],
    temporal: Array.isArray(data.temporal) ? data.temporal : [],
  };
}
