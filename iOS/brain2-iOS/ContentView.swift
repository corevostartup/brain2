//
//  ContentView.swift
//  brain2-iOS
//
//  Created by Cássio on 03/04/26.
//

import SwiftUI
import WebKit

/// Mesma base da landing Brain2 (cinza quase preto).
private let appChromeBackground = Color(red: 26 / 255, green: 26 / 255, blue: 26 / 255)

struct ContentView: View {
    var body: some View {
        ZStack {
            appChromeBackground
                .ignoresSafeArea()
            
            WebView(urlString: "https://brain2corevo.netlify.app/")
        }
    }
}

struct WebView: UIViewRepresentable {
    let urlString: String

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.allowsBackForwardNavigationGestures = true
        if #available(iOS 13.0, *) {
            webView.backgroundColor = UIColor(
                red: 26 / 255,
                green: 26 / 255,
                blue: 26 / 255,
                alpha: 1
            )
        }
        loadURL(in: webView)
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        guard let currentURL = uiView.url?.absoluteString else { return }
        if currentURL != urlString {
            loadURL(in: uiView)
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
