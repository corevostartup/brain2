//
//  ConversationStore.swift
//  Joi
//

import Foundation
import Observation

enum ChatRole: String, Codable, Sendable {
    case user
    case assistant
}

enum ChatBackend: String, Codable, Sendable {
    case ollama
    case openAI
}

struct ChatMessage: Identifiable, Codable, Equatable, Sendable {
    var id: UUID
    var role: ChatRole
    var content: String
    var createdAt: Date
    /// Mensagem de erro da API (não é reenviada ao Ollama).
    var isError: Bool

    enum CodingKeys: String, CodingKey {
        case id, role, content, createdAt, isError
    }

    init(
        id: UUID = UUID(),
        role: ChatRole,
        content: String,
        createdAt: Date = Date(),
        isError: Bool = false
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.createdAt = createdAt
        self.isError = isError
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        role = try c.decode(ChatRole.self, forKey: .role)
        content = try c.decode(String.self, forKey: .content)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        isError = try c.decodeIfPresent(Bool.self, forKey: .isError) ?? false
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(role, forKey: .role)
        try c.encode(content, forKey: .content)
        try c.encode(createdAt, forKey: .createdAt)
        try c.encode(isError, forKey: .isError)
    }
}

struct JoiProject: Identifiable, Codable, Equatable, Sendable {
    var id: UUID
    var name: String
    var createdAt: Date
    /// `nil` = pasta de **raiz** na Joi autorizada; caso contrário = subpasta do projeto pai.
    var parentId: UUID?

    init(id: UUID = UUID(), name: String, parentId: UUID? = nil, createdAt: Date = Date()) {
        self.id = id
        self.name = name
        self.createdAt = createdAt
        self.parentId = parentId
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        parentId = try c.decodeIfPresent(UUID.self, forKey: .parentId)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encode(createdAt, forKey: .createdAt)
        try c.encodeIfPresent(parentId, forKey: .parentId)
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, createdAt, parentId
    }
}

struct Conversation: Identifiable, Codable, Equatable, Sendable {
    var id: UUID
    var title: String
    var messages: [ChatMessage]
    var updatedAt: Date
    /// Pasta/projeto no vault Obsidian; `nil` = conversa na pasta **Memórias** (subpasta da Joi autorizada).
    var projectId: UUID?
    /// Se `true`, o título não é sobrescrito por `recomputeTitle()` ao enviar mensagens (ex.: renomeação manual).
    var titleLocked: Bool

    /// Data de início da conversa (primeira mensagem), para o nome do ficheiro no vault.
    var startedAt: Date {
        messages.map(\.createdAt).min() ?? updatedAt
    }

    mutating func recomputeTitle() {
        if titleLocked { return }
        guard let first = messages.first(where: { $0.role == .user })?.content else {
            title = "Nova conversa"
            return
        }
        let trimmed = first.trimmingCharacters(in: .whitespacesAndNewlines)
        let maxLen = 44
        if trimmed.count <= maxLen {
            title = trimmed.isEmpty ? "Nova conversa" : trimmed
        } else {
            title = String(trimmed.prefix(maxLen)).trimmingCharacters(in: .whitespacesAndNewlines) + "…"
        }
    }

    init(
        id: UUID = UUID(),
        title: String,
        messages: [ChatMessage] = [],
        updatedAt: Date = Date(),
        projectId: UUID? = nil,
        titleLocked: Bool = false
    ) {
        self.id = id
        self.title = title
        self.messages = messages
        self.updatedAt = updatedAt
        self.projectId = projectId
        self.titleLocked = titleLocked
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        messages = try c.decode([ChatMessage].self, forKey: .messages)
        updatedAt = try c.decode(Date.self, forKey: .updatedAt)
        projectId = try c.decodeIfPresent(UUID.self, forKey: .projectId)
        titleLocked = try c.decodeIfPresent(Bool.self, forKey: .titleLocked) ?? false
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(title, forKey: .title)
        try c.encode(messages, forKey: .messages)
        try c.encode(updatedAt, forKey: .updatedAt)
        try c.encodeIfPresent(projectId, forKey: .projectId)
        try c.encode(titleLocked, forKey: .titleLocked)
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, messages, updatedAt, projectId, titleLocked
    }
}

