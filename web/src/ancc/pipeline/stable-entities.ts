/**
 * Entidades “estáveis” por sessão — nomes próprios / termos em destaque com mapa canónico.
 */

const PT_STOP = new Set([
  "uma",
  "este",
  "esta",
  "isto",
  "isso",
  "aquilo",
  "como",
  "para",
  "pelo",
  "pela",
  "sobre",
  "entre",
  "desde",
  "quando",
  "onde",
  "muito",
  "mais",
  "todo",
  "toda",
]);

function normalizeEntityKey(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Extrai frases com capitalização tipo nome próprio e siglas; funde com mapa de sessão.
 */
export function mergeMessageEntities(
  message: string,
  prior: Record<string, string>,
): { entities: string[]; map: Record<string, string> } {
  const map: Record<string, string> = { ...prior };
  const seen = new Set<string>();
  const out: string[] = [];

  const add = (raw: string) => {
    const t = raw.replace(/\s+/g, " ").trim();
    if (t.length < 2) {
      return;
    }
    const key = normalizeEntityKey(t);
    if (PT_STOP.has(key) || key.length < 2) {
      return;
    }
    const canonical = map[key] ?? t;
    if (!map[key]) {
      map[key] = canonical;
    }
    if (!seen.has(key)) {
      seen.add(key);
      out.push(map[key]!);
    }
  };

  // Nome próprio: sequência de palavras com inicial maiúscula (1–4 palavras)
  const capRe =
    /\b([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+){0,3})\b/g;
  let m: RegExpExecArray | null;
  while ((m = capRe.exec(message)) !== null) {
    add(m[1]!);
  }

  // Siglas (2–6 letras)
  const acrRe = /\b([A-Z]{2,6})\b/g;
  while ((m = acrRe.exec(message)) !== null) {
    add(m[1]!);
  }

  return { entities: out.slice(0, 24), map };
}

export function entityOverlapScore(hitNoteTitle: string, snippet: string | undefined, entities: string[]): number {
  if (entities.length === 0) {
    return 0.5;
  }
  const blob = `${hitNoteTitle} ${snippet ?? ""}`.toLowerCase();
  let hits = 0;
  for (const e of entities) {
    const el = e.toLowerCase();
    if (blob.includes(el)) {
      hits += 1;
    }
  }
  return Math.min(1, hits / Math.min(entities.length, 6));
}
