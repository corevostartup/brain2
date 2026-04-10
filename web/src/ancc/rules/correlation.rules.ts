/**
 * Duas camadas de correlação vault:
 * - **contexto** — pode incluir notas mais fracas para informar o LLM neste turno.
 * - **persistência** — só ligações assertivas gravadas em `related_vault_notes` e no grafo «Your Brain».
 *
 * A neuroplasticidade (decaimento / outcome) atua sobre ligações de memória; caminhos do vault
 * reforçados em `finalizeInteraction` usam apenas hits de persistência.
 */
export const CORRELATION = {
  /** Pool lexical inicial em `correlateVaultFiles` (candidatos). */
  minLexicalCandidate: 0.2,
  /** Incluir no bloco ANCC para o modelo (contexto do turno). */
  minContext: 0.24,
  /** Gravar em frontmatter / aresta no grafo de conversas — só o que faz sentido forte. */
  minPersist: 0.5,
  maxHitsContext: 14,
  maxHitsPersist: 8,
} as const;
