import type { AssembledContext } from "@/ancc/models/context";
import { ANCC_CONTEXT_MARKERS } from "@/ancc/rules/prompt-injection.rules";

function formatCorrelationLine(hit: AssembledContext["vaultCorrelations"][number]): string {
  const topics = hit.matchedTopics.length ? hit.matchedTopics.join(", ") : "—";
  return `- ${hit.noteTitle} (${(hit.relevance * 100).toFixed(0)}% relevância; tópicos: ${topics})`;
}

export function buildHiddenSystemPromptBlock(ctx: AssembledContext): string {
  const lines: string[] = [];
  lines.push(ANCC_CONTEXT_MARKERS.begin);
  lines.push(`Active topics: ${ctx.wikiLinksFormatted.join(", ") || "(none)"}`);
  lines.push(`Priority memory class: ${ctx.priorityMemoryClass}`);
  lines.push("Relevant correlations:");
  if (ctx.linksWithStrength.length === 0) {
    lines.push("- (no strong links in this turn)");
  } else {
    for (const row of ctx.linksWithStrength) {
      lines.push(`- ${row.link} (${row.strength.toFixed(2)}, ${row.linkType})`);
    }
  }
  lines.push("Vault-aligned notes (correlação com ficheiros existentes):");
  if (ctx.vaultCorrelations.length === 0) {
    lines.push("- (nenhuma nota do vault acima do limiar nesta interação)");
  } else {
    for (const h of ctx.vaultCorrelations.slice(0, 12)) {
      lines.push(formatCorrelationLine(h));
    }
  }
  lines.push("Recent active context:");
  if (ctx.recentContextBullets.length === 0) {
    lines.push("- (sem resumo ainda)");
  } else {
    for (const b of ctx.recentContextBullets) {
      lines.push(`- ${b}`);
    }
  }
  lines.push("Behavioral guidance:");
  for (const g of ctx.behavioralGuidance) {
    lines.push(`- ${g}`);
  }
  lines.push(ANCC_CONTEXT_MARKERS.end);
  return lines.join("\n");
}
