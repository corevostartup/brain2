import type { AssembledContext } from "@/ancc/models/context";
import { ANCC_CONTEXT_MARKERS, ANCC_VAULT_MEMORY_CONTRACT } from "@/ancc/rules/prompt-injection.rules";

function formatCorrelationLine(hit: AssembledContext["vaultCorrelations"][number]): string {
  const topics = hit.matchedTopics.length ? hit.matchedTopics.join(", ") : "—";
  const sem =
    hit.semanticSimilarity != null
      ? `; semântica ${(hit.semanticSimilarity * 100).toFixed(0)}%`
      : "";
  const mode = hit.retrievalMode === "hybrid" ? "; modo híbrido" : "";
  return `- ${hit.noteTitle} (${(hit.relevance * 100).toFixed(0)}% relevância${sem}${mode}; tópicos: ${topics})`;
}

export function buildHiddenSystemPromptBlock(ctx: AssembledContext): string {
  const lines: string[] = [];
  lines.push(ANCC_CONTEXT_MARKERS.begin);
  for (const line of ANCC_VAULT_MEMORY_CONTRACT) {
    lines.push(line);
  }
  lines.push("---");
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
  lines.push("Vault — correlações assertivas (candidatas a ligação persistente / grafo):");
  if (ctx.vaultCorrelationsPersisted.length === 0) {
    lines.push("- (nenhuma acima do limiar assertivo para esta pergunta)");
  } else {
    for (const h of ctx.vaultCorrelationsPersisted.slice(0, 10)) {
      lines.push(formatCorrelationLine(h));
      if (h.snippet?.trim()) {
        lines.push(`  excerpt: ${h.snippet.trim().slice(0, 280)}`);
      }
    }
  }
  const persistPaths = new Set(ctx.vaultCorrelationsPersisted.map((h) => h.path));
  const supplemental = ctx.vaultCorrelations.filter((h) => !persistPaths.has(h.path));
  lines.push("Vault — contexto adicional (só este turno, correlação mais fraca):");
  if (supplemental.length === 0) {
    lines.push("- (nenhuma)");
  } else {
    for (const h of supplemental.slice(0, 10)) {
      lines.push(formatCorrelationLine(h));
      if (h.snippet?.trim()) {
        lines.push(`  excerpt: ${h.snippet.trim().slice(0, 280)}`);
      }
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
