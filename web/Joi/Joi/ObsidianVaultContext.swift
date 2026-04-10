//
//  ObsidianVaultContext.swift
//  Joi
//
//  Agrega texto do vault Obsidian autorizado para injetar como memória no pedido ao LLM (Ollama / OpenAI).
//

import Foundation

enum ObsidianVaultContext {
    /// Tamanho total aproximado do bloco de memória (UTF-8), para não estourar o contexto do modelo.
    private static let maxBundleUTF8Bytes = 120_000
    /// Máximo por ficheiro antes de truncar.
    private static let maxFileUTF8Bytes = 32_000

    private static let preamble = """
    És o assistente Joi. A seguir tens excertos da pasta Obsidian (vault) do utilizador — notas, índices e conversas exportadas. Usa este material como memória factual quando for relevante para a conversa. Se algo não constar aqui, diz claramente que não tens essa informação nos ficheiros disponíveis; não inventes. Responde no idioma que o utilizador usar.

    --- Memória Obsidian (caminhos relativos à pasta Joi autorizada) ---

    """

    private static let closing = "\n--- Fim da memória Obsidian ---\n"

    /// Devolve texto pronto para `role: "system"`, ou `nil` se não houver vault ou ficheiros.
    static func buildBundleForLLM(userMessage: String, conversationTitle: String) -> String? {
        guard let root = ObsidianVaultBookmarkResolver.resolvedRootURL() else { return nil }
        guard root.startAccessingSecurityScopedResource() else { return nil }
        defer { root.stopAccessingSecurityScopedResource() }

        let fm = FileManager.default
        var items: [(URL, String)] = []
        collectTextFiles(in: root, root: root, fm: fm, into: &items)
        guard !items.isEmpty else { return nil }

        let keywords = tokenize(userMessage + " " + conversationTitle)

        var scored: [(Int, URL, String)] = []
        for (url, rel) in items {
            let s = pathRelevanceScore(relPath: rel, keywords: keywords)
            scored.append((s, url, rel))
        }
        scored.sort { a, b in
            if a.0 != b.0 { return a.0 > b.0 }
            return a.2.localizedCaseInsensitiveCompare(b.2) == .orderedAscending
        }
        boostScoresWithContentSample(keywords: keywords, scored: &scored)

        let overhead = preamble.utf8.count + closing.utf8.count + 512
        var budget = max(0, maxBundleUTF8Bytes - overhead)
        var body = ""
        var omittedFiles = 0

        for (_, url, rel) in scored {
            guard budget > 200 else {
                omittedFiles += 1
                continue
            }
            guard let raw = readTextFile(url) else { continue }
            let withoutYaml = stripYamlFrontmatter(raw)
            let clipped = clipUTF8Bytes(withoutYaml, maxBytes: min(maxFileUTF8Bytes, budget - 64))
            let section = "### \(rel)\n\n\(clipped)\n\n"
            let cost = section.utf8.count
            if cost > budget {
                omittedFiles += 1
                continue
            }
            body.append(section)
            budget -= cost
        }

        guard !body.isEmpty else { return nil }

        var note = ""
        if omittedFiles > 0 {
            note = "\n[Nota: \(omittedFiles) ficheiro(s) não incluídos por limite de contexto do modelo.]\n"
        }
        return preamble + body + note + closing
    }

    private static func collectTextFiles(in directory: URL, root: URL, fm: FileManager, into out: inout [(URL, String)]) {
        guard let entries = try? fm.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return }

        for url in entries {
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: url.path, isDirectory: &isDir) else { continue }
            if isDir.boolValue {
                collectTextFiles(in: url, root: root, fm: fm, into: &out)
                continue
            }
            let ext = url.pathExtension.lowercased()
            guard ext == "md" || ext == "markdown" || ext == "txt" else { continue }
            let rel = relativePath(from: root, to: url)
            out.append((url, rel))
        }
    }

    private static func relativePath(from root: URL, to file: URL) -> String {
        let r = root.standardizedFileURL.path
        let f = file.standardizedFileURL.path
        guard f.hasPrefix(r) else { return file.lastPathComponent }
        let idx = f.index(f.startIndex, offsetBy: r.count)
        var sub = String(f[idx...])
        while sub.hasPrefix("/") { sub.removeFirst() }
        return sub.isEmpty ? file.lastPathComponent : sub
    }

    private static func tokenize(_ s: String) -> Set<String> {
        let lower = s.lowercased()
        var set = Set<String>()
        for word in lower.split(whereSeparator: { !$0.isLetter && !$0.isNumber }) {
            let w = String(word)
            if w.count >= 3 { set.insert(w) }
        }
        return set
    }

    private static func pathRelevanceScore(relPath: String, keywords: Set<String>) -> Int {
        guard !keywords.isEmpty else { return 0 }
        let pathLower = relPath.lowercased()
        var score = 0
        for w in keywords where pathLower.contains(w) {
            score += 6
        }
        return score
    }

    /// Reforço barato: amostra o início de alguns ficheiros (prioridade alfabética) para palavras só no texto.
    private static func boostScoresWithContentSample(keywords: Set<String>, scored: inout [(Int, URL, String)]) {
        guard !keywords.isEmpty else { return }
        let maxContentChecks = 100
        var checked = 0
        for i in scored.indices {
            guard scored[i].0 == 0 else { continue }
            guard checked < maxContentChecks else { break }
            checked += 1
            let url = scored[i].1
            guard let data = try? Data(contentsOf: url, options: [.mappedIfSafe]) else { continue }
            let sample = String(decoding: data.prefix(10_000), as: UTF8.self).lowercased()
            var add = 0
            for w in keywords where sample.contains(w) {
                add += 2
            }
            if add > 0 {
                let (_, u, r) = scored[i]
                scored[i] = (add, u, r)
            }
        }
        scored.sort { a, b in
            if a.0 != b.0 { return a.0 > b.0 }
            return a.2.localizedCaseInsensitiveCompare(b.2) == .orderedAscending
        }
    }

    private static func readTextFile(_ url: URL) -> String? {
        guard let data = try? Data(contentsOf: url, options: [.mappedIfSafe]) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func stripYamlFrontmatter(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("---") else { return text }
        let lines = trimmed.split(separator: "\n", omittingEmptySubsequences: false)
        guard lines.first?.trimmingCharacters(in: .whitespaces) == "---" else { return text }
        var i = 1
        while i < lines.count {
            if lines[i].trimmingCharacters(in: .whitespaces) == "---" {
                let rest = lines.dropFirst(i + 1).joined(separator: "\n")
                return rest.trimmingCharacters(in: .whitespacesAndNewlines)
            }
            i += 1
        }
        return text
    }

    private static func clipUTF8Bytes(_ s: String, maxBytes: Int) -> String {
        guard maxBytes > 0 else { return "" }
        if s.utf8.count <= maxBytes { return s }
        var used = 0
        var idx = s.startIndex
        while idx < s.endIndex {
            let ch = s[idx]
            let add = String(ch).utf8.count
            if used + add > maxBytes { break }
            used += add
            idx = s.index(after: idx)
        }
        var out = String(s[s.startIndex..<idx])
        if idx < s.endIndex {
            out += "\n\n… (truncado)"
        }
        return out
    }
}
