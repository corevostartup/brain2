import { promises as fs } from "node:fs";
import path from "node:path";
import type { FolderTreeNode, VaultConversation, VaultGraph } from "@/lib/vault";
import {
  isCentralBrainHubMarkdownPath,
  VAULT_LOOSE_MEMORIES_FOLDER_NAME,
  VAULT_MEMORIES_FOLDER_NOTE_BASENAME,
} from "@/lib/brain2CentralFolder";
import {
  buildConversationsFromMarkdownFiles,
  buildGraphFromMarkdownFiles,
  type VaultMarkdownFile,
} from "@/lib/vaultMarkdown";
import { ANCC_MODEL_MEMORY_FOLDER } from "@/lib/anccModelMemory";

export let PRESET_VAULT_PATH =
  "/Users/Cassio/Library/Mobile Documents/com~apple~CloudDocs/Brain2/Vault";

const WIKILINK_REGEX = /\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*?)?\]\]/g;

function normalizeRelativePath(relativePath: string): string {
  return relativePath
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join(path.sep);
}

function resolvePresetPath(relativePath: string): string {
  const rootPath = path.resolve(PRESET_VAULT_PATH);
  const normalized = normalizeRelativePath(relativePath);
  const resolvedPath = path.resolve(rootPath, normalized);

  if (resolvedPath === rootPath) {
    return resolvedPath;
  }

  if (!resolvedPath.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error("Invalid folder path.");
  }

  return resolvedPath;
}

function validateFolderName(folderName: string): string {
  const trimmed = folderName.trim();
  if (!trimmed) {
    throw new Error("Folder name is required.");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error("Invalid folder name.");
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error("Folder name must not contain path separators.");
  }
  return trimmed;
}

function normalizeConversationPath(conversationPath: string): string {
  const normalized = normalizeRelativePath(conversationPath);
  if (!normalized) {
    throw new Error("Conversation path is required.");
  }
  return normalized.endsWith(".md") ? normalized : `${normalized}.md`;
}

function validateConversationTitle(newTitle: string): string {
  const trimmed = newTitle.trim();
  if (!trimmed) {
    throw new Error("Conversation title is required.");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error("Invalid conversation title.");
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error("Conversation title must not contain path separators.");
  }
  return trimmed;
}

function sanitizeFileSegment(raw: string, fallback: string): string {
  const sanitized = raw
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || fallback;
}

