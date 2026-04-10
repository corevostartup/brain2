//
//  ObsidianMemorySync.swift
//  Joi
//
//  Exporta conversas e projetos para o vault Obsidian (wikilinks [[...]], pastas físicas).
//

import AppKit
import Foundation

/// Caminho por defeito no painel: pasta `Joi` dentro do vault.
private let obsidianJoiRelativePath = "Library/Mobile Documents/iCloud~md~obsidian/Documents/Joi"

/// Todas as pastas criadas na Joi ficam **dentro** desta pasta no vault (subpastas não são listadas aqui, só no índice do pai).
private let cassioNunesVaultFolderName = "Cássio Nunes"

/// Conversas sem projeto (`projectId == nil`): pasta **Memórias** na raiz da Joi (criada automaticamente no sync).
private let memoriasVaultFolderName = "Memórias"

/// Nome do `.md` índice dentro da pasta Memórias (`Memórias/Memórias.md`).
private let memoriasIndexMarkdownBaseName = "Memórias"

/// Resolve o URL da pasta Joi a partir do bookmark em UserDefaults — **sem** `@MainActor`, para chamadas desde `ObsidianVaultMirror` / `ObsidianVaultContext`.
enum ObsidianVaultBookmarkResolver {
    static let userDefaultsKey = "joi.obsidianJoiVaultBookmark"

    nonisolated static func resolvedRootURL() -> URL? {
        guard let data = UserDefaults.standard.data(forKey: userDefaultsKey) else { return nil }
        var stale = false
        do {
            let url = try URL(
                resolvingBookmarkData: data,
                options: [.withSecurityScope],
                relativeTo: nil,
                bookmarkDataIsStale: &stale
            )
            if stale {
                UserDefaults.standard.removeObject(forKey: userDefaultsKey)
                return nil
            }
            return url
        } catch {
            return nil
        }
    }
}

