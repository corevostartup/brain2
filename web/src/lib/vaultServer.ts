import { promises as fs } from "node:fs";
import path from "node:path";
import type { FolderTreeNode, VaultGraph } from "@/lib/vault";

export const PRESET_VAULT_PATH =
  "/Users/Cassio/Library/Mobile Documents/com~apple~CloudDocs/Brain2/Vault";

const WIKILINK_REGEX = /\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*?)?\]\]/g;

type MarkdownFile = {
  name: string;
  content: string;
};

async function readFolderTreeFromPath(dirPath: string): Promise<FolderTreeNode[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const folders: FolderTreeNode[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      try {
        const children = await readFolderTreeFromPath(fullPath);
        folders.push({ name: entry.name, kind: "folder", children });
      } catch {
        folders.push({ name: entry.name, kind: "folder", children: [] });
      }
      continue;
    }

  }

  folders.sort((a, b) => a.name.localeCompare(b.name));
  return folders;
}

async function readAllMarkdownFilesFromPath(dirPath: string): Promise<MarkdownFile[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files: MarkdownFile[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      try {
        const nested = await readAllMarkdownFilesFromPath(fullPath);
        files.push(...nested);
      } catch {
        // Skip unreadable subdirectories.
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      try {
        const content = await fs.readFile(fullPath, "utf8");
        files.push({
          name: entry.name.replace(/\.md$/, ""),
          content,
        });
      } catch {
        // Skip unreadable markdown files.
      }
    }
  }

  return files;
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

function buildGraphFromMarkdownFiles(files: MarkdownFile[]): VaultGraph {
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

export async function getPresetVaultData(): Promise<{
  path: string;
  folders: FolderTreeNode[];
  graph: VaultGraph;
}> {
  const folders = await readFolderTreeFromPath(PRESET_VAULT_PATH);
  const markdownFiles = await readAllMarkdownFilesFromPath(PRESET_VAULT_PATH);
  const graph = buildGraphFromMarkdownFiles(markdownFiles);

  return {
    path: PRESET_VAULT_PATH,
    folders,
    graph,
  };
}
