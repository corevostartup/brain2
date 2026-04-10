/**
 * Pesos do MVP para strength:
 * strength =
 *   0.35 * topic_match +
 *   0.25 * recurrence +
 *   0.20 * recency +
 *   0.20 * structural_importance
 *
 * Todos os componentes ∈ [0, 1]; o resultado é clampado a [0, 1].
 */
export const LINK_STRENGTH_WEIGHTS = {
  topicMatch: 0.35,
  recurrence: 0.25,
  recency: 0.2,
  structuralImportance: 0.2,
} as const;

export function clamp01(n: number): number {
  if (Number.isNaN(n)) {
    return 0;
  }
  return Math.min(1, Math.max(0, n));
}

export function combineStrengthComponents(components: {
  topicMatch: number;
  recurrence: number;
  recency: number;
  structuralImportance: number;
}): number {
  const s =
    LINK_STRENGTH_WEIGHTS.topicMatch * clamp01(components.topicMatch) +
    LINK_STRENGTH_WEIGHTS.recurrence * clamp01(components.recurrence) +
    LINK_STRENGTH_WEIGHTS.recency * clamp01(components.recency) +
    LINK_STRENGTH_WEIGHTS.structuralImportance * clamp01(components.structuralImportance);
  return clamp01(s);
}

/** Só promove ligações com correlação mínima com o vault (evita ligar tudo a tudo). */
export const MIN_CORRELATION_TO_LINK = 0.12;

/** Ligações abaixo disto são descartadas ou marcadas como experimental fraco. */
export const WEAK_LINK_THRESHOLD = 0.35;
