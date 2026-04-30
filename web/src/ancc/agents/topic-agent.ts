import { parseWikiLinksFromText } from "@/ancc/models/link";

/**
 * Palavras de função / muito vagas (PT/EN) — não são "unidades com significado" sozinhas.
 * Unigramas só passam se forem âncora (comprimento/dígitos); n-grams podem contê-las no meio.
 */
const FUNCTION_WORDS = new Set(
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
    "um",
    "uns",
    "umas",
    "para",
    "pra",
    "pro",
    "prá",
    "com",
    "por",
    "per",
    "que",
    "quê",
    "não",
    "nao",
    "mais",
    "menos",
    "muito",
    "pouco",
    "como",
    "foi",
    "fui",
    "ser",
    "são",
    "sou",
    "somos",
    "está",
    "estão",
    "estou",
    "tem",
    "têm",
    "tinha",
    "tinham",
    "ter",
    "teve",
    "há",
    "hei",
    "seu",
    "sua",
    "seus",
    "suas",
    "pelo",
    "pela",
    "pelos",
    "pelas",
    "aos",
    "ao",
    "à",
    "às",
    "das",
    "dos",
    "del",
    "nos",
    "nas",
    "num",
    "numa",
    "já",
    "ja",
    "ou",
    "sobre",
    "entre",
    "quando",
    "onde",
    "também",
    "tambem",
    "bem",
    "mal",
    "assim",
    "tipo",
    "né",
    "ne",
    "você",
    "voce",
    "vc",
    "tu",
    "teu",
    "tua",
    "teus",
    "tuas",
    "ele",
    "ela",
    "eles",
    "elas",
    "eu",
    "mim",
    "meu",
    "minha",
    "nós",
    "vós",
    "algo",
    "algum",
    "alguma",
    "alguns",
    "algumas",
    "nada",
    "ninguém",
    "ninguem",
    "coisa",
    "coisas",
    "vez",
    "vezes",
    "forma",
    "gente",
    "pessoa",
    "pessoas",
    "hoje",
    "ontem",
    "amanhã",
    "amanha",
    "agora",
    "aqui",
    "aí",
    "ai",
    "ali",
    "então",
    "entao",
    "depois",
    "antes",
    "sempre",
    "nunca",
    "talvez",
    "quase",
    "mês",
    "mes",
    "ano",
    "anos",
    "dia",
    "dias",
    "hora",
    "horas",
    "lembrar",
    "lembra",
    "lembro",
    "disse",
    "dizer",
    "fala",
    "falar",
    "faz",
    "fazer",
    "fez",
    "diz",
    "vai",
    "ir",
    "vão",
    "vou",
    "quer",
    "querer",
    "sei",
    "saber",
    "acho",
    "achar",
    "cada",
    "todo",
    "toda",
    "todos",
    "todas",
    "mesmo",
    "mesma",
    "outro",
    "outra",
    "outros",
    "outras",
    "isso",
    "isto",
    "aquilo",
    "esse",
    "essa",
    "esses",
    "essas",
    "aquele",
    "aquela",
    "aqueles",
    "aquelas",
    "qual",
    "quais",
    "quem",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "how",
    "just",
    "only",
    "even",
    "still",
    "also",
    "into",
    "than",
    "then",
    "them",
    "they",
    "their",
    "there",
    "these",
    "those",
  ].map((s) => s.toLowerCase())
);

const MAX_NGRAM_SLOTS = 14;
const MAX_UNIGRAM_SLOTS = 6;
const MAX_OUT = 24;

/** Unigrama forte: não é função vaga e tem substância lexical ou número. */
function isAnchorToken(t: string): boolean {
  const w = t.trim().toLowerCase();
  if (w.length < 2) {
    return false;
  }
  if (FUNCTION_WORDS.has(w)) {
    return false;
  }
  if (/\d/.test(w)) {
    return true;
  }
  return w.length >= 4;
}

function rawTokenSequence(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9áàâãéêíóôõúç\s-]/gi, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function tokenizeForUnigramFreq(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9áàâãéêíóôõúç\s-]/gi, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !FUNCTION_WORDS.has(t));
}

/** Frases com maiúsculas (títulos prováveis), EN e PT acentuado. */
function extractTitleLikePhrases(text: string): string[] {
  const out: string[] = [];
  const re =
    /\b[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zàáâãéêíóôõúç]+(?:\s+[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zàáâãéêíóôõúç]+)+\b/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0].trim());
  }
  return out;
}

/**
 * Colocações 2–4 palavras: pelo menos um token âncora; ranqueadas por frequência × peso de comprimento.
 */
function extractMeaningfulPhrases(text: string): { phrase: string; score: number }[] {
  const seq = rawTokenSequence(text);
  if (seq.length < 2) {
    return [];
  }

  const counts = new Map<string, number>();

  for (let i = 0; i < seq.length; i++) {
    for (let n = 2; n <= 4; n++) {
      if (i + n > seq.length) {
        break;
      }
      const slice = seq.slice(i, i + n);
      if (!slice.some(isAnchorToken)) {
        continue;
      }
      const key = slice.join(" ");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const scored: { phrase: string; score: number }[] = [];
  for (const [phrase, count] of counts) {
    const words = phrase.split(/\s+/).length;
    const score = count * (1 + 0.14 * (words - 1));
    scored.push({ phrase, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export type TopicAgentInput = {
  text: string;
  /** Nomes de notas existentes (sem .md) para reforçar tópicos reais do vault. */
  vaultNoteTitles: string[];
};

export function extractTopics(input: TopicAgentInput): string[] {
  const fromWiki = parseWikiLinksFromText(input.text);
  const phrases = extractTitleLikePhrases(input.text);
  const tokens = tokenizeForUnigramFreq(input.text);

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

  const phraseRanked = extractMeaningfulPhrases(input.text);
  let addedPhrases = 0;
  for (const { phrase } of phraseRanked) {
    if (addedPhrases >= MAX_NGRAM_SLOTS) {
      break;
    }
    if (merged.size >= MAX_OUT) {
      break;
    }
    add(phrase);
    addedPhrases += 1;
  }

  const freq = new Map<string, number>();
  for (const tok of tokens) {
    if (!isAnchorToken(tok)) {
      continue;
    }
    freq.set(tok, (freq.get(tok) ?? 0) + 1);
  }
  const sortedUnigrams = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);

  let addedUni = 0;
  for (const w of sortedUnigrams) {
    if (addedUni >= MAX_UNIGRAM_SLOTS) {
      break;
    }
    if (merged.size >= MAX_OUT) {
      break;
    }
    add(w);
    addedUni += 1;
  }

  /** Texto muito curto ou só função: recuperar unigramas por frequência (≥3 letras, fora da lista). */
  if (merged.size < 2 && rawTokenSequence(input.text).length > 0) {
    const weakFreq = new Map<string, number>();
    for (const tok of tokenizeForUnigramFreq(input.text)) {
      weakFreq.set(tok, (weakFreq.get(tok) ?? 0) + 1);
    }
    const weakSorted = [...weakFreq.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
    for (const w of weakSorted.slice(0, 4)) {
      if (merged.size >= MAX_OUT) {
        break;
      }
      if (w.length >= 4) {
        add(w);
      }
    }
  }

  return [...merged.values()].slice(0, MAX_OUT);
}
