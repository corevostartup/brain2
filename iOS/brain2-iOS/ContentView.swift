//
//  ContentView.swift
//  brain2-iOS
//

import SwiftUI

/// Query `brain2-shell` alinha com `page.tsx` (sessionStorage shell nativa, igual ao macOS).
private let brain2WebURL = "https://brain2corevo.netlify.app/?brain2-shell=macos"
private let appChromeBackground = Color(red: 12 / 255, green: 12 / 255, blue: 12 / 255)

struct ContentView: View {
    /// `false` = ecrã nativo de boas-vindas; `true` = shell nativo com WKWebView (fluxo nativo completo).
    @AppStorage("brain2_ios_native_shell_unlocked_v1") private var shellUnlocked = false

    @State private var pendingBootstrapTokens: Brain2WebView.PendingGoogleTokens?
    @State private var webOAuthErrorMessage: String?
    @State private var oauthBusy = false
    @State private var oauthAlertMessage: String?
    @State private var showOAuthAlert = false

    private let oauthController = GoogleOAuthSignInController()

    private var isOAuthConfigured: Bool {
        !NativeOAuthSecrets.googleOAuthClientID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var configurationHint: String? {
        guard !isOAuthConfigured else { return nil }
        return "Adicione o ID cliente Web do Firebase em NativeOAuthSecrets.Local.swift e registe brain2auth://oauth-callback na Google Cloud."
    }

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
                        onOpenWelcome: {
                            shellUnlocked = false
                        },
                        onGoogleSignIn: { startGoogleOAuth(preferWebError: true) },
                        oauthConfigured: isOAuthConfigured,
                        oauthBusy: oauthBusy
                    )
                } else {
                    IOSGoogleSignInScreen(
                        isBusy: oauthBusy,
                        configurationError: configurationHint,
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
    }

    private func startGoogleOAuth(preferWebError: Bool) {
        guard isOAuthConfigured else { return }

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
    let onOpenWelcome: () -> Void
    let onGoogleSignIn: () -> Void
    let oauthConfigured: Bool
    let oauthBusy: Bool

    var body: some View {
        NavigationStack {
            Brain2WebView(
                urlString: urlString,
                pendingGoogleTokens: pendingTokens,
                onTokensDelivered: onTokensDelivered,
                onStartGoogleSignInFromWeb: onGoogleSignIn,
                webOAuthErrorMessage: $webOAuthErrorMessage
            )
            .ignoresSafeArea(edges: .bottom)
            .navigationTitle("Brain2")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(appChromeBackground, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            onGoogleSignIn()
                        } label: {
                            Label("Iniciar sessão com Google", systemImage: "person.badge.key")
                        }
                        .disabled(!oauthConfigured || oauthBusy)

                        Button(role: .none) {
                            onOpenWelcome()
                        } label: {
                            Label("Ecrã inicial", systemImage: "arrow.backward.circle")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .font(.body.weight(.medium))
                            .accessibilityLabel("Menu da conta")
                    }
                }
            }
        }
        .tint(.white)
    }
}

#Preview {
    ContentView()
}