private struct PersistedRoot: Codable {
    var conversations: [Conversation]
    var projects: [JoiProject]?
    var chatBackend: ChatBackend?
    var ollamaModel: String?
    var openAIModel: String?
}

/// Máximo de mensagens (user+assistant) enviadas no corpo do pedido ao modelo; o transcript completo mantém-se na app e no disco.
private let kMaxMessagesInLLMRequest = 80
/// OpenAI: teto mais conservador para reduzir 429 por tokens/minuto em prompts grandes.
private let kMaxMessagesInOpenAIRequest = 24
/// Orçamento aproximado de caracteres para histórico enviado à OpenAI.
private let kOpenAIHistoryCharBudget = 24_000

@MainActor
@Observable
final class ConversationStore {
    var conversations: [Conversation] = []
    var selectedId: UUID?
    var draft = ""
    var chatBackend: ChatBackend = .ollama
    /// Modelo Ollama (ex.: llama3.1).
    var ollamaModel = "llama3.1"
    /// Modelo OpenAI por defeito (configurado no `OpenAIClient.defaultModel`).
    var openAIModel = OpenAIClient.defaultModel
    var isSending = false
    var sidebarSearch = ""
    /// `true` até o utilizador autorizar a pasta do Obsidian (bookmark com sandbox).
    var obsidianNeedsVaultAccess = false
    var projects: [JoiProject] = []
    /// Pasta selecionada na barra lateral; `nil` = lista «Seus chats» (todas as conversas).
    var selectedProjectId: UUID?

    private var vaultMirrorWatcher: ObsidianVaultMirrorWatcher?
    /// Ignorar FSEvents logo após a app gravar no vault (evita ciclo import → save → evento).
    private var ignoreVaultMirrorUntil: Date?
    private var mirrorRetryTask: Task<Void, Never>?

    /// Após apagar uma conversa na Joi, o scan do vault pode ainda ver o `.md` (latência, iCloud) e reintroduzi-la; filtramos esse id durante este intervalo.
    private var recentlyDeletedConversationIds: [UUID: Date] = [:]
    private let recentlyDeletedConversationTTL: TimeInterval = 90

    private let ollamaClient = OllamaClient()
    private let openAIClient = OpenAIClient()
    private let saveURL: URL

    /// Seleciona as mensagens mais recentes respeitando um orçamento aproximado de caracteres.
    private func openAITrimmedHistoryPayload(from messages: [ChatMessage]) -> [OllamaMessagePayload] {
        let recent = messages.filter { !$0.isError }.suffix(kMaxMessagesInOpenAIRequest)
        var out: [OllamaMessagePayload] = []
        out.reserveCapacity(recent.count)
        var used = 0
        for msg in recent.reversed() {
            // Aproximação simples: role + quebras + conteúdo.
            let cost = msg.content.count + 16
            if !out.isEmpty, used + cost > kOpenAIHistoryCharBudget { break }
            out.append(OllamaMessagePayload(role: msg.role.rawValue, content: msg.content))
            used += cost
        }
        return out.reversed()
    }

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = base.appendingPathComponent("Joi", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        saveURL = dir.appendingPathComponent("conversations.json", isDirectory: false)
        load()
        if conversations.isEmpty {
            startNewConversation()
        }
        // Com conversas guardadas: arranque na boas-vindas (`selectedId == nil`) até escolher uma na barra lateral ou enviar mensagem.
        obsidianNeedsVaultAccess = !ObsidianMemorySync.hasStoredVaultAccess()
        // Vault syncing now only happens on user actions (event-driven), not continuous background watching
        
        // Sync on startup if vault is authorized
        if ObsidianMemorySync.hasStoredVaultAccess() {
            importFromObsidianMirror(bypassIgnoreWindow: true)
        }
    }

