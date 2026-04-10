/** Marcadores estáveis para parsing futuro / API. */
export const ANCC_CONTEXT_MARKERS = {
  begin: "[ANCC Context Layer]",
  end: "[/ANCC Context Layer]",
} as const;

export const DEFAULT_BEHAVIORAL_GUIDANCE = [
  "Responder de forma natural e útil.",
  "Priorizar conceitos estruturais e correlações fortes listadas.",
  "Não sobrecarregar com wikilinks irrelevantes ou especulação além do contexto.",
] as const;
