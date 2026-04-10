import type { MemoryClass } from "@/ancc/models/memory";
import type { MemoryLink } from "@/ancc/models/link";
import type { AssembledContext, VaultCorrelationHit } from "@/ancc/models/context";
import { formatWikiLink } from "@/ancc/models/link";
import { DEFAULT_BEHAVIORAL_GUIDANCE } from "@/ancc/rules/prompt-injection.rules";

export function assembleContext(input: {
  topics: string[];
  links: MemoryLink[];
  memoryClass: MemoryClass;
  vaultCorrelations: VaultCorrelationHit[];
  recentBullets: string[];
}): AssembledContext {
  const sorted = [...input.links].sort((a, b) => b.strength - a.strength);
  const wikiLinksFormatted = sorted.map((l) => formatWikiLink(l.target));
  const linksWithStrength = sorted.map((l) => ({
    link: formatWikiLink(l.target),
    strength: l.strength,
    linkType: l.type,
  }));

  return {
    activeTopics: input.topics,
    wikiLinksFormatted,
    linksWithStrength,
    priorityMemoryClass: input.memoryClass,
    recentContextBullets: input.recentBullets,
    vaultCorrelations: input.vaultCorrelations,
    behavioralGuidance: [...DEFAULT_BEHAVIORAL_GUIDANCE],
  };
}