    /// Autoriza ou altera a pasta Joi no vault (painel do macOS).
    /// - Parameter changingLocation: `true` em Definições ao mudar de destino; `false` na primeira autorização.
    @discardableResult
    func chooseObsidianVaultFolder(changingLocation: Bool = false) -> Bool {
        guard ObsidianMemorySync.presentOpenPanel(changingLocation: changingLocation) else { return false }
        obsidianNeedsVaultAccess = false
        // Sync on user action, not on background watching
        save(syncMarkdownToObsidian: true)
        return true
    }

    /// Banner «Memórias no Obsidian»: primeira autorização da pasta Joi.
    func requestObsidianVaultAccess() {
        _ = chooseObsidianVaultFolder(changingLocation: false)
    }

    /// Sync with Obsidian vault is now event-driven:
    /// - Automatically syncs on: message send, conversation create/delete/rename, folder create
    /// - Manual sync: user can call this from settings (if needed in future)
    /// This eliminates continuous FSEvents polling that caused stuttering
    private func startVaultMirrorWatcher() {
        vaultMirrorWatcher?.stop()
        // Watcher disabled - using event-driven sync instead
        vaultMirrorWatcher = nil
    }

    private func pruneExpiredRecentlyDeletedConversations() {
        let now = Date()
        recentlyDeletedConversationIds = recentlyDeletedConversationIds.filter {
            now.timeIntervalSince($0.value) < recentlyDeletedConversationTTL
        }
    }

    private func markConversationDeletedByUser(_ id: UUID) {
        pruneExpiredRecentlyDeletedConversations()
        recentlyDeletedConversationIds[id] = Date()
    }

    /// O scan do vault preenche `updatedAt` com datas de ficheiro que raramente coincidem com a memória; `==` faria merge falso a cada FSEvent e o chat inteiro re-renderizava (NSTextView a «piscar»).
    private func vaultMirrorConversationsMatchLocal(merged: [Conversation], local: [Conversation]) -> Bool {
        let a = merged.sorted { $0.id.uuidString < $1.id.uuidString }
        let b = local.sorted { $0.id.uuidString < $1.id.uuidString }
        guard a.count == b.count else { return false }
        return zip(a, b).allSatisfy { m, l in
            m.id == l.id
                && m.title == l.title
                && m.messages == l.messages
                && m.projectId == l.projectId
                && m.titleLocked == l.titleLocked
        }
    }

    private func vaultMirrorProjectsMatchLocal(stateProjects: [JoiProject], local: [JoiProject]) -> Bool {
        let a = stateProjects.sorted { $0.id.uuidString < $1.id.uuidString }
        let b = local.sorted { $0.id.uuidString < $1.id.uuidString }
        guard a.count == b.count else { return false }
        return zip(a, b).allSatisfy { x, y in
            x.id == y.id && x.name == y.name && x.parentId == y.parentId
        }
    }

