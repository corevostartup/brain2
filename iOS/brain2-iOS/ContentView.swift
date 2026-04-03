//
//  ContentView.swift
//  brain2-iOS
//
//  Created by Cássio on 03/04/26.
//

import SwiftUI
import WebKit

struct ContentView: View {
    var body: some View {
        WebView(urlString: "https://brain2corevo.netlify.app/")
            .ignoresSafeArea()
    }
}

struct WebView: UIViewRepresentable {
    let urlString: String

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let webView = WKWebView(frame: .zero, configuration: config)
        
        // Disable scrolling and bouncing
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.bouncesZoom = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 12/255, green: 12/255, blue: 12/255, alpha: 1)
        
        // Disable gestures
        webView.allowsBackForwardNavigationGestures = false
        
        // Inject CSS to disable zoom and fill screen
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
