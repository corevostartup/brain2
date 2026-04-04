// ── Vault service: File System Access API + Obsidian wikilink parser ──

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
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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

// ── Folder tree type ──

export type FolderTreeNode = {
  name: string;
  children: FolderTreeNode[];
};

// ── Read folder tree (directories only) from a directory handle ──

export async function readFolderTree(
  dirHandle: FileSystemDirectoryHandle
): Promise<FolderTreeNode[]> {
  const folders: FolderTreeNode[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const entry of (dirHandle as any).values() as AsyncIterable<FileSystemHandle>) {
    if (entry.kind === "directory" && !entry.name.startsWith(".")) {
      try {
        const children = await readFolderTree(entry as FileSystemDirectoryHandle);
        folders.push({ name: entry.name, children });
      } catch {
        folders.push({ name: entry.name, children: [] });
      }
    }
  }

  folders.sort((a, b) => a.name.localeCompare(b.name));
  return folders;
}

// ── Read all .md files recursively from a directory handle ──

async function readAllMarkdownFiles(
  dirHandle: FileSystemDirectoryHandle,
  basePath = ""
): Promise<{ name: string; path: string; content: string }[]> {
  const files: { name: string; path: string; content: string }[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const entry of (dirHandle as any).values() as AsyncIterable<FileSystemHandle>) {
    const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.kind === "file" && entry.name.endsWith(".md")) {
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
          entryPath
        );
        files.push(...subFiles);
      } catch {
        // Skip unreadable directories
      }
    }
  }

  return files;
}

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
  const files = await readAllMarkdownFiles(dirHandle);

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
