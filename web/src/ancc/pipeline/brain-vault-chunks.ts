import { splitTextIntoChunks } from "@/ancc/pipeline/text-chunks";

/**
 * Formato típico de conversa Brain2 no vault (`buildVaultConversationMarkdown`):
 * `## User — …` / `## Brain2 — …` — recortar por turnos melhora embeddings e excertos.
 */
function extractDialogueSections(markdownBody: string): string[] | null {
  const t = markdownBody.replace(/\r\n/g, "\n").trim();
  if (!t || !/^##\s*(User|Brain2)\b/im.test(t)) {
    return null;
  }

  const indices: number[] = [];
  let m: RegExpExecArray | null;
  const re = /^##\s*(User|Brain2)\b[^\n]*/gim;
  while ((m = re.exec(t)) !== null) {
    indices.push(m.index);
  }
  if (indices.length === 0) {
    return null;
  }

  const sections: string[] = [];
  const preamble = t.slice(0, indices[0]).trim();
  if (preamble.length > 60) {
    sections.push(preamble);
  }

  for (let i = 0; i < indices.length; i += 1) {
    const start = indices[i];
    const end = i + 1 < indices.length ? indices[i + 1] : t.length;
    const block = t.slice(start, end).trim();
    if (block.length > 12) {
      sections.push(block);
    }
  }

  return sections.length ? sections : null;
}

/**
 * Produz chunks para retrieval: primeiro por turnos de conversa (se aplicável),
 * depois subdivide blocos longos com sobreposição.
 */
export function splitVaultBodyIntoRetrievalChunks(
  body: string,
  opts: { maxChars: number; overlapChars: number; maxChunks: number }
): string[] {
  const { maxChars, overlapChars, maxChunks } = opts;
  const dialogue = extractDialogueSections(body);
  const units = dialogue ?? [body.replace(/\r\n/g, "\n").trim()].filter(Boolean);

  const out: string[] = [];
  for (const unit of units) {
    if (out.length >= maxChunks) {
      break;
    }
    if (unit.length <= maxChars) {
      out.push(unit);
      continue;
    }
    const sub = splitTextIntoChunks(unit, { maxChars, overlapChars });
    for (const s of sub) {
      if (out.length >= maxChunks) {
        break;
      }
      out.push(s);
    }
  }

  return out.slice(0, maxChunks);
}
