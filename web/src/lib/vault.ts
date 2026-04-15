// ── Vault service: File System Access API + Obsidian wikilink parser ──

import {
  ensureCentralBrainFolderOnDirectoryHandle,
  isCentralBrainHubMarkdownPath,
  loadCentralBrainNameFromStorage,
} from "./brain2CentralFolder";

export type VaultNode = {
  id: string;
  label: string;
};

export type VaultEdge = {
  source: string;
  target: string;
};

export type VaultGraph = {
  nodes: VaultNode[];
  edges: VaultEdge[];
};

export type VaultConversation = {
  id: string;
  title: string;
  path: string;
  modifiedAt: number;
  content: string;
};

/**
 * Nome apresentável: remove sufixos de ficheiro Brain2 (` - (id)` ou legado `--id`).
 * Os dados internos (id, path) mantêm o nome completo do ficheiro.
 */
export function formatConversationDisplayTitle(raw: string): string {
  let s = raw.trim();
  if (!s) {
    return "";
  }
  s = s.replace(/\s+-\s*\([^)]*\)\s*$/u, "").trim();
  s = s.replace(/\s+--[a-z0-9-]+\s*$/iu, "").trim();
  return s;
}

const DB_NAME = "brain2-vault";
const STORE_NAME = "handles";
const HANDLE_KEY = "vaultDirHandle";
const PATH_KEY = "brain2-vault-path";

// ── localStorage for vault path string ──

export function saveVaultPath(path: string): void {
  localStorage.setItem(PATH_KEY, path);
}

export function loadVaultPath(): string | null {
  return localStorage.getItem(PATH_KEY);
}

export function clearVaultPath(): void {
  localStorage.removeItem(PATH_KEY);
}

// ── IndexedDB helpers for persisting FileSystemDirectoryHandle ──

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDirectoryHandle(
  handle: FileSystemDirectoryHandle
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const stored = loadCentralBrainNameFromStorage();
  if (stored?.trim()) {
    try {
      await ensureCentralBrainFolderOnDirectoryHandle(handle, stored);
    } catch {
      /* não bloquear: o utilizador pode criar a pasta-central depois no Mac ou nas definições */
    }
  }
}

export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function clearDirectoryHandle(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
  } catch {
    // ignore
  }
  clearVaultPath();
}

// ── Pick a directory via File System Access API ──

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle = await (window as any).showDirectoryPicker({ mode: "read" });
    return handle as FileSystemDirectoryHandle;
  } catch {
    // User cancelled
    return null;
  }
}

// ── Verify permission (needed after page reload) ──

export async function verifyPermission(
  handle: FileSystemDirectoryHandle
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts = { mode: "read" } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((await (handle as any).queryPermission(opts)) === "granted") return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((await (handle as any).requestPermission(opts)) === "granted") return true;
  return false;
}

/** Necessário para criar ficheiros no vault (ex.: memórias ANCC do modelo). */
export async function verifyWritePermission(
  handle: FileSystemDirectoryHandle
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts = { mode: "readwrite" } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((await (handle as any).queryPermission(opts)) === "granted") return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((await (handle as any).requestPermission(opts)) === "granted") return true;
  return false;
}

// ── Folder tree type ──

export type FolderTreeNode = {
  name: string;
  kind: "folder" | "file";
  children: FolderTreeNode[];
};

// ── Read folder tree (directories + .md files) from a directory handle ──

