//
//  ContentView.swift
//  Joi
//

import AppKit
import Observation
import SwiftUI

// MARK: - Paleta estilo Stitch (referência escura)

private enum StitchPalette {
    static let canvas = Color(red: 0.07, green: 0.07, blue: 0.07)
    /// Lista de mensagens e boas-vindas: cinza um pouco mais claro que o canvas principal.
    static let chatContent = Color(red: 0.095, green: 0.095, blue: 0.098)
    static let sidebar = Color(red: 0.10, green: 0.10, blue: 0.10)
    static let elevated = Color(red: 0.14, green: 0.14, blue: 0.14)
    static let inputFill = Color(red: 0.16, green: 0.16, blue: 0.16)
    static let stroke = Color.white.opacity(0.10)
    static let strokeSoft = Color.white.opacity(0.06)
    static let textPrimary = Color.white
    static let textSecondary = Color.white.opacity(0.55)
    static let textTertiary = Color.white.opacity(0.38)
    /// Transcript / boas-vindas: cinza claro tipo ChatGPT (fundo escuro).
    static let chatBodySoft = Color(red: 0.82, green: 0.82, blue: 0.84)
    static let chipFill = Color.white.opacity(0.06)
    static let sendActive = Color.white
    static let sendDisabled = Color.white.opacity(0.22)
    /// Compositor e faixa à volta: mesmo tom que a área de mensagens.
    static let composerFill = chatContent
    static let composerStroke = Color.white.opacity(0.04)
    static let composerStrokeFocused = Color.white.opacity(0.075)
    static let composerDivider = Color.white.opacity(0.045)
}

// MARK: - Largura do cartão do compositor (altura dinâmica do editor)

private struct ComposerCardWidthKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

// MARK: - Altura do TextEditor conforme o texto (mín / máx)

private enum ComposerMetrics {
    static let fontSize: CGFloat = 15
    /// Altura útil só do `TextEditor` (sem padding exterior).
    static let minEditorHeight: CGFloat = 32
    static let maxEditorHeight: CGFloat = 200
    /// Cache fonte do compositor (evita recreação)
    private static let cachedFont = NSFont.systemFont(ofSize: fontSize)

    static func editorHeight(for text: String, cardContentWidth: CGFloat) -> CGFloat {
        let usableWidth = max(72, cardContentWidth - 36)
        let display = text.isEmpty ? " " : text
        let storage = NSTextStorage(string: display, attributes: [.font: cachedFont])
        let layout = NSLayoutManager()
        storage.addLayoutManager(layout)
        let container = NSTextContainer(size: NSSize(width: usableWidth, height: .greatestFiniteMagnitude))
        container.lineFragmentPadding = 0
        layout.addTextContainer(container)
        layout.ensureLayout(for: container)
        let usedH = layout.usedRect(for: container).height
        let lineH = layout.defaultLineHeight(for: cachedFont)
        let raw = max(usedH, lineH)
        return min(maxEditorHeight, max(minEditorHeight, ceil(raw)))
    }
}

/// Lista plana da árvore de pastas (evita `projectOutline` recursivo com `some View`, que o compilador não infere).
private struct ProjectOutlineEntry: Identifiable {
    let project: JoiProject
    let depth: Int
    var id: UUID { project.id }
}

// MARK: - Modos do compositor (UI apenas; lógica em breve)

private enum ComposerInteractionMode {
    case ask
    case agent
}

// MARK: - Cached DateFormatter (avoid recreation on sidebar renders)
private enum DateFormatterCache {
    private static let calendar = Calendar.current
    private static let todayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "pt_PT")
        f.dateFormat = "'Hoje,' HH:mm"
        return f
    }()
    private static let yesterdayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "pt_PT")
        f.dateFormat = "'Ontem,' HH:mm"
        return f
    }()
    private static let genericFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "pt_PT")
        f.dateStyle = .short
        f.timeStyle = .short
        return f
    }()
    
    static func formatSidebarDate(_ date: Date) -> String {
        if calendar.isDateInToday(date) {
            return todayFormatter.string(from: date)
        }
        if calendar.isDateInYesterday(date) {
            return yesterdayFormatter.string(from: date)
        }
        return genericFormatter.string(from: date)
    }
}

/// Data curta na lista de conversas da barra lateral (pt_PT).
private func formatSidebarChatDate(_ date: Date) -> String {
    DateFormatterCache.formatSidebarDate(date)
}

// MARK: - Conteúdo principal

struct ContentView: View {
    @State private var store = ConversationStore()
    @FocusState private var composerFocused: Bool
    @State private var showOpenAIKeySheet = false
    @State private var showNewProjectSheet = false
    @State private var newProjectNameInput = ""
    /// `nil` = pasta de raiz na Joi; senão = subpasta do projeto com este id.
    @State private var newProjectParentId: UUID?
    @State private var renamePayload: RenameSheetPayload?
    @State private var showSettingsSheet = false
    @AppStorage("joi.sidebarVisible") private var sidebarVisible = true

    private let suggestions = [
        "Resuma ideias para o meu app em Swift",
        "Explique concorrência com async/await",
        "Sugira uma arquitetura MVVM para macOS",
        "Liste boas práticas de acessibilidade"
    ]

