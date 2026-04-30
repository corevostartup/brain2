//
//  Brain2WebView.swift
//  brain2-iOS
//
//  WKWebView + bridge Brain2Native (igual ao macOS) para OAuth com ASWebAuthenticationSession
//  em vez de login Google dentro do WebView (bloqueado pelo Google).
//

import SwiftUI
import UIKit
import UniformTypeIdentifiers
import WebKit

private let defaultAppURL = "https://brain2corevo.netlify.app/"

struct Brain2WebView: UIViewRepresentable {
    let urlString: String
    /// Quando definido, dispara o mesmo CustomEvent que a web já escuta.
    var pendingGoogleTokens: PendingGoogleTokens?
    var onTokensDelivered: () -> Void

    /// Chamado quando a página pede login Google nativo (`Brain2Native.startGoogleSignIn`).
    var onStartGoogleSignInFromWeb: () -> Void

    /// Quando não vazio, publica `brain2-native-google-signin-error` na página (ex.: falha OAuth).
    var webOAuthErrorMessage: Binding<String?>

    struct PendingGoogleTokens: Equatable {
        let idToken: String
        let accessToken: String?
    }

    init(
        urlString: String,
        pendingGoogleTokens: PendingGoogleTokens?,
        onTokensDelivered: @escaping () -> Void,
        onStartGoogleSignInFromWeb: @escaping () -> Void = {},
        webOAuthErrorMessage: Binding<String?> = .constant(nil)
    ) {
        self.urlString = urlString
        self.pendingGoogleTokens = pendingGoogleTokens
        self.onTokensDelivered = onTokensDelivered
        self.onStartGoogleSignInFromWeb = onStartGoogleSignInFromWeb
        self.webOAuthErrorMessage = webOAuthErrorMessage
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(
            onTokensDelivered: onTokensDelivered,
            onStartGoogleSignInFromWeb: onStartGoogleSignInFromWeb
        )
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(context.coordinator, name: Coordinator.messageHandlerName)

        let webView = WKWebView(frame: .zero, configuration: config)

        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.bouncesZoom = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 12 / 255, green: 12 / 255, blue: 12 / 255, alpha: 1)
        webView.allowsBackForwardNavigationGestures = false

        let injectedJS = """
        var meta = document.createElement('meta');
        meta.name = 'viewport';
        meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover';
        document.head.appendChild(meta);

        document.addEventListener('touchmove', function(e) {
          if (e.touches.length > 1) {
            e.preventDefault();
          }
        }, false);
        """

        let userScript = WKUserScript(source: injectedJS, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        config.userContentController.addUserScript(userScript)

        context.coordinator.webView = webView
        webView.navigationDelegate = context.coordinator
        context.coordinator.pendingTokens = pendingGoogleTokens

        loadURL(in: webView)
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        context.coordinator.onStartGoogleSignInFromWeb = onStartGoogleSignInFromWeb

        if let err = webOAuthErrorMessage.wrappedValue?.trimmingCharacters(in: .whitespacesAndNewlines), !err.isEmpty {
            context.coordinator.publishSignInErrorToWeb(err)
            DispatchQueue.main.async {
                webOAuthErrorMessage.wrappedValue = nil
            }
        }

        context.coordinator.pendingTokens = pendingGoogleTokens

        if let tokens = pendingGoogleTokens, !uiView.isLoading, uiView.url != nil {
            context.coordinator.dispatchTokensIfNeeded(idToken: tokens.idToken, accessToken: tokens.accessToken)
        }

        guard let loaded = uiView.url else { return }
        guard let expectedDoc = Self.canonicalDocumentURL(from: urlString),
              let gotDoc = Self.canonicalDocumentURL(from: loaded.absoluteString)
        else {
            return
        }
        if expectedDoc != gotDoc {
            loadURL(in: uiView)
        }
    }

    /// Compara documento (scheme/host/path) ignorando query — o pedido pode não incluir `brain2-shell`.
    private static func canonicalDocumentURL(from urlString: String) -> URL? {
        let raw = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = raw.isEmpty ? defaultAppURL : raw
        guard var components = URLComponents(string: base), components.scheme != nil else { return nil }
        components.query = nil
        components.fragment = nil
        return components.url
    }

