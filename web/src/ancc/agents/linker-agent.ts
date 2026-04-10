import { formatWikiLink, stripWikiBrackets } from "@/ancc/models/link";

function toTitleCasePhrase(s: string): string {
  const t = stripWikiBrackets(s).trim();
  if (!t) {
    return "";
  }
  return t
    .split(/\s+/)
    .map((word) => {
      if (word.length <= 2 && /^(de|da|do|of|a|an|the)$/i.test(word)) {
        return word.toLowerCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

export function topicsToWikiLinks(topics: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const topic of topics) {
    const title = toTitleCasePhrase(topic);
    if (!title) {
      continue;
    }
    const key = title.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(formatWikiLink(title));
  }
  return out;
}