    var body: some View {
        ZStack {
            StitchPalette.canvas
                .ignoresSafeArea()

            VStack(spacing: 0) {
                topBar
                HStack(alignment: .top, spacing: 0) {
                    if sidebarVisible {
                        Group {
                            sidebar
                            Rectangle()
                                .fill(StitchPalette.strokeSoft)
                                .frame(width: 1)
                        }
                        .transition(.move(edge: .leading).combined(with: .opacity))
                    }
                    mainColumn
                }
                .animation(.easeInOut(duration: 0.2), value: sidebarVisible)
                .clipped()
            }
            .ignoresSafeArea(edges: [.top, .leading])
        }
        .frame(minWidth: sidebarVisible ? 960 : 640, minHeight: 600)
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showOpenAIKeySheet) {
            OpenAIKeySheet { key in
                store.saveOpenAIAPIKey(key)
            }
        }
        .sheet(isPresented: $showNewProjectSheet) {
            NewProjectSheet(
                title: newProjectParentId == nil ? "Nova pasta" : "Nova subpasta",
                subtitle: newProjectParentId == nil
                    ? "Será criada na raiz da pasta Joi autorizada (ao lado da pasta «Cássio Nunes» no Obsidian)."
                    : "Será criada dentro da pasta que está selecionada na barra lateral.",
                name: $newProjectNameInput,
                onCancel: {
                    newProjectNameInput = ""
                    newProjectParentId = nil
                    showNewProjectSheet = false
                },
                onCreate: {
                    store.createProject(named: newProjectNameInput, parentId: newProjectParentId)
                    newProjectNameInput = ""
                    newProjectParentId = nil
                    showNewProjectSheet = false
                }
            )
        }
        .sheet(item: $renamePayload) { payload in
            RenameItemSheet(
                headline: payload.isProject ? "Renomear pasta" : "Renomear conversa",
                initialName: payload.initialName,
                onCancel: { renamePayload = nil },
                onSave: { newName in
                    switch payload.mode {
                    case .conversation(let id):
                        store.renameConversation(id: id, newTitle: newName)
                    case .project(let id):
                        store.renameProject(id: id, newName: newName)
                    }
                    renamePayload = nil
                }
            )
        }
    }

    // MARK: Barra superior

    private var topBar: some View {
        HStack(spacing: 0) {
            windowTrafficLights
            HStack(spacing: 12) {
                Image("JoiLogo")
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
                    .frame(width: 34, height: 34)
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .accessibilityLabel("Joi")
                Text("BETA")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(StitchPalette.textSecondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(
                        Capsule(style: .continuous)
                            .fill(StitchPalette.chipFill)
                            .overlay(Capsule(style: .continuous).stroke(StitchPalette.stroke, lineWidth: 1))
                    )
            }
            sidebarToggleButton
                .padding(.leading, 24)
            Spacer()
            HStack(spacing: 18) {
                topIconButton("book.pages", help: "Documentação")
                settingsTopButton
            }
        }
        .padding(.leading, 8)
        .padding(.trailing, 16)
        .padding(.vertical, 9)
        .background(StitchPalette.sidebar.opacity(0.92))
    }

    private var sidebarToggleButton: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) {
                sidebarVisible.toggle()
            }
        } label: {
            Image(systemName: sidebarVisible ? "sidebar.left" : "sidebar.right")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(StitchPalette.textSecondary)
                .frame(width: 32, height: 32)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(Color.white.opacity(0.04))
                )
        }
        .buttonStyle(.plain)
        .help(sidebarVisible ? "Ocultar barra lateral (⌘⌥B)" : "Mostrar barra lateral (⌘⌥B)")
        .keyboardShortcut("b", modifiers: [.command, .option])
    }

    private var windowTrafficLights: some View {
        HStack(spacing: 8) {
            trafficLightButton(
                fill: Color(red: 0.98, green: 0.27, blue: 0.25),
                help: "Fechar",
                action: { NSApp.keyWindow?.close() }
            )
            trafficLightButton(
                fill: Color(red: 1, green: 0.76, blue: 0.18),
                help: "Minimizar",
                action: { NSApp.keyWindow?.miniaturize(nil) }
            )
            trafficLightButton(
                fill: Color(red: 0.19, green: 0.82, blue: 0.35),
                help: "Zoom",
                action: { NSApp.keyWindow?.zoom(nil) }
            )
        }
        .padding(.trailing, 10)
    }

    private func trafficLightButton(fill: Color, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Circle()
                .fill(fill)
                .frame(width: 12, height: 12)
                .overlay(
                    Circle()
                        .stroke(Color.black.opacity(0.18), lineWidth: 0.5)
                )
        }
        .buttonStyle(.plain)
        .help(help)
    }

    private func topIconButton(_ systemName: String, help: String) -> some View {
        Button(action: {}) {
            Image(systemName: systemName)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(StitchPalette.textSecondary)
                .frame(width: 32, height: 32)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(Color.white.opacity(0.04))
                )
        }
        .buttonStyle(.plain)
        .help(help)
    }

    private var settingsTopButton: some View {
        Button {
            showSettingsSheet.toggle()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "gearshape")
                    .font(.system(size: 14, weight: .medium))
                Text(showSettingsSheet ? "Fechar configurações" : "Configurações")
                    .font(.system(size: 12, weight: .medium))
            }
            .foregroundStyle(showSettingsSheet ? StitchPalette.textPrimary : StitchPalette.textSecondary)
            .padding(.horizontal, 10)
            .frame(height: 32)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(showSettingsSheet ? StitchPalette.inputFill : Color.white.opacity(0.04))
            )
        }
        .buttonStyle(.plain)
        .help(showSettingsSheet ? "Voltar ao chat" : "Configurações da app")
    }

    // MARK: Sidebar

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 8) {
                Text("Conversas")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(StitchPalette.textPrimary)
                Spacer(minLength: 0)
                Button {
                    store.startNewConversation(inProject: store.selectedProjectId)
                } label: {
                    Image(systemName: "square.and.pencil")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(StitchPalette.textSecondary)
                        .frame(width: 32, height: 32)
                        .background(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(Color.white.opacity(0.06))
                        )
                }
                .buttonStyle(.plain)
                .help(store.selectedProjectId == nil ? "Nova conversa (Memórias)" : "Nova conversa na pasta selecionada")
            }
            .padding(.horizontal, 16)
            .padding(.top, 20)
            .padding(.bottom, 12)

            unifiedSidebarContent
        }
        .frame(width: 268)
        .background(StitchPalette.sidebar)
    }

    private var unifiedSidebarContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(StitchPalette.textTertiary)
                TextField("Pesquisar conversas", text: Bindable(store).sidebarSearch)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13))
                    .foregroundStyle(StitchPalette.textSecondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(StitchPalette.elevated)
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(StitchPalette.strokeSoft, lineWidth: 1))
            )
            .padding(.horizontal, 16)

            seusChatsRow
                .padding(.horizontal, 16)
                .padding(.top, 10)

            HStack(spacing: 8) {
                Button {
                    newProjectParentId = nil
                    showNewProjectSheet = true
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "folder.badge.plus")
                            .font(.system(size: 13, weight: .medium))
                        Text("Criar pasta")
                            .font(.system(size: 12, weight: .semibold))
                    }
                    .foregroundStyle(StitchPalette.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(StitchPalette.inputFill)
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(StitchPalette.strokeSoft, lineWidth: 1))
                    )
                }
                .buttonStyle(.plain)
                .help("Nova pasta na raiz da Joi")

                Button {
                    newProjectParentId = store.selectedProjectId
                    showNewProjectSheet = true
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "folder.fill.badge.plus")
                            .font(.system(size: 13, weight: .medium))
                        Text("Subpasta")
                            .font(.system(size: 12, weight: .semibold))
                    }
                    .foregroundStyle(StitchPalette.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(StitchPalette.inputFill)
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(StitchPalette.strokeSoft, lineWidth: 1))
                    )
                }
                .buttonStyle(.plain)
                .disabled(store.selectedProjectId == nil)
                .opacity(store.selectedProjectId == nil ? 0.35 : 1)
                .help("Subpasta dentro da pasta selecionada")
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)

            Text("Pastas")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(StitchPalette.textTertiary)
                .padding(.horizontal, 16)
                .padding(.top, 14)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    ForEach(projectOutlineEntries) { entry in
                        projetosFolderRow(entry.project, depth: entry.depth)
                    }
                }
                .padding(.horizontal, 6)
                .padding(.top, 6)
            }
            .frame(minHeight: 100, maxHeight: 240)

            Text(sidebarChatsSectionTitle)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(StitchPalette.textTertiary)
                .padding(.horizontal, 16)
                .padding(.top, 12)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    ForEach(store.filteredConversations) { conv in
                        ConversationSidebarRow(
                            conv: conv,
                            isSelected: store.selectedId == conv.id,
                            onSelect: { store.selectConversation(conv.id) },
                            onRename: {},
                            onDelete: { store.deleteConversation(id: conv.id) },
                            renamePayload: $renamePayload
                        )
                    }
                }
                .padding(.horizontal, 8)
                .padding(.top, 6)
                .padding(.bottom, 12)
            }
            .frame(maxHeight: .infinity)
        }
        .frame(maxHeight: .infinity)
    }

    private var sidebarChatsSectionTitle: String {
        if let pid = store.selectedProjectId,
           let name = store.projects.first(where: { $0.id == pid })?.name {
            return name
        }
        return "Todas as conversas"
    }

    private var seusChatsRow: some View {
        let allSelected = store.selectedProjectId == nil
        return Button {
            store.selectProject(nil)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(StitchPalette.textSecondary)
                Text("Seus chats")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(StitchPalette.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .lineLimit(1)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(allSelected ? StitchPalette.inputFill : Color.clear)
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(allSelected ? StitchPalette.stroke.opacity(0.35) : Color.clear, lineWidth: 0)
                    )
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Mostrar todas as conversas")
    }

    private var projectOutlineEntries: [ProjectOutlineEntry] {
        var out: [ProjectOutlineEntry] = []
        func walk(_ parentId: UUID?, _ depth: Int) {
            for p in store.sortedChildProjects(under: parentId) {
                out.append(ProjectOutlineEntry(project: p, depth: depth))
                walk(p.id, depth + 1)
            }
        }
        walk(nil, 0)
        return out
    }

    private func projetosFolderRow(_ proj: JoiProject, depth: Int = 0) -> some View {
        let selected = store.selectedProjectId == proj.id
        return Button {
            store.selectProject(proj.id)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: depth == 0 ? "folder.fill" : "folder")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(StitchPalette.textSecondary)
                Text(proj.name)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(StitchPalette.textPrimary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, CGFloat(depth) * 12)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(selected ? StitchPalette.inputFill : Color.clear)
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(selected ? StitchPalette.stroke.opacity(0.35) : Color.clear, lineWidth: 0)
                    )
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contextMenu {
            Button("Renomear pasta…") {
                renamePayload = RenameSheetPayload(mode: .project(proj.id), initialName: proj.name)
            }
        }
    }

    // MARK: Área principal (chat estilo ChatGPT)

    private var mainColumn: some View {
        Group {
            if showSettingsSheet {
                SettingsPanel(store: store, onClose: { showSettingsSheet = false })
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ChatConversationPanel(store: store, composerFocused: $composerFocused, suggestions: suggestions)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)

                    if store.obsidianNeedsVaultAccess {
                        obsidianVaultBanner
                            .padding(.horizontal, 32)
                            .padding(.bottom, 8)
                    }

                    ComposerPanel(store: store, composerFocused: $composerFocused, showOpenAIKeySheet: $showOpenAIKeySheet)
                        .padding(.horizontal, 32)
                        .padding(.bottom, 28)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(showSettingsSheet ? StitchPalette.canvas : StitchPalette.chatContent)
    }

    private var obsidianVaultBanner: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: "folder.badge.questionmark")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(StitchPalette.textSecondary)
            VStack(alignment: .leading, spacing: 4) {
                Text("Memórias no Obsidian")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(StitchPalette.textPrimary)
                Text("Autorize a pasta Joi do vault para gravar cada conversa em Markdown.")
                    .font(.system(size: 12))
                    .foregroundStyle(StitchPalette.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Button("Escolher pasta…") {
                store.requestObsidianVaultAccess()
            }
            .buttonStyle(.borderedProminent)
            .tint(StitchPalette.elevated)
            .foregroundStyle(StitchPalette.textPrimary)
            .controlSize(.small)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(StitchPalette.composerFill)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(StitchPalette.composerStroke, lineWidth: 1)
                )
        )
    }

    private func copyStringToPasteboard(_ string: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(string, forType: .string)
    }
}