    /// Reconcilia conversas e pastas com os `.md` geridos no vault (Obsidian / Finder).
    /// Now only called on explicit user action (startup or manual sync button), not continuously via FSEvents
    func importFromObsidianMirror(bypassIgnoreWindow: Bool = false) {
        guard ObsidianMemorySync.hasStoredVaultAccess() else { return }
        if !bypassIgnoreWindow, let t = ignoreVaultMirrorUntil, Date() < t { return }
        
        // Event-driven sync: import happens explicitly, not continuously
        guard !isSending else {
            mirrorRetryTask?.cancel()
            mirrorRetryTask = Task { @MainActor in
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                guard !Task.isCancelled else { return }
                importFromObsidianMirror(bypassIgnoreWindow: false)
            }
            return
        }
        mirrorRetryTask?.cancel()
        mirrorRetryTask = nil
        guard let state = ObsidianVaultMirror.scanVaultSync() else { return }
        if state.conversations.isEmpty && state.projects.isEmpty {
            if !conversations.isEmpty || !projects.isEmpty { return }
        }
        pruneExpiredRecentlyDeletedConversations()
        let tombstoned = Set(recentlyDeletedConversationIds.keys)
        let vaultConversationsVisible = state.conversations.filter { !tombstoned.contains($0.id) }
        /// O scan pode correr antes do `.md` existir no disco; substituir tudo apagava conversas novas (ex.: em **Memórias**).
        let vaultById = Dictionary(uniqueKeysWithValues: vaultConversationsVisible.map { ($0.id, $0) })
        var mergedConversations: [Conversation] = vaultConversationsVisible
        for loc in conversations where vaultById[loc.id] == nil {
            mergedConversations.append(loc)
        }
        mergedConversations.sort { $0.startedAt > $1.startedAt }

        if vaultMirrorConversationsMatchLocal(merged: mergedConversations, local: conversations),
           vaultMirrorProjectsMatchLocal(stateProjects: state.projects, local: projects) {
            return
        }

        conversations = mergedConversations
        projects = state.projects

        if let sid = selectedId, !conversations.contains(where: { $0.id == sid }) {
            selectedId = conversations.sorted { $0.startedAt > $1.startedAt }.first?.id
        }
        if let pid = selectedProjectId, !projects.contains(where: { $0.id == pid }) {
            selectedProjectId = nil
        }
        if conversations.isEmpty {
            startNewConversation()
            return
        }
        save(syncMarkdownToObsidian: true)
    }

    func setChatBackend(_ backend: ChatBackend) {
        chatBackend = backend
        save(syncMarkdownToObsidian: false)
    }

    /// Lista da barra lateral: sem pasta selecionada = todas as conversas; com pasta = só as dessa pasta. Pesquisa aplica-se sobre essa lista.
    var filteredConversations: [Conversation] {
        let q = sidebarSearch.trimmingCharacters(in: .whitespacesAndNewlines)
        let base: [Conversation]
        if let pid = selectedProjectId {
            base = conversations
                .filter { $0.projectId == pid }
                .sorted { $0.startedAt > $1.startedAt }
        } else {
            base = conversations.sorted { $0.startedAt > $1.startedAt }
        }
        guard !q.isEmpty else { return base }
        return base.filter { $0.title.localizedCaseInsensitiveContains(q) }
    }

    func conversations(inProject projectId: UUID?) -> [Conversation] {
        conversations
            .filter { $0.projectId == projectId }
            .sorted { $0.startedAt > $1.startedAt }
    }

    var selectedConversation: Conversation? {
        guard let id = selectedId else { return nil }
        return conversations.first { $0.id == id }
    }

