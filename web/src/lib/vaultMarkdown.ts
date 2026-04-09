import type { VaultConversation, VaultGraph } from "@/lib/vault";
import {
  VAULT_LOOSE_MEMORIES_FOLDER_NAME,
  VAULT_MEMORIES_FOLDER_NOTE_BASENAME,
} from "@/lib/brain2CentralFolder";

export type VaultMarkdownFile = {
  name: string;
  path: string;
  content: string;
  modifiedAt: number;
};

const WIKILINK_REGEX = /\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*?)?\]\]/g;

/** Nota de sistema `Memories/Memories.md`; não entra na lista de conversas da barra lateral. */
export function isMemoriesHubNotePath(relativePath: string): boolean {
  const n = relativePath.replace(/\\/g, "/").trim();
  const expected = `${VAULT_LOOSE_MEMORIES_FOLDER_NAME}/${VAULT_MEMORIES_FOLDER_NOTE_BASENAME}`;
  return n.localeCompare(expected, undefined, { sensitivity: "base" }) === 0;
}

function parseWikilinks(content: string): string[] {
  const links: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = WIKILINK_REGEX.exec(content)) !== null) {
    const target = match[1].trim();
    if (target) {
      links.push(target);
    }
  }

  return links;
}

export function buildConversationsFromMarkdownFiles(files: VaultMarkdownFile[]): VaultConversation[] {
  return files
    .filter((file) => !isMemoriesHubNotePath(file.path))
    .map((file) => ({
      id: file.path.toLowerCase(),
      title: file.name,
      path: file.path,
      modifiedAt: file.modifiedAt,
      content: file.content,
    }))
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export function buildGraphFromMarkdownFiles(files: VaultMarkdownFile[]): VaultGraph {
  const nodeMap = new Map<string, string>();

  for (const file of files) {
    nodeMap.set(file.name.toLowerCase(), file.name);
  }

  const nodes = Array.from(nodeMap.values()).map((label) => ({
    id: label.toLowerCase(),
    label,
  }));

  const edges: Array<{ source: string; target: string }> = [];
  const edgeSet = new Set<string>();

  for (const file of files) {
    const sourceId = file.name.toLowerCase();
    const links = parseWikilinks(file.content);

    for (const link of links) {
      const targetId = link.toLowerCase();

      if (!nodeMap.has(targetId)) {
        nodeMap.set(targetId, link);
        nodes.push({ id: targetId, label: link });
      }

      if (sourceId === targetId) {
        continue;
      }

      const edgeKey =
        sourceId < targetId
          ? `${sourceId}::${targetId}`
          : `${targetId}::${sourceId}`;

      if (!edgeSet.has(edgeKey)) {
        edgeSet.add(edgeKey);
        edges.push({ source: sourceId, target: targetId });
      }
    }
  }

  return { nodes, edges };
}
