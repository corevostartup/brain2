import type { ChatMessage } from "@/lib/chat";
import type { ANCCProcessResult } from "@/ancc";
import type { VaultCorrelationHit } from "@/ancc/models/context";
import { formatWikiLink } from "@/ancc/models/link";

function toIsoDate(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, "/").trim().toLowerCase();
}

/**
 * Remove só o **path desta nota** da lista de correlações para o frontmatter.
 * Não apaga ficheiros nem conversas — evita auto-ligação `[[esta conversa]] → esta conversa`.
 */
export function filterCorrelationsForCurrentVaultFile(
  hits: VaultCorrelationHit[],
  currentVaultPath: string
): VaultCorrelationHit[] {
  const cur = normalizeVaultPath(currentVaultPath);
  return hits
    .filter((h) => normalizeVaultPath(h.path) !== cur)
    .sort((a, b) => b.relevance - a.relevance);
}

function yamlDoubleQuoted(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const MAX_RELATED = 24;
const MAX_LINK_ROWS = 32;

function buildAnccYamlBlock(
  result: ANCCProcessResult,
  currentVaultPath: string
): string {
  const lines: string[] = [];
  const filtered = filterCorrelationsForCurrentVaultFile(
    result.assembled.vaultCorrelationsPersisted,
    currentVaultPath
  ).slice(0, MAX_RELATED);

  lines.push("brain2_ancc:");
  lines.push("  version: 1");
  lines.push(`  updated: ${yamlDoubleQuoted(new Date().toISOString())}`);
  lines.push(`  interaction_id: ${yamlDoubleQuoted(result.memoryNote.id)}`);
  lines.push(`  memory_class: ${yamlDoubleQuoted(result.memoryClass)}`);

  if (result.interactionOutcome) {
    lines.push(`  interaction_outcome: ${yamlDoubleQuoted(result.interactionOutcome)}`);
  }
  if (result.outcomeConfidence !== undefined) {
    lines.push(`  outcome_confidence: ${Number(result.outcomeConfidence.toFixed(4))}`);
  }
  if (result.outcomeSignals && result.outcomeSignals.length > 0) {
    lines.push("  outcome_signals:");
    for (const s of result.outcomeSignals.slice(0, 16)) {
      lines.push(`    - ${yamlDoubleQuoted(s)}`);
    }
  }

  const topics = result.topics.length ? result.topics : result.memoryNote.topics;
  if (topics.length === 0) {
    lines.push("  topics: []");
  } else {
    lines.push("  topics:");
    for (const t of topics.slice(0, 40)) {
      lines.push(`    - ${yamlDoubleQuoted(formatWikiLink(t))}`);
    }
  }

  const links = result.links.slice(0, MAX_LINK_ROWS);
  if (links.length === 0) {
    lines.push("  correlation_links: []");
  } else {
    lines.push("  correlation_links:");
    for (const l of links) {
      lines.push(`    - target: ${yamlDoubleQuoted(formatWikiLink(l.target))}`);
      lines.push(`      strength: ${Number(l.strength.toFixed(4))}`);
      lines.push(`      type: ${yamlDoubleQuoted(l.type)}`);
    }
  }

  if (filtered.length === 0) {
    lines.push("  related_vault_notes: []");
  } else {
    lines.push("  related_vault_notes:");
    for (const h of filtered) {
      lines.push(`    - note: ${yamlDoubleQuoted(formatWikiLink(h.noteTitle))}`);
      lines.push(`      relevance: ${Number(h.relevance.toFixed(4))}`);
      lines.push(`      vault_path: ${yamlDoubleQuoted(h.path.replace(/\\/g, "/"))}`);
      if (h.matchedTopics.length > 0) {
        lines.push("      matched_topics:");
        for (const mt of h.matchedTopics.slice(0, 12)) {
          lines.push(`        - ${yamlDoubleQuoted(mt)}`);
        }
      }
    }
  }

  return lines.join("\n");
}

export type BuildVaultConversationMarkdownParams = {
  title: string;
  startedAt: number;
  model: string;
  messages: ChatMessage[];
  /** Metadados ANCC (correlações automáticas com o resto do vault). */
  anccPersist?: {
    result: ANCCProcessResult;
    currentVaultPath: string;
  };
};

/**
 * Markdown guardado no vault: frontmatter YAML com ANCC + corpo da conversa.
 * O frontmatter lista tópicos, forças de ligação e notas relacionadas com relevância.
 */
export function buildVaultConversationMarkdown(params: BuildVaultConversationMarkdownParams): string {
  const bodyLines: string[] = [];

  let nonSystemIndex = 0;
  for (const message of params.messages) {
    if (message.role === "system") {
      continue;
    }

    const roleLabel = message.role === "user" ? "User" : "Brain2";
    const fallbackTimestamp = params.startedAt + nonSystemIndex * 1000;
    const messageTimestamp = message.createdAt ?? fallbackTimestamp;

    bodyLines.push(`## ${roleLabel} — ${toIsoDate(messageTimestamp)}`);
    bodyLines.push("");
    bodyLines.push(message.content.trim());
    bodyLines.push("");
    nonSystemIndex += 1;
  }

  const bodyCore = [
    `# ${params.title}`,
    "",
    `- Created: ${toIsoDate(params.startedAt)}`,
    `- Updated: ${toIsoDate(Date.now())}`,
    `- Model: ${params.model}`,
    "",
    ...bodyLines,
  ].join("\n");

  if (!params.anccPersist) {
    return bodyCore.trimEnd() + "\n";
  }

  const yamlInner = buildAnccYamlBlock(params.anccPersist.result, params.anccPersist.currentVaultPath);
  const frontmatter = `---\n${yamlInner}\n---\n\n`;

  return (frontmatter + bodyCore).trimEnd() + "\n";
}

// ── Parse markdown de conversa do vault → mensagens de chat (continuar sessão) ──

function stripLeadingFrontmatter(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.length === 0 || lines[0].trim() !== "---") {
    return content;
  }

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      return lines.slice(index + 1).join("\n");
    }
  }

  return content;
}

