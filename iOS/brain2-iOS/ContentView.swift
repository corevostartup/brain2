//
//  ContentView.swift
//  brain2-iOS
//

import SwiftUI

private let brain2WebURL = "https://brain2corevo.netlify.app/"

struct ContentView: View {
    @AppStorage("brain2_ios_native_gate_done") private var nativeGateDone = false

    @State private var pendingBootstrapTokens: Brain2WebView.PendingGoogleTokens?
    @State private var oauthBusy = false
    @State private var oauthAlertMessage: String?
    @State private var showOAuthAlert = false

    private let oauthController = GoogleOAuthSignInController()

    private var configurationHint: String? {
        let id = NativeOAuthSecrets.googleOAuthClientID.trimmingCharacters(in: .whitespacesAndNewlines)
        if id.isEmpty {
            return "Adicione o ID cliente Web do Firebase em NativeOAuthSecrets.Local.swift e registe brain2auth://oauth-callback na Google Cloud."
        }
        return nil
    }

    var body: some View {
        Group {
            if nativeGateDone {
                Brain2WebView(
                    urlString: brain2WebURL,
                    pendingGoogleTokens: pendingBootstrapTokens,
                    onTokensDelivered: {
                        pendingBootstrapTokens = nil
                    }
                )
                .ignoresSafeArea()
            } else {
                IOSGoogleSignInScreen(
                    isBusy: oauthBusy,
                    configurationError: configurationHint,
                    onGoogleSignIn: { startGoogleOAuth() },
                    onContinueToWeb: {
                        nativeGateDone = true
                    }
                )
            }
        }
        .alert("Login Google", isPresented: $showOAuthAlert, actions: {
            Button("OK", role: .cancel) {}
        }, message: {
            Text(oauthAlertMessage ?? "")
        })
    }

    private func startGoogleOAuth() {
        if configurationHint != nil {
            showOAuthAlert = true
            oauthAlertMessage = configurationHint
            return
        }

        oauthBusy = true
        oauthController.startGoogleSignIn { result in
            oauthBusy = false
            switch result {
            case .success(let tokens):
                pendingBootstrapTokens = Brain2WebView.PendingGoogleTokens(
                    idToken: tokens.idToken,
                    accessToken: tokens.accessToken
                )
                nativeGateDone = true
            case .failure(let error):
                let ns = error as NSError
                // Utilizador fechou o painel de login (domínio AuthenticationServices, código 1).
                if ns.domain == "com.apple.AuthenticationServices.WebAuthenticationSession",
                   ns.code == 1 {
                    return
                }
                oauthAlertMessage = ns.localizedDescription
                showOAuthAlert = true
            }
        }
    }
}

#Preview {
    ContentView()
}
