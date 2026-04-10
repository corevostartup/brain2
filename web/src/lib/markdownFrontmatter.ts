/**
 * Remove o primeiro bloco `---` YAML. O grafo não deve tratar `[[tópicos]]` no frontmatter ANCC
 * como wikilinks no corpo da nota.
 */
export function stripYamlFrontmatter(markdown: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/m.exec(markdown);
  if (!m) {
    return markdown;
  }
  return markdown.slice(m.index + m[0].length);
}

/** Extrai `vault_path` do frontmatter ANCC (ligações conversa ↔ conversa). */
export function extractRelatedVaultPathsFromMarkdown(content: string): string[] {
  if (!content.includes("brain2_ancc")) {
    return [];
  }
  const paths: string[] = [];
  const re = /vault_path:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const p = m[1].replace(/\\/g, "/").trim();
    if (p) {
      paths.push(p);
    }
  }
  return paths;
}