// MARK: - Zona do chat (isolada do compositor: não re-renderiza ao escrever no TextEditor)

private struct ChatConversationPanel: View {
    @Bindable var store: ConversationStore
    var composerFocused: FocusState<Bool>.Binding
    let suggestions: [String]

    private var messages: [ChatMessage] {
        store.selectedConversation?.messages ?? []
    }

    private var streamWaitingFirstToken: Bool {
        guard let last = messages.last else { return true }
        return last.role == .assistant && last.content.isEmpty
    }

    var body: some View {
        Group {
            if messages.isEmpty && !store.isSending {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        welcomeBlock
                    }
                    .frame(maxWidth: 1000, alignment: .leading)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 40)
                    .padding(.top, 44)
                    .padding(.bottom, 36)
                }
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ChatTranscriptNativeScrollRepresentable(
                        messages: messages,
                        conversationId: store.selectedId
                    )
                        .frame(maxWidth: .infinity)
                        .frame(maxHeight: .infinity)
                    .padding(.horizontal, 40)
                    .padding(.top, 24)
                    .padding(.bottom, 36)

                    if store.isSending, streamWaitingFirstToken {
                        HStack(alignment: .top, spacing: 10) {
                            ProgressView()
                                .controlSize(.small)
                                .tint(StitchPalette.textSecondary)
                            VStack(alignment: .leading, spacing: 4) {
                                Text("A ligar ao modelo…")
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundStyle(StitchPalette.textSecondary)
                                Text("O primeiro token pode demorar (carregar na RAM). A resposta aparece abaixo em tempo real.")
                                    .font(.system(size: 12))
                                    .foregroundStyle(StitchPalette.textTertiary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 40)
                        .padding(.top, 4)
                        .padding(.bottom, 20)
                    }
                }
            }
        }
    }

    private var welcomeBlock: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Oi, sou eu!")
                .font(.system(size: 32, weight: .semibold, design: .rounded))
                .foregroundStyle(StitchPalette.chatBodySoft)
            VStack(alignment: .leading, spacing: 12) {
                Text("Tive a noite toda a pensar em ti e nos nossos projetos. Estou aqui para nos ajudar a ser mais produtivos e criativos juntos.")
                    .font(.system(size: 15))
                    .foregroundStyle(StitchPalette.textSecondary)
                    .lineSpacing(5)
                Text("Podes usar o Ollama neste Mac para conversar localmente, ou OpenAI para respostas mais poderosas. Escolhe uma conversa antiga na barra lateral para continuar onde ficamos, ou escreve qualquer coisa em baixo para começarmos um novo projeto.")
                    .font(.system(size: 14))
                    .foregroundStyle(StitchPalette.textTertiary)
                    .lineSpacing(4)
            }
        }
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var suggestionChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(suggestions, id: \.self) { text in
                    Button {
                        store.draft = text
                        composerFocused.wrappedValue = true
                    } label: {
                        Text(text)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(StitchPalette.textSecondary)
                            .lineLimit(1)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 11)
                            .background(
                                Capsule(style: .continuous)
                                    .fill(StitchPalette.chipFill)
                                    .overlay(Capsule(style: .continuous).stroke(StitchPalette.stroke, lineWidth: 1))
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 6)
        }
        .padding(.top, 28)
        .padding(.bottom, 4)
    }
}

