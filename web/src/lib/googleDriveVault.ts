import type { FolderTreeNode, VaultConversation, VaultGraph } from "@/lib/vault";
import {
  buildConversationsFromMarkdownFiles,
  buildGraphFromMarkdownFiles,
  type VaultMarkdownFile,
} from "@/lib/vaultMarkdown";

const FOLDER_MIME = "application/vnd.google-apps.folder";

type DriveListFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
};

type DriveListResponse = {
  files?: DriveListFile[];
  nextPageToken?: string;
};

async function listFolderChildren(folderId: string, accessToken: string): Promise<DriveListFile[]> {
  const all: DriveListFile[] = [];
  let pageToken: string | undefined;

  const escapedId = folderId.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = `'${escapedId}' in parents and trashed=false`;

  do {
    const params = new URLSearchParams({
      q,
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime)",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error("Falha ao listar conteudo da pasta no Google Drive.");
    }

    const data = (await response.json()) as DriveListResponse;
    all.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return all;
}

async function downloadDriveFileText(fileId: string, accessToken: string): Promise<string> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("alt", "media");
  url.searchParams.set("supportsAllDrives", "true");

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error("Falha ao baixar arquivo do Google Drive.");
  }

  return response.text();
}

function buildFolderTreeFromMarkdownPaths(relativePaths: string[]): FolderTreeNode[] {
  const root: FolderTreeNode[] = [];

  function findOrCreateFolder(nodes: FolderTreeNode[], name: string): FolderTreeNode {
    let folder = nodes.find((n) => n.kind === "folder" && n.name === name);
    if (!folder) {
      folder = { name, kind: "folder", children: [] };
      nodes.push(folder);
    }
    return folder;
  }

  for (const filePath of relativePaths) {
    const normalized = filePath.replace(/\\/g, "/");
    const segments = normalized.split("/").filter(Boolean);
    if (segments.length === 0) {
      continue;
    }

    const folderParts = segments.length > 1 ? segments.slice(0, -1) : [];
    let level = root;
    for (const part of folderParts) {
      const folder = findOrCreateFolder(level, part);
      level = folder.children;
    }
  }

  function sortTree(nodes: FolderTreeNode[]): FolderTreeNode[] {
    const folders = nodes
      .filter((n) => n.kind === "folder")
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    const files = nodes
      .filter((n) => n.kind === "file")
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return [
      ...folders.map((f) => ({ ...f, children: sortTree(f.children) })),
      ...files,
    ];
  }

  return sortTree(root);
}

async function walkDriveFolder(
  folderId: string,
  basePath: string,
  accessToken: string,
  out: VaultMarkdownFile[]
): Promise<void> {
  const children = await listFolderChildren(folderId, accessToken);

  for (const child of children) {
    const id = child.id;
    const name = String(child.name ?? "").trim();
    if (!id || !name || name.startsWith(".")) {
      continue;
    }

    if (child.mimeType === FOLDER_MIME) {
      const nextBase = basePath ? `${basePath}/${name}` : name;
      await walkDriveFolder(id, nextBase, accessToken, out);
      continue;
    }

    if (!name.toLowerCase().endsWith(".md")) {
      continue;
    }

    const relativePath = basePath ? `${basePath}/${name}` : name;
    const displayName = name.replace(/\.md$/i, "");
    let modifiedAt = Date.now();
    if (child.modifiedTime) {
      const parsed = Date.parse(child.modifiedTime);
      if (!Number.isNaN(parsed)) {
        modifiedAt = parsed;
      }
    }

    try {
      const content = await downloadDriveFileText(id, accessToken);
      out.push({
        name: displayName,
        path: relativePath,
        content,
        modifiedAt,
      });
    } catch {
      // ignora .md ilegivel
    }
  }
}

export type GoogleDriveVaultData = {
  path: string;
  folders: FolderTreeNode[];
  conversations: VaultConversation[];
  graph: VaultGraph;
};

/** Carrega arvore, conversas e grafo a partir da pasta raiz no Google Drive (somente leitura). */
export async function loadVaultFromGoogleDriveFolder(
  rootFolderId: string,
  accessToken: string,
  displayLabel: string
): Promise<GoogleDriveVaultData> {
  const trimmedRoot = rootFolderId.trim();
  if (!trimmedRoot) {
    throw new Error("ID da pasta do Google Drive invalido.");
  }

  const markdownFiles: VaultMarkdownFile[] = [];
  await walkDriveFolder(trimmedRoot, "", accessToken, markdownFiles);

  const folders = buildFolderTreeFromMarkdownPaths(markdownFiles.map((f) => f.path));
  const conversations = buildConversationsFromMarkdownFiles(markdownFiles);
  const graph = buildGraphFromMarkdownFiles(markdownFiles);

  const pathLabel = displayLabel.trim()
    ? `Google Drive: ${displayLabel.trim()}`
    : `Google Drive (${trimmedRoot.slice(0, 12)}…)`;

  return {
    path: pathLabel,
    folders,
    conversations,
    graph,
  };
}