@MainActor
enum ObsidianMemorySync {
    static func defaultVaultURL() -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(obsidianJoiRelativePath, isDirectory: true)
    }

    nonisolated static func hasStoredVaultAccess() -> Bool {
        ObsidianVaultBookmarkResolver.resolvedRootURL() != nil
    }

    /// Pasta Joi autorizada (para importação / vigilância do disco).
    nonisolated static func authorizedVaultRootURL() -> URL? {
        ObsidianVaultBookmarkResolver.resolvedRootURL()
    }

    static func storeBookmark(for url: URL) {
        do {
            let data = try url.bookmarkData(
                options: .withSecurityScope,
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )
            UserDefaults.standard.set(data, forKey: ObsidianVaultBookmarkResolver.userDefaultsKey)
        } catch {}
    }

    @discardableResult
    static func presentOpenPanel(changingLocation: Bool = false) -> Bool {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        if changingLocation, let current = ObsidianVaultBookmarkResolver.resolvedRootURL() {
            panel.directoryURL = current
        } else {
            panel.directoryURL = defaultVaultURL()
        }
        panel.message = changingLocation
            ? "Escolha a nova pasta Joi no vault Obsidian. As conversas e pastas passam a sincronizar para este destino."
            : "Escolha a pasta Joi dentro do vault Obsidian para gravar as conversas em Markdown."
        panel.prompt = changingLocation ? "Usar esta pasta" : "Autorizar"
        guard panel.runModal() == .OK, let url = panel.url else { return false }
        storeBookmark(for: url)
        return true
    }

    // MARK: - Sync principal

    /// Grava UTF-8 só se o conteúdo for diferente do ficheiro existente (evita reescrita contínua e rajadas de FSEvents).
    private static func writeUTF8IfChanged(_ content: String, to url: URL) -> Bool {
        if let existing = try? String(contentsOf: url, encoding: .utf8), existing == content {
            return false
        }
        do {
            try content.write(to: url, atomically: true, encoding: .utf8)
            return true
        } catch {
            return false
        }
    }

    /// - Returns: `true` se pelo menos um ficheiro `.md` foi alterado no disco (para ignorar eco no mirror).
    @discardableResult
    static func syncVault(conversations: [Conversation], projects: [JoiProject]) -> Bool {
        guard let root = ObsidianVaultBookmarkResolver.resolvedRootURL() else { return false }
        guard root.startAccessingSecurityScopedResource() else { return false }
        defer { root.stopAccessingSecurityScopedResource() }

        let fm = FileManager.default
        do {
            try fm.createDirectory(at: root, withIntermediateDirectories: true)
        } catch { return false }

        let stemById = assignWikilinkStems(conversations: conversations)
        var writtenRel = Set<String>()
        let projectById = Dictionary(uniqueKeysWithValues: projects.map { ($0.id, $0) })
        var didWrite = false

        let cassioDir = cassioNunesFolderURL(root: root)
        try? fm.createDirectory(at: cassioDir, withIntermediateDirectories: true)
        let hubIndexURL = cassioNunesHubIndexFileURL(root: root)
        let hubMd = markdownCassioNunesIndex(projects: projects)
        if writeUTF8IfChanged(hubMd, to: hubIndexURL) { didWrite = true }
        writtenRel.insert(relativePath(from: root, to: hubIndexURL))

        for conv in conversations {
            let stem = stemById[conv.id] ?? fallbackStem(conv)
            let dir: URL
            if let pid = conv.projectId, projectById[pid] != nil {
                let folder = projectDirectoryURL(projectId: pid, projects: projects, root: root)
                try? fm.createDirectory(at: folder, withIntermediateDirectories: true)
                dir = folder
            } else {
                let mem = memoriasFolderURL(root: root)
                try? fm.createDirectory(at: mem, withIntermediateDirectories: true)
                dir = mem
            }
            let fileURL = dir.appendingPathComponent("\(stem).md", isDirectory: false)
            let md = markdownConversation(
                conv,
                stemById: stemById,
                allConversations: conversations,
                projects: projects
            )
            if writeUTF8IfChanged(md, to: fileURL) { didWrite = true }
            writtenRel.insert(relativePath(from: root, to: fileURL))
        }

        for proj in projects {
            let folder = projectDirectoryURL(projectId: proj.id, projects: projects, root: root)
            try? fm.createDirectory(at: folder, withIntermediateDirectories: true)
            let indexStem = projectIndexStem(proj, projects: projects)
            let indexURL = folder.appendingPathComponent("\(indexStem).md", isDirectory: false)
            let indexMd = markdownProjectIndex(
                project: proj,
                conversations: conversations,
                stemById: stemById,
                projects: projects
            )
            if writeUTF8IfChanged(indexMd, to: indexURL) { didWrite = true }
            writtenRel.insert(relativePath(from: root, to: indexURL))
        }

        let memDir = memoriasFolderURL(root: root)
        try? fm.createDirectory(at: memDir, withIntermediateDirectories: true)
        let memoriasIndexURL = memoriasIndexFileURL(root: root)
        let memoriasIndexMd = markdownMemoriasIndex(conversations: conversations, stemById: stemById)
        if writeUTF8IfChanged(memoriasIndexMd, to: memoriasIndexURL) { didWrite = true }
        writtenRel.insert(relativePath(from: root, to: memoriasIndexURL))

        cleanupOrphans(root: root, writtenRelativePaths: writtenRel, conversationIds: Set(conversations.map(\.id)))
        return didWrite
    }

    // MARK: - Renomear (stems e wikilinks no vault)

    /// Stem do ficheiro `.md` da conversa (igual ao usado em `[[…]]` gerido pela Joi).
    static func wikilinkStem(for conversation: Conversation, conversations: [Conversation]) -> String {
        let map = assignWikilinkStems(conversations: conversations)
        return map[conversation.id] ?? fallbackStem(conversation)
    }

    /// Stem do índice da pasta (nome do `.md` do índice do projeto).
    static func projectWikilinkStem(for project: JoiProject, projects: [JoiProject]) -> String {
        projectIndexStem(project, projects: projects)
    }

    /// Substitui o alvo `oldStem` por `newStem` em todos os `.md` sob a pasta Joi autorizada (wikilinks e linha `joi_wikilink:`).
    static func replaceWikilinkTargetInVault(from oldStem: String, to newStem: String) {
        guard oldStem != newStem, let root = ObsidianVaultBookmarkResolver.resolvedRootURL() else { return }
        guard root.startAccessingSecurityScopedResource() else { return }
        defer { root.stopAccessingSecurityScopedResource() }

        let fm = FileManager.default
        enumerateMarkdownFiles(in: root, fm: fm) { fileURL in
            guard let data = try? Data(contentsOf: fileURL, options: [.mappedIfSafe]),
                  let text = String(data: data, encoding: .utf8)
            else { return }
            let updated = replaceWikilinkOccurrences(in: text, oldStem: oldStem, newStem: newStem)
            guard updated != text else { return }
            try? updated.write(to: fileURL, atomically: true, encoding: .utf8)
        }
    }

    private static func enumerateMarkdownFiles(in directory: URL, fm: FileManager, visitor: (URL) -> Void) {
        guard let items = try? fm.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return }

        for url in items {
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: url.path, isDirectory: &isDir) else { continue }
            if isDir.boolValue {
                enumerateMarkdownFiles(in: url, fm: fm, visitor: visitor)
            } else if url.pathExtension.lowercased() == "md" {
                visitor(url)
            }
        }
    }

    /// Actualiza `[[stem]]`, `[[stem|…]]`, `[[stem#…]]` e a propriedade YAML `joi_wikilink:` quando coincide com o stem antigo.
    private static func replaceWikilinkOccurrences(in content: String, oldStem: String, newStem: String) -> String {
        guard oldStem != newStem else { return content }
        var s = content
        s = s.replacingOccurrences(of: "[[\(oldStem)]]", with: "[[\(newStem)]]")
        s = s.replacingOccurrences(of: "[[\(oldStem)|", with: "[[\(newStem)|")
        s = s.replacingOccurrences(of: "[[\(oldStem)#", with: "[[\(newStem)#")
        s = replaceJoiWikilinkYAMLLine(in: s, oldStem: oldStem, newStem: newStem)
        return s
    }

    private static func replaceJoiWikilinkYAMLLine(in content: String, oldStem: String, newStem: String) -> String {
        let lines = content.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline)
        var out: [String] = []
        out.reserveCapacity(lines.count + 2)
        for lineSub in lines {
            let line = String(lineSub)
            if line.hasPrefix("joi_wikilink:") {
                let rest = line.dropFirst("joi_wikilink:".count)
                    .trimmingCharacters(in: .whitespaces)
                let unquoted: String
                if rest.first == "\"", rest.last == "\"", rest.count >= 2 {
                    unquoted = String(rest.dropFirst().dropLast())
                        .replacingOccurrences(of: "\\\"", with: "\"")
                } else {
                    unquoted = String(rest)
                }
                if unquoted == oldStem {
                    out.append("joi_wikilink: \(yamlEscape(newStem))")
                    continue
                }
            }
            out.append(line)
        }
        return out.joined(separator: "\n")
    }

    // MARK: - Pastas na raiz da Joi; índice hub em `Cássio Nunes/Cássio Nunes.md`.

    private static func cassioNunesFolderURL(root: URL) -> URL {
        root.appendingPathComponent(cassioNunesVaultFolderName, isDirectory: true)
    }

    /// Ficheiro índice: `Cássio Nunes/Cássio Nunes.md`.
    private static func cassioNunesHubIndexFileURL(root: URL) -> URL {
        cassioNunesFolderURL(root: root).appendingPathComponent("\(cassioNunesVaultFolderName).md", isDirectory: false)
    }

    /// Wikilink para a nota hub (relativo à raiz da Joi).
    private static func cassioNunesWikiStem() -> String {
        "\(cassioNunesVaultFolderName)/\(cassioNunesVaultFolderName)"
    }

    private static func memoriasFolderURL(root: URL) -> URL {
        root.appendingPathComponent(memoriasVaultFolderName, isDirectory: true)
    }

    /// Wikilink da nota índice `Memórias/Memórias.md` (relativo à raiz da Joi).
    private static func memoriasIndexWikilinkStem() -> String {
        "\(memoriasVaultFolderName)/\(memoriasIndexMarkdownBaseName)"
    }

    private static func memoriasIndexFileURL(root: URL) -> URL {
        memoriasFolderURL(root: root).appendingPathComponent("\(memoriasIndexMarkdownBaseName).md", isDirectory: false)
    }

    private static func folderSlug(for project: JoiProject, projects: [JoiProject]) -> String {
        let siblings = projects.filter { $0.parentId == project.parentId }
        var base = sanitizePathComponent(project.name)
        if base.isEmpty { base = "Projeto" }
        let slugs = siblings.map { p -> (JoiProject, String) in
            let s = sanitizePathComponent(p.name)
            return (p, s.isEmpty ? "Projeto" : s)
        }
        let colliding = slugs.filter { $0.1 == base }
        if colliding.count > 1 {
            return "\(base)-\(String(project.id.uuidString.prefix(6)))"
        }
        return base
    }

    /// Pastas de projeto: `Joi autorizada / pasta-raiz / … / pasta-do-projeto` (padrão normal do vault).
    private static func projectDirectoryURL(projectId: UUID, projects: [JoiProject], root: URL) -> URL {
        guard let proj = projects.first(where: { $0.id == projectId }) else { return root }
        var chain: [JoiProject] = []
        var current: JoiProject? = proj
        while let c = current {
            chain.append(c)
            if let pid = c.parentId {
                current = projects.first { $0.id == pid }
            } else {
                current = nil
            }
        }
        let ordered = chain.reversed()
        var url = root
        for p in ordered {
            let slug = folderSlug(for: p, projects: projects)
            url = url.appendingPathComponent(slug, isDirectory: true)
        }
        return url
    }

    private static func markdownCassioNunesIndex(projects: [JoiProject]) -> String {
        let roots = projects.filter { $0.parentId == nil }.sorted { $0.createdAt < $1.createdAt }
        var lines: [String] = []
        lines.append("---")
        lines.append("joi_managed: true")
        lines.append("joi_kind: cassio_root_index")
        lines.append("title: \(yamlEscape(cassioNunesVaultFolderName))")
        lines.append("---")
        lines.append("")
        lines.append("# \(cassioNunesVaultFolderName)")
        lines.append("")
        lines.append("## Pastas na raiz da Joi")
        lines.append("")
        for p in roots {
            let stem = projectIndexStem(p, projects: projects)
            lines.append("- [[\(stem)]]")
        }
        lines.append("")
        lines.append("## Memórias (conversas soltas)")
        lines.append("")
        lines.append("- [[\(memoriasIndexWikilinkStem())]]")
        lines.append("")
        lines.append("> As pastas de raiz da Joi ficam ao lado desta pasta no vault. As subpastas só aparecem no índice do projeto onde foram criadas.")
        lines.append("")
        return lines.joined(separator: "\n")
    }

    private static func markdownMemoriasIndex(conversations: [Conversation], stemById: [UUID: String]) -> String {
        let loose = conversations.filter { $0.projectId == nil }.sorted { $0.startedAt > $1.startedAt }
        var lines: [String] = []
        lines.append("---")
        lines.append("joi_managed: true")
        lines.append("joi_kind: memorias_index")
        lines.append("title: \(yamlEscape(memoriasVaultFolderName))")
        lines.append("---")
        lines.append("")
        lines.append("# \(memoriasVaultFolderName)")
        lines.append("")
        lines.append("## Índice geral")
        lines.append("")
        lines.append("- [[\(cassioNunesWikiStem())]]")
        lines.append("")
        lines.append("## Chats")
        lines.append("")
        for conv in loose {
            guard let s = stemById[conv.id] else { continue }
            lines.append("- [[\(s)]]")
        }
        lines.append("")
        return lines.joined(separator: "\n")
    }

    /// Nome do ficheiro índice (sem .md), igual ao da pasta sempre que possível.
    private static func projectIndexStem(_ project: JoiProject, projects: [JoiProject]) -> String {
        folderSlug(for: project, projects: projects)
    }

    private static func sanitizePathComponent(_ raw: String) -> String {
        let invalid = CharacterSet(charactersIn: "/\\?%*|\"<>:\n\r")
        let trimmed = raw.components(separatedBy: invalid).joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let collapsed = trimmed.replacingOccurrences(of: "  ", with: " ", options: [], range: nil)
        return collapsed.trimmingCharacters(in: CharacterSet(charactersIn: "."))
    }

    // MARK: - Nome do ficheiro conversa: AA-MM-DD - Assunto (barras → hífens; ano 2 dígitos)

    private static let fileDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone.current
        f.dateFormat = "yy-MM-dd"
        return f
    }()

    private static func assignWikilinkStems(conversations: [Conversation]) -> [UUID: String] {
        var map: [UUID: String] = [:]
        var used = Set<String>()
        let sorted = conversations.sorted { $0.startedAt < $1.startedAt }
        for conv in sorted {
            let datePart = fileDateFormatter.string(from: conv.startedAt)
            let subject = sanitizeNoteTitle(conv.title)
            var base = "\(datePart) - \(subject)"
            if base.trimmingCharacters(in: .whitespacesAndNewlines).hasSuffix("-") {
                base = "\(datePart) - Conversa"
            }
            var stem = base
            var n = 2
            while used.contains(stem) {
                stem = "\(base) (\(n))"
                n += 1
            }
            used.insert(stem)
            map[conv.id] = stem
        }
        return map
    }

    private static func fallbackStem(_ conv: Conversation) -> String {
        "\(fileDateFormatter.string(from: conv.startedAt)) - \(String(conv.id.uuidString.prefix(8)))"
    }

    private static func sanitizeNoteTitle(_ title: String) -> String {
        let invalid = CharacterSet(charactersIn: "/\\?%*|\"<>:\n\r#^[]")
        var t = title.components(separatedBy: invalid).joined(separator: " ")
        t = t.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return "Conversa" }
        if t.count > 80 { t = String(t.prefix(80)).trimmingCharacters(in: .whitespacesAndNewlines) }
        return t
    }

    // MARK: - Wikilinks automáticos

    private static func autonomousWikilinks(
        for conv: Conversation,
        stemById: [UUID: String],
        all: [Conversation]
    ) -> [String] {
        var links = Set<String>()
        let combined = conv.messages.map(\.content).joined(separator: "\n").lowercased()

        for other in all where other.id != conv.id {
            guard let otherStem = stemById[other.id] else { continue }
            let ot = other.title.lowercased()
            if ot.count >= 3, combined.contains(ot) {
                links.insert(otherStem)
                continue
            }
            let ta = titleTokens(conv.title)
            let tb = titleTokens(other.title)
            if ta.count >= 2, tb.count >= 2, !ta.intersection(tb).isEmpty {
                links.insert(otherStem)
            }
        }

        return links.sorted()
    }

    private static func titleTokens(_ title: String) -> Set<String> {
        let lower = title.lowercased()
        var set = Set<String>()
        for word in lower.split(whereSeparator: { !$0.isLetter && !$0.isNumber }) {
            if word.count >= 4 { set.insert(String(word)) }
        }
        return set
    }

    // MARK: - Markdown conversa

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoFormatterNoFrac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private static func yamlEscape(_ s: String) -> String {
        if s.contains(":") || s.contains("\"") || s.contains("\n") {
            let escaped = s.replacingOccurrences(of: "\"", with: "\\\"")
            return "\"\(escaped)\""
        }
        return s
    }

    private static func markdownConversation(
        _ conv: Conversation,
        stemById: [UUID: String],
        allConversations: [Conversation],
        projects: [JoiProject]
    ) -> String {
        let stem = stemById[conv.id] ?? fallbackStem(conv)
        let updated = isoFormatter.string(from: conv.updatedAt)

        var lines: [String] = []
        lines.append("---")
        lines.append("joi_managed: true")
        lines.append("joi_kind: conversation")
        lines.append("joi_conversation_id: \(conv.id.uuidString)")
        lines.append("joi_wikilink: \(yamlEscape(stem))")
        lines.append("title: \(yamlEscape(conv.title))")
        if conv.titleLocked {
            lines.append("joi_title_locked: true")
        }
        lines.append("updated_at: \(updated)")
        lines.append("source: Joi")
        if let pid = conv.projectId, let p = projects.first(where: { $0.id == pid }) {
            lines.append("joi_project: \(yamlEscape(p.name))")
        }
        lines.append("---")
        lines.append("")

        if conv.projectId == nil {
            lines.append("## Índice Memórias")
            lines.append("")
            lines.append("- [[\(memoriasIndexWikilinkStem())]]")
            lines.append("")
        }

        let linkTargets = autonomousWikilinks(for: conv, stemById: stemById, all: allConversations)
        if !linkTargets.isEmpty {
            lines.append("## Ligações automáticas")
            lines.append("")
            for t in linkTargets {
                lines.append("- [[\(t)]]")
            }
            lines.append("")
        }

        for msg in conv.messages {
            let ts = isoFormatterNoFrac.string(from: msg.createdAt)
            let heading: String
            switch msg.role {
            case .user:
                heading = "## Utilizador — \(ts)"
            case .assistant:
                heading = msg.isError ? "## Erro (assistente) — \(ts)" : "## Assistente — \(ts)"
            }
            lines.append(heading)
            lines.append("")
            lines.append(msg.content)
            lines.append("")
        }

        return lines.joined(separator: "\n")
    }

    private static func markdownProjectIndex(
        project: JoiProject,
        conversations: [Conversation],
        stemById: [UUID: String],
        projects: [JoiProject]
    ) -> String {
        var lines: [String] = []
        lines.append("---")
        lines.append("joi_managed: true")
        lines.append("joi_kind: project_index")
        lines.append("joi_project_id: \(project.id.uuidString)")
        lines.append("title: \(yamlEscape(project.name))")
        if let pid = project.parentId {
            lines.append("joi_parent_project_id: \(pid.uuidString)")
        }
        lines.append("---")
        lines.append("")
        lines.append("# \(project.name)")
        lines.append("")

        lines.append("## Pasta ascendente")
        lines.append("")
        if let pid = project.parentId, let parent = projects.first(where: { $0.id == pid }) {
            let parentStem = projectIndexStem(parent, projects: projects)
            lines.append("- [[\(parentStem)]]")
        } else {
            lines.append("- [[\(cassioNunesWikiStem())]]")
        }
        lines.append("")

        let subfolders = projects.filter { $0.parentId == project.id }.sorted { $0.createdAt < $1.createdAt }
        if !subfolders.isEmpty {
            lines.append("## Subpastas")
            lines.append("")
            for sub in subfolders {
                let subStem = projectIndexStem(sub, projects: projects)
                lines.append("- [[\(subStem)]]")
            }
            lines.append("")
        }

        lines.append("## Chats")
        lines.append("")

        let inProject = conversations.filter { $0.projectId == project.id }
            .sorted { $0.updatedAt > $1.updatedAt }
        for conv in inProject {
            guard let s = stemById[conv.id] else { continue }
            lines.append("- [[\(s)]]")
        }
        lines.append("")
        return lines.joined(separator: "\n")
    }

    // MARK: - Caminhos e limpeza

    private static func relativePath(from root: URL, to file: URL) -> String {
        let r = root.standardizedFileURL.path
        let f = file.standardizedFileURL.path
        guard f.hasPrefix(r) else { return f.precomposedStringWithCanonicalMapping }
        let idx = f.index(f.startIndex, offsetBy: r.count)
        var sub = String(f[idx...])
        while sub.hasPrefix("/") { sub.removeFirst() }
        return sub.precomposedStringWithCanonicalMapping
    }

    /// Remove do vault todos os `.md` de conversa Joi com o id dado (inclui cópias com stem antigo).
    static func deleteConversationMarkdownFromVault(conversationId: UUID) {
        guard let root = ObsidianVaultBookmarkResolver.resolvedRootURL() else { return }
        guard root.startAccessingSecurityScopedResource() else { return }
        defer { root.stopAccessingSecurityScopedResource() }

        let fm = FileManager.default
        enumerateMarkdownFiles(in: root.standardizedFileURL, fm: fm) { url in
            guard url.pathExtension.lowercased() == "md" else { return }
            guard let data = try? Data(contentsOf: url, options: [.mappedIfSafe]) else { return }
            let head = String(decoding: data.prefix(12_288), as: UTF8.self)
            guard head.contains("joi_managed: true"), head.contains("joi_kind: conversation") else { return }
            guard parseConversationUUID(from: head) == conversationId else { return }
            try? fm.removeItem(at: url)
        }
    }

    private static func cleanupOrphans(
        root: URL,
        writtenRelativePaths: Set<String>,
        conversationIds: Set<UUID>
    ) {
        let fm = FileManager.default
        recurseCleanupDirectory(root, root: root, fm: fm, written: writtenRelativePaths, conversationIds: conversationIds)
    }

    private static func recurseCleanupDirectory(
        _ dir: URL,
        root: URL,
        fm: FileManager,
        written: Set<String>,
        conversationIds: Set<UUID>
    ) {
        scanDirectory(dir, root: root, fm: fm, written: written, conversationIds: conversationIds)
        guard let subs = try? fm.contentsOfDirectory(
            at: dir,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return }
        for url in subs {
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue else { continue }
            recurseCleanupDirectory(url, root: root, fm: fm, written: written, conversationIds: conversationIds)
        }
    }

    private static func scanDirectory(
        _ dir: URL,
        root: URL,
        fm: FileManager,
        written: Set<String>,
        conversationIds: Set<UUID>
    ) {
        guard let files = try? fm.contentsOfDirectory(
            at: dir,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) else { return }

        for file in files where file.pathExtension.lowercased() == "md" {
            let rel = relativePath(from: root, to: file)
            if written.contains(rel) { continue }

            if file.lastPathComponent.lowercased().hasPrefix("joi-") {
                try? fm.removeItem(at: file)
                continue
            }

            guard let data = try? Data(contentsOf: file, options: [.mappedIfSafe]) else { continue }
            let head = String(decoding: data.prefix(4_096), as: UTF8.self)
            guard head.contains("joi_managed: true") else { continue }

            if head.contains("joi_kind: conversation"), let id = parseConversationUUID(from: head) {
                if !conversationIds.contains(id) {
                    try? fm.removeItem(at: file)
                } else if !written.contains(rel) {
                    // Mesmo chat gravado com novo nome/caminho: apagar cópia antiga.
                    try? fm.removeItem(at: file)
                }
                continue
            }

            if head.contains("joi_kind: project_index")
                || head.contains("joi_kind: cassio_root_index")
                || head.contains("joi_kind: memorias_index")
            {
                try? fm.removeItem(at: file)
            }
        }
    }

    private static func parseConversationUUID(from yamlHeader: String) -> UUID? {
        for line in yamlHeader.split(separator: "\n") {
            let s = String(line)
            if s.hasPrefix("joi_conversation_id:") {
                let parts = s.split(separator: ":", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
                guard parts.count == 2 else { continue }
                var raw = parts[1]
                if raw.first == "\"", raw.last == "\"", raw.count >= 2 {
                    raw = String(raw.dropFirst().dropLast())
                }
                if let u = UUID(uuidString: raw) { return u }
            }
        }
        return nil
    }
}
