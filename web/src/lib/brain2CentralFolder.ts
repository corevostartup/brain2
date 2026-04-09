/**
 * Regra geral Brain2 (web, shell nativo, futuros dispositivos):
 * na raiz do diretório do vault escolhido, criar a pasta-central `Nome/`
 * e dentro o ficheiro `Nome.md` com o mesmo nome.
 *
 * Isto é o eixo onde as pastas na raiz se ligam ao «cérebro».
 *
 * API preset (vaultServer): ficheiro opcional na raiz do vault `.brain2-central-folder-name`
 * (uma linha = nome da pasta-central). O wikilink ao hub só é escrito em `Nome/Nome.md` ao criar
 * pastas na raiz do vault (irmãs da pasta-central), não em subpastas.
 *
 * Pasta `Memories` (raiz do vault):
 * - Criada automaticamente pelo Brain2; conversas sem pasta ficam em `Memories/`.
 * - Oculta no menu lateral (como a pasta-central).
 * - Dentro existe `Memories/Memories.md` com metadados a apontar para `Nome-da-pasta-central.md` (hub).
 * - Cada conversa nova em `Memories/` é um ficheiro `.md` à parte; a correlação pasta↔`Pasta.md`
 *   aplica-se também a `Memories` e `Memories.md` (como nas outras pastas).
 */

/** Pasta na raiz do vault para conversas sem pasta selecionada. */
export const VAULT_LOOSE_MEMORIES_FOLDER_NAME = "Memories";

/** Ficheiro `Memories/Memories.md` (nome igual ao da pasta). */
export const VAULT_MEMORIES_FOLDER_NOTE_BASENAME = `${VAULT_LOOSE_MEMORIES_FOLDER_NAME}.md`;

export const BRAIN2_CENTRAL_BRAIN_NAME_KEY = "brain2-central-brain-folder-name";

export function sanitizeCentralBrainFolderName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") {
    throw new Error("O nome da pasta-central é obrigatório.");
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error("O nome não pode conter / nem \\.");
  }
  return trimmed;
}

export function defaultCentralBrainMarkdown(displayName: string): string {
  return `# ${displayName}

Pasta-central do teu cérebro no Brain2. As pastas na raiz ligam-se a este nome.

`;
}

export function saveCentralBrainNameToStorage(name: string): void {
  try {
    localStorage.setItem(BRAIN2_CENTRAL_BRAIN_NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

export function loadCentralBrainNameFromStorage(): string | null {
  try {
    return localStorage.getItem(BRAIN2_CENTRAL_BRAIN_NAME_KEY);
  } catch {
    return null;
  }
}

/** Caminho relativo `Nome/Nome.md` da pasta-central (eixo); não deve aparecer no menu lateral nem como conversa. */
export function isCentralBrainHubMarkdownPath(
  relativePath: string,
  centralName: string | null | undefined,
): boolean {
  const c = centralName?.trim();
  if (!c) return false;
  const norm = relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const expected = `${c}/${c}.md`;
  return norm.localeCompare(expected, undefined, { sensitivity: "base" }) === 0;
}

/** Pasta na raiz do vault com o nome da pasta-central — oculta no menu lateral (como `Memories`). */
export function shouldHideRootVaultFolderName(
  folderName: string,
  centralName: string | null | undefined,
): boolean {
  const c = centralName?.trim();
  if (!c) return false;
  return folderName.localeCompare(c, undefined, { sensitivity: "base" }) === 0;
}

/**
 * Garante `rootHandle/Nome/` e `rootHandle/Nome/Nome.md` (File System Access API).
 */
export async function ensureCentralBrainFolderOnDirectoryHandle(
  rootHandle: FileSystemDirectoryHandle,
  rawName: string,
): Promise<{ folderName: string }> {
  const folderName = sanitizeCentralBrainFolderName(rawName);
  const dirHandle = await rootHandle.getDirectoryHandle(folderName, { create: true });
  const fileName = `${folderName}.md`;
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const file = await fileHandle.getFile();
  const writable = await fileHandle.createWritable({ keepExistingData: true });
  try {
    if (file.size === 0) {
      await writable.write(defaultCentralBrainMarkdown(folderName));
    }
  } finally {
    await writable.close();
  }
  saveCentralBrainNameToStorage(folderName);
  return { folderName };
}
