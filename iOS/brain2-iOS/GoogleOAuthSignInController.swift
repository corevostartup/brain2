//
//  GoogleOAuthSignInController.swift
//  brain2-iOS
//
//  GoogleSignIn nativo (mesmo modelo do app Lyka).
//

import Foundation
import GoogleSignIn
import UIKit

final class GoogleOAuthSignInController: NSObject {
    @MainActor
    func handle(_ url: URL) -> Bool {
        GIDSignIn.sharedInstance.handle(url)
    }

    func startGoogleSignIn(completion: @escaping (Result<GoogleOAuthPKCE.Tokens, Error>) -> Void) {
        guard let clientId = googleClientIdFromFirebasePlist() else {
            completion(.failure(OAuthConfigError.missingClientId))
            return
        }

        Task { @MainActor in
            guard
                let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                let rootVC = windowScene.windows.first(where: { $0.isKeyWindow })?.rootViewController ?? windowScene.windows.first?.rootViewController
            else {
                completion(.failure(OAuthConfigError.missingRootViewController))
                return
            }

            do {
                GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientId)
                let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: rootVC)
                guard let idToken = result.user.idToken?.tokenString, !idToken.isEmpty else {
                    completion(.failure(OAuthConfigError.missingIDToken))
                    return
                }

                let tokens = GoogleOAuthPKCE.Tokens(
                    idToken: idToken,
                    accessToken: result.user.accessToken.tokenString
                )
                completion(.success(tokens))
            } catch {
                completion(.failure(error))
            }
        }
    }

    private func googleClientIdFromFirebasePlist() -> String? {
        guard
            let url = Bundle.main.url(forResource: "GoogleService-Info", withExtension: "plist"),
            let data = try? Data(contentsOf: url),
            let raw = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
            let clientId = (raw["CLIENT_ID"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
            !clientId.isEmpty
        else {
            return nil
        }
        return clientId
    }
}

enum OAuthConfigError: LocalizedError {
    case missingClientId
    case missingRootViewController
    case missingIDToken

    var errorDescription: String? {
        switch self {
        case .missingClientId:
            return "CLIENT_ID ausente em GoogleService-Info.plist."
        case .missingRootViewController:
            return "Janela indisponivel para login Google."
        case .missingIDToken:
            return "Token do Google nao recebido."
        }
    }
}