    private func loadURL(in webView: WKWebView) {
        let raw = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = raw.isEmpty ? defaultAppURL : raw
        guard var components = URLComponents(string: base), components.scheme != nil else { return }
        var items = components.queryItems ?? []
        if !items.contains(where: { $0.name == "brain2-shell" }) {
            // Mesmo parâmetro que o macOS: `page.tsx` persiste em sessionStorage e marca shell nativa.
            items.append(URLQueryItem(name: "brain2-shell", value: "macos"))
        }
        components.queryItems = items
        guard let url = components.url else { return }
        webView.load(URLRequest(url: url))
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler, UIDocumentPickerDelegate {
        static let messageHandlerName = "brain2Native"
        private static let selectedVaultPathDefaultsKey = "brain2-ios-selected-vault-path"
        private static let selectedVaultBookmarkDefaultsKey = "brain2-ios-selected-vault-bookmark"

        weak var webView: WKWebView?
        var pendingTokens: PendingGoogleTokens?
        let onTokensDelivered: () -> Void
        var onStartGoogleSignInFromWeb: () -> Void
        /// Evita duplicar o mesmo par id/access se `updateUIView` e `didFinish` correrem seguidos.
        private var lastDispatchedTokenFingerprint: String?
        private let fileManager = FileManager.default

        init(onTokensDelivered: @escaping () -> Void, onStartGoogleSignInFromWeb: @escaping () -> Void) {
            self.onTokensDelivered = onTokensDelivered
            self.onStartGoogleSignInFromWeb = onStartGoogleSignInFromWeb
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == Self.messageHandlerName else { return }
            guard let body = message.body as? [String: Any],
                  let type = body["type"] as? String
            else {
                return
            }
            if type == "startGoogleSignIn" {
                DispatchQueue.main.async { [weak self] in
                    self?.onStartGoogleSignInFromWeb()
                }
                return
            }

            if type == "pickDirectory" {
                presentDirectoryPicker()
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            injectNativeBridge()
            publishPersistedVaultSelectionIfAvailable()
            if let tokens = pendingTokens {
                dispatchTokensIfNeeded(idToken: tokens.idToken, accessToken: tokens.accessToken)
            }
        }

        /// Mesmo contrato que macOS: `Brain2Native.startGoogleSignIn` → OAuth fora do WKWebView.
        private func injectNativeBridge() {
            let script = """
            (function() {
              document.documentElement.setAttribute('data-brain2-native', '');
              window.Brain2Native = window.Brain2Native || {};
              window.Brain2Native.isAvailable = true;
              window.Brain2Native.startGoogleSignIn = function () {
                try {
                  window.webkit.messageHandlers.\(Self.messageHandlerName).postMessage({ type: 'startGoogleSignIn' });
                } catch (e) {}
              };
              window.Brain2Native.pickDirectory = function () {
                try {
                  window.webkit.messageHandlers.\(Self.messageHandlerName).postMessage({ type: 'pickDirectory' });
                } catch (e) {}
              };
              window.dispatchEvent(new CustomEvent('brain2-native-bridge-ready'));
            })();
            """
            webView?.evaluateJavaScript(script, completionHandler: nil)
        }

        func publishSignInErrorToWeb(_ message: String) {
            let detail: [String: String] = ["message": message]
            guard JSONSerialization.isValidJSONObject(detail),
                  let data = try? JSONSerialization.data(withJSONObject: detail),
                  let json = String(data: data, encoding: .utf8)
            else {
                return
            }
            let script = """
            window.dispatchEvent(new CustomEvent('brain2-native-google-signin-error', { detail: \(json) }));
            """
            webView?.evaluateJavaScript(script, completionHandler: nil)
        }

        func dispatchTokensIfNeeded(idToken: String, accessToken: String?) {
            let fp = idToken + "|" + (accessToken ?? "")
            guard lastDispatchedTokenFingerprint != fp else { return }
            lastDispatchedTokenFingerprint = fp
            pendingTokens = nil
            dispatchTokens(idToken: idToken, accessToken: accessToken)
        }

        func dispatchTokens(idToken: String, accessToken: String?) {
            let payload: [String: String] = [
                "idToken": idToken,
                "accessToken": accessToken ?? "",
            ]
            guard JSONSerialization.isValidJSONObject(payload),
                  let data = try? JSONSerialization.data(withJSONObject: payload),
                  let json = String(data: data, encoding: .utf8)
            else {
                return
            }

            let script = """
            window.dispatchEvent(new CustomEvent('brain2-native-google-tokens', { detail: \(json) }));
            """

            webView?.evaluateJavaScript(script) { _, _ in
                DispatchQueue.main.async {
                    self.onTokensDelivered()
                }
            }
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let selectedURL = urls.first else { return }
            persistVaultSelection(selectedURL)
            publishVaultSelection(for: selectedURL)
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            // usuário cancelou; sem ação necessária
        }

        private func presentDirectoryPicker() {
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
                picker.delegate = self
                picker.allowsMultipleSelection = false
                self.topViewController()?.present(picker, animated: true)
            }
        }

        private func topViewController() -> UIViewController? {
            guard
                let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                let root = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController ?? scene.windows.first?.rootViewController
            else {
                return nil
            }
            var top = root
            while let presented = top.presentedViewController {
                top = presented
            }
            return top
        }

        private func persistVaultSelection(_ selectedURL: URL) {
            do {
                let bookmarkData = try selectedURL.bookmarkData(
                    options: [],
                    includingResourceValuesForKeys: nil,
                    relativeTo: nil
                )
                UserDefaults.standard.set(bookmarkData, forKey: Self.selectedVaultBookmarkDefaultsKey)
                UserDefaults.standard.set(selectedURL.path, forKey: Self.selectedVaultPathDefaultsKey)
            } catch {
                UserDefaults.standard.removeObject(forKey: Self.selectedVaultBookmarkDefaultsKey)
                UserDefaults.standard.removeObject(forKey: Self.selectedVaultPathDefaultsKey)
            }
        }

        private func resolvePersistedVaultURL() -> URL? {
            guard let bookmarkData = UserDefaults.standard.data(forKey: Self.selectedVaultBookmarkDefaultsKey) else {
                return nil
            }
            var isStale = false
            guard let resolvedURL = try? URL(
                resolvingBookmarkData: bookmarkData,
                options: [],
                relativeTo: nil,
                bookmarkDataIsStale: &isStale
            ) else {
                return nil
            }
            if isStale {
                persistVaultSelection(resolvedURL)
            }
            return resolvedURL
        }

        private func publishPersistedVaultSelectionIfAvailable() {
            guard let url = resolvePersistedVaultURL() else { return }
            publishVaultSelection(for: url)
        }

        private struct FolderNode: Codable {
            let name: String
            let kind: String
            let children: [FolderNode]
        }

        private struct VaultConversationPayload: Codable {
            let id: String
            let title: String
            let path: String
            let modifiedAt: Int64
            let content: String
        }

        private struct GraphNodePayload: Codable {
            let id: String
            let label: String
        }

        private struct GraphEdgePayload: Codable {
            let source: String
            let target: String
        }

        private struct VaultGraphPayload: Codable {
            let nodes: [GraphNodePayload]
            let edges: [GraphEdgePayload]
        }

        private struct NativeVaultStatePayload: Codable {
            let path: String
            let folders: [FolderNode]
            let graph: VaultGraphPayload
            let conversations: [VaultConversationPayload]
        }

        private struct MarkdownFile {
            let title: String
            let path: String
            let modifiedAt: Int64
            let content: String
        }

        private func publishVaultSelection(for vaultURL: URL) {
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                guard let self else { return }
                guard let payload = self.buildNativeVaultStatePayload(vaultURL: vaultURL) else { return }
                guard let jsonData = try? JSONEncoder().encode(payload),
                      let json = String(data: jsonData, encoding: .utf8)
                else {
                    return
                }
                let script = """
                (function() {
                  window.Brain2NativeState = \(json);
                  window.dispatchEvent(new CustomEvent('brain2-native-vault-selected'));
                })();
                """
                DispatchQueue.main.async { [weak self] in
                    self?.webView?.evaluateJavaScript(script, completionHandler: nil)
                }
            }
        }

        private func buildNativeVaultStatePayload(vaultURL: URL) -> NativeVaultStatePayload? {
            let didAccess = vaultURL.startAccessingSecurityScopedResource()
            defer {
                if didAccess {
                    vaultURL.stopAccessingSecurityScopedResource()
                }
            }

            let folders = readFolderTree(dirURL: vaultURL)
            let markdownFiles = readAllMarkdownFiles(dirURL: vaultURL)
            let conversations = markdownFiles.map { file in
                VaultConversationPayload(
                    id: file.path.lowercased(),
                    title: file.title,
                    path: file.path,
                    modifiedAt: file.modifiedAt,
                    content: file.content
                )
            }
            let graph = buildConversationGraph(conversations: conversations)

            return NativeVaultStatePayload(
                path: vaultURL.path,
                folders: folders,
                graph: graph,
                conversations: conversations
            )
        }

        private func readFolderTree(dirURL: URL) -> [FolderNode] {
            var folders: [FolderNode] = []
            var files: [FolderNode] = []

            guard let entries = try? fileManager.contentsOfDirectory(
                at: dirURL,
                includingPropertiesForKeys: [.isDirectoryKey],
                options: [.skipsHiddenFiles]
            ) else {
                return []
            }

            for entry in entries {
                let name = entry.lastPathComponent
                let values = try? entry.resourceValues(forKeys: [.isDirectoryKey])
                if values?.isDirectory == true {
                    let children = readFolderTree(dirURL: entry)
                    folders.append(FolderNode(name: name, kind: "folder", children: children))
                } else if entry.pathExtension.lowercased() == "md" {
                    let stem = (name as NSString).deletingPathExtension
                    files.append(FolderNode(name: stem, kind: "file", children: []))
                }
            }

            folders.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            files.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            return folders + files
        }

        private func readAllMarkdownFiles(dirURL: URL, relativeBase: String = "") -> [MarkdownFile] {
            var files: [MarkdownFile] = []

            guard let entries = try? fileManager.contentsOfDirectory(
                at: dirURL,
                includingPropertiesForKeys: [.isDirectoryKey, .contentModificationDateKey],
                options: [.skipsHiddenFiles]
            ) else {
                return files
            }

            for entry in entries {
                let name = entry.lastPathComponent
                let entryRelativePath = relativeBase.isEmpty ? name : "\(relativeBase)/\(name)"
                let values = try? entry.resourceValues(forKeys: [.isDirectoryKey, .contentModificationDateKey])

                if values?.isDirectory == true {
                    files.append(contentsOf: readAllMarkdownFiles(dirURL: entry, relativeBase: entryRelativePath))
                    continue
                }

                guard entry.pathExtension.lowercased() == "md" else { continue }
                guard let data = try? Data(contentsOf: entry),
                      let content = String(data: data, encoding: .utf8)
                else {
                    continue
                }

                let title = (name as NSString).deletingPathExtension
                let modifiedAtMs: Int64
                if let modified = values?.contentModificationDate {
                    modifiedAtMs = Int64(modified.timeIntervalSince1970 * 1000)
                } else {
                    modifiedAtMs = Int64(Date().timeIntervalSince1970 * 1000)
                }

                files.append(
                    MarkdownFile(
                        title: title,
                        path: entryRelativePath.replacingOccurrences(of: "\\", with: "/"),
                        modifiedAt: modifiedAtMs,
                        content: content
                    )
                )
            }

            return files
        }

        private func buildConversationGraph(conversations: [VaultConversationPayload]) -> VaultGraphPayload {
            var nodes: [GraphNodePayload] = []
            var titleToId = [String: String]()
            var stemToId = [String: String]()

            for conversation in conversations {
                nodes.append(GraphNodePayload(id: conversation.id, label: conversation.title))
                titleToId[conversation.title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()] = conversation.id
                let stem = ((conversation.path as NSString).lastPathComponent as NSString).deletingPathExtension
                stemToId[stem.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()] = conversation.id
            }

            var edges: [GraphEdgePayload] = []
            var edgeSet = Set<String>()
            for conversation in conversations {
                let links = parseWikiLinks(from: stripYamlFrontmatter(conversation.content))
                for link in links {
                    let key = link.lowercased()
                    guard let target = titleToId[key] ?? stemToId[key] else { continue }
                    guard target != conversation.id else { continue }
                    let edgeKey = conversation.id < target ? "\(conversation.id)|\(target)" : "\(target)|\(conversation.id)"
                    if edgeSet.contains(edgeKey) { continue }
                    edgeSet.insert(edgeKey)
                    edges.append(GraphEdgePayload(source: conversation.id, target: target))
                }
            }

            return VaultGraphPayload(nodes: nodes, edges: edges)
        }

        private func parseWikiLinks(from text: String) -> [String] {
            guard let regex = try? NSRegularExpression(pattern: #"\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*?)?\]\]"#) else {
                return []
            }
            let ns = text as NSString
            let matches = regex.matches(in: text, range: NSRange(location: 0, length: ns.length))
            return matches.compactMap { match in
                guard match.numberOfRanges > 1 else { return nil }
                let raw = ns.substring(with: match.range(at: 1)).trimmingCharacters(in: .whitespacesAndNewlines)
                return raw.isEmpty ? nil : raw
            }
        }

        private func stripYamlFrontmatter(_ markdown: String) -> String {
            guard markdown.hasPrefix("---") else { return markdown }
            let lines = markdown.split(separator: "\n", omittingEmptySubsequences: false)
            guard lines.count >= 2, lines[0].trimmingCharacters(in: .whitespaces) == "---" else { return markdown }
            for idx in 1..<lines.count {
                if lines[idx].trimmingCharacters(in: .whitespaces) == "---" {
                    let body = lines[(idx + 1)...].joined(separator: "\n")
                    return body
                }
            }
            return markdown
        }
    }
}
