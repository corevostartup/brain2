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
private let appChromeBackground = Color(red: 26 / 255, green: 26 / 255, blue: 26 / 255)

struct ContentView: View {
    var body: some View {
        VStack(spacing: 0) {
            titleBar
            WebView(urlString: "https://brain2corevo.netlify.app/")
        }
        .background(appChromeBackground)
        .background(WindowChromeConfigurator())
    }

    private var titleBar: some View {
        HStack(spacing: 6) {
            WindowChromeButton(color: NSColor.systemRed, helpText: "Fechar") {
                WindowChromeActions.closeFocusedWindow()
            }
            WindowChromeButton(color: NSColor.systemYellow, helpText: "Minimizar") {
                WindowChromeActions.miniaturizeFocusedWindow()
            }
            WindowChromeButton(color: NSColor.systemGreen, helpText: "Zoom") {
                WindowChromeActions.zoomFocusedWindow()
            }
            WindowDragRegion()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(.leading, 10)
        .padding(.trailing, 8)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity)
        .frame(height: 26)
        .background(appChromeBackground)
    }
}

private struct WindowChromeButton: View {
    let color: NSColor
    let helpText: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Circle()
                .fill(Color(nsColor: color))
                .frame(width: 10, height: 10)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .help(helpText)
    }
}

struct WebView: NSViewRepresentable {
    let urlString: String

    func makeNSView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.allowsBackForwardNavigationGestures = true
        if #available(macOS 13.0, *) {
            webView.underPageBackgroundColor = NSColor(
                calibratedRed: 26 / 255,
                green: 26 / 255,
                blue: 26 / 255,
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
