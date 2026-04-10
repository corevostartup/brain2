import type { ChatMessage } from "@/lib/chat";

/** Frases curtas para o ANCC (memória ativa recente na conversa). */
export function buildAnccRecentBullets(messages: ChatMessage[], max = 3): string[] {
  const users = messages.filter((m) => m.role === "user").slice(-max);
  return users
    .map((m) => m.content.replace(/\s+/g, " ").trim().slice(0, 200))
    .filter(Boolean);
}
