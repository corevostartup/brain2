import { clamp01 } from "@/ancc/rules/link-strength.rules";

/**
 * Re-peso de ligações após a resposta do modelo (etapa ANCC pós-interação).
 * Complementa a plasticidade base (decaimento por inatividade / reforço por reativação).
 */
export const OUTCOME_WEIGHTING = {
  /** Interseção utilizador ↔ assistente: reforço leve. */
  usefulIntersectionBoost: 1.07,
  /** Resposta expandiu o mesmo eixo: reforço mais forte na interseção. */
  deepenedIntersectionBoost: 1.14,
  /** Utilizador ou modelo sinalizam correção: enfraquecer eixos da mensagem do utilizador. */
  correctedUserAxisFactor: 0.8,
  /** Modelo desviou o foco: enfraquecer só o que era do utilizador e não voltou na resposta. */
  redirectedUserOnlyFactor: 0.86,
  /** Novos eixos na resposta (redirecionamento / aprofundamento): força inicial no grafo. */
  newAssistantAxisSeed: 0.19,
  /** Resposta mínima / baixa aderência: decaimento suave em tudo o que estava ativo. */
  ignoredGlobalFactor: 0.92,
  /** Sinal fraco ou ambíguo: quase neutro. */
  unknownNeutralFactor: 0.995,
} as const;

export function applyStrengthFactor(strength: number, factor: number): number {
  return clamp01(strength * factor);
}
