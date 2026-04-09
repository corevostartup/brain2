//
//  ContentView.swift
//  Brain2
//
//  Created by Cássio on 03/04/26.
//

import AppKit
import AuthenticationServices
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
        // Google/Firebase OAuth costuma bloquear user-agents de WebView “puros”; Safari reduz falhas no login.
        webView.customUserAgent =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15"
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
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        var queryItems = components?.queryItems ?? []
        // Evita bundle JS stale no WKWebView entre deploys da web.
        queryItems.append(URLQueryItem(name: "brain2-shell", value: "macos"))
        queryItems.append(URLQueryItem(name: "brain2-t", value: String(Int(Date().timeIntervalSince1970))))
        components?.queryItems = queryItems
        let finalURL = components?.url ?? url
        let request = URLRequest(
            url: finalURL,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: 30
        )
        webView.load(request)
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler, ASWebAuthenticationPresentationContextProviding {
        static let messageHandlerName = "brain2Native"
        private static let selectedVaultPathDefaultsKey = "brain2-selected-vault-path"
        private static let selectedVaultBookmarkDefaultsKey = "brain2-selected-vault-bookmark"
        private static let memoriesFolderName = "Brain2Memories"
        private static let llmModelDefaultsKey = "brain2-llm-model"
        private static let llmApiKeyDefaultsKey = "brain2-llm-api-key"

        private weak var webView: WKWebView?
        private var googleAuthSession: ASWebAuthenticationSession?
        private var googleLoopbackReceiver: OAuthLoopbackRedirectReceiver?
        private var googleOAuthCompletedViaLoopback = false
        private let googleOAuthOutcomeLock = NSLock()
        private var googleOAuthOutcomeDelivered = false
        /// Evita varios ASWebAuthenticationSession / listeners em paralelo (mensagem "helper application" no macOS).
        private var isGoogleOAuthFlowActive = false
        private var oauthPresentationWindow: NSWindow?
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
            promptRepickIfLegacyPathWithoutBookmark()
        }

        /// Instalações antigas só tinham o caminho em texto; no sandbox isso não dá acesso de escrita.
        private func promptRepickIfLegacyPathWithoutBookmark() {
            let path = UserDefaults.standard.string(forKey: Self.selectedVaultPathDefaultsKey) ?? ""
            let hasBookmark = UserDefaults.standard.data(forKey: Self.selectedVaultBookmarkDefaultsKey) != nil
            guard !path.isEmpty, !hasBookmark else { return }

            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
                self?.showVaultAccessAlert(
                    title: "Volte a escolher a pasta do vault",
                    text: "Para o Brain2 poder gravar no disco, abra Configurações → Vault → Local e toque em «Escolher diretório». O macOS memoriza o acesso com segurança (uma vez)."
                )
            }
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
                return
            }

            if type == "renameVault" {
                let renamePayload = payload["payload"] as? [String: Any] ?? [:]
                renameVaultFolder(renamePayload)
                return
            }

            if type == "saveConversation" {
                let conversationPayload = payload["payload"] as? [String: Any] ?? [:]
                saveConversationToVault(conversationPayload)
                return
            }

            if type == "createFolder" {
                let folderPayload = payload["payload"] as? [String: Any] ?? [:]
                createVaultSubfolderFromWeb(folderPayload)
                return
            }

            if type == "renameFolder" {
                let folderPayload = payload["payload"] as? [String: Any] ?? [:]
                renameVaultSubfolderFromWeb(folderPayload)
                return
            }

            if type == "saveLlmConfig" {
                let llmPayload = payload["payload"] as? [String: Any] ?? [:]
                saveLlmConfig(llmPayload)
                return
            }

            if type == "clearLlmConfig" {
                clearLlmConfig()
            }

            if type == "startGoogleSignIn" {
                startGoogleSignInWithSystemBrowser()
                return
            }

            if type == "debugLog" {
                let debugPayload = payload["payload"] as? [String: Any] ?? [:]
                handleNativeDebugLog(debugPayload)
            }
        }

        func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            oauthPresentationWindow
                ?? webView?.window
                ?? NSApp.keyWindow
                ?? NSApp.mainWindow
                ?? NSApplication.shared.windows.first { $0.isVisible }
                ?? NSApplication.shared.windows.first!
        }

        private func endGoogleOAuthFlowTracking() {
            isGoogleOAuthFlowActive = false
        }

        private func startGoogleSignInWithSystemBrowser() {
            guard !isGoogleOAuthFlowActive else {
                #if DEBUG
                NSLog("[Brain2 OAuth] Fluxo de login ja em curso; ignorando clique extra.")
                #endif
                return
            }

            let clientId = NativeOAuthSecrets.googleOAuthClientID
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !clientId.isEmpty else {
                publishGoogleSignInError(
                    "Configure googleOAuthClientID em NativeOAuthSecrets.Local.swift: use o ID cliente Web do Firebase (Autenticacao > Google) e autorize http://127.0.0.1:8765/ nesse cliente na Google Cloud."
                )
                return
            }

            let clientSecretTrimmed = NativeOAuthSecrets.googleOAuthClientSecret
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !clientSecretTrimmed.isEmpty else {
                publishGoogleSignInError(
                    "Falta googleOAuthClientSecret: edite o ficheiro NativeOAuthSecrets.Local.swift na pasta Brain2 (nao o .example). Google Cloud > Credenciais > Web client (auto created by Google Service) > + segredo > copie o GOCSPX-... completo ao aparecer e cole entre aspas."
                )
                return
            }

            // Key/main primeiro: o helper do ASWebAuthenticationSession liga-se melhor a janela do app ativa do que so ao WKWebView.
            guard
                let anchor = NSApp.keyWindow
                    ?? NSApp.mainWindow
                    ?? webView?.window
                    ?? NSApplication.shared.windows.first(where: { $0.isVisible })
            else {
                publishGoogleSignInError("Nenhuma janela disponivel para apresentar o login do Google.")
                return
            }

            isGoogleOAuthFlowActive = true

            let redirectURI = NativeOAuthSecrets.googleOAuthRedirectURI
            let oauthPort = GoogleDesktopOAuth.loopbackPort(forRedirectURI: redirectURI)

            let verifier = GoogleDesktopOAuth.randomPKCEVerifier()
            guard let challenge = GoogleDesktopOAuth.pkceChallengeS256(verifier: verifier) else {
                endGoogleOAuthFlowTracking()
                publishGoogleSignInError("Falha ao preparar o login (PKCE).")
                return
            }

            let state = GoogleDesktopOAuth.randomPKCEVerifier()
            guard let authURL = GoogleDesktopOAuth.buildAuthorizationURL(
                clientId: clientId,
                challenge: challenge,
                state: state,
                redirectURI: redirectURI
            ) else {
                endGoogleOAuthFlowTracking()
                publishGoogleSignInError("URL de autorizacao invalida.")
                return
            }

            #if DEBUG
            if
                let items = URLComponents(url: authURL, resolvingAgainstBaseURL: false)?.queryItems,
                let ru = items.first(where: { $0.name == "redirect_uri" })?.value
            {
                NSLog(
                    "[Brain2 OAuth] Se aparecer redirect_uri_mismatch, cadastre EXATAMENTE isto (mesmo cliente OAuth do client_id): %@",
                    ru
                )
            }
            NSLog("[Brain2 OAuth] client_id (inteiro, comparar com Credenciais Google): %@", clientId)
            #endif

            googleOAuthCompletedViaLoopback = false
            googleOAuthOutcomeDelivered = false
            googleLoopbackReceiver?.stop()
            let receiver = OAuthLoopbackRedirectReceiver(port: oauthPort) { [weak self] callbackURL in
                guard let self else { return }
                self.googleLoopbackReceiver = nil
                self.googleOAuthCompletedViaLoopback = true
                self.googleAuthSession?.cancel()
                self.handleGoogleOAuthRedirectURL(
                    callbackURL,
                    clientId: clientId,
                    codeVerifier: verifier,
                    redirectURI: redirectURI
                )
            }
            googleLoopbackReceiver = receiver

            receiver.start { [weak self] error in
                guard let self else { return }
                if let error {
                    self.googleLoopbackReceiver = nil
                    self.endGoogleOAuthFlowTracking()
                    self.publishGoogleSignInError(
                        "Nao foi possivel abrir a porta \(oauthPort) para o login Google (\(error.localizedDescription)). Verifique se outra app usa essa porta."
                    )
                    return
                }
                self.presentGoogleOAuthSession(
                    authURL: authURL,
                    anchor: anchor,
                    clientId: clientId,
                    codeVerifier: verifier,
                    redirectURI: redirectURI
                )
            }
        }

        private func presentGoogleOAuthSession(
            authURL: URL,
            anchor: NSWindow,
            clientId: String,
            codeVerifier: String,
            redirectURI: String
        ) {
            oauthPresentationWindow = anchor

            let session = ASWebAuthenticationSession(
                url: authURL,
                callbackURLScheme: "http"
            ) { [weak self] callbackURL, error in
                guard let self else { return }
                self.endGoogleOAuthFlowTracking()
                self.googleAuthSession = nil
                self.oauthPresentationWindow = nil
                self.googleLoopbackReceiver?.stop()
                self.googleLoopbackReceiver = nil

                if self.googleOAuthCompletedViaLoopback {
                    return
                }

                if let error {
                    self.publishGoogleSignInError(error.localizedDescription)
                    return
                }

                guard let callbackURL else {
                    self.publishGoogleSignInError("Resposta inesperada do Google.")
                    return
                }
                self.handleGoogleOAuthRedirectURL(
                    callbackURL,
                    clientId: clientId,
                    codeVerifier: codeVerifier,
                    redirectURI: redirectURI
                )
            }

            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            googleAuthSession = session

            if !session.start() {
                endGoogleOAuthFlowTracking()
                googleAuthSession = nil
                oauthPresentationWindow = nil
                googleLoopbackReceiver?.stop()
                googleLoopbackReceiver = nil
                publishGoogleSignInError("Nao foi possivel abrir a janela de login do Google.")
            }
        }

        private func handleGoogleOAuthRedirectURL(
            _ callbackURL: URL,
            clientId: String,
            codeVerifier: String,
            redirectURI: String
        ) {
            guard let items = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems else {
                publishGoogleSignInError("Resposta inesperada do Google.")
                return
            }

            if let errorCode = items.first(where: { $0.name == "error" })?.value {
                let desc = items.first(where: { $0.name == "error_description" })?.value ?? errorCode
                publishGoogleSignInError(desc)
                return
            }

            guard let code = items.first(where: { $0.name == "code" })?.value else {
                publishGoogleSignInError("Codigo de autorizacao ausente.")
                return
            }

            googleOAuthOutcomeLock.lock()
            if googleOAuthOutcomeDelivered {
                googleOAuthOutcomeLock.unlock()
                return
            }
            googleOAuthOutcomeDelivered = true
            googleOAuthOutcomeLock.unlock()

            GoogleDesktopOAuth.exchangeCodeForTokens(
                code: code,
                clientId: clientId,
                codeVerifier: codeVerifier,
                redirectURI: redirectURI,
                clientSecret: NativeOAuthSecrets.googleOAuthClientSecret
            ) { [weak self] result in
                guard let self else { return }
                switch result {
                case .success(let tokens):
                    self.publishGoogleTokens(idToken: tokens.idToken, accessToken: tokens.accessToken)
                case .failure(let err):
                    self.publishGoogleSignInError(err.localizedDescription)
                }
            }
        }

        private func publishGoogleTokens(idToken: String, accessToken: String?) {
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

            DispatchQueue.main.async { [weak self] in
                let script = """
                window.dispatchEvent(new CustomEvent('brain2-native-google-tokens', { detail: \(json) }));
                """
                self?.webView?.evaluateJavaScript(script, completionHandler: nil)
            }
        }

        private func publishGoogleSignInError(_ message: String) {
            let detail: [String: String] = ["message": message]
            guard JSONSerialization.isValidJSONObject(detail),
                  let data = try? JSONSerialization.data(withJSONObject: detail),
                  let json = String(data: data, encoding: .utf8)
            else {
                return
            }

            DispatchQueue.main.async { [weak self] in
                let script = """
                window.dispatchEvent(new CustomEvent('brain2-native-google-signin-error', { detail: \(json) }));
                """
                self?.webView?.evaluateJavaScript(script, completionHandler: nil)
            }
        }

        private func saveLlmConfig(_ payload: [String: Any]) {
            let model = (payload["model"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let apiKey = (payload["apiKey"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

            if model.isEmpty || apiKey.isEmpty {
                return
            }

            UserDefaults.standard.set(model, forKey: Self.llmModelDefaultsKey)
            UserDefaults.standard.set(apiKey, forKey: Self.llmApiKeyDefaultsKey)
        }

        private func clearLlmConfig() {
            UserDefaults.standard.removeObject(forKey: Self.llmModelDefaultsKey)
            UserDefaults.standard.removeObject(forKey: Self.llmApiKeyDefaultsKey)
        }

        private func injectNativeBridge() {
            let llmModel = UserDefaults.standard.string(forKey: Self.llmModelDefaultsKey) ?? ""
            let llmApiKey = UserDefaults.standard.string(forKey: Self.llmApiKeyDefaultsKey) ?? ""
            let llmConfigJSON: String

            if llmApiKey.isEmpty {
                llmConfigJSON = "null"
            } else {
                let llmObject: [String: String] = [
                    "model": llmModel.isEmpty ? "gpt-5.4-mini" : llmModel,
                    "apiKey": llmApiKey,
                ]

                if
                    let data = try? JSONSerialization.data(withJSONObject: llmObject),
                    let json = String(data: data, encoding: .utf8)
                {
                    llmConfigJSON = json
                } else {
                    llmConfigJSON = "null"
                }
            }

            let script = """
            document.documentElement.setAttribute('data-brain2-native', '');
            window.Brain2Native = window.Brain2Native || {};
            window.Brain2Native.isAvailable = true;
                        window.Brain2Native.llmConfig = \(llmConfigJSON);
            window.Brain2Native.pickDirectory = function () {
              try {
                window.webkit.messageHandlers.\(Self.messageHandlerName).postMessage({ type: 'pickDirectory' });
              } catch (_) {}
            };
                        window.Brain2Native.renameVault = function (payload) {
                            try {
                                window.webkit.messageHandlers.\(Self.messageHandlerName).postMessage({ type: 'renameVault', payload: payload || {} });
                            } catch (_) {}
                        };
            window.Brain2Native.createFolder = function (payload) {
              try {
                window.webkit.messageHandlers.\(Self.messageHandlerName).postMessage({ type: 'createFolder', payload: payload || {} });
              } catch (_) {}
            };
            window.Brain2Native.renameFolder = function (payload) {
              try {
                window.webkit.messageHandlers.\(Self.messageHandlerName).postMessage({ type: 'renameFolder', payload: payload || {} });
              } catch (_) {}
            };
            window.Brain2Native.saveConversation = function (payload) {
              try {
                window.webkit.messageHandlers.\(Self.messageHandlerName).postMessage({ type: 'saveConversation', payload: payload || {} });
              } catch (_) {}
            };
                        window.Brain2Native.saveLlmConfig = function (payload) {
                            try {
                                window.webkit.messageHandlers.\(Self.messageHandlerName).postMessage({ type: 'saveLlmConfig', payload: payload || {} });
                            } catch (_) {}
                        };
                        window.Brain2Native.clearLlmConfig = function () {
                            try {
                                window.webkit.messageHandlers.\(Self.messageHandlerName).postMessage({ type: 'clearLlmConfig' });
                            } catch (_) {}
                        };
            window.Brain2Native.startGoogleSignIn = function () {
              try {
                window.webkit.messageHandlers.\(Self.messageHandlerName).postMessage({ type: 'startGoogleSignIn' });
              } catch (_) {}
            };
            window.Brain2Native.debugLog = function (payload) {
              try {
                window.webkit.messageHandlers.\(Self.messageHandlerName).postMessage({ type: 'debugLog', payload: payload || {} });
              } catch (_) {}
            };
            if (!window.__brain2ConsolePatched) {
              window.__brain2ConsolePatched = true;
              const levels = ['log', 'info', 'warn', 'error'];
              const toSafeString = (value) => {
                if (value == null) return String(value);
                if (typeof value === 'string') return value;
                try { return JSON.stringify(value); } catch (_) { return String(value); }
              };
              levels.forEach((level) => {
                const original = console[level] ? console[level].bind(console) : null;
                console[level] = function (...args) {
                  try {
                    window.Brain2Native.debugLog({
                      event: 'web-console',
                      payload: { level, args: args.map(toSafeString) }
                    });
                  } catch (_) {}
                  if (original) original(...args);
                };
              });
              window.addEventListener('error', (ev) => {
                try {
                  window.Brain2Native.debugLog({
                    event: 'web-error',
                    payload: {
                      message: ev.message || '',
                      source: ev.filename || '',
                      line: ev.lineno || 0,
                      column: ev.colno || 0
                    }
                  });
                } catch (_) {}
              });
              window.addEventListener('unhandledrejection', (ev) => {
                try {
                  window.Brain2Native.debugLog({
                    event: 'web-unhandledrejection',
                    payload: { reason: toSafeString(ev.reason) }
                  });
                } catch (_) {}
              });
            }
            window.dispatchEvent(new CustomEvent('brain2-native-bridge-ready'));
            """
            webView?.evaluateJavaScript(script, completionHandler: nil)
        }

        private func handleNativeDebugLog(_ payload: [String: Any]) {
            #if DEBUG
            let event = payload["event"] as? String ?? "unknown"
            if
                let payloadData = try? JSONSerialization.data(withJSONObject: payload, options: [.fragmentsAllowed]),
                let payloadString = String(data: payloadData, encoding: .utf8)
            {
                NSLog("[Brain2 Debug] \(event): \(payloadString)")
            } else {
                NSLog("[Brain2 Debug] \(event): \(payload)")
            }
            #endif
        }

        private func saveConversationToVault(_ payload: [String: Any]) {
            guard let vaultURL = resolvePersistedVaultURL() else {
                #if DEBUG
                NSLog("[Brain2 Native] saveConversationToVault: sem security-scoped bookmark — escolha o vault em Configurações (Local).")
                #endif
                return
            }

            guard
                let markdown = payload["markdown"] as? String,
                !markdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else {
                return
            }

            let conversationID = (payload["conversationId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let rawTitle = (payload["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let rawFolderPath = (payload["folderPath"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)

            DispatchQueue.global(qos: .utility).async { [weak self] in
                guard let self else { return }

                self.withSecurityScopedAccess(to: vaultURL) {
                    let memoriesURL = vaultURL.appendingPathComponent(Self.memoriesFolderName, isDirectory: true)
                    let normalizedFolderPath = self.normalizeRelativeFolderPath(rawFolderPath)
                    let targetFolderURL = self.resolveTargetFolderURL(
                        normalizedFolderPath: normalizedFolderPath,
                        vaultURL: vaultURL,
                        fallbackURL: memoriesURL
                    )

                    do {
                        try self.fileManager.createDirectory(
                            at: targetFolderURL,
                            withIntermediateDirectories: true,
                            attributes: nil
                        )

                        let safeConversationID = self.sanitizeFileName(conversationID ?? "chat-\(Int(Date().timeIntervalSince1970))")
                        let formattedTitle = self.formatConversationFileTitle(rawTitle ?? "conversation")
                        let filename = "\(formattedTitle) - (\(safeConversationID)).md"
                        let conversationFileMetadataSuffix = " - (\(safeConversationID)).md"
                        let conversationFileSuffix = "--\(safeConversationID).md"
                        let legacyConversationFilePrefix = "\(safeConversationID)-"
                        let fileURL = targetFolderURL.appendingPathComponent(filename)
                        if let existingConversationURL = self.findExistingConversationFile(
                            in: targetFolderURL,
                            metadataSuffix: conversationFileMetadataSuffix,
                            suffix: conversationFileSuffix,
                            legacyPrefix: legacyConversationFilePrefix,
                            excludingFileName: filename
                        ), existingConversationURL.lastPathComponent != filename {
                            if self.fileManager.fileExists(atPath: fileURL.path) {
                                try self.fileManager.removeItem(at: fileURL)
                            }
                            try self.fileManager.moveItem(at: existingConversationURL, to: fileURL)
                        }
                        let markdownToPersist = self.applyFolderCorrelationIfNeeded(
                            markdown: markdown,
                            targetFolderURL: targetFolderURL,
                            normalizedFolderPath: normalizedFolderPath
                        )

                        try markdownToPersist.write(to: fileURL, atomically: true, encoding: .utf8)
                    } catch {
                        #if DEBUG
                        NSLog("[Brain2 Native] saveConversationToVault falhou: \(error.localizedDescription)")
                        #endif
                        return
                    }

                    self.publishVaultSelection(for: vaultURL)
                }
            }
        }

        private func sanitizeFileName(_ raw: String) -> String {
            let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
            let scalars = raw.lowercased().unicodeScalars.map { scalar -> Character in
                allowed.contains(scalar) ? Character(scalar) : "-"
            }
            let compact = String(scalars)
                .replacingOccurrences(of: "--+", with: "-", options: .regularExpression)
                .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
            if compact.isEmpty {
                return "conversation"
            }
            return compact
        }

        private func formatConversationFileTitle(_ raw: String) -> String {
            let cleaned = raw
                .replacingOccurrences(of: "[._-]+", with: " ", options: .regularExpression)
                .replacingOccurrences(of: "[\\\\/:*?\"<>|]+", with: " ", options: .regularExpression)
                .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)

            guard !cleaned.isEmpty else {
                return "Conversation"
            }

            return cleaned
                .split(separator: " ")
                .map { token in
                    let lower = token.lowercased()
                    guard let first = lower.first else { return "" }
                    return String(first).uppercased() + lower.dropFirst()
                }
                .joined(separator: " ")
        }

        private func normalizeRelativeFolderPath(_ rawPath: String?) -> String? {
            guard let rawPath else {
                return nil
            }

            let normalized = rawPath
                .replacingOccurrences(of: "\\\\", with: "/")
                .split(separator: "/")
                .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty && $0 != "." && $0 != ".." }
                .joined(separator: "/")

            return normalized.isEmpty ? nil : normalized
        }

        private func resolveTargetFolderURL(
            normalizedFolderPath: String?,
            vaultURL: URL,
            fallbackURL: URL
        ) -> URL {
            guard let normalizedFolderPath, !normalizedFolderPath.isEmpty else {
                return fallbackURL
            }

            var targetURL = vaultURL
            for component in normalizedFolderPath.split(separator: "/") {
                targetURL.appendPathComponent(String(component), isDirectory: true)
            }

            let rootPath = vaultURL.standardizedFileURL.path
            let targetPath = targetURL.standardizedFileURL.path
            guard targetPath == rootPath || targetPath.hasPrefix(rootPath + "/") else {
                return fallbackURL
            }

            return targetURL
        }

        private func findExistingConversationFile(
            in folderURL: URL,
            metadataSuffix: String,
            suffix: String,
            legacyPrefix: String,
            excludingFileName: String
        ) -> URL? {
            guard let entries = try? fileManager.contentsOfDirectory(
                at: folderURL,
                includingPropertiesForKeys: nil,
                options: [.skipsHiddenFiles]
            ) else {
                return nil
            }

            for entry in entries {
                var isDirectory: ObjCBool = false
                guard fileManager.fileExists(atPath: entry.path, isDirectory: &isDirectory), !isDirectory.boolValue else {
                    continue
                }

                let name = entry.lastPathComponent
                guard name != excludingFileName else {
                    continue
                }

                if
                    name.lowercased().hasSuffix(".md"),
                    (name.hasSuffix(metadataSuffix) || name.hasSuffix(suffix) || name.hasPrefix(legacyPrefix))
                {
                    return entry
                }
            }

            return nil
        }

        private func applyFolderCorrelationIfNeeded(
            markdown: String,
            targetFolderURL: URL,
            normalizedFolderPath: String?
        ) -> String {
            guard let normalizedFolderPath, !normalizedFolderPath.isEmpty else {
                return markdown
            }

            let folderName = targetFolderURL.lastPathComponent.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !folderName.isEmpty else {
                return markdown
            }

            let folderCorrelationURL = targetFolderURL.appendingPathComponent("\(folderName).md")
            var isDirectory: ObjCBool = false
            if fileManager.fileExists(atPath: folderCorrelationURL.path, isDirectory: &isDirectory) {
                guard !isDirectory.boolValue else {
                    return markdown
                }
            } else {
                _ = fileManager.createFile(atPath: folderCorrelationURL.path, contents: Data(), attributes: nil)
            }

            let alreadyCorrelated = parseWikilinks(from: markdown).contains {
                $0.caseInsensitiveCompare(folderName) == .orderedSame
            }
            if alreadyCorrelated {
                return markdown
            }

            let correlationLine = "- Correlation: [[\(folderName)]]"
            var lines = markdown.components(separatedBy: .newlines)

            if let modelIndex = lines.firstIndex(where: {
                $0.trimmingCharacters(in: .whitespaces).lowercased().hasPrefix("- model:")
            }) {
                lines.insert(correlationLine, at: modelIndex + 1)
                return lines.joined(separator: "\n")
            }

            if let firstMetadataIndex = lines.firstIndex(where: {
                $0.trimmingCharacters(in: .whitespaces).hasPrefix("- ")
            }) {
                var insertIndex = firstMetadataIndex
                while insertIndex < lines.count {
                    let trimmed = lines[insertIndex].trimmingCharacters(in: .whitespaces)
                    if !trimmed.hasPrefix("- ") {
                        break
                    }
                    insertIndex += 1
                }

                lines.insert(correlationLine, at: insertIndex)
                return lines.joined(separator: "\n")
            }

            if let firstLine = lines.first, firstLine.trimmingCharacters(in: .whitespaces).hasPrefix("#") {
                let insertIndex = (lines.count > 1 && lines[1].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) ? 2 : 1
                lines.insert(correlationLine, at: insertIndex)
                return lines.joined(separator: "\n")
            }

            return "\(correlationLine)\n\(markdown)"
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

                // Com App Sandbox, só bookmarks com security scope permitem ler/gravar de forma fiável.
                // Guardar só o caminho (path) não concede `startAccessingSecurityScopedResource`.
                let bookmarkData: Data
                do {
                    bookmarkData = try selectedURL.bookmarkData(
                        options: .withSecurityScope,
                        includingResourceValuesForKeys: nil,
                        relativeTo: nil
                    )
                } catch {
                    self.showVaultAccessAlert(
                        title: "Não foi possível memorizar a pasta",
                        text: "O macOS não criou o acesso persistente a esta pasta: \(error.localizedDescription)\n\nTente outra pasta ou verifique as permissões."
                    )
                    return
                }

                UserDefaults.standard.set(bookmarkData, forKey: Self.selectedVaultBookmarkDefaultsKey)
                UserDefaults.standard.set(selectedURL.path, forKey: Self.selectedVaultPathDefaultsKey)

                guard let resolvedURL = self.resolvePersistedVaultURL() else {
                    UserDefaults.standard.removeObject(forKey: Self.selectedVaultBookmarkDefaultsKey)
                    UserDefaults.standard.removeObject(forKey: Self.selectedVaultPathDefaultsKey)
                    self.showVaultAccessAlert(
                        title: "Erro ao reabrir o vault",
                        text: "O marcador da pasta não pôde ser usado. Escolha a pasta novamente."
                    )
                    return
                }

                self.publishVaultSelection(for: resolvedURL)
            }
        }

        private func showVaultAccessAlert(title: String, text: String) {
            let alert = NSAlert()
            alert.messageText = title
            alert.informativeText = text
            alert.alertStyle = .warning
            alert.addButton(withTitle: "OK")
            alert.runModal()
        }

        private func renameVaultFolder(_ payload: [String: Any]) {
            let nextVaultName = (payload["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

            guard !nextVaultName.isEmpty else {
                publishVaultRenameResult(success: false, errorMessage: "Vault name is required.")
                return
            }

            DispatchQueue.global(qos: .utility).async { [weak self] in
                guard let self else { return }
                guard let currentVaultURL = self.resolvePersistedVaultURL() else {
                    self.publishVaultRenameResult(success: false, errorMessage: "No vault selected.")
                    return
                }

                self.withSecurityScopedAccess(to: currentVaultURL) {
                    do {
                        let safeVaultName = try self.validateVaultFolderName(nextVaultName)
                        let parentURL = currentVaultURL.deletingLastPathComponent()
                        let nextVaultURL = parentURL
                            .appendingPathComponent(safeVaultName, isDirectory: true)
                            .standardizedFileURL

                        if nextVaultURL.path == currentVaultURL.standardizedFileURL.path {
                            self.publishVaultSelection(for: currentVaultURL)
                            self.publishVaultRenameResult(success: true, errorMessage: nil)
                            return
                        }

                        var isDirectory: ObjCBool = false
                        if self.fileManager.fileExists(atPath: nextVaultURL.path, isDirectory: &isDirectory) {
                            throw NSError(
                                domain: "Brain2Native",
                                code: 1,
                                userInfo: [NSLocalizedDescriptionKey: "A folder with this name already exists."]
                            )
                        }

                        try self.fileManager.moveItem(at: currentVaultURL, to: nextVaultURL)

                        let bookmarkData: Data
                        do {
                            bookmarkData = try nextVaultURL.bookmarkData(
                                options: .withSecurityScope,
                                includingResourceValuesForKeys: nil,
                                relativeTo: nil
                            )
                        } catch {
                            try? self.fileManager.moveItem(at: nextVaultURL, to: currentVaultURL)
                            self.publishVaultRenameResult(
                                success: false,
                                errorMessage: "Nao foi possivel memorizar o acesso a pasta renomeada: \(error.localizedDescription)"
                            )
                            return
                        }

                        UserDefaults.standard.set(nextVaultURL.path, forKey: Self.selectedVaultPathDefaultsKey)
                        UserDefaults.standard.set(bookmarkData, forKey: Self.selectedVaultBookmarkDefaultsKey)

                        self.publishVaultSelection(for: nextVaultURL)
                        self.publishVaultRenameResult(success: true, errorMessage: nil)
                    } catch {
                        self.publishVaultRenameResult(success: false, errorMessage: error.localizedDescription)
                    }
                }
            }
        }

        private func validateVaultFolderName(_ raw: String) throws -> String {
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                throw NSError(
                    domain: "Brain2Native",
                    code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "Vault name is required."]
                )
            }

            if trimmed == "." || trimmed == ".." || trimmed.contains("/") || trimmed.contains("\\") {
                throw NSError(
                    domain: "Brain2Native",
                    code: 3,
                    userInfo: [NSLocalizedDescriptionKey: "Vault name is invalid."]
                )
            }

            return trimmed
        }

        private func publishVaultRenameResult(success: Bool, errorMessage: String?) {
            var payload: [String: Any] = ["success": success]
            if let errorMessage, !errorMessage.isEmpty {
                payload["error"] = errorMessage
            }

            guard JSONSerialization.isValidJSONObject(payload) else { return }
            guard
                let payloadData = try? JSONSerialization.data(withJSONObject: payload),
                let payloadJSON = String(data: payloadData, encoding: .utf8)
            else {
                return
            }

            DispatchQueue.main.async { [weak self] in
                let script = """
                window.dispatchEvent(new CustomEvent('brain2-native-vault-rename-result', { detail: \(payloadJSON) }));
                """
                self?.webView?.evaluateJavaScript(script, completionHandler: nil)
            }
        }

        private func publishFolderMutationResult(success: Bool, errorMessage: String?) {
            var payload: [String: Any] = ["success": success]
            if let errorMessage, !errorMessage.isEmpty {
                payload["error"] = errorMessage
            }

            guard JSONSerialization.isValidJSONObject(payload) else { return }
            guard
                let payloadData = try? JSONSerialization.data(withJSONObject: payload),
                let payloadJSON = String(data: payloadData, encoding: .utf8)
            else {
                return
            }

            DispatchQueue.main.async { [weak self] in
                let script = """
                window.dispatchEvent(new CustomEvent('brain2-native-folder-mutation-result', { detail: \(payloadJSON) }));
                """
                self?.webView?.evaluateJavaScript(script, completionHandler: nil)
            }
        }

        private func normalizeFolderPathSegments(_ raw: String) -> String {
            raw
                .replacingOccurrences(of: "\\", with: "/")
                .split(separator: "/")
                .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty && $0 != "." && $0 != ".." }
                .joined(separator: "/")
        }

        private func validateSubfolderName(_ raw: String) throws -> String {
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                throw NSError(
                    domain: "Brain2Native",
                    code: 10,
                    userInfo: [NSLocalizedDescriptionKey: "O nome da pasta e obrigatorio."]
                )
            }

            if trimmed == "." || trimmed == ".." || trimmed.contains("/") || trimmed.contains("\\") {
                throw NSError(
                    domain: "Brain2Native",
                    code: 11,
                    userInfo: [NSLocalizedDescriptionKey: "Nome de pasta invalido."]
                )
            }

            return trimmed
        }

        private func resolveUnderVault(vaultURL: URL, relativePath: String) throws -> URL {
            let normalized = normalizeFolderPathSegments(relativePath)
            let rootPath = vaultURL.standardizedFileURL.path
            var url = vaultURL
            if !normalized.isEmpty {
                for component in normalized.split(separator: "/") {
                    url.appendPathComponent(String(component), isDirectory: true)
                }
            }

            let targetPath = url.standardizedFileURL.path
            guard targetPath == rootPath || targetPath.hasPrefix(rootPath + "/") else {
                throw NSError(
                    domain: "Brain2Native",
                    code: 12,
                    userInfo: [NSLocalizedDescriptionKey: "Caminho invalido fora do vault."]
                )
            }

            return url
        }

        private func hasWikilinkTarget(markdown: String, target: String) -> Bool {
            let trimmed = target.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return false }
            return parseWikilinks(from: markdown).contains { link in
                link.compare(trimmed, options: .caseInsensitive) == .orderedSame
            }
        }

        private func insertFolderCorrelationWikilinkInMetadata(markdown: String, target: String) -> String {
            let trimmedTarget = target.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmedTarget.isEmpty else { return markdown }
            if hasWikilinkTarget(markdown: markdown, target: trimmedTarget) {
                return markdown
            }

            let correlationLine = "- Correlation: [[\(trimmedTarget)]]"
            var lines = markdown.components(separatedBy: .newlines)

            if let modelIndex = lines.firstIndex(where: {
                $0.trimmingCharacters(in: .whitespaces).lowercased().hasPrefix("- model:")
            }) {
                lines.insert(correlationLine, at: modelIndex + 1)
                return lines.joined(separator: "\n")
            }

            if let firstMetadataIndex = lines.firstIndex(where: {
                $0.trimmingCharacters(in: .whitespaces).hasPrefix("- ")
            }) {
                var insertIndex = firstMetadataIndex
                while insertIndex < lines.count, lines[insertIndex].trimmingCharacters(in: .whitespaces).hasPrefix("- ") {
                    insertIndex += 1
                }
                lines.insert(correlationLine, at: insertIndex)
                return lines.joined(separator: "\n")
            }

            if let firstLine = lines.first, firstLine.trimmingCharacters(in: .whitespaces).hasPrefix("#") {
                let insertIndex = (lines.count > 1 && lines[1].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) ? 2 : 1
                lines.insert(correlationLine, at: insertIndex)
                return lines.joined(separator: "\n")
            }

            return "\(correlationLine)\n\(markdown)"
        }

        private func ensureMarkdownCorrelationWikilink(fileURL: URL, targetWikilinkName: String) throws {
            var isDirectory: ObjCBool = false
            let existing: String
            if fileManager.fileExists(atPath: fileURL.path, isDirectory: &isDirectory) {
                if isDirectory.boolValue {
                    throw NSError(
                        domain: "Brain2Native",
                        code: 13,
                        userInfo: [NSLocalizedDescriptionKey: "O destino da correlacao nao e um ficheiro."]
                    )
                }
                existing = (try? String(contentsOf: fileURL, encoding: .utf8)) ?? ""
            } else {
                existing = ""
            }

            let next = insertFolderCorrelationWikilinkInMetadata(markdown: existing, target: targetWikilinkName)
            let normalized = next.hasSuffix("\n") ? next : "\(next)\n"
            try normalized.write(to: fileURL, atomically: true, encoding: .utf8)
        }

        private func performCreateVaultSubfolder(vaultURL: URL, parentRelativePath: String, folderName: String) throws {
            let safeName = try validateSubfolderName(folderName)
            let normalizedParentPath = normalizeFolderPathSegments(parentRelativePath)
            let parentURL = try resolveUnderVault(vaultURL: vaultURL, relativePath: normalizedParentPath)

            var isParentDir: ObjCBool = false
            guard fileManager.fileExists(atPath: parentURL.path, isDirectory: &isParentDir), isParentDir.boolValue else {
                throw NSError(
                    domain: "Brain2Native",
                    code: 14,
                    userInfo: [NSLocalizedDescriptionKey: "A pasta pai nao existe."]
                )
            }

            let nextURL = parentURL.appendingPathComponent(safeName, isDirectory: true)
            if fileManager.fileExists(atPath: nextURL.path) {
                throw NSError(
                    domain: "Brain2Native",
                    code: 15,
                    userInfo: [NSLocalizedDescriptionKey: "Ja existe uma pasta com este nome."]
                )
            }

            try fileManager.createDirectory(at: nextURL, withIntermediateDirectories: false, attributes: nil)

            let bootstrapURL = nextURL.appendingPathComponent("\(safeName).md")
            do {
                guard fileManager.createFile(atPath: bootstrapURL.path, contents: Data(), attributes: nil) else {
                    throw NSError(
                        domain: "Brain2Native",
                        code: 16,
                        userInfo: [NSLocalizedDescriptionKey: "Nao foi possivel criar o ficheiro da pasta."]
                    )
                }

                if !normalizedParentPath.isEmpty {
                    let parentFolderName = (normalizedParentPath as NSString).lastPathComponent
                    try ensureMarkdownCorrelationWikilink(fileURL: bootstrapURL, targetWikilinkName: parentFolderName)
                    let parentCorrURL = parentURL.appendingPathComponent("\(parentFolderName).md")
                    try ensureMarkdownCorrelationWikilink(fileURL: parentCorrURL, targetWikilinkName: safeName)
                }
            } catch {
                try? fileManager.removeItem(at: nextURL)
                throw error
            }
        }

        private func performRenameVaultSubfolder(vaultURL: URL, folderRelativePath: String, newFolderName: String) throws {
            let safeName = try validateSubfolderName(newFolderName)
            let normalizedFolderPath = normalizeFolderPathSegments(folderRelativePath)
            guard !normalizedFolderPath.isEmpty else {
                throw NSError(
                    domain: "Brain2Native",
                    code: 17,
                    userInfo: [NSLocalizedDescriptionKey: "Indique a pasta a renomear."]
                )
            }

            let currentURL = try resolveUnderVault(vaultURL: vaultURL, relativePath: normalizedFolderPath)

            var isDir: ObjCBool = false
            guard fileManager.fileExists(atPath: currentURL.path, isDirectory: &isDir), isDir.boolValue else {
                throw NSError(
                    domain: "Brain2Native",
                    code: 18,
                    userInfo: [NSLocalizedDescriptionKey: "A pasta nao existe."]
                )
            }

            if currentURL.standardizedFileURL.path == vaultURL.standardizedFileURL.path {
                throw NSError(
                    domain: "Brain2Native",
                    code: 19,
                    userInfo: [NSLocalizedDescriptionKey: "Use Configuracoes para renomear o vault."]
                )
            }

            let currentName = currentURL.lastPathComponent
            if currentName.compare(safeName, options: .caseInsensitive) == .orderedSame {
                return
            }

            let parentURL = currentURL.deletingLastPathComponent()
            let nextURL = parentURL.appendingPathComponent(safeName, isDirectory: true)
            if fileManager.fileExists(atPath: nextURL.path) {
                throw NSError(
                    domain: "Brain2Native",
                    code: 20,
                    userInfo: [NSLocalizedDescriptionKey: "Ja existe uma pasta com este nome."]
                )
            }

            try fileManager.moveItem(at: currentURL, to: nextURL)

            // Regra do vault: `NomeDaPasta/NomeDaPasta.md` acompanha o nome da pasta.
            let oldCorrelationURL = nextURL.appendingPathComponent("\(currentName).md")
            let newCorrelationURL = nextURL.appendingPathComponent("\(safeName).md")
            if oldCorrelationURL.standardizedFileURL.path != newCorrelationURL.standardizedFileURL.path {
                var isCorrelationFile: ObjCBool = false
                if fileManager.fileExists(atPath: oldCorrelationURL.path, isDirectory: &isCorrelationFile),
                   !isCorrelationFile.boolValue {
                    if fileManager.fileExists(atPath: newCorrelationURL.path) {
                        throw NSError(
                            domain: "Brain2Native",
                            code: 21,
                            userInfo: [NSLocalizedDescriptionKey: "Ja existe um ficheiro com o nome da nova pasta dentro da pasta."]
                        )
                    }
                    try fileManager.moveItem(at: oldCorrelationURL, to: newCorrelationURL)
                }
            }
        }

        private func createVaultSubfolderFromWeb(_ payload: [String: Any]) {
            let parentPath = (payload["parentPath"] as? String) ?? ""
            let folderName = (payload["folderName"] as? String) ?? ""

            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                guard let self else { return }
                guard let vaultURL = self.resolvePersistedVaultURL() else {
                    DispatchQueue.main.async { [weak self] in
                        self?.publishFolderMutationResult(
                            success: false,
                            errorMessage: "Nenhum vault local selecionado. Abra Configuracoes e escolha a pasta."
                        )
                    }
                    return
                }

                self.withSecurityScopedAccess(to: vaultURL) {
                    do {
                        try self.performCreateVaultSubfolder(
                            vaultURL: vaultURL,
                            parentRelativePath: parentPath,
                            folderName: folderName
                        )
                        self.publishVaultSelection(for: vaultURL) { [weak self] in
                            self?.publishFolderMutationResult(success: true, errorMessage: nil)
                        }
                    } catch {
                        self.publishFolderMutationResult(success: false, errorMessage: error.localizedDescription)
                    }
                }
            }
        }

        private func renameVaultSubfolderFromWeb(_ payload: [String: Any]) {
            let folderPath = (payload["folderPath"] as? String) ?? ""
            let newFolderName = (payload["newFolderName"] as? String) ?? ""

            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                guard let self else { return }
                guard let vaultURL = self.resolvePersistedVaultURL() else {
                    DispatchQueue.main.async { [weak self] in
                        self?.publishFolderMutationResult(
                            success: false,
                            errorMessage: "Nenhum vault local selecionado. Abra Configuracoes e escolha a pasta."
                        )
                    }
                    return
                }

                self.withSecurityScopedAccess(to: vaultURL) {
                    do {
                        try self.performRenameVaultSubfolder(
                            vaultURL: vaultURL,
                            folderRelativePath: folderPath,
                            newFolderName: newFolderName
                        )
                        self.publishVaultSelection(for: vaultURL) { [weak self] in
                            self?.publishFolderMutationResult(success: true, errorMessage: nil)
                        }
                    } catch {
                        self.publishFolderMutationResult(success: false, errorMessage: error.localizedDescription)
                    }
                }
            }
        }

        private func publishPersistedVaultIfAvailable() {
            guard let persistedURL = resolvePersistedVaultURL() else { return }

            var isDirectory: ObjCBool = false
            guard fileManager.fileExists(atPath: persistedURL.path, isDirectory: &isDirectory), isDirectory.boolValue else {
                return
            }

            publishVaultSelection(for: persistedURL)
        }

        private func publishVaultSelection(for rootURL: URL, onJavaScriptEvaluated: (@Sendable () -> Void)? = nil) {
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                guard let self else { return }
                self.withSecurityScopedAccess(to: rootURL) {
                    let payload = self.buildVaultPayload(for: rootURL)
                    self.publish(payload: payload, onJavaScriptEvaluated: onJavaScriptEvaluated)
                }
            }
        }

        /// URL obtida **apenas** a partir do security-scoped bookmark. O fallback por path não funciona
        /// com App Sandbox (`startAccessingSecurityScopedResource` falha em URLs só com caminho).
        private func resolvePersistedVaultURL() -> URL? {
            guard let bookmarkData = UserDefaults.standard.data(forKey: Self.selectedVaultBookmarkDefaultsKey) else {
                return nil
            }

            var isStale = false
            guard
                let resolvedURL = try? URL(
                    resolvingBookmarkData: bookmarkData,
                    options: [.withSecurityScope],
                    relativeTo: nil,
                    bookmarkDataIsStale: &isStale
                )
            else {
                return nil
            }

            if isStale {
                if let refreshed = try? resolvedURL.bookmarkData(
                    options: .withSecurityScope,
                    includingResourceValuesForKeys: nil,
                    relativeTo: nil
                ) {
                    UserDefaults.standard.set(refreshed, forKey: Self.selectedVaultBookmarkDefaultsKey)
                }
            }

            if let path = UserDefaults.standard.string(forKey: Self.selectedVaultPathDefaultsKey),
               !path.isEmpty,
               resolvedURL.path != path {
                UserDefaults.standard.set(resolvedURL.path, forKey: Self.selectedVaultPathDefaultsKey)
            }

            return resolvedURL
        }

        private func withSecurityScopedAccess(to url: URL, perform: () -> Void) {
            let granted = url.startAccessingSecurityScopedResource()
            #if DEBUG
            if !granted {
                NSLog("[Brain2 Native] startAccessingSecurityScopedResource falhou para \(url.path) — operações de ficheiro podem falhar (sandbox).")
            }
            #endif
            defer {
                if granted {
                    url.stopAccessingSecurityScopedResource()
                }
            }
            perform()
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

        private func publish(payload: [String: Any], onJavaScriptEvaluated: (@Sendable () -> Void)? = nil) {
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
                self?.webView?.evaluateJavaScript(script) { _, error in
                    #if DEBUG
                    if let error {
                        NSLog("[Brain2 Native] evaluateJavaScript vault payload falhou: \(error.localizedDescription)")
                    }
                    #endif
                    onJavaScriptEvaluated?()
                }
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
