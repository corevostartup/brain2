import { clamp01 } from "@/ancc/rules/link-strength.rules";

/**
 * Neuroplasticidade: decaimento temporal e reforço por reativação.
 * Regra central: «Every memory link must earn its place repeatedly.»
 */
export const PLASTICITY = {
  /** Fator multiplicativo por passo quando o tópico não volta a ser ativado. */
  decayPerIdleStep: 0.92,
  /** Reforço quando o utilizador volta a falar do mesmo eixo semântico. */
  reinforcementOnReactivation: 0.06,
  /** Teto após reforço por interação. */
  reinforcementCap: 0.98,
  /** Força mínima antes de remoção lógica (soft-delete no grafo). */
  pruneBelow: 0.08,
} as const;

export function applyDecay(strength: number, idleSteps: number): number {
  if (idleSteps <= 0) {
    return clamp01(strength);
  }
  let s = clamp01(strength);
  for (let i = 0; i < idleSteps; i += 1) {
    s *= PLASTICITY.decayPerIdleStep;
  }
  return clamp01(s);
}

export function applyReinforcement(strength: number): number {
  return clamp01(Math.min(PLASTICITY.reinforcementCap, strength + PLASTICITY.reinforcementOnReactivation));
}
