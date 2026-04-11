//
//  Brain2WebView.swift
//  brain2-iOS
//
//  WKWebView + injeção dos tokens Firebase (mesmo contrato que macOS / page.tsx).
//

import SwiftUI
import WebKit

private let defaultAppURL = "https://brain2corevo.netlify.app/"

struct Brain2WebView: UIViewRepresentable {
    let urlString: String
    /// Quando definido, dispara o mesmo CustomEvent que a web já escuta.
    var pendingGoogleTokens: PendingGoogleTokens?
    var onTokensDelivered: () -> Void

    struct PendingGoogleTokens: Equatable {
        let idToken: String
        let accessToken: String?
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onTokensDelivered: onTokensDelivered)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
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
        context.coordinator.pendingTokens = pendingGoogleTokens

        guard let currentURL = uiView.url?.absoluteString else { return }
        if currentURL != urlString {
            loadURL(in: uiView)
        }
    }

    private func loadURL(in webView: WKWebView) {
        let raw = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        let u = raw.isEmpty ? defaultAppURL : raw
        guard let url = URL(string: u) else { return }
        webView.load(URLRequest(url: url))
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        weak var webView: WKWebView?
        var pendingTokens: PendingGoogleTokens?
        let onTokensDelivered: () -> Void

        init(onTokensDelivered: @escaping () -> Void) {
            self.onTokensDelivered = onTokensDelivered
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard let tokens = pendingTokens else { return }
            pendingTokens = nil
            dispatchTokens(idToken: tokens.idToken, accessToken: tokens.accessToken)
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
