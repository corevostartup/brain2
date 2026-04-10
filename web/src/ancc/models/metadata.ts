/** Metadados opcionais por interação (análise de outcome, métricas). */
export type InteractionOutcome =
  | "useful"
  | "corrected"
  | "deepened"
  | "ignored"
  | "redirected"
  | "unknown";

export type InteractionMetadata = {
  interactionId: string;
  userMessageAt: string;
  outcome?: InteractionOutcome;
  /** IDs de notas do vault tocadas nesta correlação. */
  touchedVaultPaths?: string[];
};

export function newInteractionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ancc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
