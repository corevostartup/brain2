/**
 * Recorta texto em janelas com sobreposição para embeddings (MVP: por caracteres).
 */
export function splitTextIntoChunks(
  text: string,
  opts: { maxChars: number; overlapChars: number }
): string[] {
  const t = text.replace(/\r\n/g, "\n").trim();
  if (!t) {
    return [];
  }
  const { maxChars, overlapChars } = opts;
  if (t.length <= maxChars) {
    return [t];
  }
  const out: string[] = [];
  let start = 0;
  while (start < t.length) {
    const end = Math.min(t.length, start + maxChars);
    let slice = t.slice(start, end);
    if (end < t.length) {
      const lastBreak = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf(". "));
      if (lastBreak > maxChars * 0.45) {
        slice = slice.slice(0, lastBreak + 1);
      }
    }
    const trimmed = slice.trim();
    if (trimmed.length > 40) {
      out.push(trimmed);
    }
    const step = Math.max(1, slice.length - overlapChars);
    start += step;
    if (out.length >= 64) {
      break;
    }
  }
  return out.length ? out : [t.slice(0, maxChars)];
}
