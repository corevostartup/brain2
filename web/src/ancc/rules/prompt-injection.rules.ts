/** Marcadores estáveis para parsing futuro / API. */
export const ANCC_CONTEXT_MARKERS = {
  begin: "[ANCC Context Layer]",
  end: "[/ANCC Context Layer]",
} as const;

export const DEFAULT_BEHAVIORAL_GUIDANCE = [
  "Responder de forma natural e útil.",
  "Priorizar correlações fortes (secção assertiva); o contexto extra é exploratório neste turno.",
  "Não sobrecarregar com wikilinks irrelevantes ou especulação além do contexto.",
  "Correlações gravadas na memória/grafos são só as assertivas; o resto informa sem obrigar ligação permanente.",
] as const;
