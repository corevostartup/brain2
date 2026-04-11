//
//  GoogleOAuthSignInController.swift
//  brain2-iOS
//
//  ASWebAuthenticationSession (fluxo recomendado pela Apple para OAuth) + PKCE.
//

import AuthenticationServices
import Foundation
import UIKit

final class GoogleOAuthSignInController: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var authSession: ASWebAuthenticationSession?
    private var pkceVerifier = ""
    private var oauthState = ""

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let windows = scenes.flatMap(\.windows)
        if let key = windows.first(where: { $0.isKeyWindow }) {
            return key
        }
        if let any = windows.first {
            return any
        }
        return scenes.first!.windows.first!
    }

    func startGoogleSignIn(completion: @escaping (Result<GoogleOAuthPKCE.Tokens, Error>) -> Void) {
        authSession?.cancel()

        let clientId = NativeOAuthSecrets.googleOAuthClientID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clientId.isEmpty else {
            completion(.failure(OAuthConfigError.missingClientId))
            return
        }

        let redirectURI = NativeOAuthSecrets.googleOAuthRedirectURI
        pkceVerifier = GoogleOAuthPKCE.randomPKCEVerifier()
        oauthState = GoogleOAuthPKCE.randomPKCEVerifier()

        guard let challenge = GoogleOAuthPKCE.pkceChallengeS256(verifier: pkceVerifier) else {
            completion(.failure(OAuthConfigError.pkceFailed))
            return
        }

        guard
            let authURL = GoogleOAuthPKCE.buildAuthorizationURL(
                clientId: clientId,
                challenge: challenge,
                state: oauthState,
                redirectURI: redirectURI
            )
        else {
            completion(.failure(OAuthConfigError.invalidAuthURL))
            return
        }

        let scheme = URL(string: redirectURI)?.scheme ?? "brain2auth"

        let session = ASWebAuthenticationSession(
            url: authURL,
            callbackURLScheme: scheme
        ) { [weak self] callbackURL, error in
            guard let self else { return }
            self.authSession = nil

            if let error {
                completion(.failure(error))
                return
            }

            guard let callbackURL else {
                completion(.failure(OAuthConfigError.missingCallback))
                return
            }

            guard let items = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems else {
                completion(.failure(OAuthConfigError.missingCallback))
                return
            }

            if let errCode = items.first(where: { $0.name == "error" })?.value {
                let desc = items.first(where: { $0.name == "error_description" })?.value ?? errCode
                completion(.failure(OAuthConfigError.oauthProvider(errCode, desc)))
                return
            }

            guard let returnedState = items.first(where: { $0.name == "state" })?.value, returnedState == self.oauthState else {
                completion(.failure(OAuthConfigError.stateMismatch))
                return
            }

            guard let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty else {
                completion(.failure(OAuthConfigError.missingCode))
                return
            }

            GoogleOAuthPKCE.exchangeCodeForTokens(
                code: code,
                clientId: clientId,
                codeVerifier: self.pkceVerifier,
                redirectURI: redirectURI,
                clientSecret: NativeOAuthSecrets.googleOAuthClientSecret
            ) { result in
                completion(result)
            }
        }

        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authSession = session

        if !session.start() {
            completion(.failure(OAuthConfigError.sessionStartFailed))
        }
    }

    func cancel() {
        authSession?.cancel()
        authSession = nil
    }
}

enum OAuthConfigError: LocalizedError {
    case missingClientId
    case pkceFailed
    case invalidAuthURL
    case missingCallback
    case missingCode
    case stateMismatch
    case sessionStartFailed
    case oauthProvider(String, String)

    var errorDescription: String? {
        switch self {
        case .missingClientId:
            return "Configure o ID cliente Google (NativeOAuthSecrets.Local.swift)."
        case .pkceFailed:
            return "Falha ao preparar PKCE."
        case .invalidAuthURL:
            return "URL de autorização inválida."
        case .missingCallback:
            return "Resposta de login incompleta."
        case .missingCode:
            return "Código de autorização ausente."
        case .stateMismatch:
            return "Estado OAuth inválido (segurança)."
        case .sessionStartFailed:
            return "Não foi possível abrir o login do Google."
        case .oauthProvider(_, let desc):
            return desc
        }
    }
}
