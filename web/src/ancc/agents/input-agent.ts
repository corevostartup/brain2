export type RawInterpretation = {
  normalizedText: string;
  charCount: number;
  sentenceCount: number;
  hasQuestion: boolean;
  languageHint: "pt" | "en" | "mixed" | "unknown";
};

function countSentences(text: string): number {
  const parts = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  return Math.max(1, parts.length);
}

function detectLanguageHint(text: string): RawInterpretation["languageHint"] {
  const pt = /\b(não|você|está|para|como|isso|uma|pelo|também|muito)\b/gi;
  const en = /\b(the|and|what|how|this|that|with|from|your)\b/gi;
  const ptHits = (text.match(pt) ?? []).length;
  const enHits = (text.match(en) ?? []).length;
  if (ptHits > 0 && enHits > 0) {
    return "mixed";
  }
  if (ptHits > enHits) {
    return "pt";
  }
  if (enHits > ptHits) {
    return "en";
  }
  return "unknown";
}

export function interpretUserInput(raw: string): RawInterpretation {
  const normalizedText = raw.replace(/\r\n/g, "\n").trim();
  return {
    normalizedText,
    charCount: normalizedText.length,
    sentenceCount: countSentences(normalizedText),
    hasQuestion: /\?\s*$/.test(normalizedText) || normalizedText.includes("?"),
    languageHint: detectLanguageHint(normalizedText),
  };
}