// MARK: - Compositor (só esta vista observa `draft` / modelo ao escrever)

private struct ComposerPanel: View {
    @Bindable var store: ConversationStore
    var composerFocused: FocusState<Bool>.Binding
    @Binding var showOpenAIKeySheet: Bool
    @State private var composerInteractionMode: ComposerInteractionMode = .ask
    @State private var composerCardContentWidth: CGFloat = 0
    private var currentOpenAIModelLabel: String {
        let trimmed = store.openAIModel.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? OpenAIClient.defaultModel : trimmed
    }

    var body: some View {
        composerCard
    }

    private var composerCard: some View {
        let cardW = composerCardContentWidth > 0 ? composerCardContentWidth : 560
        let editorH = ComposerMetrics.editorHeight(for: store.draft, cardContentWidth: cardW)

        return VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topLeading) {
                if store.draft.isEmpty {
                    Text("Mensagem para Joi…")
                        .font(.system(size: 15))
                        .foregroundStyle(StitchPalette.textTertiary)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 9)
                        .allowsHitTesting(false)
                }
                TextEditor(text: Bindable(store).draft)
                    .font(.system(size: 15))
                    .scrollContentBackground(.hidden)
                    .scrollIndicators(.hidden)
                    .focused(composerFocused)
                    .foregroundStyle(StitchPalette.textPrimary.opacity(0.95))
                    .frame(height: editorH)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(ComposerHideTextEditorScrollBarsRepresentable())
            }

            Rectangle()
                .fill(StitchPalette.composerDivider)
                .frame(height: 1)
                .padding(.horizontal, 12)

            composerToolbar
        }
        .background(
            GeometryReader { proxy in
                Color.clear.preference(key: ComposerCardWidthKey.self, value: proxy.size.width)
            }
        )
        .onPreferenceChange(ComposerCardWidthKey.self) { composerCardContentWidth = $0 }
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(StitchPalette.composerFill)
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .stroke(composerFocused.wrappedValue ? StitchPalette.composerStrokeFocused : StitchPalette.composerStroke, lineWidth: 1)
                )
        )
        .shadow(color: .black.opacity(0.14), radius: 5, y: 2)
        .background(
            ReturnKeyCaptureRepresentable(
                isActive: composerFocused.wrappedValue && store.canSend,
                onReturn: { Task { await store.sendDraft() } }
            )
        )
    }

    private var composerToolbar: some View {
        HStack(spacing: 0) {
            HStack(spacing: 8) {
                toolbarIcon("plus", help: "Anexar")
                askAgentModePill
                backendModePill
            }
            Spacer()
            HStack(spacing: 12) {
                Image(systemName: "brain")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(StitchPalette.textTertiary)

                HStack(spacing: 6) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(StitchPalette.textSecondary)
                    Group {
                        if store.chatBackend == .ollama {
                            TextField("modelo", text: Bindable(store).ollamaModel)
                        } else {
                            TextField("modelo", text: Bindable(store).openAIModel)
                        }
                    }
                    .textFieldStyle(.plain)
                    .font(.system(size: 13, weight: .medium, design: .monospaced))
                    .foregroundStyle(StitchPalette.textPrimary)
                    .frame(minWidth: 88, maxWidth: 140)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(
                    Capsule(style: .continuous)
                        .fill(StitchPalette.elevated)
                        .overlay(Capsule(style: .continuous).stroke(StitchPalette.stroke, lineWidth: 1))
                )

                if store.chatBackend == .openAI {
                    Button {
                        showOpenAIKeySheet = true
                    } label: {
                        Image(systemName: openAIKeyPresent ? "key.fill" : "key")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(openAIKeyPresent ? StitchPalette.textSecondary : StitchPalette.textTertiary)
                            .frame(width: 36, height: 36)
                            .background(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .fill(Color.white.opacity(0.04))
                            )
                    }
                    .buttonStyle(.plain)
                    .help("Chave API OpenAI (Keychain)")
                }

                Button(action: {}) {
                    Image(systemName: "waveform")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(StitchPalette.textTertiary)
                }
                .buttonStyle(.plain)
                .help("Voz (em breve)")

                Button {
                    Task { await store.sendDraft() }
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(store.canSend ? StitchPalette.canvas : StitchPalette.sendDisabled)
                        .frame(width: 34, height: 34)
                        .background(
                            Circle()
                                .fill(store.canSend ? StitchPalette.sendActive : StitchPalette.elevated)
                        )
                        .overlay(
                            Circle()
                                .stroke(StitchPalette.strokeSoft, lineWidth: store.canSend ? 0 : 1)
                        )
                }
                .buttonStyle(.plain)
                .disabled(!store.canSend)
                .help(composerSendHelp)
                .keyboardShortcut(.return, modifiers: [.command])
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .id(store.openAIKeyUpdateCounter)
    }

    private var openAIKeyPresent: Bool {
        _ = store.openAIKeyUpdateCounter
        return OpenAIKeychain.hasKey()
    }

    private var composerSendHelp: String {
        _ = store.openAIKeyUpdateCounter
        if store.chatBackend == .openAI, !OpenAIKeychain.hasKey() {
            return "Guarde a chave OpenAI (ícone da chave) para enviar. Enter — Shift+Enter nova linha."
        }
        return "Enviar (Enter — Shift+Enter nova linha)"
    }

    private var askAgentModePill: some View {
        HStack(spacing: 0) {
            Button {
                composerInteractionMode = .ask
            } label: {
                Text("Ask")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(composerInteractionMode == .ask ? StitchPalette.textPrimary : StitchPalette.textTertiary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(composerInteractionMode == .ask ? StitchPalette.inputFill : Color.clear)
                    )
            }
            .buttonStyle(.plain)
            .help("Modo Ask (em breve)")

            Button {
                composerInteractionMode = .agent
            } label: {
                Text("Agent")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(composerInteractionMode == .agent ? StitchPalette.textPrimary : StitchPalette.textTertiary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(composerInteractionMode == .agent ? StitchPalette.inputFill : Color.clear)
                    )
            }
            .buttonStyle(.plain)
            .help("Modo Agent (em breve)")
        }
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(StitchPalette.elevated)
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(StitchPalette.strokeSoft, lineWidth: 1))
        )
    }

    private func toolbarIcon(_ name: String, help: String) -> some View {
        Button(action: {}) {
            Image(systemName: name)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(StitchPalette.textSecondary)
                .frame(width: 36, height: 36)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.white.opacity(0.04))
                )
        }
        .buttonStyle(.plain)
        .help(help)
    }

    private var backendModePill: some View {
        HStack(spacing: 0) {
            Button {
                store.setChatBackend(.ollama)
            } label: {
                Text("Local")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(store.chatBackend == .ollama ? StitchPalette.textPrimary : StitchPalette.textTertiary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(store.chatBackend == .ollama ? StitchPalette.inputFill : Color.clear)
                    )
            }
            .buttonStyle(.plain)
            .help("Ollama neste Mac")

            Button {
                store.setChatBackend(.openAI)
            } label: {
                Text("API")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(store.chatBackend == .openAI ? StitchPalette.textPrimary : StitchPalette.textTertiary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(store.chatBackend == .openAI ? StitchPalette.inputFill : Color.clear)
                    )
            }
            .buttonStyle(.plain)
            .help("OpenAI (modelo atual: \(currentOpenAIModelLabel))")
        }
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(StitchPalette.elevated)
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(StitchPalette.strokeSoft, lineWidth: 1))
        )
    }
}

