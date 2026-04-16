/**
 * Nome / identidade de exibição escolhida pelo utilizador para o assistente.
 *
 * **Armazenamento canónico:** o valor válido é guardado em `ModelMemoryState` (localStorage
 * `brain2-ancc-model-memory-v1`), campos `assistantDisplayName` e `assistantDisplayNameUpdatedAt`,
 * via `saveUserAssistantDisplayName` — o mesmo blob das memórias ANCC do Brain2. Assim o nome
 * acompanha o pacote de «memórias do modelo» e é aplicado em cada turno até o utilizador mudar.
 *
 * A chave `USER_ASSISTANT_DISPLAY_NAME_STORAGE_KEY` é só legado: na primeira leitura migra para o
 * estado ANCC e é removida.
 */

import { loadModelMemoryState, saveModelMemoryState } from "@/lib/anccModelMemory";

export const USER_ASSISTANT_DISPLAY_NAME_STORAGE_KEY = "brain2-user-assistant-display-name";

/** Manter alinhado com o truncamento em `anccModelMemory` (ASSISTANT_NAME_MAX_LOAD). */
export const USER_ASSISTANT_DISPLAY_NAME_MAX_LEN = 64;

const MAX_NAME_LEN = USER_ASSISTANT_DISPLAY_NAME_MAX_LEN;