    var canSend: Bool {
        guard !isSending, !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return false
        }
        if chatBackend == .openAI, !OpenAIKeychain.hasKey() { return false }
        return true
    }

    /// Incrementado quando a chave OpenAI muda, para a UI atualizar `canSend`.
    private(set) var openAIKeyUpdateCounter = 0

    func saveOpenAIAPIKey(_ raw: String) {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        guard OpenAIKeychain.set(trimmed) else { return }
        openAIKeyUpdateCounter += 1
    }

    /// `projectId == nil` grava no vault na pasta **Memórias** (via `ObsidianMemorySync.syncVault`).
    func startNewConversation(inProject projectId: UUID? = nil) {
        var c = Conversation(
            id: UUID(),
            title: "Nova conversa",
            messages: [],
            updatedAt: Date(),
            projectId: projectId
        )
        c.recomputeTitle()
        conversations.insert(c, at: 0)
        selectedId = c.id
        save(syncMarkdownToObsidian: true)
    }

    /// Pastas de topo ficam na **raiz** da pasta Joi autorizada; `parentId` define subpastas no vault.
    func createProject(named rawName: String, parentId: UUID?) {
        let trimmed = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if let pid = parentId {
            guard projects.contains(where: { $0.id == pid }) else { return }
        }
        let name = uniquifyProjectName(trimmed, parentId: parentId)
        let p = JoiProject(name: name, parentId: parentId)
        projects.append(p)
        selectedProjectId = p.id
        save(syncMarkdownToObsidian: true)
    }

    func sortedChildProjects(under parentId: UUID?) -> [JoiProject] {
        projects
            .filter { $0.parentId == parentId }
            .sorted { $0.createdAt < $1.createdAt }
    }

    func selectProject(_ id: UUID?) {
        selectedProjectId = id
    }

    private func uniquifyProjectName(_ base: String, parentId: UUID?, excludingId: UUID? = nil) -> String {
        var name = base
        var n = 2
        while projects.contains(where: { p in
            p.parentId == parentId && p.name == name && p.id != excludingId
        }) {
            name = "\(base) (\(n))"
            n += 1
        }
        return name
    }

    func selectConversation(_ id: UUID) {
        selectedId = id
    }

    func deleteConversation(id: UUID) {
        if ObsidianMemorySync.hasStoredVaultAccess() {
            ObsidianMemorySync.deleteConversationMarkdownFromVault(conversationId: id)
        }
        conversations.removeAll { $0.id == id }
        if selectedId == id {
            selectedId = conversations.sorted { $0.startedAt > $1.startedAt }.first?.id
        }
        if conversations.isEmpty {
            startNewConversation()
        } else {
            save(syncMarkdownToObsidian: true)
        }
    }

    /// Renomeia a conversa, actualiza `[[wikilink]]` no vault Obsidian e fixa o título (não volta a ser inferido das mensagens).
    func renameConversation(id: UUID, newTitle: String) {
        let trimmed = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let idx = conversations.firstIndex(where: { $0.id == id }) else { return }

        var snapshot = conversations
        let oldStem = ObsidianMemorySync.wikilinkStem(for: snapshot[idx], conversations: snapshot)
        snapshot[idx].title = trimmed
        snapshot[idx].updatedAt = Date()
        let newStem = ObsidianMemorySync.wikilinkStem(for: snapshot[idx], conversations: snapshot)

        if oldStem != newStem {
            ObsidianMemorySync.replaceWikilinkTargetInVault(from: oldStem, to: newStem)
        }

        conversations[idx].title = trimmed
        conversations[idx].updatedAt = Date()
        conversations[idx].titleLocked = true
        save(syncMarkdownToObsidian: true)
    }

    /// Renomeia uma pasta/projeto; actualiza wikilinks no vault quando o stem do índice muda.
    func renameProject(id: UUID, newName: String) {
        let trimmed = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let idx = projects.firstIndex(where: { $0.id == id }) else { return }

        let parentId = projects[idx].parentId
        let finalName: String
        if projects.contains(where: { $0.id != id && $0.parentId == parentId && $0.name == trimmed }) {
            finalName = uniquifyProjectName(trimmed, parentId: parentId, excludingId: id)
        } else {
            finalName = trimmed
        }

        var snapshotProjects = projects
        let oldStem = ObsidianMemorySync.projectWikilinkStem(for: snapshotProjects[idx], projects: snapshotProjects)
        snapshotProjects[idx].name = finalName
        let newStem = ObsidianMemorySync.projectWikilinkStem(for: snapshotProjects[idx], projects: snapshotProjects)

        if oldStem != newStem {
            ObsidianMemorySync.replaceWikilinkTargetInVault(from: oldStem, to: newStem)
        }

        projects[idx].name = finalName
        save(syncMarkdownToObsidian: true)
    }

    func sendDraft() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isSending else { return }

        if selectedId == nil {
            startNewConversation(inProject: selectedProjectId)
        }
        guard let convId = selectedId,
              let idx = conversations.firstIndex(where: { $0.id == convId })
        else { return }

        isSending = true
        defer { isSending = false }

        draft = ""
        conversations[idx].messages.append(ChatMessage(role: .user, content: text))
        conversations[idx].recomputeTitle()
        conversations[idx].updatedAt = Date()
        save(syncMarkdownToObsidian: true)

        let historyMessages = conversations[idx].messages
        let historyPayload: [OllamaMessagePayload]
        if chatBackend == .openAI {
            historyPayload = openAITrimmedHistoryPayload(from: historyMessages)
        } else {
            historyPayload = historyMessages
                .filter { !$0.isError }
                .suffix(kMaxMessagesInLLMRequest)
                .map { OllamaMessagePayload(role: $0.role.rawValue, content: $0.content) }
        }

        var payload: [OllamaMessagePayload] = []
        
        // Usa embeddings se for OpenAI, caso contrário fallback para path + tags
        var vaultMemory: String?
        if chatBackend == .openAI, let apiKey = OpenAIKeychain.get(), OpenAIKeychain.hasKey() {
            vaultMemory = await ObsidianEmbeddingsContext.buildBundleForLLM(
                userMessage: text,
                conversationTitle: conversations[idx].title,
                apiKey: apiKey
            )
        } else {
            // Fallback para método sem embeddings (Ollama ou falha de API)
            vaultMemory = ObsidianVaultContext.buildBundleForLLM(
                userMessage: text,
                conversationTitle: conversations[idx].title
            )
        }
        
        if let vaultMemory, !vaultMemory.isEmpty {
            payload.append(OllamaMessagePayload(role: "system", content: vaultMemory))
        }
        payload.append(contentsOf: historyPayload)

        let modelForLog: String
        switch chatBackend {
        case .ollama:
            modelForLog = ollamaModel.trimmingCharacters(in: .whitespacesAndNewlines)
        case .openAI:
            modelForLog = openAIModel.trimmingCharacters(in: .whitespacesAndNewlines)
        }

        let assistantMsgId = UUID()
        conversations[idx].messages.append(ChatMessage(id: assistantMsgId, role: .assistant, content: ""))

        let streamUI = StreamDisplayThrottler()
        let applyAssistantText: (String) -> Void = { [weak self] text in
            guard let self else { return }
            guard let i = self.conversations.firstIndex(where: { $0.id == convId }),
                  let mi = self.conversations[i].messages.firstIndex(where: { $0.id == assistantMsgId })
            else { return }
            var conv = self.conversations[i]
            conv.messages[mi].content = text
            self.conversations[i] = conv
        }

        do {
            switch chatBackend {
            case .ollama:
                let model = ollamaModel.trimmingCharacters(in: .whitespacesAndNewlines)
                _ = try await ollamaClient.chatStreaming(model: model, messages: payload) { text in
                    streamUI.push(text, apply: applyAssistantText)
                }
            case .openAI:
                guard let apiKey = OpenAIKeychain.get(), OpenAIKeychain.hasKey() else {
                    throw OpenAIClientError.missingAPIKey
                }
                let model = openAIModel.trimmingCharacters(in: .whitespacesAndNewlines)
                _ = try await openAIClient.chatStreaming(
                    apiKey: apiKey,
                    model: model.isEmpty ? OpenAIClient.defaultModel : model,
                    messages: payload
                ) { text in
                    streamUI.push(text, apply: applyAssistantText)
                }
            }
            streamUI.flush(apply: applyAssistantText)
            guard let i = conversations.firstIndex(where: { $0.id == convId })
            else { return }
            var convDone = conversations[i]
            convDone.updatedAt = Date()
            conversations[i] = convDone
        } catch {
            streamUI.cancel()
            guard let i = conversations.firstIndex(where: { $0.id == convId }),
                  let mi = conversations[i].messages.firstIndex(where: { $0.id == assistantMsgId })
            else { return }
            let errText: String
            switch chatBackend {
            case .ollama:
                errText = OllamaConnectionDiagnostics.userMessage(for: error, model: modelForLog)
            case .openAI:
                errText = OpenAIConnectionDiagnostics.userMessage(for: error, model: modelForLog)
            }
            var conv = conversations[i]
            conv.messages[mi].content = errText
            conv.messages[mi].isError = true
            conv.updatedAt = Date()
            conversations[i] = conv
        }

        if let i = conversations.firstIndex(where: { $0.id == convId }) {
            let conv = conversations.remove(at: i)
            conversations.insert(conv, at: 0)
            selectedId = conv.id
        }
        save(syncMarkdownToObsidian: true)
    }

    private func load() {
        guard FileManager.default.fileExists(atPath: saveURL.path) else { return }
        do {
            let data = try Data(contentsOf: saveURL)
            let root = try JSONDecoder().decode(PersistedRoot.self, from: data)
            conversations = root.conversations
            projects = root.projects ?? []
            chatBackend = root.chatBackend ?? .ollama
            if let o = root.ollamaModel, !o.isEmpty { ollamaModel = o }
            if let o = root.openAIModel, !o.isEmpty {
                // Migração de padrão antigo para o novo modelo por defeito.
                openAIModel = (o == "gpt-4o-mini") ? OpenAIClient.defaultModel : o
            }
        } catch {
            conversations = []
        }
    }

    /// - Parameter syncMarkdownToObsidian: só `true` quando conversas/projetos mudaram no Joi (mensagem, novo chat, apagar, renomear, pasta nova, import, pasta Obsidian). Caso contrário não toca no vault (evita ler/reescrever dezenas de `.md` em cada `save`).
    private func save(syncMarkdownToObsidian: Bool = false) {
        do {
            let root = PersistedRoot(
                conversations: conversations,
                projects: projects,
                chatBackend: chatBackend,
                ollamaModel: ollamaModel,
                openAIModel: openAIModel
            )
            let data = try JSONEncoder().encode(root)
            try data.write(to: saveURL, options: [.atomic])
        } catch {}
        guard syncMarkdownToObsidian, ObsidianMemorySync.hasStoredVaultAccess() else { return }
        let touched = ObsidianMemorySync.syncVault(conversations: conversations, projects: projects)
        if touched {
            let proposed = Date().addingTimeInterval(0.9)
            ignoreVaultMirrorUntil = max(proposed, ignoreVaultMirrorUntil ?? .distantPast)
        }
    }
}