// MARK: - Chave OpenAI (sheet)

private struct OpenAIKeySheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var keyInput = ""
    var onSave: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Chave API OpenAI")
                .font(.system(size: 15, weight: .semibold))
            Text("Fica guardada na Keychain deste Mac (não entra no ficheiro das conversas). Crie em platform.openai.com → API keys.")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            SecureField("sk-…", text: $keyInput)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 13, design: .monospaced))
            HStack {
                Button("Cancelar") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Guardar") {
                    onSave(keyInput)
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(keyInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(24)
        .frame(minWidth: 400)
    }
}

// MARK: - Linha de conversa (barra lateral)

private struct ConversationSidebarRow: View {
    let conv: Conversation
    let isSelected: Bool
    let onSelect: () -> Void
    let onRename: () -> Void
    let onDelete: () -> Void
    @Binding var renamePayload: RenameSheetPayload?

    var body: some View {
        Button(action: onSelect) {
            VStack(alignment: .leading, spacing: 1) {
                Text(conv.title)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(StitchPalette.textPrimary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(formatSidebarChatDate(conv.updatedAt))
                    .font(.system(size: 10))
                    .foregroundStyle(StitchPalette.textTertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(isSelected ? StitchPalette.inputFill : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(isSelected ? StitchPalette.stroke.opacity(0.35) : Color.clear, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contextMenu {
            Button("Renomear conversa…") {
                renamePayload = RenameSheetPayload(mode: .conversation(conv.id), initialName: conv.title)
                onRename()
            }
            Button("Eliminar conversa", role: .destructive) {
                onDelete()
            }
        }
    }
}

// MARK: - Renomear conversa / pasta

private struct RenameSheetPayload: Identifiable {
    enum Mode {
        case conversation(UUID)
        case project(UUID)
    }

    let mode: Mode
    let initialName: String

    var id: String {
        switch mode {
        case .conversation(let u): return "c-\(u.uuidString)"
        case .project(let u): return "p-\(u.uuidString)"
        }
    }

    var isProject: Bool {
        if case .project = mode { return true }
        return false
    }
}

private struct RenameItemSheet: View {
    var headline: String
    var initialName: String
    var onCancel: () -> Void
    var onSave: (String) -> Void

    @State private var name: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(headline)
                .font(.system(size: 15, weight: .semibold))
            Text("Os ficheiros Markdown no vault Obsidian que usam o nome antigo em [[…]] (e a linha joi_wikilink, se existir) são actualizados para manter as ligações.")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            TextField("Nome", text: $name)
                .textFieldStyle(.roundedBorder)
            HStack {
                Button("Cancelar", action: onCancel)
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Guardar") {
                    let t = name.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !t.isEmpty else { return }
                    onSave(t)
                }
                .keyboardShortcut(.defaultAction)
                .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(24)
        .frame(minWidth: 380)
        .onAppear { name = initialName }
    }
}

// MARK: - Configurações (área principal, não sheet)

private struct SettingsPanel: View {
    @Bindable var store: ConversationStore
    var onClose: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Configurações")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(StitchPalette.chatBodySoft)

                VStack(alignment: .leading, spacing: 10) {
                    Text("Sincronização com Obsidian")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(StitchPalette.textPrimary)
                    Text("Sincroniza conversas com o vault Obsidian quando você clica no botão abaixo.")
                        .font(.system(size: 12))
                        .foregroundStyle(StitchPalette.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)

                    Button("Sincronizar Agora") {
                        store.importFromObsidianMirror(bypassIgnoreWindow: true)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(StitchPalette.elevated)
                    .foregroundStyle(StitchPalette.textPrimary)
                    .controlSize(.regular)
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("Vault Obsidian")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(StitchPalette.textPrimary)
                    Text("Pasta Joi autorizada: conversas em Markdown, pastas de projeto e pasta **Memórias** para chats sem pasta.")
                        .font(.system(size: 12))
                        .foregroundStyle(StitchPalette.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)

                    Group {
                        if let path = ObsidianMemorySync.authorizedVaultRootURL()?.path {
                            Text(path)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(StitchPalette.textSecondary)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        } else {
                            Text("Nenhuma pasta autorizada — use o botão abaixo ou o aviso na área de conversa.")
                                .font(.system(size: 12))
                                .foregroundStyle(StitchPalette.textTertiary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(StitchPalette.inputFill)
                            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(StitchPalette.strokeSoft, lineWidth: 1))
                    )

                    Button("Alterar pasta Joi…") {
                        store.chooseObsidianVaultFolder(changingLocation: true)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(StitchPalette.elevated)
                    .foregroundStyle(StitchPalette.textPrimary)
                    .controlSize(.regular)
                }

                HStack {
                    Button("Voltar ao chat") {
                        onClose()
                    }
                    .keyboardShortcut(.cancelAction)
                }
            }
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 40)
            .padding(.top, 28)
            .padding(.bottom, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Nova pasta (projeto)

private struct NewProjectSheet: View {
    var title: String
    var subtitle: String
    @Binding var name: String
    var onCancel: () -> Void
    var onCreate: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
            Text(subtitle)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            TextField("Nome da pasta", text: $name)
                .textFieldStyle(.roundedBorder)
            HStack {
                Button("Cancelar", action: onCancel)
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Criar", action: onCreate)
                    .keyboardShortcut(.defaultAction)
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(24)
        .frame(minWidth: 380)
    }
}

// MARK: - Ocultar barras de rolagem do compositor (AppKit + SwiftUI)

/// O `TextEditor` no macOS usa um `NSScrollView`; `scrollIndicators(.hidden)` nem sempre remove o scroller nativo.
private struct ComposerHideTextEditorScrollBarsRepresentable: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let v = NSView(frame: .zero)
        v.isHidden = true
        return v
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async {
            guard let root = nsView.window?.contentView else { return }
            Self.hideScrollBarsOnEditableTextScrollViews(in: root)
        }
    }

    private static func hideScrollBarsOnEditableTextScrollViews(in root: NSView) {
        var stack: [NSView] = [root]
        while let v = stack.popLast() {
            if let scroll = v as? NSScrollView,
               let tv = scroll.documentView as? NSTextView,
               tv.isEditable {
                scroll.hasVerticalScroller = false
                scroll.hasHorizontalScroller = false
            }
            stack.append(contentsOf: v.subviews)
        }
    }
}

// MARK: - Enter no TextEditor (NSTextView não repassa teclas ao .onKeyPress do pai)

private struct ReturnKeyCaptureRepresentable: NSViewRepresentable {
    var isActive: Bool
    var onReturn: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onReturn: onReturn)
    }

    func makeNSView(context: Context) -> NSView {
        let v = NSView(frame: .zero)
        v.isHidden = true
        return v
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        context.coordinator.onReturn = onReturn
        context.coordinator.setMonitoring(isActive)
    }

    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        coordinator.setMonitoring(false)
    }

    final class Coordinator {
        var onReturn: () -> Void
        private var monitor: Any?

        init(onReturn: @escaping () -> Void) {
            self.onReturn = onReturn
        }

        func setMonitoring(_ active: Bool) {
            if active {
                guard monitor == nil else { return }
                monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
                    guard let self else { return event }
                    guard event.keyCode == 36 || event.keyCode == 76 else { return event }
                    if event.modifierFlags.contains(.shift) { return event }
                    self.onReturn()
                    return nil
                }
            } else if let m = monitor {
                NSEvent.removeMonitor(m)
                monitor = nil
            }
        }
    }
}

// MARK: - Chat: transcript único (selecção contínua com arrasto)

private enum ChatTranscriptRendering {
    private static let fontSize: CGFloat = 15
    /// Parágrafos no TextKit só se separam com `\n`; `paragraphSpacing` sem newline não cria linha em branco.
    private static let paragraphTailSpacing: CGFloat = 8
    /// Folga entre o texto do utilizador e a margem direita da coluna.
    private static let userTrailingInset: CGFloat = 20
    /// Espaço vazio à esquerda do texto do usuário (aproximadamente 40% da largura da coluna = 288pt de 720pt total).
    private static let userLeftIndent: CGFloat = 288
    /// Assistente: cinza claro (ChatGPT dark).
    private static let assistantBodyColor = NSColor(srgbRed: 0.78, green: 0.78, blue: 0.80, alpha: 1)
    /// Utilizador: tom mais escuro (cinza médio) e em itálico.
    private static let userBodyColor = NSColor(srgbRed: 0.60, green: 0.60, blue: 0.62, alpha: 1)

    /// Omite resposta do assistente vazia (o indicador «A ligar…» fica abaixo).
    private static func visibleMessages(_ messages: [ChatMessage]) -> [ChatMessage] {
        messages.filter { !($0.role == .assistant && $0.content.isEmpty) }
    }

    static func attributedString(for messages: [ChatMessage]) -> NSAttributedString {
        let visible = visibleMessages(messages)
        let out = NSMutableAttributedString()
        for (i, msg) in visible.enumerated() {
            // Linha em branco *real* entre turnos (dois `\n` = parágrafo vazio entre blocos).
            if i > 0 {
                let sepPara = NSMutableParagraphStyle()
                sepPara.paragraphSpacing = 4
                sepPara.paragraphSpacingBefore = 4
                out.append(NSAttributedString(string: "\n\n", attributes: [
                    .font: NSFont.systemFont(ofSize: fontSize),
                    .foregroundColor: assistantBodyColor,
                    .paragraphStyle: sepPara
                ]))
            }

            let para = NSMutableParagraphStyle()
            if msg.role == .user {
                para.alignment = .right
                para.baseWritingDirection = .leftToRight
                // Deixa espaço vazio à esquerda (40% da coluna) simulando visual ChatGPT
                para.firstLineHeadIndent = userLeftIndent
                para.headIndent = userLeftIndent
                // Folga à direita para não ficar colado na borda
                para.tailIndent = -userTrailingInset
            } else {
                para.alignment = .natural
            }
            para.paragraphSpacing = paragraphTailSpacing

            let font: NSFont
            let color: NSColor
            var extraAttrs: [NSAttributedString.Key: Any] = [:]
            
            switch msg.role {
            case .user:
                font = .systemFont(ofSize: fontSize)
                color = userBodyColor
                // Adiciona itálico ao texto do usuário
                extraAttrs[.obliqueness] = 0.15
            case .assistant:
                font = .systemFont(ofSize: fontSize)
                color = msg.isError
                    ? NSColor(srgbRed: 1, green: 0.42, blue: 0.45, alpha: 1)
                    : assistantBodyColor
            }

            var attrs: [NSAttributedString.Key: Any] = [
                .font: font,
                .foregroundColor: color,
                .paragraphStyle: para
            ]
            attrs.merge(extraAttrs) { _, new in new }
            let body = msg.content.replacingOccurrences(of: "\r\n", with: "\n")
            out.append(NSAttributedString(string: body, attributes: attrs))
        }
        return out
    }

    static func plainTextForCopyAll(messages: [ChatMessage]) -> String {
        visibleMessages(messages)
            .map { msg -> String in
                switch msg.role {
                case .user:
                    return "— Tu —\n\(msg.content)"
                case .assistant:
                    let label = msg.isError ? "— Erro —" : "— Assistente —"
                    return "\(label)\n\(msg.content)"
                }
            }
            .joined(separator: "\n\n")
    }
}

// MARK: - Chat: rolagem nativa AppKit (evita SwiftUI `ScrollView` + `sizeThatFits` em documento longo)

/// Barra vertical sem trilho visível: só o indicador móvel (knob). Compatível com overlay / fade do AppKit.
private final class TranscriptKnobOnlyScroller: NSScroller {
    override class var isCompatibleWithOverlayScrollers: Bool { true }

    override func drawKnobSlot(in slotRect: NSRect, highlight flag: Bool) {
        // Trilho intencionalmente vazio; o AppKit continua a desenhar o knob via `drawKnob`.
    }
}

private final class ChatTranscriptNSTextView: NSTextView {
    var onCopyEntireTranscript: (() -> Void)?

    override func menu(for event: NSEvent) -> NSMenu? {
        let base = super.menu(for: event)?.copy() as? NSMenu ?? NSMenu()
        let item = NSMenuItem(
            title: "Copiar conversa completa",
            action: #selector(menuCopyEntireTranscript),
            keyEquivalent: ""
        )
        item.target = self
        base.insertItem(item, at: 0)
        base.insertItem(.separator(), at: 1)
        return base
    }

    @objc private func menuCopyEntireTranscript() {
        onCopyEntireTranscript?()
    }
}

private struct ChatTranscriptNativeScrollRepresentable: NSViewRepresentable {
    var messages: [ChatMessage]
    /// Só usado para decidir scroll ao fim ao **abrir / trocar** conversa — não a cada token ou mensagem nova.
    var conversationId: UUID?

    /// Largura máxima da coluna de leitura; o texto centra-se com `textContainerInset`, o `NSScrollView` usa toda a largura.
    private static let transcriptColumnMaxWidth: CGFloat = 1000
    /// Espaço extra por baixo do texto dentro do scroll (última mensagem não colada à borda inferior).
    private static let transcriptBottomContentMargin: CGFloat = 48

    final class Coordinator {
        var cachedMessages: [ChatMessage] = []
        var cachedAttributedString: NSAttributedString = NSAttributedString()
        var lastClipWidth: CGFloat = -1
        /// Evita `scrollToEndOfDocument` em cada atualização do transcript na mesma conversa.
        var lastScrolledToEndConversationId: UUID?
        /// Track last message count for incremental update
        var lastMessageCount: Int = 0
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.drawsBackground = false
        scroll.borderType = .noBorder
        scroll.hasHorizontalScroller = false
        scroll.autohidesScrollers = true
        scroll.scrollerStyle = .overlay

        let vScroller = TranscriptKnobOnlyScroller()
        vScroller.scrollerStyle = .overlay
        vScroller.knobStyle = .light
        vScroller.controlSize = .small
        scroll.verticalScroller = vScroller
        scroll.hasVerticalScroller = true

        let tv = ChatTranscriptNSTextView()
        tv.isEditable = false
        tv.isSelectable = true
        tv.drawsBackground = false
        tv.isRichText = true
        tv.importsGraphics = false
        tv.usesFontPanel = false
        tv.isAutomaticQuoteSubstitutionEnabled = false
        tv.isAutomaticDashSubstitutionEnabled = false
        tv.isAutomaticTextReplacementEnabled = false
        tv.isVerticallyResizable = true
        tv.isHorizontallyResizable = false
        tv.autoresizingMask = [.width]
        tv.textContainer?.lineFragmentPadding = 0
        tv.textContainer?.widthTracksTextView = true
        tv.textContainer?.lineBreakMode = .byWordWrapping
        tv.minSize = .zero
        tv.maxSize = NSSize(width: 10_000, height: CGFloat.greatestFiniteMagnitude)
        tv.font = NSFont.systemFont(ofSize: 15)
        tv.textColor = .labelColor
        tv.layoutManager?.allowsNonContiguousLayout = false

        scroll.documentView = tv
        return scroll
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        scrollView.layoutSubtreeIfNeeded()
        guard let tv = scrollView.documentView as? ChatTranscriptNSTextView else { return }

        let coord = context.coordinator
        tv.onCopyEntireTranscript = {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(
                ChatTranscriptRendering.plainTextForCopyAll(messages: coord.cachedMessages),
                forType: .string
            )
        }

        let clipW = max(1, scrollView.contentView.bounds.width)
        let textChanged = messages != coord.cachedMessages
        // Lower threshold to 0.1 to catch more resize events
        let widthChanged = abs(clipW - coord.lastClipWidth) >= 0.1

        if textChanged {
            // Incremental update: if message count increased, append only new messages
            // Otherwise, full rebuild (conversation switched)
            if messages.count > coord.cachedMessages.count && 
               messages.count > 0 && coord.cachedMessages.count > 0 &&
               messages.prefix(coord.cachedMessages.count).elementsEqual(coord.cachedMessages) {
                // Incremental append only new messages
                let newMessages = Array(messages.suffix(messages.count - coord.cachedMessages.count))
                let newAttr = ChatTranscriptRendering.attributedString(for: newMessages)
                
                if let storage = tv.textStorage as? NSMutableAttributedString {
                    // Add separator before new messages
                    let sepPara = NSMutableParagraphStyle()
                    sepPara.paragraphSpacing = 4
                    sepPara.paragraphSpacingBefore = 4
                    let sep = NSAttributedString(string: "\n\n", attributes: [
                        .font: NSFont.systemFont(ofSize: 15),
                        .foregroundColor: NSColor(srgbRed: 0.78, green: 0.78, blue: 0.80, alpha: 1),
                        .paragraphStyle: sepPara
                    ])
                    storage.append(sep)
                    storage.append(newAttr)
                    coord.cachedAttributedString = storage.copy() as? NSAttributedString ?? storage
                }
            } else {
                // Full rebuild
                coord.cachedMessages = messages
                let attr = ChatTranscriptRendering.attributedString(for: messages)
                tv.textStorage?.setAttributedString(attr)
                coord.cachedAttributedString = attr
            }
            
            coord.cachedMessages = messages
        }

        // Handle width changes separately - don't invalidate on every text change
        if widthChanged {
            coord.lastClipWidth = clipW

            // Coluna de leitura centrada; scroll view em toda a largura → scroller na borda direita real.
            let sideInset = max(0, (clipW - Self.transcriptColumnMaxWidth) / 2)
            tv.textContainerInset = NSSize(width: sideInset, height: 10)
            tv.textContainer?.widthTracksTextView = true

            var r = tv.frame
            r.size.width = clipW
            tv.frame = r

            // Only invalidate layout on WIDTH changes, not on text changes
            if let lm = tv.layoutManager, let tc = tv.textContainer {
                let fullRange = NSRange(location: 0, length: tv.textStorage?.length ?? 0)
                lm.invalidateLayout(forCharacterRange: fullRange, actualCharacterRange: nil)
            }

            // Recalculate height on main thread
            DispatchQueue.main.async {
                self.relayoutTranscriptDocumentHeight(textView: tv, scrollView: scrollView, clipWidth: clipW)
            }
        } else if textChanged {
            // Text changed but width didn't - just adjust height slightly
            // Use background thread to avoid blocking scroll
            DispatchQueue.global(qos: .userInitiated).async {
                DispatchQueue.main.async {
                    self.relayoutTranscriptDocumentHeight(textView: tv, scrollView: scrollView, clipWidth: clipW)
                }
            }
        }

        let openedOrSwitchedChat = conversationId != coord.lastScrolledToEndConversationId
        if openedOrSwitchedChat {
            coord.lastScrolledToEndConversationId = conversationId
            DispatchQueue.main.async {
                tv.scrollToEndOfDocument(nil)
            }
        }
    }

    private func relayoutTranscriptDocumentHeight(textView tv: NSTextView, scrollView: NSScrollView, clipWidth: CGFloat) {
        guard let lm = tv.layoutManager, let tc = tv.textContainer else { return }
        
        // Quick calculation: just get used rect without full layout
        let used = lm.usedRect(for: tc)
        let inset = tv.textContainerInset.height * 2
        let contentH = ceil(used.height + inset) + Self.transcriptBottomContentMargin
        let clipH = max(1, scrollView.contentView.bounds.height)
        let totalH = max(contentH, clipH)
        
        var r = tv.frame
        r.size.width = clipWidth
        r.size.height = totalH
        tv.frame = r
    }
}

#Preview {
    ContentView()
}
