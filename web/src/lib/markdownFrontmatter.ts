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

/**
 * Extrai valores de `tags:` do YAML inicial (Obsidian / Joi-style).
 * Suporta `tags: [a, b]`, lista com `- item`, e ignora o resto do frontmatter.
 */
export function extractYamlTagsFromMarkdown(markdown: string): string[] {
  const tags: string[] = [];
  const block = /^---\r?\n([\s\S]*?)\r?\n---/m.exec(markdown);
  if (!block) {
    return tags;
  }
  const fm = block[1];
  const lines = fm.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.toLowerCase().includes("tags:")) {
      continue;
    }
    const inline = /tags:\s*\[([^\]]*)\]/i.exec(line);
    if (inline) {
      for (const part of inline[1].split(",")) {
        const t = part
          .trim()
          .replace(/^["'#]|["']$/g, "")
          .trim();
        if (t) {
          tags.push(t);
        }
      }
      return tags;
    }
    if (/^\s*tags:\s*$/i.test(line.trim())) {
      let j = i + 1;
      while (j < lines.length) {
        const ln = lines[j].trim();
        if (ln.startsWith("-")) {
          const raw = ln.replace(/^-\s*/, "").replace(/^["']|["']$/g, "").trim();
          if (raw) {
            tags.push(raw);
          }
          j += 1;
        } else if (ln === "") {
          j += 1;
        } else {
          break;
        }
      }
      break;
    }
  }
  return tags;
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
