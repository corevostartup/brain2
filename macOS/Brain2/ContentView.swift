//
//  ContentView.swift
//  Brain2
//
//  Created by Cássio on 03/04/26.
//

import AppKit
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

    func makeNSView(context: Context) -> WKWebView {
        let webView = WKWebView()
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

    private func loadURL(in webView: WKWebView) {
        guard let url = URL(string: urlString) else { return }
        webView.load(URLRequest(url: url))
    }
}

#Preview {
    ContentView()
}
