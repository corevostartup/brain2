/**
 * Ligação de memória: alvo semelhante a um wikilink Obsidian.
 * `target` guarda o título limpo (ex.: "Brain2"); use `formatWikiLink` para [[Brain2]].
 */
export type MemoryLinkType =
  | "structural"
  | "semantic"
  | "contextual"
  | "recurrent"
  | "experimental";

export type MemoryLink = {
  target: string;
  strength: number;
  type: MemoryLinkType;
  updatedAt: string;
};

const WIKILINK_REGEX = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

export function stripWikiBrackets(target: string): string {
  const t = target.trim();
  const m = /^\[\[(.+)\]\]$/.exec(t);
  return (m ? m[1] : t).trim();
}

export function formatWikiLink(title: string): string {
  const inner = title.trim();
  return `[[${inner}]]`;
}

export function parseWikiLinksFromText(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(WIKILINK_REGEX.source, "g");
  while ((m = re.exec(text)) !== null) {
    const inner = m[1]?.trim();
    if (inner) {
      out.push(inner);
    }
  }
  return out;
}

export function linkKey(sourceNoteId: string, targetTitle: string): string {
  return `${sourceNoteId}::${stripWikiBrackets(targetTitle).toLowerCase()}`;
}
