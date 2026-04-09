/**
 * Regra geral Brain2 (web, shell nativo, futuros dispositivos):
 * na raiz do diretório do vault escolhido, criar a pasta-central `Nome/`
 * e dentro o ficheiro `Nome.md` com o mesmo nome.
 *
 * Isto é o eixo onde as pastas na raiz se ligam ao «cérebro».
 */

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
