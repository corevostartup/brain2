/**
 * Intenção de uso da memória do vault num turno — ajusta peso da recuperação sem bloquear o chat.
 */

export type RetrievalIntent = "recall" | "store" | "converse";

/**
 * - **recall**: utilizador pede explícita ou implicitamente para lembrar / consultar notas.
 * - **store**: foco em guardar / anotar — baixa-se ligeiramente o ruído de notas antigas.
 * - **converse**: diálogo geral — recuperação mais conservadora.
 */
export function detectRetrievalIntent(userMessage: string): RetrievalIntent {
  const t = userMessage.trim().toLowerCase();

  if (
    /\b(lembr|lembra|recorda|recordar|busca|buscar|procura|procurar|achar|encontrar|onde eu|o que eu|nas minhas notas|no vault|no cérebro|minhas anotações|what did i|find in my notes|search my notes|look up)\b/.test(
      t,
    ) ||
    /\[\[/.test(userMessage)
  ) {
    return "recall";
  }

  if (
    /\b(guarda|guardar|anota|anotar|salva|salvar|grava|gravar|adiciona|adicionar|cria uma nota|criar nota|escreve isto|regista|write down|save this|add to my notes)\b/.test(
      t,
    )
  ) {
    return "store";
  }

  return "converse";
}

/** Multiplicador de relevância bruta antes do re-ranking (0.85–1.08). */
export function intentRelevanceMultiplier(intent: RetrievalIntent): number {
  switch (intent) {
    case "recall":
      return 1.08;
    case "store":
      return 0.88;
    case "converse":
    default:
      return 0.96;
  }
}
