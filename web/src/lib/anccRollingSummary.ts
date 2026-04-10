/**
 * Memória de sessão comprimida para retrieval + tópicos ANCC (não substitui o histórico completo).
 */
export function appendRollingSessionSummary(
  previous: string,
  userMessage: string,
  assistantMessage: string,
  maxChars = 1400
): string {
  const u = userMessage.replace(/\s+/g, " ").trim().slice(0, 200);
  const a = assistantMessage.replace(/\s+/g, " ").trim().slice(0, 280);
  const block = `• User: ${u}\n• Brain2: ${a}`;
  const next = (previous.trim() ? `${previous.trim()}\n` : "") + block;
  return next.length > maxChars ? next.slice(-maxChars) : next;
}
