import type { VaultConversation } from "@/lib/vault";
import type { VaultFileSnapshot } from "@/ancc/pipeline/vault-correlation";

/** Mais matéria por nota = melhor chance de embeddings apanhar trechos de conversa reais. */
const MAX_FILES = 200;
const MAX_CHARS_PER_FILE = 36_000;

function fileNameFromPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  const last = parts[parts.length - 1]?.trim();
  return last || "note.md";
}

/**
 * Converte conversas/notas do vault em snapshots para o ANCC (uma leitura por envio ao modelo).
 * Limita quantidade e tamanho para manter o pipeline rápido no browser.
 */
export function buildVaultSnapshotsForAncc(conversations: VaultConversation[]): VaultFileSnapshot[] {
  const sorted = [...conversations].sort((a, b) => b.modifiedAt - a.modifiedAt);
  const slice = sorted.slice(0, MAX_FILES);

  return slice.map((c): VaultFileSnapshot => {
    const content = c.content.length > MAX_CHARS_PER_FILE
      ? `${c.content.slice(0, MAX_CHARS_PER_FILE)}\n\n[…truncado para ANCC…]`
      : c.content;

    return {
      path: c.path,
      name: fileNameFromPath(c.path),
      content,
      modifiedAt: c.modifiedAt,
    };
  });
}