function roleFromLabel(label: string): "user" | "assistant" {
  const normalized = label.trim().toLowerCase();
  if (["user", "utilizador", "usuario", "usuário", "you", "voce", "você"].includes(normalized)) {
    return "user";
  }
  return "assistant";
}

function parseRoleMarker(line: string): {
  role: "user" | "assistant";
  inlineText: string;
  headingIso?: string;
} | null {
  const timestampHeadingMatch = line.match(
    /^\s*#{1,6}\s*(user|utilizador|usuario|usuário|you|voce|você|assistant|chatgpt|ai|brain2|brain)\b\s*[—–-]\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s*$/i
  );

  if (timestampHeadingMatch) {
    return {
      role: roleFromLabel(timestampHeadingMatch[1]),
      inlineText: "",
      headingIso: timestampHeadingMatch[2],
    };
  }

  const markerMatch = line.match(
    /^\s*(#{1,6}\s*)?(user|utilizador|usuario|usuário|you|voce|você|assistant|chatgpt|ai|brain2|brain)\b(?:\s*([:\-–—])\s*(.*))?\s*$/i
  );

  if (!markerMatch) {
    return null;
  }

  const hasHeadingPrefix = Boolean(markerMatch[1]);
  const role = roleFromLabel(markerMatch[2]);
  const separator = markerMatch[3] ?? "";
  const tail = (markerMatch[4] ?? "").trim();

  const inlineText = (!hasHeadingPrefix && separator === ":" && tail.length > 0) ? tail : "";

  return { role, inlineText };
}

/**
 * Extrai `sessionId` e `startedAt` do nome do ficheiro `… - (sessionId-startedAt).md`
 * (o segmento entre parêntesis corresponde a `sanitize(sessionId + "-" + startedAt)`).
 */
export function tryParseConversationRecordPartsFromVaultPath(
  vaultPath: string
): { sessionId: string; startedAt: number } | null {
  const fileName = vaultPath.replace(/\\/g, "/").split("/").pop() ?? "";
  const paren = fileName.match(/\(([^)]+)\)\s*\.md$/i);
  if (!paren) {
    return null;
  }
  const safeId = paren[1];
  const lastDigits = safeId.match(/^(.*)-(\d{10,})$/);
  if (!lastDigits) {
    return null;
  }
  const startedAt = Number(lastDigits[2]);
  if (!Number.isFinite(startedAt)) {
    return null;
  }
  const sessionId = lastDigits[1];
  if (!sessionId) {
    return null;
  }
  return { sessionId, startedAt };
}

/**
 * Lê `- Created: ISO` do corpo da nota (após frontmatter).
 */
export function tryParseCreatedAtFromVaultContent(content: string): number | null {
  const body = stripLeadingFrontmatter(content);
  const m = body.match(/^\s*-\s*Created:\s*(\d{4}-\d{2}-\d{2}T[^\s)]+)/im);
  if (!m?.[1]) {
    return null;
  }
  const t = Date.parse(m[1]);
  return Number.isFinite(t) ? t : null;
}

export function extractFolderPathFromVaultPath(vaultPath: string): string | null {
  const norm = vaultPath.replace(/\\/g, "/").trim();
  const slash = norm.lastIndexOf("/");
  if (slash <= 0) {
    return null;
  }
  const folder = norm.slice(0, slash).trim();
  return folder || null;
}

/**
 * Converte o markdown guardado no vault em mensagens para o estado de chat
 * (continuar a mesma conversa ao reabrir a nota).
 */
export function parseVaultConversationMarkdownToChatMessages(content: string): ChatMessage[] {
  const sanitizedContent = stripLeadingFrontmatter(content);
  const lines = sanitizedContent.replace(/\r\n/g, "\n").split("\n");
  const messages: ChatMessage[] = [];
  let currentRole: "user" | "assistant" = "assistant";
  let buffer: string[] = [];
  let pendingCreatedAt: number | undefined;

  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text.length > 0) {
      const idBase = messages.length + 1;
      messages.push({
        id: `vault-${idBase}-${currentRole}`,
        role: currentRole,
        content: text,
        createdAt: pendingCreatedAt,
      });
    }
    buffer = [];
    pendingCreatedAt = undefined;
  };

  const firstRoleLine = lines.findIndex((line) => parseRoleMarker(line) !== null);

  if (firstRoleLine === -1) {
    const fallback = sanitizedContent.trim();
    if (fallback.length > 0) {
      return [
        {
          id: "vault-fallback-1",
          role: "assistant",
          content: fallback,
        },
      ];
    }

    return [
      {
        id: "vault-fallback-1",
        role: "assistant",
        content: "Sem conteúdo nesta conversa.",
      },
    ];
  }

  for (let index = firstRoleLine; index < lines.length; index += 1) {
    const line = lines[index];
    const marker = parseRoleMarker(line);

    if (marker) {
      flush();
      currentRole = marker.role;
      if (marker.headingIso) {
        const parsed = Date.parse(marker.headingIso);
        if (Number.isFinite(parsed)) {
          pendingCreatedAt = parsed;
        }
      }
      if (marker.inlineText.length > 0) {
        buffer.push(marker.inlineText);
      }
      continue;
    }

    buffer.push(line);
  }

  flush();

  if (messages.length === 0) {
    return [
      {
        id: "vault-fallback-1",
        role: "assistant",
        content: "Sem conteúdo nesta conversa.",
      },
    ];
  }

  return messages;
}
