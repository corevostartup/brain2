import { extractTopics } from "@/ancc/agents/topic-agent";
import type { InteractionOutcome } from "@/ancc/models/metadata";

function topicKeySet(topics: string[]): Set<string> {
  return new Set(topics.map((t) => t.trim().toLowerCase()).filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) {
    return 1;
  }
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) {
      inter += 1;
    }
  }
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

/** Utilizador corrige contexto ou rejeita premissa anterior. */
const USER_CORRECTION_MARKERS =
  /\b(corrijo|corrigir|corre[çc][ãa]o|errad|não\s+é\b|nao\s+e\b|na\s+verdade|equivocado|wrong|incorrect|actually|mistake|em\s+vez|não\s+está\b|nao\s+esta\b|isso\s+não|isso\s+nao)\b/i;

/** Modelo admite erro ou corrige a própria resposta. */
const ASSISTANT_SELF_CORRECTION =
  /\b(desculpa|pe[cç]o\s+desculpa|corre[cç][aã]o|sorry[, ]?\s*I\s+was\s+wrong|let\s+me\s+correct|I\s+misspoke|acrescentar\s+que|emenda|retifico)\b/i;

export type OutcomeAnalysisInput = {
  userMessage: string;
  assistantMessage: string;
  /** Tópicos já extraídos na fase pré-LLM (eixo do utilizador). */
  userTopics: string[];
  vaultNoteTitles: string[];
};

export type OutcomeAnalysisResult = {
  outcome: InteractionOutcome;
  confidence: number;
  signals: string[];
  assistantTopics: string[];
};

/**
 * Heurística local (sem segundo turno): classifica como a troca provavelmente se comportou.
 * «Ignorado» ≈ resposta mínima com pouca sobreposição semântica com o pedido.
 */
export function analyzeInteractionOutcome(input: OutcomeAnalysisInput): OutcomeAnalysisResult {
  const signals: string[] = [];
  const userText = input.userMessage.trim();
  const asstText = input.assistantMessage.trim();

  const assistantTopics = extractTopics({
    text: asstText,
    vaultNoteTitles: input.vaultNoteTitles,
  });

  if (!asstText) {
    return {
      outcome: "unknown",
      confidence: 0.35,
      signals: ["empty_assistant"],
      assistantTopics,
    };
  }

  const U = topicKeySet(input.userTopics);
  const A = topicKeySet(assistantTopics);
  const j = jaccard(U, A);
  const userLen = userText.length;
  const asstLen = asstText.length;
  const shortReply = asstLen < 42 && !asstText.includes("\n");

  if (USER_CORRECTION_MARKERS.test(userText)) {
    signals.push("user_correction_markers");
    return { outcome: "corrected", confidence: 0.84, signals, assistantTopics };
  }
  if (ASSISTANT_SELF_CORRECTION.test(asstText)) {
    signals.push("assistant_self_correction");
    return { outcome: "corrected", confidence: 0.78, signals, assistantTopics };
  }

  if (shortReply && j < 0.14 && U.size > 0) {
    signals.push("taciturn_low_overlap");
    return { outcome: "ignored", confidence: 0.68, signals, assistantTopics };
  }

  if (U.size > 0 && A.size >= 2 && j < 0.24) {
    signals.push("low_overlap_rich_pivot");
    return { outcome: "redirected", confidence: 0.71, signals, assistantTopics };
  }

  if (j >= 0.26 && asstLen >= userLen * 1.52 && userLen > 12) {
    signals.push("expanded_engagement");
    return { outcome: "deepened", confidence: 0.74, signals, assistantTopics };
  }

  if (j >= 0.12 || [...U].some((k) => A.has(k))) {
    signals.push("aligned_response");
    return { outcome: "useful", confidence: 0.64, signals, assistantTopics };
  }

  signals.push("weak_signals");
  return { outcome: "unknown", confidence: 0.46, signals, assistantTopics };
}