// MARK: - Streaming: menos atualizações à UI (SwiftUI + transcript reconstruído em cada mudança)

/// Garante no máximo ~1 pintura do transcript por intervalo; `flush` aplica o texto final ao terminar o stream.
@MainActor
private final class StreamDisplayThrottler {
    private var latest: String?
    private var cooldownTask: Task<Void, Never>?
    private var lastFire: CFAbsoluteTime = 0
    private let minInterval: CFAbsoluteTime = 0.05

    func push(_ text: String, apply: @escaping (String) -> Void) {
        latest = text
        let now = CFAbsoluteTimeGetCurrent()
        if now - lastFire >= minInterval {
            fire(apply: apply)
            return
        }
        cooldownTask?.cancel()
        let waitSec = minInterval - (now - lastFire)
        cooldownTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(max(0.002, waitSec) * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self.fire(apply: apply)
        }
    }

    private func fire(apply: (String) -> Void) {
        cooldownTask?.cancel()
        cooldownTask = nil
        guard let v = latest else { return }
        apply(v)
        lastFire = CFAbsoluteTimeGetCurrent()
    }

    func flush(apply: (String) -> Void) {
        cooldownTask?.cancel()
        cooldownTask = nil
        if let v = latest {
            apply(v)
        }
        lastFire = CFAbsoluteTimeGetCurrent()
    }

    func cancel() {
        cooldownTask?.cancel()
        cooldownTask = nil
        latest = nil
    }
}
