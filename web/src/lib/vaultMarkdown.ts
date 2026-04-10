import type { VaultConversation, VaultGraph } from "@/lib/vault";
import {
  VAULT_LOOSE_MEMORIES_FOLDER_NAME,
  VAULT_MEMORIES_FOLDER_NOTE_BASENAME,
} from "@/lib/brain2CentralFolder";
import { extractRelatedVaultPathsFromMarkdown } from "@/lib/vaultConversationGraph";

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

function normalizePathKey(path: string): string {
  return path.replace(/\\/g, "/").trim().toLowerCase();
}

/** Resolve [[wikilink]] para o path normalizado de um ficheiro do conjunto (sem criar nós órfãos). */
function resolveWikilinkToFilePath(linkText: string, files: VaultMarkdownFile[]): string | null {
  const t = linkText.trim().toLowerCase();
  if (!t) {
    return null;
  }

  for (const f of files) {
    const pathNorm = normalizePathKey(f.path);
    const stem = f.name.replace(/\.md$/i, "").trim().toLowerCase();
    const fullLower = f.name.trim().toLowerCase();
    const base = pathNorm.split("/").pop() ?? "";
    const baseStem = base.replace(/\.md$/i, "").trim().toLowerCase();

    if (stem === t || fullLower === t || baseStem === t || base.toLowerCase() === t) {
      return pathNorm;
    }

    const simplified = baseStem.replace(/\s+-\s*\([^)]*\)\s*$/u, "").trim();
    if (simplified && simplified === t) {
      return pathNorm;
    }
  }

  return null;
}

function linkKeyUndirected(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

/**
 * Um nó por ficheiro `.md` (exceto hub Memories). Arestas só entre ficheiros do vault
 * quando o wikilink ou o ANCC `vault_path` aponta para outro ficheiro conhecido.
 */
export function buildGraphFromMarkdownFiles(files: VaultMarkdownFile[]): VaultGraph {
  const usable = files.filter((f) => !isMemoriesHubNotePath(f.path));

  const nodes: VaultGraph["nodes"] = usable.map((f) => {
    const id = normalizePathKey(f.path);
    const label = f.name.replace(/\.md$/i, "") || f.name;
    return { id, label };
  });

  const pathSet = new Set(nodes.map((n) => n.id));

  const edges: VaultGraph["edges"] = [];
  const edgeSet = new Set<string>();

  const addEdge = (source: string, target: string) => {
    if (!source || !target || source === target) {
      return;
    }
    const k = linkKeyUndirected(source, target);
    if (edgeSet.has(k)) {
      return;
    }
    edgeSet.add(k);
    edges.push({ source, target });
  };

  for (const file of usable) {
    const sourcePath = normalizePathKey(file.path);

    for (const link of parseWikilinks(file.content)) {
      const targetPath = resolveWikilinkToFilePath(link, usable);
      if (targetPath && pathSet.has(targetPath)) {
        addEdge(sourcePath, targetPath);
      }
    }

    for (const raw of extractRelatedVaultPathsFromMarkdown(file.content)) {
      const targetPath = normalizePathKey(raw);
      if (pathSet.has(targetPath)) {
        addEdge(sourcePath, targetPath);
      }
    }
  }

  return { nodes, edges };
}
