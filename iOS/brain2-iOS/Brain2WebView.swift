//
//  Brain2WebView.swift
//  brain2-iOS
//
//  WKWebView + bridge Brain2Native (igual ao macOS) para OAuth com ASWebAuthenticationSession
//  em vez de login Google dentro do WebView (bloqueado pelo Google).
//

import SwiftUI
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

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        static let messageHandlerName = "brain2Native"

        weak var webView: WKWebView?
        var pendingTokens: PendingGoogleTokens?
        let onTokensDelivered: () -> Void
        var onStartGoogleSignInFromWeb: () -> Void
        /// Evita duplicar o mesmo par id/access se `updateUIView` e `didFinish` correrem seguidos.
        private var lastDispatchedTokenFingerprint: String?

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
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            injectNativeBridge()
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
    }
}
