//
//  ContentView.swift
//  Brain2
//
//  Created by Cássio on 03/04/26.
//

import AppKit
import Foundation
import SwiftUI
import WebKit

/// Mesma base da landing Brain2 (cinza quase preto).
private let appChromeBackground = Color(red: 12 / 255, green: 12 / 255, blue: 12 / 255)

struct ContentView: View {
    var body: some View {
        ZStack(alignment: .topLeading) {
            WebView(urlString: "https://brain2corevo.netlify.app/")
                .padding(.top, 34)

            // Faixa arrastavel no topo para mover a janela sem barra de titulo nativa.
            WindowDragRegion()
                .frame(maxWidth: .infinity)
                .frame(height: 42)
        }
        .ignoresSafeArea()
        .background(appChromeBackground)
        .background(WindowChromeConfigurator())
    }
}

struct WebView: NSViewRepresentable {
    let urlString: String

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: Coordinator.messageHandlerName)

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController

        let webView = WKWebView(frame: .zero, configuration: configuration)
        context.coordinator.attach(webView: webView)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        if #available(macOS 13.0, *) {
            webView.underPageBackgroundColor = NSColor(
                calibratedRed: 12 / 255,
                green: 12 / 255,
                blue: 12 / 255,
                alpha: 1
            )
        }
        loadURL(in: webView)
        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
        guard let currentURL = nsView.url?.absoluteString else { return }
        if currentURL != urlString {
            loadURL(in: nsView)
        }
    }

    static func dismantleNSView(_ nsView: WKWebView, coordinator: Coordinator) {
        nsView.configuration.userContentController.removeScriptMessageHandler(forName: Coordinator.messageHandlerName)
    }

    private func loadURL(in webView: WKWebView) {
        guard let url = URL(string: urlString) else { return }
        webView.load(URLRequest(url: url))
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        static let messageHandlerName = "brain2Native"
        private static let selectedVaultPathDefaultsKey = "brain2-selected-vault-path"

        private weak var webView: WKWebView?
        private let fileManager = FileManager.default
        private lazy var wikilinkRegex = try? NSRegularExpression(
            pattern: #"\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*?)?\]\]"#
        )

        func attach(webView: WKWebView) {
            self.webView = webView
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            injectNativeBridge()
            publishPersistedVaultIfAvailable()
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == Self.messageHandlerName else { return }
            guard
                let payload = message.body as? [String: Any],
                let type = payload["type"] as? String
            else {
                return
            }

            if type == "pickDirectory" {
                presentDirectoryPicker()
            }
        }

        private func injectNativeBridge() {
            let script = """
            window.Brain2Native = window.Brain2Native || {};
            window.Brain2Native.isAvailable = true;
            window.Brain2Native.pickDirectory = function () {
              try {
                window.webkit.messageHandlers.\(Self.messageHandlerName).postMessage({ type: 'pickDirectory' });
              } catch (_) {}
            };
            window.dispatchEvent(new CustomEvent('brain2-native-bridge-ready'));
            """
            webView?.evaluateJavaScript(script, completionHandler: nil)
        }

        private func presentDirectoryPicker() {
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }

                let panel = NSOpenPanel()
                panel.title = "Escolher diretório"
                panel.message = "Selecione o diretório usado para listar Pastas e Your Brain."
                panel.canChooseDirectories = true
                panel.canChooseFiles = false
                panel.canCreateDirectories = false
                panel.allowsMultipleSelection = false
                panel.prompt = "Escolher"

                guard panel.runModal() == .OK, let selectedURL = panel.url else { return }

                UserDefaults.standard.set(selectedURL.path, forKey: Self.selectedVaultPathDefaultsKey)
                self.publishVaultSelection(for: selectedURL)
            }
        }

        private func publishPersistedVaultIfAvailable() {
            guard let path = UserDefaults.standard.string(forKey: Self.selectedVaultPathDefaultsKey) else { return }

            var isDirectory: ObjCBool = false
            guard fileManager.fileExists(atPath: path, isDirectory: &isDirectory), isDirectory.boolValue else {
                return
            }

            publishVaultSelection(for: URL(fileURLWithPath: path))
        }

        private func publishVaultSelection(for rootURL: URL) {
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                guard let self else { return }
                let payload = self.buildVaultPayload(for: rootURL)
                self.publish(payload: payload)
            }
        }

        private func buildVaultPayload(for rootURL: URL) -> [String: Any] {
            let folders = readFolderTree(at: rootURL)
            let markdownFiles = readAllMarkdownFiles(at: rootURL)
            let graph = buildGraph(from: markdownFiles)
            let conversations = buildConversations(from: markdownFiles)

            return [
                "path": rootURL.path,
                "folders": folders.map(\.asJSONObject),
                "graph": graph,
                "conversations": conversations,
            ]
        }

        private func publish(payload: [String: Any]) {
            guard JSONSerialization.isValidJSONObject(payload) else { return }
            guard
                let jsonData = try? JSONSerialization.data(withJSONObject: payload),
                let jsonString = String(data: jsonData, encoding: .utf8)
            else {
                return
            }

            DispatchQueue.main.async { [weak self] in
                let script = """
                window.Brain2NativeState = \(jsonString);
                window.dispatchEvent(new CustomEvent('brain2-native-vault-selected', { detail: window.Brain2NativeState }));
                """
                self?.webView?.evaluateJavaScript(script, completionHandler: nil)
            }
        }

        private func readFolderTree(at directoryURL: URL) -> [NativeFolderNode] {
            guard
                let entries = try? fileManager.contentsOfDirectory(
                    at: directoryURL,
                    includingPropertiesForKeys: [.isDirectoryKey],
                    options: [.skipsHiddenFiles]
                )
            else {
                return []
            }

            var folders: [NativeFolderNode] = []

            for entry in entries.sorted(by: { $0.lastPathComponent.localizedCaseInsensitiveCompare($1.lastPathComponent) == .orderedAscending }) {
                if entry.lastPathComponent.hasPrefix(".") {
                    continue
                }

                var isDirectory: ObjCBool = false
                guard fileManager.fileExists(atPath: entry.path, isDirectory: &isDirectory), isDirectory.boolValue else {
                    continue
                }

                folders.append(
                    NativeFolderNode(
                        name: entry.lastPathComponent,
                        children: readFolderTree(at: entry)
                    )
                )
            }

            return folders
        }

        private func readAllMarkdownFiles(at directoryURL: URL, basePath: String = "") -> [MarkdownFile] {
            guard
                let entries = try? fileManager.contentsOfDirectory(
                    at: directoryURL,
                    includingPropertiesForKeys: [.isDirectoryKey],
                    options: [.skipsHiddenFiles]
                )
            else {
                return []
            }

            var files: [MarkdownFile] = []

            for entry in entries {
                if entry.lastPathComponent.hasPrefix(".") {
                    continue
                }

                let relativePath = basePath.isEmpty
                    ? entry.lastPathComponent
                    : "\(basePath)/\(entry.lastPathComponent)"

                var isDirectory: ObjCBool = false
                if fileManager.fileExists(atPath: entry.path, isDirectory: &isDirectory), isDirectory.boolValue {
                    files.append(contentsOf: readAllMarkdownFiles(at: entry, basePath: relativePath))
                    continue
                }

                if entry.pathExtension.lowercased() == "md" {
                    guard let content = try? String(contentsOf: entry, encoding: .utf8) else { continue }
                    let resourceValues = try? entry.resourceValues(forKeys: [.contentModificationDateKey])
                    let modifiedAt = (resourceValues?.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000
                    files.append(
                        MarkdownFile(
                            name: entry.deletingPathExtension().lastPathComponent,
                            path: relativePath,
                            content: content,
                            modifiedAt: modifiedAt
                        )
                    )
                }
            }

            return files
        }

        private func parseWikilinks(from markdown: String) -> [String] {
            guard let wikilinkRegex else { return [] }

            let nsMarkdown = markdown as NSString
            let matches = wikilinkRegex.matches(
                in: markdown,
                range: NSRange(location: 0, length: nsMarkdown.length)
            )

            return matches.compactMap { match in
                guard match.numberOfRanges > 1 else { return nil }
                let raw = nsMarkdown.substring(with: match.range(at: 1))
                let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                return trimmed.isEmpty ? nil : trimmed
            }
        }

        private func buildGraph(from files: [MarkdownFile]) -> [String: Any] {
            var nodeMap: [String: String] = [:]
            for file in files {
                nodeMap[file.name.lowercased()] = file.name
            }

            var nodes: [[String: String]] = nodeMap.map { key, value in
                ["id": key, "label": value]
            }

            var edges: [[String: String]] = []
            var edgeKeys = Set<String>()

            for file in files {
                let sourceID = file.name.lowercased()
                let links = parseWikilinks(from: file.content)

                for link in links {
                    let targetID = link.lowercased()

                    if nodeMap[targetID] == nil {
                        nodeMap[targetID] = link
                        nodes.append(["id": targetID, "label": link])
                    }

                    if sourceID == targetID {
                        continue
                    }

                    let edgeKey = sourceID < targetID ? "\(sourceID)::\(targetID)" : "\(targetID)::\(sourceID)"

                    if !edgeKeys.contains(edgeKey) {
                        edgeKeys.insert(edgeKey)
                        edges.append(["source": sourceID, "target": targetID])
                    }
                }
            }

            return [
                "nodes": nodes,
                "edges": edges,
            ]
        }

        private func buildConversations(from files: [MarkdownFile]) -> [[String: Any]] {
            files
                .sorted(by: { $0.modifiedAt > $1.modifiedAt })
                .map { file in
                    [
                        "id": file.path.lowercased(),
                        "title": file.name,
                        "path": file.path,
                        "modifiedAt": file.modifiedAt,
                        "content": file.content,
                    ]
                }
        }
    }

    private struct NativeFolderNode {
        let name: String
        let children: [NativeFolderNode]

        var asJSONObject: [String: Any] {
            [
                "name": name,
                "kind": "folder",
                "children": children.map(\.asJSONObject),
            ]
        }
    }

    private struct MarkdownFile {
        let name: String
        let path: String
        let content: String
        let modifiedAt: Double
    }
}

#Preview {
    ContentView()
}
