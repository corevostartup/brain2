//
//  ContentView.swift
//  brain2-iOS
//

import SwiftUI
import GoogleSignIn

/// Query `brain2-shell` alinha com `page.tsx` (sessionStorage shell nativa, igual ao macOS).
private let brain2WebURL = "https://brain2-corevo2.vercel.app/?brain2-shell=macos"

struct ContentView: View {
    /// `false` = ecrã nativo de boas-vindas; `true` = shell nativo com WKWebView (fluxo nativo completo).
    @AppStorage("brain2_ios_native_shell_unlocked_v1") private var shellUnlocked = false

    @State private var pendingBootstrapTokens: Brain2WebView.PendingGoogleTokens?
    @State private var webOAuthErrorMessage: String?
    @State private var oauthBusy = false
    @State private var oauthAlertMessage: String?
    @State private var showOAuthAlert = false

    private let oauthController = GoogleOAuthSignInController()

    var body: some View {
        ZStack {
            Group {
                if shellUnlocked {
                    Brain2NativeShellView(
                        urlString: brain2WebURL,
                        pendingTokens: $pendingBootstrapTokens,
                        webOAuthErrorMessage: $webOAuthErrorMessage,
                        onTokensDelivered: {
                            pendingBootstrapTokens = nil
                        },
                        onGoogleSignIn: { startGoogleOAuth(preferWebError: true) }
                    )
                } else {
                    IOSGoogleSignInScreen(
                        isBusy: oauthBusy,
                        configurationError: nil,
                        onGoogleSignIn: { startGoogleOAuth(preferWebError: false) },
                        onContinueToWeb: {
                            shellUnlocked = true
                        }
                    )
                }
            }

            if oauthBusy {
                ZStack {
                    Color.black.opacity(0.28)
                        .ignoresSafeArea()
                    ProgressView()
                        .scaleEffect(1.15)
                        .tint(.white)
                }
                .allowsHitTesting(true)
            }
        }
        .alert("Login Google", isPresented: $showOAuthAlert, actions: {
            Button("OK", role: .cancel) {}
        }, message: {
            Text(oauthAlertMessage ?? "")
        })
        .onOpenURL { url in
            _ = oauthController.handle(url)
        }
    }

    private func startGoogleOAuth(preferWebError: Bool) {
        oauthBusy = true
        oauthController.startGoogleSignIn { result in
            oauthBusy = false
            switch result {
            case .success(let tokens):
                pendingBootstrapTokens = Brain2WebView.PendingGoogleTokens(
                    idToken: tokens.idToken,
                    accessToken: tokens.accessToken
                )
                shellUnlocked = true
            case .failure(let error):
                let ns = error as NSError
                if ns.domain == "com.apple.AuthenticationServices.WebAuthenticationSession",
                   ns.code == 1 {
                    return
                }
                let message = ns.localizedDescription
                if preferWebError || shellUnlocked {
                    webOAuthErrorMessage = message
                } else {
                    oauthAlertMessage = message
                    showOAuthAlert = true
                }
            }
        }
    }
}

// MARK: - Shell nativo (barra + menu)

private struct Brain2NativeShellView: View {
    let urlString: String
    @Binding var pendingTokens: Brain2WebView.PendingGoogleTokens?
    @Binding var webOAuthErrorMessage: String?
    let onTokensDelivered: () -> Void
    let onGoogleSignIn: () -> Void

    var body: some View {
        Brain2WebView(
            urlString: urlString,
            pendingGoogleTokens: pendingTokens,
            onTokensDelivered: onTokensDelivered,
            onStartGoogleSignInFromWeb: onGoogleSignIn,
            webOAuthErrorMessage: $webOAuthErrorMessage
        )
        .ignoresSafeArea()
    }
}

#Preview {
    ContentView()
}
