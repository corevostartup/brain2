import type { MemoryClass } from "@/ancc/models/memory";

export function inferMemoryClassFromSignals(signals: {
  maxLinkStrength: number;
  topicCount: number;
  hasStructuralKeyword: boolean;
  recurrenceScore: number;
}): MemoryClass {
  if (signals.hasStructuralKeyword && signals.maxLinkStrength >= 0.75) {
    return "structural";
  }
  if (signals.recurrenceScore >= 0.55) {
    return "recurrent";
  }
  if (signals.maxLinkStrength >= 0.5 && signals.topicCount >= 2) {
    return "recent";
  }
  if (signals.maxLinkStrength < 0.3 && signals.topicCount <= 1) {
    return "disposable";
  }
  return "experimental";
}
