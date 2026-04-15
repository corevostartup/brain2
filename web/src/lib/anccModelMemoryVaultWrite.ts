/**
 * Escreve uma nota de memória ANCC do modelo no vault local (File System Access API).
 * Pasta: `_Brain2/ANCC_Model_Memory/` (alinhada com `ANCC_MODEL_MEMORY_FOLDER`).
 */

import { ANCC_MODEL_MEMORY_FOLDER } from "@/lib/anccModelMemory";

export async function writeAnccModelMemoryToBrowserVault(
  rootHandle: FileSystemDirectoryHandle,
  markdown: string,
  fileBase: string
): Promise<void> {
  const segments = ANCC_MODEL_MEMORY_FOLDER.split("/").filter(Boolean);
  let dir: FileSystemDirectoryHandle = rootHandle;
  for (const seg of segments) {
    dir = await dir.getDirectoryHandle(seg, { create: true });
  }
  const safe = fileBase
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/--+/g, "-")
    .slice(0, 120) || "memory";
  const fileHandle = await dir.getFileHandle(`${safe}.md`, { create: true });
  const writable = await fileHandle.createWritable();
  const body = markdown.endsWith("\n") ? markdown : `${markdown}\n`;
  await writable.write(body);
  await writable.close();
}
