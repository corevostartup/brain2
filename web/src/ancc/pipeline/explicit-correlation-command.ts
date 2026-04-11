import { parseWikiLinksFromText, stripWikiBrackets } from "@/ancc/models/link";
import type { VaultCorrelationHit } from "@/ancc/models/context";
import type { VaultFileSnapshot } from "@/ancc/pipeline/vault-correlation";
import { noteTitleFromFileName } from "@/ancc/pipeline/vault-correlation";

/**
 * Correlações pedidas explicitamente pelo utilizador («correlacionar X com Y», «correlate A with B»)
 * devem sobrescrever o score lexical e gravar em `related_vault_notes` quando a nota existir no vault.
 */
export const EXPLICIT_CORRELATION = {
  relevance: 0.92,
  minMatchScore: 0.52,
} as const;

function cleanHint(raw: string | undefined): string {
  if (!raw) {
    return "";
  }
  let s = raw.trim();
  s = stripWikiBrackets(s).trim();
  s = s.replace(/^["«'“]|["»'”]$/g, "").trim();
  s = s.replace(/[.!?,;:]+$/g, "").trim();
  return s;
}

function tryTwoPartEnglish(text: string): [string, string] | null {
  const m = text.match(/\bcorrelate\s+([\s\S]+?)\s+with\s+([\s\S]+?)(?:[.!?\n]|$)/i);
  if (!m?.[1] || !m?.[2]) {
    return null;
  }
  const a = cleanHint(m[1]);
  const b = cleanHint(m[2]);
  if (/^(this|this\s+conversation)$/i.test(a)) {
    return null;
  }
  if (a.length >= 2 && b.length >= 2) {
    return [a, b];
  }
  return null;
}

function tryTwoPartPortuguese(text: string): [string, string] | null {
  const m = text.match(/\bcorrelacion(?:ar|a)\s+([\s\S]+)$/i);
  if (!m?.[1]) {
    return null;
  }
  const rest = m[1].trim();
  const parts = rest.split(/\s+com\s+/i);
  if (parts.length < 2) {
    return null;
  }
  const b = cleanHint(parts.slice(1).join(" com "));
  const a = cleanHint(parts[0]);
  if (!a || !b) {
    return null;
  }
  if (/^(esta\s+)?conversa$/i.test(a) || /^(isto|isso)$/i.test(a)) {
    return null;
  }
  if (a.length >= 2 && b.length >= 2) {
    return [a, b];
  }
  return null;
}

/**
 * Extrai nomes de notas / tópicos que o utilizador pediu para correlacionar com o vault.
 * Suporta EN/PT e wikilinks `[[Nota]]` na mesma frase (ex.: «correlacionar com [[Reunião Q1]]»).
 */
export function extractExplicitCorrelationHints(text: string): string[] {
  const hints = new Set<string>();
  const raw = text.replace(/\r\n/g, "\n").trim();

  const add = (s?: string) => {
    const c = cleanHint(s);
    if (c.length >= 2) {
      hints.add(c);
    }
  };

  const twoEn = tryTwoPartEnglish(raw);
  if (twoEn) {
    add(twoEn[0]);
    add(twoEn[1]);
    return [...hints];
  }

  const twoPt = tryTwoPartPortuguese(raw);
  if (twoPt) {
    add(twoPt[0]);
    add(twoPt[1]);
    return [...hints];
  }

  const oneEn = raw.match(/\bcorrelate\s+(?:this\s+)?(?:conversation\s+)?with\s+(.+?)(?:[.!?\n]|$)/i);
  if (oneEn?.[1]) {
    add(oneEn[1]);
  }

  const onePt = raw.match(
    /\bcorrelacion(?:ar|a)\s+(?:esta\s+)?(?:conversa\s+)?(?:com|a)\s+(.+?)(?:[.!?\n]|$)/i
  );
  if (onePt?.[1]) {
    add(onePt[1]);
  }

  const linkEn = raw.match(/\blink\s+(?:this\s+)?(?:conversation\s+)?(?:to|with)\s+(.+?)(?:[.!?\n]|$)/i);
  if (linkEn?.[1]) {
    add(linkEn[1]);
  }

  const linkPt = raw.match(/\bligar\s+(?:esta\s+)?(?:conversa\s+)?(?:a|com)\s+(.+?)(?:[.!?\n]|$)/i);
  if (linkPt?.[1]) {
    add(linkPt[1]);
  }

  if (/\b(correlat|correla|ligar|link\s+this)\w*/i.test(raw)) {
    for (const w of parseWikiLinksFromText(raw)) {
      add(w);
    }
  }

  return [...hints];
}

function scoreHintAgainstFile(hintLower: string, file: VaultFileSnapshot): number {
  const title = noteTitleFromFileName(file.name);
  const titleLower = title.toLowerCase();
  const pathLower = file.path.toLowerCase();
  const base = file.name.replace(/\.md$/i, "").toLowerCase();

  if (!hintLower || !titleLower) {
    return 0;
  }

  if (titleLower === hintLower || base === hintLower) {
    return 1;
  }
  if (titleLower.includes(hintLower) || pathLower.includes(hintLower.replace(/\s+/g, "-"))) {
    return 0.88;
  }
  if (hintLower.includes(titleLower) && titleLower.length >= 4) {
    return 0.86;
  }

  const hintTokens = hintLower.split(/\s+/).filter((t) => t.length > 2);
  if (hintTokens.length === 0) {
    return 0;
  }
  let overlap = 0;
  for (const t of hintTokens) {
    if (titleLower.includes(t)) {
      overlap += 1;
    }
  }
  if (overlap === 0) {
    return 0;
  }
  return 0.52 + 0.35 * (overlap / hintTokens.length);
}

export function resolveHintsToExplicitVaultHits(
  hints: string[],
  files: VaultFileSnapshot[]
): VaultCorrelationHit[] {
  if (hints.length === 0 || files.length === 0) {
    return [];
  }

  const out: VaultCorrelationHit[] = [];

  for (const hint of hints) {
    const hintLower = hint.trim().toLowerCase();
    if (hintLower.length < 2) {
      continue;
    }

    let best: { file: VaultFileSnapshot; score: number } | null = null;
    for (const file of files) {
      const score = scoreHintAgainstFile(hintLower, file);
      if (!best || score > best.score) {
        best = { file, score };
      }
    }

    if (!best || best.score < EXPLICIT_CORRELATION.minMatchScore) {
      continue;
    }

    const snippet = best.file.content.replace(/\s+/g, " ").trim().slice(0, 220);
    out.push({
      path: best.file.path,
      noteTitle: noteTitleFromFileName(best.file.name),
      relevance: EXPLICIT_CORRELATION.relevance,
      matchedTopics: [`pedido:${hint.slice(0, 80)}`],
      snippet: snippet.length ? snippet : undefined,
    });
  }

  return dedupeHitsByPath(out);
}

function dedupeHitsByPath(hits: VaultCorrelationHit[]): VaultCorrelationHit[] {
  const map = new Map<string, VaultCorrelationHit>();
  for (const h of hits) {
    const k = h.path.toLowerCase();
    const prev = map.get(k);
    if (!prev || h.relevance > prev.relevance) {
      map.set(k, h);
    }
  }
  return [...map.values()];
}

/**
 * Junta hits automáticos com hits explícitos; o mesmo path fica com a maior relevância e tópicos fundidos.
 */
export function mergeVaultCorrelationHits(
  automatic: VaultCorrelationHit[],
  explicit: VaultCorrelationHit[]
): VaultCorrelationHit[] {
  const map = new Map<string, VaultCorrelationHit>();

  for (const h of automatic) {
    map.set(h.path.toLowerCase(), { ...h, matchedTopics: [...h.matchedTopics] });
  }

  for (const h of explicit) {
    const k = h.path.toLowerCase();
    const prev = map.get(k);
    if (!prev) {
      map.set(k, { ...h, matchedTopics: [...h.matchedTopics] });
    } else {
      const topics = [...new Set([...prev.matchedTopics, ...h.matchedTopics])];
      map.set(k, {
        ...prev,
        relevance: Math.max(prev.relevance, h.relevance),
        matchedTopics: topics,
        snippet: h.snippet ?? prev.snippet,
      });
    }
  }

  return [...map.values()].sort((a, b) => b.relevance - a.relevance).slice(0, 20);
}