function formatConversationFileTitle(raw: string): string {
  const cleaned = raw
    .replace(/[._-]+/g, " ")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "Conversation";
  }

  return cleaned
    .split(" ")
    .map((word) => {
      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWikilinkTarget(markdown: string, target: string): boolean {
  const escapedTarget = escapeRegex(target.trim());
  if (!escapedTarget) {
    return false;
  }

  const wikilinkRegex = new RegExp(`\\[\\[\\s*${escapedTarget}(?:\\s*(?:\\]\\]|#|\\|))`, "i");
  return wikilinkRegex.test(markdown);
}

function insertFolderCorrelationWikilinkInMetadata(markdown: string, folderName: string): string {
  if (hasWikilinkTarget(markdown, folderName)) {
    return markdown;
  }

  const correlationLine = `- Correlation: [[${folderName}]]`;
  const lines = markdown.split(/\r?\n/);

  const modelLineIndex = lines.findIndex((line) => /^-\s*Model\s*:/i.test(line.trim()));
  if (modelLineIndex >= 0) {
    lines.splice(modelLineIndex + 1, 0, correlationLine);
    return lines.join("\n");
  }

  const firstMetadataIndex = lines.findIndex((line) => line.trim().startsWith("- "));
  if (firstMetadataIndex >= 0) {
    let insertIndex = firstMetadataIndex;
    while (insertIndex < lines.length && lines[insertIndex].trim().startsWith("- ")) {
      insertIndex += 1;
    }
    lines.splice(insertIndex, 0, correlationLine);
    return lines.join("\n");
  }

  if (lines.length > 0 && lines[0].trim().startsWith("#")) {
    const insertIndex = lines[1]?.trim() === "" ? 2 : 1;
    lines.splice(insertIndex, 0, correlationLine);
    return lines.join("\n");
  }

  return `${correlationLine}\n${markdown}`;
}

async function readMarkdownFileOrEmpty(fileAbsolutePath: string): Promise<string> {
  try {
    const stats = await fs.stat(fileAbsolutePath);
    if (!stats.isFile()) {
      throw new Error("Folder correlation target is not a file.");
    }

    return await fs.readFile(fileAbsolutePath, "utf8");
  } catch (error) {
    const errno = error as { code?: string };
    if (errno.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function ensureMarkdownCorrelationWikilink(fileAbsolutePath: string, targetFolderName: string): Promise<void> {
  const existingMarkdown = await readMarkdownFileOrEmpty(fileAbsolutePath);
  const nextMarkdown = insertFolderCorrelationWikilinkInMetadata(existingMarkdown, targetFolderName);
  const normalizedNextMarkdown = nextMarkdown.endsWith("\n") ? nextMarkdown : `${nextMarkdown}\n`;

  await fs.writeFile(fileAbsolutePath, normalizedNextMarkdown, "utf8");
}

/** Mesmo nome que `brain2-central-brain-folder-name` (ficheiro opcional na raiz do preset). */
async function readPresetCentralBrainFolderName(): Promise<string | null> {
  try {
    const markerPath = path.join(PRESET_VAULT_PATH, ".brain2-central-folder-name");
    const text = await fs.readFile(markerPath, "utf8");
    const line = text.split(/\r?\n/u)[0]?.trim();
    return line && line.length > 0 ? line : null;
  } catch {
    return null;
  }
}

/** Garante `Memories/Memories.md` com wikilink à pasta-central (ficheiro `.brain2-central-folder-name`). */
async function ensureMemoriesFolderHubMarkdownIfNeeded(): Promise<void> {
  const memoriesDir = path.join(PRESET_VAULT_PATH, VAULT_LOOSE_MEMORIES_FOLDER_NAME);
  try {
    const st = await fs.stat(memoriesDir);
    if (!st.isDirectory()) {
      return;
    }
  } catch {
    return;
  }
  const memoriesMd = path.join(memoriesDir, VAULT_MEMORIES_FOLDER_NOTE_BASENAME);
  try {
    await fs.access(memoriesMd);
  } catch {
    await fs.writeFile(memoriesMd, "", "utf8");
  }
  const central = await readPresetCentralBrainFolderName();
  if (!central) {
    return;
  }
  await ensureMarkdownCorrelationWikilink(memoriesMd, central);
}

async function readFolderTreeFromPath(
  dirPath: string,
  depth = 0,
  centralName: string | null = null,
): Promise<FolderTreeNode[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const folders: FolderTreeNode[] = [];
  const central = centralName?.trim() ?? "";

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (depth === 0) {
        if (central && entry.name.localeCompare(central, undefined, { sensitivity: "base" }) === 0) {
          continue;
        }
        if (
          entry.name.localeCompare(VAULT_LOOSE_MEMORIES_FOLDER_NAME, undefined, {
            sensitivity: "base",
          }) === 0
        ) {
          continue;
        }
      }
      try {
        const children = await readFolderTreeFromPath(fullPath, depth + 1, centralName);
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

async function readAllMarkdownFilesFromPath(
  dirPath: string,
  basePath = ""
): Promise<VaultMarkdownFile[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files: VaultMarkdownFile[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      try {
        const nested = await readAllMarkdownFilesFromPath(fullPath, relativePath);
        files.push(...nested);
      } catch {
        // Skip unreadable subdirectories.
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      try {
        const [content, stat] = await Promise.all([
          fs.readFile(fullPath, "utf8"),
          fs.stat(fullPath),
        ]);
        files.push({
          name: entry.name.replace(/\.md$/, ""),
          path: relativePath,
          content,
          modifiedAt: stat.mtimeMs,
        });
      } catch {
        // Skip unreadable markdown files.
      }
    }
  }

  return files;
}

export async function getPresetVaultData(): Promise<{
  path: string;
  folders: FolderTreeNode[];
  graph: VaultGraph;
  conversations: VaultConversation[];
  /** Nome da pasta-central (ficheiro `.brain2-central-folder-name` na raiz do preset). */
  centralBrainFolderName: string | null;
}> {
  const centralBrainFolderName = await readPresetCentralBrainFolderName();
  const folders = await readFolderTreeFromPath(PRESET_VAULT_PATH, 0, centralBrainFolderName);
  const rawMarkdownFiles = await readAllMarkdownFilesFromPath(PRESET_VAULT_PATH);
  const markdownFilesForConversations = rawMarkdownFiles.filter(
    (f) => !isCentralBrainHubMarkdownPath(f.path, centralBrainFolderName),
  );
  const graph = buildGraphFromMarkdownFiles(rawMarkdownFiles);
  const conversations = buildConversationsFromMarkdownFiles(markdownFilesForConversations);

  return {
    path: PRESET_VAULT_PATH,
    folders,
    graph,
    conversations,
    centralBrainFolderName,
  };
}

export async function renamePresetVault(vaultName: string): Promise<void> {
  const safeVaultName = validateFolderName(vaultName);
  const currentRootPath = path.resolve(PRESET_VAULT_PATH);
  const currentStats = await fs.stat(currentRootPath);

  if (!currentStats.isDirectory()) {
    throw new Error("Preset vault root is not a directory.");
  }

  const parentPath = path.dirname(currentRootPath);
  const nextRootPath = path.resolve(parentPath, safeVaultName);

  if (path.dirname(nextRootPath) !== parentPath) {
    throw new Error("Invalid vault name.");
  }

  if (nextRootPath === currentRootPath) {
    return;
  }

  try {
    await fs.access(nextRootPath);
    throw new Error("A vault with this name already exists.");
  } catch (error) {
    const errno = error as { code?: string };
    if (errno.code && errno.code !== "ENOENT") {
      throw error;
    }
  }

  await fs.rename(currentRootPath, nextRootPath);
  PRESET_VAULT_PATH = nextRootPath;
}

/**
 * Grava nota de memória própria do assistente (ANCC) no vault preset.
 * Caminho relativo: `_Brain2/ANCC_Model_Memory/<fileBase>.md` — excluído do grafo «Your Brain».
 */
export async function saveAnccModelMemoryPresetFile(markdown: string, fileBase: string): Promise<void> {
  if (!markdown.trim()) {
    throw new Error("Markdown is required.");
  }
  const safe = sanitizeFileSegment(fileBase || "memory", "memory");
  const relativePath = `${ANCC_MODEL_MEMORY_FOLDER}/${safe}.md`;
  const absolutePath = resolvePresetPath(relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const normalized = markdown.endsWith("\n") ? markdown : `${markdown}\n`;
  await fs.writeFile(absolutePath, normalized, "utf8");
}

export async function savePresetConversation(
  conversationId: string,
  title: string,
  markdown: string,
  folderPath?: string
): Promise<void> {
  if (!markdown.trim()) {
    throw new Error("Conversation markdown is required.");
  }

  const safeConversationId = sanitizeFileSegment(
    conversationId || `chat-${Date.now().toString(36)}`,
    "conversation"
  );
  const formattedTitle = formatConversationFileTitle(title || "conversation");

  const normalizedFolderPath = normalizeRelativePath(folderPath ?? "");
  const targetFolderRelativePath = normalizedFolderPath || VAULT_LOOSE_MEMORIES_FOLDER_NAME;
  const targetFolderAbsolutePath = resolvePresetPath(targetFolderRelativePath);
  await fs.mkdir(targetFolderAbsolutePath, { recursive: true });
  await ensureMemoriesFolderHubMarkdownIfNeeded();

  let markdownToPersist = markdown;
  const pathForCorrelation = normalizedFolderPath || VAULT_LOOSE_MEMORIES_FOLDER_NAME;
  if (pathForCorrelation) {
    const folderName = path.basename(pathForCorrelation);
    if (folderName) {
      const folderCorrelationRelativePath = `${pathForCorrelation}/${folderName}.md`;
      const folderCorrelationAbsolutePath = resolvePresetPath(folderCorrelationRelativePath);

      try {
        const folderCorrelationStats = await fs.stat(folderCorrelationAbsolutePath);
        if (!folderCorrelationStats.isFile()) {
          throw new Error("Folder correlation target is not a file.");
        }
      } catch {
        // Ensure mandatory folder-correlation file exists.
        await fs.writeFile(folderCorrelationAbsolutePath, "", "utf8");
      }

      markdownToPersist = insertFolderCorrelationWikilinkInMetadata(markdown, folderName);
    }
  }

  const filename = `${formattedTitle} - (${safeConversationId}).md`;
  const fileAbsolutePath = resolvePresetPath(`${targetFolderRelativePath}/${filename}`);
  const conversationFileMetadataSuffix = ` - (${safeConversationId}).md`;
  const conversationFileSuffix = `--${safeConversationId}.md`;
  const legacyConversationFilePrefix = `${safeConversationId}-`;

  const folderEntries = await fs.readdir(targetFolderAbsolutePath, { withFileTypes: true });
  const existingConversationFileName = folderEntries.find((entry) =>
    entry.isFile() &&
    entry.name !== filename &&
    entry.name.endsWith(".md") &&
    (
      entry.name.endsWith(conversationFileMetadataSuffix) ||
      entry.name.endsWith(conversationFileSuffix) ||
      entry.name.startsWith(legacyConversationFilePrefix)
    )
  )?.name;

  if (existingConversationFileName && existingConversationFileName !== filename) {
    const existingConversationAbsolutePath = resolvePresetPath(
      `${targetFolderRelativePath}/${existingConversationFileName}`
    );

    await fs.rm(fileAbsolutePath, { force: true });
    await fs.rename(existingConversationAbsolutePath, fileAbsolutePath);
  }

  const normalizedMarkdown = markdownToPersist.endsWith("\n") ? markdownToPersist : `${markdownToPersist}\n`;

  await fs.writeFile(fileAbsolutePath, normalizedMarkdown, "utf8");
}

export async function createPresetFolder(parentPath: string, folderName: string): Promise<void> {
  const safeFolderName = validateFolderName(folderName);
  const parentAbsolutePath = resolvePresetPath(parentPath);
  const normalizedParentPath = normalizeRelativePath(parentPath);

  const parentStats = await fs.stat(parentAbsolutePath);
  if (!parentStats.isDirectory()) {
    throw new Error("Parent path is not a directory.");
  }

  const nextFolderRelativePath = parentPath ? `${parentPath}/${safeFolderName}` : safeFolderName;
  const nextFolderAbsolutePath = resolvePresetPath(nextFolderRelativePath);

  await fs.mkdir(nextFolderAbsolutePath);

  const bootstrapConversationRelativePath = `${nextFolderRelativePath}/${safeFolderName}.md`;
  const bootstrapConversationAbsolutePath = resolvePresetPath(bootstrapConversationRelativePath);

  try {
    await fs.writeFile(bootstrapConversationAbsolutePath, "", "utf8");

    // Mandatory system rule: when creating a subfolder, correlate child and parent folder markdowns.
    if (normalizedParentPath) {
      const parentFolderName = path.basename(normalizedParentPath);
      if (parentFolderName) {
        const parentCorrelationRelativePath = `${normalizedParentPath}/${parentFolderName}.md`;
        const parentCorrelationAbsolutePath = resolvePresetPath(parentCorrelationRelativePath);

        await ensureMarkdownCorrelationWikilink(bootstrapConversationAbsolutePath, parentFolderName);
        await ensureMarkdownCorrelationWikilink(parentCorrelationAbsolutePath, safeFolderName);
      }
    }

    // Só na raiz do vault: irmãs da pasta-central ligam ao hub; subpastas (de irmãs ou outras) não.
    const centralHub = await readPresetCentralBrainFolderName();
    if (
      !normalizedParentPath &&
      centralHub &&
      safeFolderName.localeCompare(centralHub, undefined, { sensitivity: "base" }) !== 0
    ) {
      await ensureMarkdownCorrelationWikilink(bootstrapConversationAbsolutePath, centralHub);
    }
  } catch (error) {
    // Keep folder creation atomic for the caller: if bootstrap .md fails, rollback the folder.
    await fs.rm(nextFolderAbsolutePath, { recursive: true, force: true });
    throw error;
  }
}

export async function deletePresetFolder(folderPath: string): Promise<void> {
  const normalizedFolderPath = normalizeRelativePath(folderPath);
  if (!normalizedFolderPath) {
    throw new Error("Folder path is required.");
  }

  const targetAbsolutePath = resolvePresetPath(folderPath);
  const rootAbsolutePath = path.resolve(PRESET_VAULT_PATH);

  if (targetAbsolutePath === rootAbsolutePath) {
    throw new Error("Deleting the vault root is not allowed.");
  }

  const targetStats = await fs.stat(targetAbsolutePath);
  if (!targetStats.isDirectory()) {
    throw new Error("Target path is not a directory.");
  }

  await fs.rm(targetAbsolutePath, { recursive: true, force: false });
}

export async function renamePresetFolder(
  folderPath: string,
  newFolderName: string
): Promise<void> {
  const normalizedFolderPath = normalizeRelativePath(folderPath);
  if (!normalizedFolderPath) {
    throw new Error("Folder path is required.");
  }

  const safeFolderName = validateFolderName(newFolderName);
  const currentAbsolutePath = resolvePresetPath(normalizedFolderPath);
  const currentStats = await fs.stat(currentAbsolutePath);

  if (!currentStats.isDirectory()) {
    throw new Error("Folder path is not a directory.");
  }

  const rootAbsolutePath = path.resolve(PRESET_VAULT_PATH);
  if (currentAbsolutePath === rootAbsolutePath) {
    throw new Error("Renaming the vault root is not allowed.");
  }

  const parentRelativePath = path.dirname(normalizedFolderPath);
  const parentPathSegment = parentRelativePath === "." ? "" : parentRelativePath;
  const nextRelativePath = parentPathSegment
    ? `${parentPathSegment}/${safeFolderName}`
    : safeFolderName;
  const nextAbsolutePath = resolvePresetPath(nextRelativePath);

  if (nextAbsolutePath === currentAbsolutePath) {
    return;
  }

  try {
    await fs.access(nextAbsolutePath);
    throw new Error("A folder with this name already exists.");
  } catch (error) {
    const errno = error as { code?: string };
    if (errno.code && errno.code !== "ENOENT") {
      throw error;
    }
  }

  await fs.rename(currentAbsolutePath, nextAbsolutePath);

  // Regra Brain2 (ver `brain2CentralFolder.ts` na web): `NomeDaPasta/NomeDaPasta.md` na mesma pasta.
  const oldFolderName = path.basename(normalizedFolderPath);
  const correlationOld = path.join(nextAbsolutePath, `${oldFolderName}.md`);
  const correlationNew = path.join(nextAbsolutePath, `${safeFolderName}.md`);
  if (correlationOld === correlationNew) {
    return;
  }

  let correlationStats: Awaited<ReturnType<typeof fs.stat>>;
  try {
    correlationStats = await fs.stat(correlationOld);
  } catch (error) {
    const errno = error as { code?: string };
    if (errno.code === "ENOENT") {
      return;
    }
    throw error;
  }

  if (!correlationStats.isFile()) {
    return;
  }

  try {
    await fs.access(correlationNew);
    throw new Error(
      "Ja existe um ficheiro com o nome da nova pasta dentro da pasta."
    );
  } catch (error) {
    const errno = error as { code?: string };
    if (errno.code === "ENOENT") {
      await fs.rename(correlationOld, correlationNew);
      return;
    }
    throw error;
  }
}

export async function renamePresetConversation(
  conversationPath: string,
  newTitle: string
): Promise<void> {
  const normalizedConversationPath = normalizeConversationPath(conversationPath);
  const safeTitle = validateConversationTitle(newTitle);

  const currentAbsolutePath = resolvePresetPath(normalizedConversationPath);
  const currentStats = await fs.stat(currentAbsolutePath);
  if (!currentStats.isFile()) {
    throw new Error("Conversation path is not a file.");
  }

  const parentRelativePath = path.dirname(normalizedConversationPath);
  const parentPathSegment = parentRelativePath === "." ? "" : parentRelativePath;
  const nextRelativePath = parentPathSegment
    ? `${parentPathSegment}/${safeTitle}.md`
    : `${safeTitle}.md`;
  const nextAbsolutePath = resolvePresetPath(nextRelativePath);

  if (nextAbsolutePath === currentAbsolutePath) {
    return;
  }

  try {
    await fs.access(nextAbsolutePath);
    throw new Error("A conversation with this name already exists.");
  } catch (error) {
    const errno = error as { code?: string };
    if (errno.code && errno.code !== "ENOENT") {
      throw error;
    }
  }

  await fs.rename(currentAbsolutePath, nextAbsolutePath);
}

export async function deletePresetConversation(conversationPath: string): Promise<void> {
  const normalizedConversationPath = normalizeConversationPath(conversationPath);
  const targetAbsolutePath = resolvePresetPath(normalizedConversationPath);
  const targetStats = await fs.stat(targetAbsolutePath);

  if (!targetStats.isFile()) {
    throw new Error("Conversation path is not a file.");
  }

  await fs.rm(targetAbsolutePath, { force: false });
}