export async function readFolderTree(
  dirHandle: FileSystemDirectoryHandle,
  depth = 0,
  hiddenRootFolderName: string | null = loadCentralBrainNameFromStorage(),
): Promise<FolderTreeNode[]> {
  const folders: FolderTreeNode[] = [];
  const files: FolderTreeNode[] = [];
  const hidden = hiddenRootFolderName?.trim() ?? "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const entry of (dirHandle as any).values() as AsyncIterable<FileSystemHandle>) {
    if (entry.kind === "directory" && !entry.name.startsWith(".")) {
      if (
        depth === 0 &&
        hidden.length > 0 &&
        entry.name.localeCompare(hidden, undefined, { sensitivity: "base" }) === 0
      ) {
        continue;
      }
      try {
        const children = await readFolderTree(
          entry as FileSystemDirectoryHandle,
          depth + 1,
          hiddenRootFolderName,
        );
        folders.push({ name: entry.name, kind: "folder", children });
      } catch {
        folders.push({ name: entry.name, kind: "folder", children: [] });
      }
    } else if (entry.kind === "file" && entry.name.endsWith(".md")) {
      files.push({ name: entry.name.replace(/\.md$/, ""), kind: "file", children: [] });
    }
  }

  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return [...folders, ...files];
}

// ── Read all .md files recursively from a directory handle ──

async function readAllMarkdownFiles(
  dirHandle: FileSystemDirectoryHandle,
  basePath = "",
  centralName: string | null = loadCentralBrainNameFromStorage(),
): Promise<{ name: string; path: string; content: string }[]> {
  const files: { name: string; path: string; content: string }[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const entry of (dirHandle as any).values() as AsyncIterable<FileSystemHandle>) {
    const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.kind === "file" && entry.name.endsWith(".md")) {
      if (isCentralBrainHubMarkdownPath(entryPath, centralName)) {
        continue;
      }
      try {
        const fileHandle = entry as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        const content = await file.text();
        // Strip .md extension for the display name
        const name = entry.name.replace(/\.md$/, "");
        files.push({ name, path: entryPath, content });
      } catch {
        // Skip unreadable files
      }
    } else if (entry.kind === "directory" && !entry.name.startsWith(".")) {
      // Recurse into subdirectories (skip hidden dirs like .obsidian, .trash)
      try {
        const subFiles = await readAllMarkdownFiles(
          entry as FileSystemDirectoryHandle,
          entryPath,
          centralName,
        );
        files.push(...subFiles);
      } catch {
        // Skip unreadable directories
      }
    }
  }

  return files;
}

import { isAnccModelMemoryVaultPath } from "@/lib/anccModelMemory";

// ── Parse Obsidian-style [[wikilinks]] from markdown content ──

const WIKILINK_REGEX = /\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*?)?\]\]/g;

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

// ── Build graph from vault directory ──

export async function buildGraphFromVault(
  dirHandle: FileSystemDirectoryHandle
): Promise<VaultGraph> {
  const files = (await readAllMarkdownFiles(dirHandle)).filter(
    (f) => !isAnccModelMemoryVaultPath(f.path)
  );

  // Build node map: key = lowercase name, value = display name
  const nodeMap = new Map<string, string>();
  for (const f of files) {
    nodeMap.set(f.name.toLowerCase(), f.name);
  }

  // Build nodes
  const nodes: VaultNode[] = [];
  for (const [, label] of nodeMap) {
    nodes.push({
      id: label.toLowerCase(),
      label,
    });
  }

  // Build edges from wikilinks
  const edgeSet = new Set<string>();
  const edges: VaultEdge[] = [];

  for (const f of files) {
    const sourceId = f.name.toLowerCase();
    const links = parseWikilinks(f.content);

    for (const link of links) {
      const targetId = link.toLowerCase();

      // Only create edge if target file exists in vault
      if (!nodeMap.has(targetId)) {
        // Create an "orphan" node for the link target (it's referenced but doesn't exist)
        if (!nodeMap.has(targetId)) {
          nodeMap.set(targetId, link);
          nodes.push({ id: targetId, label: link });
        }
      }

      // Deduplicate edges (A→B = B→A)
      const edgeKey =
        sourceId < targetId
          ? `${sourceId}::${targetId}`
          : `${targetId}::${sourceId}`;

      if (!edgeSet.has(edgeKey) && sourceId !== targetId) {
        edgeSet.add(edgeKey);
        edges.push({ source: sourceId, target: targetId });
      }
    }
  }

  return { nodes, edges };
}
