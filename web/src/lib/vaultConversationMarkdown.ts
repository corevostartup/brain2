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
