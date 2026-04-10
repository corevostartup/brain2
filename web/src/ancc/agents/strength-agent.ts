import type { MemoryLink, MemoryLinkType } from "@/ancc/models/link";
import {
  combineStrengthComponents,
  MIN_CORRELATION_TO_LINK,
  WEAK_LINK_THRESHOLD,
} from "@/ancc/rules/link-strength.rules";

export type StrengthAgentInput = {
  topic: string;
  /** 0–1: sobreposição com conteúdo/títulos do vault. */
  topicMatch: number;
  /** 0–1: quantas vezes este eixo já apareceu no estado (recorrência). */
  recurrence: number;
  /** 0–1: frescor temporal da última menção. */
  recency: number;
  /** 0–1: importância estrutural (hub no vault, pasta central, etc.). */
  structuralImportance: number;
};

export function scoreLinkStrength(input: StrengthAgentInput): number {
  return combineStrengthComponents({
    topicMatch: input.topicMatch,
    recurrence: input.recurrence,
    recency: input.recency,
    structuralImportance: input.structuralImportance,
  });
}

export function inferLinkType(strength: number, topicMatch: number): MemoryLinkType {
  if (strength >= 0.82 && topicMatch >= 0.55) {
    return "structural";
  }
  if (topicMatch >= 0.45) {
    return "semantic";
  }
  if (strength >= WEAK_LINK_THRESHOLD) {
    return "contextual";
  }
  if (strength < MIN_CORRELATION_TO_LINK + 0.05) {
    return "experimental";
  }
  return "recurrent";
}

export function buildMemoryLinks(
  topics: string[],
  scoreForTopic: (topic: string) => StrengthAgentInput
): MemoryLink[] {
  const now = new Date().toISOString();
  const links: MemoryLink[] = [];

  for (const topic of topics) {
    const s = scoreForTopic(topic);
    const strength = scoreLinkStrength(s);
    if (strength < MIN_CORRELATION_TO_LINK) {
      continue;
    }
    links.push({
      target: topic.trim(),
      strength,
      type: inferLinkType(strength, s.topicMatch),
      updatedAt: now,
    });
  }

  return links.sort((a, b) => b.strength - a.strength);
}
