import type { MemoryClass } from "@/ancc/models/memory";
import type { MemoryLink } from "@/ancc/models/link";
import type { AssembledContext, VaultCorrelationHit } from "@/ancc/models/context";
import { formatWikiLink } from "@/ancc/models/link";
import { DEFAULT_BEHAVIORAL_GUIDANCE } from "@/ancc/rules/prompt-injection.rules";
import type { UserPersonalityProfile } from "@/lib/userPersonalityProfile";
import { formatPersonalityForAnccGuidance } from "@/lib/userPersonalityProfile";

export function assembleContext(input: {
  topics: string[];
  links: MemoryLink[];
  memoryClass: MemoryClass;
  vaultCorrelations: VaultCorrelationHit[];
  vaultCorrelationsPersisted: VaultCorrelationHit[];
  recentBullets: string[];
  /** Frases curtas: lembretes temporais cujo dia é hoje (prioridade na resposta). */
  temporalReminderLines?: string[];
  /** Dia «hoje» YYYY-MM-DD (local) para datas relativas no fence. */
  referenceLocalDateKey: string;
  /** Nome de exibição pedido pelo utilizador — reforçado no bloco ANCC. */
  userAssistantDisplayName?: string | null;
  /** Níveis 0–100 por traço (personalidade persistida). */
  userPersonalityProfile?: UserPersonalityProfile | null;
}): AssembledContext {
  const sorted = [...input.links].sort((a, b) => b.strength - a.strength);
  const wikiLinksFormatted = sorted.map((l) => formatWikiLink(l.target));
  const linksWithStrength = sorted.map((l) => ({
    link: formatWikiLink(l.target),
    strength: l.strength,
    linkType: l.type,
  }));

  const name = input.userAssistantDisplayName?.trim();
  const personalityLine = formatPersonalityForAnccGuidance(input.userPersonalityProfile ?? null);
  const behavioralGuidance: string[] = [...DEFAULT_BEHAVIORAL_GUIDANCE];
  if (name) {
    behavioralGuidance.unshift(
      `User-chosen assistant display name (use naturally when signing or addressing): "${name}". Product is still Brain2.`
    );
  }
  if (personalityLine) {
    behavioralGuidance.unshift(personalityLine);
  }

  return {
    activeTopics: input.topics,
    wikiLinksFormatted,
    linksWithStrength,
    priorityMemoryClass: input.memoryClass,
    recentContextBullets: input.recentBullets,
    vaultCorrelations: input.vaultCorrelations,
    vaultCorrelationsPersisted: input.vaultCorrelationsPersisted,
    behavioralGuidance,
    temporalReminderLines: input.temporalReminderLines ?? [],
    referenceLocalDateKey: input.referenceLocalDateKey,
  };
}
