import { parseWikiLinksFromText } from "@/ancc/models/link";

const STOP = new Set(
  [
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "have",
    "has",
    "was",
    "were",
    "are",
    "you",
    "your",
    "can",
    "not",
    "but",
    "uma",
    "para",
    "com",
    "por",
    "que",
    "não",
    "mais",
    "como",
    "foi",
    "são",
    "seu",
    "sua",
    "pelo",
    "aos",
    "das",
    "nos",
    "já",
    "ao",
    "ou",
    "muito",
    "sobre",
    "entre",
    "quando",
    "também",
  ].map((s) => s.toLowerCase())
);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9áàâãéêíóôõúç\s-]/gi, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

/** Frases com maiúsculas (títulos prováveis). */
function extractTitleLikePhrases(text: string): string[] {
  const out: string[] = [];
  const re = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0].trim());
  }
  return out;
}

export type TopicAgentInput = {
  text: string;
  /** Nomes de notas existentes (sem .md) para reforçar tópicos reais do vault. */
  vaultNoteTitles: string[];
};

export function extractTopics(input: TopicAgentInput): string[] {
  const fromWiki = parseWikiLinksFromText(input.text);
  const phrases = extractTitleLikePhrases(input.text);
  const tokens = tokenize(input.text);

  const titleSet = new Map<string, string>();
  for (const t of input.vaultNoteTitles) {
    const k = t.trim().toLowerCase();
    if (k) {
      titleSet.set(k, t.trim());
    }
  }

  const boosted: string[] = [];
  for (const [lower, display] of titleSet) {
    if (lower.length < 2) {
      continue;
    }
    if (input.text.toLowerCase().includes(lower)) {
      boosted.push(display);
    }
  }

  const merged = new Map<string, string>();
  const add = (raw: string) => {
    const s = raw.trim();
    if (s.length < 2) {
      return;
    }
    const key = s.toLowerCase();
    if (!merged.has(key)) {
      merged.set(key, s);
    }
  };

  for (const w of fromWiki) {
    add(w);
  }
  for (const p of phrases) {
    add(p);
  }
  for (const b of boosted) {
    add(b);
  }

  const freq = new Map<string, number>();
  for (const tok of tokens) {
    freq.set(tok, (freq.get(tok) ?? 0) + 1);
  }
  const sortedTokens = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);

  for (const w of sortedTokens.slice(0, 12)) {
    add(w);
  }

  return [...merged.values()].slice(0, 24);
}
