//
//  ObsidianVaultMirror.swift
//  Joi
//
//  Importa conversas e pastas a partir dos .md no vault e vigia alterações externas (Obsidian / Finder).
//

import CoreServices
import Foundation

// MARK: - Importação (ficheiros → modelo)

enum ObsidianVaultMirror {
    /// Pastas de conversas soltas (`projectId == nil`). `Memórias` é a canónica; inclui `memórias` para vaults antigos (disco sensível a maiúsculas).
    private static let memoriasFolderNames = ["Memórias", "memórias"]

    private static func memoriasRootPaths(from root: URL) -> [String] {
        memoriasFolderNames.map {
            root.appendingPathComponent($0, isDirectory: true).standardizedFileURL.path
        }
    }

    private static func isUnderMemoriasTree(path: String, memoriasRoots: [String]) -> Bool {
        memoriasRoots.contains { base in
            path == base || path.hasPrefix(base + "/")
        }
    }

    private static let isoFrac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    /// Lê o vault e devolve o estado espelhado. Executar com bookmark da pasta Joi activo ou dentro de `startAccessing`.
    static func scanVaultSync() -> (projects: [JoiProject], conversations: [Conversation])? {
        guard let root = ObsidianVaultBookmarkResolver.resolvedRootURL() else { return nil }
        guard root.startAccessingSecurityScopedResource() else { return nil }
        defer { root.stopAccessingSecurityScopedResource() }

        let fm = FileManager.default
        let rootPath = root.standardizedFileURL.path
        let memoriasRoots = memoriasRootPaths(from: root)

        struct ProjectRecord {
            var project: JoiProject
            var folderPath: String
        }

        var projectRecords: [ProjectRecord] = []

        enumerateProjectDirectories(from: root, memoriasRoots: memoriasRoots, fm: fm) { dirURL in
            guard let files = try? fm.contentsOfDirectory(at: dirURL, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles]) else { return }
            for md in files where md.pathExtension.lowercased() == "md" {
                guard let data = try? Data(contentsOf: md, options: [.mappedIfSafe]) else { continue }
                let head = String(decoding: data.prefix(8_192), as: UTF8.self)
                guard head.contains("joi_managed: true"), head.contains("joi_kind: project_index") else { continue }
                guard let yamlBody = extractFrontmatter(from: String(decoding: data, as: UTF8.self))?.yaml else { continue }
                let keys = parseYamlKeys(yamlBody)
                guard let idStr = keys["joi_project_id"], let id = UUID(uuidString: idStr) else { continue }
                let title = keys["title"] ?? md.deletingPathExtension().lastPathComponent
                var parentId: UUID?
                if let ps = keys["joi_parent_project_id"], let u = UUID(uuidString: ps) {
                    parentId = u
                }
                let mod = (try? md.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? Date()
                let proj = JoiProject(id: id, name: title, parentId: parentId, createdAt: mod)
                let folderPath = dirURL.standardizedFileURL.path
                projectRecords.append(ProjectRecord(project: proj, folderPath: folderPath))
            }
        }

        var folderByProjectId: [UUID: String] = [:]
        var projectById: [UUID: JoiProject] = [:]
        for rec in projectRecords {
            projectById[rec.project.id] = rec.project
            if let existing = folderByProjectId[rec.project.id] {
                if rec.folderPath.count > existing.count {
                    folderByProjectId[rec.project.id] = rec.folderPath
                }
            } else {
                folderByProjectId[rec.project.id] = rec.folderPath
            }
        }
        let projects = sortProjectsParentBeforeChildren(Array(projectById.values))

        var conversations: [Conversation] = []
        var seenConvIds = Set<UUID>()

        enumerateMarkdownFiles(in: root, fm: fm) { mdURL in
            guard let data = try? Data(contentsOf: mdURL, options: [.mappedIfSafe]) else { return }
            let full = String(decoding: data, as: UTF8.self)
            let head = String(full.prefix(8_192))
            guard head.contains("joi_managed: true"), head.contains("joi_kind: conversation") else { return }
            guard let (yaml, body) = extractFrontmatter(from: full) else { return }
            let keys = parseYamlKeys(yaml)
            guard let idStr = keys["joi_conversation_id"], let id = UUID(uuidString: idStr) else { return }
            guard !seenConvIds.contains(id) else { return }
            seenConvIds.insert(id)

            let title = keys["title"] ?? "Conversa"
            let titleLocked = (keys["joi_title_locked"]?.lowercased() == "true")
            let updatedAt = parseUpdatedAt(keys["updated_at"], fallback: (try? mdURL.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? Date())
            let messages = parseConversationMessages(body)

            let convDir = mdURL.deletingLastPathComponent().standardizedFileURL.path
            let projectId: UUID? = resolveProjectId(
                conversationDirPath: convDir,
                vaultRootPath: rootPath,
                memoriasRoots: memoriasRoots,
                folderByProjectId: folderByProjectId
            )

            let conv = Conversation(
                id: id,
                title: title,
                messages: messages,
                updatedAt: updatedAt,
                projectId: projectId,
                titleLocked: titleLocked
            )
            conversations.append(conv)
        }

        conversations.sort { $0.updatedAt > $1.updatedAt }
        return (projects, conversations)
    }

    private static func resolveProjectId(
        conversationDirPath: String,
        vaultRootPath: String,
        memoriasRoots: [String],
        folderByProjectId: [UUID: String]
    ) -> UUID? {
        guard conversationDirPath.hasPrefix(vaultRootPath + "/") || conversationDirPath == vaultRootPath else {
            return nil
        }
        if isUnderMemoriasTree(path: conversationDirPath, memoriasRoots: memoriasRoots) {
            return nil
        }
        var best: (UUID, Int)?
        for (pid, folder) in folderByProjectId {
            if conversationDirPath == folder || conversationDirPath.hasPrefix(folder + "/") {
                let len = folder.count
                if best == nil || len > best!.1 {
                    best = (pid, len)
                }
            }
        }
        return best?.0
    }

    /// Percorre todas as pastas sob a Joi autorizada, exceto **Memórias** / `memórias` (conversas soltas).
    private static func enumerateProjectDirectories(from root: URL, memoriasRoots: [String], fm: FileManager, visit: (URL) -> Void) {
        func walk(_ dir: URL) {
            let path = dir.standardizedFileURL.path
            guard !isUnderMemoriasTree(path: path, memoriasRoots: memoriasRoots) else { return }
            visit(dir)
            guard let items = try? fm.contentsOfDirectory(
                at: dir,
                includingPropertiesForKeys: [.isDirectoryKey],
                options: [.skipsHiddenFiles]
            ) else { return }
            for url in items {
                var isDir: ObjCBool = false
                guard fm.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue else { continue }
                walk(url.standardizedFileURL)
            }
        }
        walk(root.standardizedFileURL)
    }

    private static func sortProjectsParentBeforeChildren(_ projects: [JoiProject]) -> [JoiProject] {
        let byId = Dictionary(uniqueKeysWithValues: projects.map { ($0.id, $0) })
        var visited = Set<UUID>()
        var result: [JoiProject] = []

        func visit(_ id: UUID) {
            guard !visited.contains(id), let p = byId[id] else { return }
            if let pid = p.parentId, byId[pid] != nil {
                visit(pid)
            }
            guard !visited.contains(id) else { return }
            visited.insert(id)
            result.append(p)
        }

        for p in projects.sorted(by: { $0.createdAt < $1.createdAt }) {
            visit(p.id)
        }
        return result
    }

    private static func parseUpdatedAt(_ raw: String?, fallback: Date) -> Date {
        guard let raw, !raw.isEmpty else { return fallback }
        if let d = isoFrac.date(from: raw) { return d }
        if let d = isoPlain.date(from: raw) { return d }
        return fallback
    }

    private static func extractFrontmatter(from text: String) -> (yaml: String, body: String)? {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard let first = lines.first?.trimmingCharacters(in: .whitespaces), first == "---" else { return nil }
        var i = 1
        var yamlLines: [String] = []
        while i < lines.count {
            let L = lines[i]
            if L.trimmingCharacters(in: .whitespaces) == "---" {
                let body = lines.dropFirst(i + 1).joined(separator: "\n")
                return (yamlLines.joined(separator: "\n"), body)
            }
            yamlLines.append(L)
            i += 1
        }
        return nil
    }

    private static func parseYamlKeys(_ header: String) -> [String: String] {
        var d: [String: String] = [:]
        for line in header.split(separator: "\n", omittingEmptySubsequences: false) {
            let s = String(line)
            guard let colon = s.firstIndex(of: ":") else { continue }
            let key = String(s[..<colon]).trimmingCharacters(in: .whitespaces)
            var val = String(s[s.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            if val.hasPrefix("\""), val.hasSuffix("\""), val.count >= 2 {
                val = String(val.dropFirst().dropLast()).replacingOccurrences(of: "\\\"", with: "\"")
            }
            d[key] = val
        }
        return d
    }

    private static func parseConversationMessages(_ body: String) -> [ChatMessage] {
        let lines = body.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        var messages: [ChatMessage] = []
        var currentRole: ChatRole?
        var currentError = false
        var currentDate: Date?
        var currentLines: [String] = []

        func flush() {
            guard let role = currentRole, let date = currentDate else { return }
            let content = currentLines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            messages.append(ChatMessage(role: role, content: content, createdAt: date, isError: currentError))
            currentRole = nil
            currentDate = nil
            currentError = false
            currentLines = []
        }

        let userP = "## Utilizador — "
        let asstP = "## Assistente — "
        let errP = "## Erro (assistente) — "

        for line in lines {
            if line.hasPrefix(userP) {
                flush()
                let ts = String(line.dropFirst(userP.count)).trimmingCharacters(in: .whitespaces)
                currentRole = .user
                currentDate = isoPlain.date(from: ts) ?? isoFrac.date(from: ts) ?? Date()
                currentError = false
                continue
            }
            if line.hasPrefix(asstP) {
                flush()
                let ts = String(line.dropFirst(asstP.count)).trimmingCharacters(in: .whitespaces)
                currentRole = .assistant
                currentDate = isoPlain.date(from: ts) ?? isoFrac.date(from: ts) ?? Date()
                currentError = false
                continue
            }
            if line.hasPrefix(errP) {
                flush()
                let ts = String(line.dropFirst(errP.count)).trimmingCharacters(in: .whitespaces)
                currentRole = .assistant
                currentDate = isoPlain.date(from: ts) ?? isoFrac.date(from: ts) ?? Date()
                currentError = true
                continue
            }
            if currentRole != nil {
                if line.hasPrefix("## ") {
                    currentLines.append(line)
                } else {
                    currentLines.append(line)
                }
            }
        }
        flush()
        return messages
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

}

// MARK: - FSEvents (alterações externas)

final class ObsidianVaultMirrorWatcher {
    private var stream: FSEventStreamRef?
    private var pendingWork: DispatchWorkItem?
    private let workQueue = DispatchQueue(label: "joi.vault.mirror.debounce")
    private let onChange: () -> Void

    init(onChange: @escaping () -> Void) {
        self.onChange = onChange
    }

    func start(path: String) {
        stop()
        let paths = [path] as CFArray
        var context = FSEventStreamContext(
            version: 0,
            info: UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque()),
            retain: nil,
            release: nil,
            copyDescription: nil
        )
        let callback: FSEventStreamCallback = { _, info, _, _, _, _ in
            guard let info else { return }
            let watcher = Unmanaged<ObsidianVaultMirrorWatcher>.fromOpaque(info).takeUnretainedValue()
            watcher.scheduleDebouncedImport()
        }
        let since = FSEventStreamEventId(kFSEventStreamEventIdSinceNow)
        // FSEvents watcher disabled - using event-driven sync instead to eliminate stuttering
        let flags = FSEventStreamCreateFlags(
            UInt32(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagWatchRoot)
        )
        guard let s = FSEventStreamCreate(kCFAllocatorDefault, callback, &context, paths, since, 10.0, flags) else { return }
        stream = s
        FSEventStreamSetDispatchQueue(s, workQueue)
        FSEventStreamStart(s)
    }

    private func scheduleDebouncedImport() {
        pendingWork?.cancel()
        let work = DispatchWorkItem { [onChange] in
            DispatchQueue.main.async(execute: onChange)
        }
        pendingWork = work
        // Watcher is disabled - using event-driven sync only
        workQueue.asyncAfter(deadline: .now() + 5.0, execute: work)
    }

    func stop() {
        if let s = stream {
            FSEventStreamStop(s)
            FSEventStreamInvalidate(s)
            FSEventStreamRelease(s)
            stream = nil
        }
        pendingWork?.cancel()
        pendingWork = nil
    }

    deinit {
        if let s = stream {
            FSEventStreamStop(s)
            FSEventStreamInvalidate(s)
            FSEventStreamRelease(s)
        }
    }
}
