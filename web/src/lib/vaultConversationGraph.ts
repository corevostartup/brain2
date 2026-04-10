import { parseWikiLinksFromText } from "@/ancc/models/link";
import {
  extractRelatedVaultPathsFromMarkdown,
  stripYamlFrontmatter,
} from "@/lib/markdownFrontmatter";
import {
  formatConversationDisplayTitle,
  type VaultConversation,
  type VaultGraph,
} from "@/lib/vault";

export { extractRelatedVaultPathsFromMarkdown } from "@/lib/markdownFrontmatter";

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").trim().toLowerCase();
}

/**
 * Verifica se um texto de wikilink [[...]] corresponde a uma conversa existente
 * (título, título apresentável ou nome do ficheiro sem .md).
 */
export function resolveWikilinkToConversationId(
  linkText: string,
  conversations: VaultConversation[]
): string | null {
  const t = linkText.trim().toLowerCase();
  if (!t) {
    return null;
  }

  for (const c of conversations) {
    const title = c.title.trim().toLowerCase();
    if (title === t) {
      return c.id;
    }

    const display = formatConversationDisplayTitle(c.title).trim().toLowerCase();
    if (display && display === t) {
      return c.id;
    }

    const fileName = (c.path.split("/").pop() ?? "").trim();
    const stem = fileName.replace(/\.md$/i, "").trim().toLowerCase();
    if (stem === t || fileName.toLowerCase() === t) {
      return c.id;
    }

    const simplified = stem.replace(/\s+-\s*\([^)]+\)\s*$/u, "").trim();
    if (simplified && simplified === t) {
      return c.id;
    }
  }

  return null;
}

function linkKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Grafo só com **conversas** (uma esfera por conversa). Arestas apenas quando:
 * - um wikilink no texto resolve para **outra** conversa do vault; ou
 * - o frontmatter ANCC lista `related_vault_notes` com `vault_path` para outra conversa.
 *
 * Não cria nós para tópicos soltos ([[palavra]] que não é título de outra conversa).
 */
export function buildConversationOnlyVaultGraph(conversations: VaultConversation[]): VaultGraph {
  const nodes: VaultGraph["nodes"] = [];
  const pathToId = new Map<string, string>();

  for (const c of conversations) {
    const label = formatConversationDisplayTitle(c.title) || c.title.trim() || c.path;
    nodes.push({ id: c.id, label: label || c.id });
    pathToId.set(normalizePath(c.path), c.id);
  }

  const edges: VaultGraph["edges"] = [];
  const edgeSet = new Set<string>();

  const addEdge = (sourceId: string, targetId: string) => {
    if (!sourceId || !targetId || sourceId === targetId) {
      return;
    }
    const k = linkKey(sourceId, targetId);
    if (edgeSet.has(k)) {
      return;
    }
    edgeSet.add(k);
    edges.push({ source: sourceId, target: targetId });
  };

  for (const c of conversations) {
    const sourceId = c.id;
    const body = c.content ?? "";
    const bodyWithoutFrontmatter = stripYamlFrontmatter(body);

    for (const link of parseWikiLinksFromText(bodyWithoutFrontmatter)) {
      const targetId = resolveWikilinkToConversationId(link, conversations);
      if (targetId && targetId !== sourceId) {
        addEdge(sourceId, targetId);
      }
    }

    for (const rawPath of extractRelatedVaultPathsFromMarkdown(body)) {
      const targetId = pathToId.get(normalizePath(rawPath));
      if (targetId && targetId !== sourceId) {
        addEdge(sourceId, targetId);
      }
    }
  }

  return { nodes, edges };
}
