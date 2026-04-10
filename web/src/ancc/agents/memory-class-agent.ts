import type { MemoryClass } from "@/ancc/models/memory";
import { inferMemoryClassFromSignals } from "@/ancc/rules/memory-class.rules";

const STRUCTURAL_KEYS =
  /\b(architecture|arquitetura|rules|regras|core|central|ANCC|vault|projeto|project|schema)\b/i;

export function assignMemoryClass(input: {
  topics: string[];
  maxLinkStrength: number;
  recurrenceScore: number;
  userText: string;
}): MemoryClass {
  return inferMemoryClassFromSignals({
    maxLinkStrength: input.maxLinkStrength,
    topicCount: input.topics.length,
    hasStructuralKeyword: STRUCTURAL_KEYS.test(input.userText),
    recurrenceScore: input.recurrenceScore,
  });
}