function stripOuterQuotes(s: string): string {
  return s.replace(/^[\s"'«»“”]+|[\s"'«»“”]+$/g, "").trim();
}

function sanitizeAssistantName(raw: string): string | null {
  let s = stripOuterQuotes(raw).replace(/\s+/g, " ").trim();
  if (!s) return null;

  const sentenceBreak = s.search(/[.!?]\s/);
  if (sentenceBreak > 0) {
    s = s.slice(0, sentenceBreak).trim();
  }
  const commaBreak = s.indexOf(",");
  if (commaBreak > 0 && commaBreak < s.length - 1) {
    const after = s.slice(commaBreak + 1).trim();
    if (after.length > 12 && /\b(porque|because|e\s+que|para)\b/i.test(after)) {
      s = s.slice(0, commaBreak).trim();
    }
  }

  s = s.replace(/[^\p{L}\p{N}\s'\-]/gu, "").replace(/\s+/g, " ").trim();
  if (s.length < 1 || s.length > MAX_NAME_LEN) {
    return null;
  }
  return s;
}

/** Ordem: mensagem inteira primeiro, depois linhas de baixo para cima (pedido no fim do parágrafo). */
function candidateChunksForRenameParsing(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const lines = t.split(/\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const chunks: string[] = [t];
  if (lines.length > 1) {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      chunks.push(lines[i]!);
    }
  }
  return chunks;
}

function tryExtractNameWithPatterns(line: string): string | null {
  const patterns: RegExp[] = [
    /\b(?:a\s+partir\s+de\s+agora|daqui\s+em\s+diante|de\s+agora\s+em\s+diante)\s*,?\s*(?:(?:o|teu|seu|vosso)\s+)?nome\s*(?:é|será|passa\s+a\s+ser|fica)\s*[:\s]+["']?(.+)$/i,
    /\b(?:(?:o|teu|seu|vosso)\s+)?nome\s*(?:é|será|passa\s+a\s+ser|fica)\s*[:\s]+["']?(.+)$/i,
    /\b(?:pode|quero\s+que|prefiro\s+que)\s+(?:te\s+)?(?:chames|chame)\s+["']?(.+)$/i,
    /\b(?:chama|chames)[- ]?te\s+["']?(.+)$/i,
    /\bte\s+chamas\s+["']?(.+)$/i,
    /\b(?:renomeia|rename)[- ]?te(?:\s+para|\s+como)?\s+["']?(.+)$/i,
    /\b(?:muda|troca)\s+(?:o\s+)?(?:teu\s+)?nome\s+para\s+["']?(.+)$/i,
    /\b(?:muda|troca)\s+o\s+nome\s+para\s+["']?(.+)$/i,
    /\b(?:a\s+partir\s+de\s+agora\s+)?chamo[- ]?te\s+["']?(.+)$/i,
    /\bquero\s+(?:te\s+)?chamar\s+de\s+["']?(.+)$/i,
    /\bpassa\s+a\s+chamar[- ]?te\s+["']?(.+)$/i,
    /\b(?:define|definir)\s+(?:o\s+)?(?:teu\s+)?nome\s+como\s+["']?(.+)$/i,
    /\bde\s+agora\s+em\s+diante\s+chamo[- ]?te\s+["']?(.+)$/i,
    /\b(?:your\s+name\s+is|call\s+yourself)\s+["']?(.+)$/i,
    /\b(?:change|rename)\s+(?:your\s+)?name\s+to\s+["']?(.+)$/i,
    /\b(?:i['’]ll|i\s+will)\s+call\s+you\s+["']?(.+)$/i,
    /\b(?:i\s+)?(?:will\s+)?call\s+you\s+["']?(.+)$/i,
  ];

  for (const re of patterns) {
    const m = line.match(re);
    if (m?.[1]) {
      const name = sanitizeAssistantName(m[1]);
      if (name) {
        return name;
      }
    }
  }
  return null;
}

/**
 * Extrai o nome quando o utilizador define ou **altera** como quer chamar o assistente (PT/EN).
 * Aceita o pedido em qualquer parte da mensagem; tenta também linha a linha (de baixo para cima).
 * Devolve `null` se não for um pedido claro de renomeação.
 */
export function tryParseAssistantRenameFromUserMessage(text: string): string | null {
  const t = text.trim();
  if (t.length < 3 || t.length > 4000) {
    return null;
  }

  for (const chunk of candidateChunksForRenameParsing(t)) {
    const name = tryExtractNameWithPatterns(chunk);
    if (name) {
      return name;
    }
  }

  return null;
}

export function loadUserAssistantDisplayName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const mm = loadModelMemoryState();
    const fromAncc = mm.assistantDisplayName?.trim();
    if (fromAncc) {
      return fromAncc.slice(0, MAX_NAME_LEN);
    }

    const legacy = window.localStorage.getItem(USER_ASSISTANT_DISPLAY_NAME_STORAGE_KEY)?.trim();
    if (!legacy) {
      return null;
    }

    const migrated = legacy.slice(0, MAX_NAME_LEN);
    saveModelMemoryState({
      ...mm,
      version: 1,
      entries: mm.entries,
      assistantDisplayName: migrated,
      assistantDisplayNameUpdatedAt: new Date().toISOString(),
    });
    window.localStorage.removeItem(USER_ASSISTANT_DISPLAY_NAME_STORAGE_KEY);
    return migrated;
  } catch {
    return null;
  }
}

export function saveUserAssistantDisplayName(name: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const mm = loadModelMemoryState();
    if (!name || !name.trim()) {
      saveModelMemoryState({ version: 1, entries: mm.entries });
      window.localStorage.removeItem(USER_ASSISTANT_DISPLAY_NAME_STORAGE_KEY);
      return;
    }
    const trimmed = name.trim().slice(0, MAX_NAME_LEN);
    saveModelMemoryState({
      ...mm,
      version: 1,
      entries: mm.entries,
      assistantDisplayName: trimmed,
      assistantDisplayNameUpdatedAt: new Date().toISOString(),
    });
    window.localStorage.removeItem(USER_ASSISTANT_DISPLAY_NAME_STORAGE_KEY);
  } catch {
    /* ignore quota */
  }
}

/**
 * Trecho para o system prompt (fora do bloco ANCC) — o modelo vê sempre que existe nome guardado.
 */
export function buildUserAssistantIdentitySystemAddition(displayName: string | null): string {
  const n = displayName?.trim();
  if (!n) {
    return "";
  }
  return [
    "[User preference — assistant display name]",
    `The user asked to call you by this name when it fits naturally in dialogue: "${n}".`,
    "Brain2 remains the product; this is how they address you as their assistant. Do not contradict or forget this for the rest of the session unless they change it.",
  ].join("\n");
}
