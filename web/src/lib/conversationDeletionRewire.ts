import { isAnccModelMemoryVaultPath } from "@/lib/anccModelMemory";
import { extractRelatedVaultPathsFromMarkdown, stripYamlFrontmatter } from "@/lib/markdownFrontmatter";
import {
  buildGraphFromMarkdownFiles,
  normalizeVaultPathKey,
  resolveVaultWikilinkToNormalizedPath,
  type VaultMarkdownFile,
} from "@/lib/vaultMarkdown";

const WIKILINK_REGEX = /\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*?)?\]\]/g;

function stripVaultPathLinesToTarget(content: string, deletedNorm: string): string {
  return content.replace(/^\s*vault_path:\s*"([^"]*)"\s*$/gm, (full, rawPath: string) => {
    const n = normalizeVaultPathKey(String(rawPath).replace(/\\/g, "/"));
    return n === deletedNorm ? "" : full;
  });
}

function removeWikilinksResolvingToTarget(
  content: string,
  deletedNorm: string,
  files: VaultMarkdownFile[],
): string {
  WIKILINK_REGEX.lastIndex = 0;
  const removals: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_REGEX.exec(content)) !== null) {
    const resolved = resolveVaultWikilinkToNormalizedPath(m[1], files);
    if (resolved === deletedNorm) {
      removals.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  let out = content;
  for (let i = removals.length - 1; i >= 0; i--) {
    const { start, end } = removals[i]!;
    out = `${out.slice(0, start)}${out.slice(end)}`;
  }
  return out;
}

function markdownLinksToNormalizedTarget(
  markdown: string,
  targetNorm: string,
  files: VaultMarkdownFile[],
): boolean {
  const body = stripYamlFrontmatter(markdown);
  WIKILINK_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_REGEX.exec(body)) !== null) {
    if (resolveVaultWikilinkToNormalizedPath(m[1], files) === targetNorm) {
      return true;
    }
  }
  if (markdown.includes("brain2_ancc")) {
    for (const raw of extractRelatedVaultPathsFromMarkdown(markdown)) {
      if (normalizeVaultPathKey(raw) === targetNorm) {
        return true;
      }
    }
  }
  return false;
}

function wikilinkStemForNormalizedPath(targetNorm: string, files: VaultMarkdownFile[]): string {
  const file = files.find((f) => normalizeVaultPathKey(f.path) === targetNorm);
  if (!file) {
    const tail = targetNorm.split("/").pop() ?? "note";
    return tail.replace(/\.md$/i, "").trim() || "note";
  }
  const base = file.path.split("/").pop() ?? file.name;
  const stem = base
    .replace(/\.md$/i, "")
    .replace(/\s+-\s*\([^)]*\)\s*$/u, "")
    .trim();
  return stem || file.name;
}

/**
 * Ao apagar uma conversa, remove wikilinks e `vault_path` ANCC para ela e,
 * se tinha 2+ vizinhos no grafo, liga o primeiro vizinho (ordenado) aos restantes
 * para preservar a componente conexa entre conversas vizinhas.
 */
export function computeConversationDeletionMutations(
  allFiles: VaultMarkdownFile[],
  conversationPath: string,
): { pathToDelete: string; filesToWrite: VaultMarkdownFile[] } {
  const deletedNorm = normalizeVaultPathKey(conversationPath);
  const usable = allFiles.filter((f) => !isAnccModelMemoryVaultPath(f.path));
  const deletedFile = usable.find((f) => normalizeVaultPathKey(f.path) === deletedNorm);
  if (!deletedFile) {
    throw new Error("Conversation path is not a file in the vault.");
  }

  const graph = buildGraphFromMarkdownFiles(usable);
  const neighbors = new Set<string>();
  for (const e of graph.edges) {
    if (e.source === deletedNorm) {
      neighbors.add(e.target);
    } else if (e.target === deletedNorm) {
      neighbors.add(e.source);
    }
  }

  const pathToDelete = deletedFile.path;
  const byNorm = new Map<string, string>();
  for (const f of usable) {
    if (normalizeVaultPathKey(f.path) === deletedNorm) {
      continue;
    }
    let next = f.content;
    next = stripVaultPathLinesToTarget(next, deletedNorm);
    next = removeWikilinksResolvingToTarget(next, deletedNorm, usable);
    byNorm.set(normalizeVaultPathKey(f.path), next);
  }

  const sortedNeighbors = [...neighbors].sort();
  if (sortedNeighbors.length >= 2) {
    const anchorNorm = sortedNeighbors[0]!;
    let anchorContent = byNorm.get(anchorNorm);
    if (anchorContent === undefined) {
      const anchorFile = usable.find((u) => normalizeVaultPathKey(u.path) === anchorNorm);
      anchorContent = anchorFile?.content ?? "";
      byNorm.set(anchorNorm, anchorContent);
    }
    let updated = anchorContent;
    for (const other of sortedNeighbors.slice(1)) {
      if (!markdownLinksToNormalizedTarget(updated, other, usable)) {
        const stem = wikilinkStemForNormalizedPath(other, usable);
        updated = `${updated.trimEnd()}\n\n[[${stem}]]\n`;
      }
    }
    byNorm.set(anchorNorm, updated);
  }

  const filesToWrite: VaultMarkdownFile[] = [];
  for (const f of usable) {
    const k = normalizeVaultPathKey(f.path);
    if (k === deletedNorm) {
      continue;
    }
    const next = byNorm.get(k);
    if (next === undefined || next === f.content) {
      continue;
    }
    filesToWrite.push({
      ...f,
      content: next,
    });
  }

  return { pathToDelete, filesToWrite };
}
