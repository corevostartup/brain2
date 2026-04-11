//
//  GoogleOAuthPKCE.swift
//  brain2-iOS
//
//  PKCE + troca de código por tokens (alinhado ao fluxo Web / macOS Brain2).
//

import CryptoKit
import Foundation
import Security

enum GoogleOAuthPKCE {
    struct Tokens {
        let idToken: String
        let accessToken: String?
    }

    enum OAuthError: LocalizedError {
        case tokenExchangeFailed(String)
        case missingIDToken

        var errorDescription: String? {
            switch self {
            case .tokenExchangeFailed(let message):
                return message
            case .missingIDToken:
                return "Google não devolveu id_token."
            }
        }
    }

    static func buildAuthorizationURL(
        clientId: String,
        challenge: String,
        state: String,
        redirectURI: String
    ) -> URL? {
        var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "access_type", value: "offline"),
            URLQueryItem(name: "prompt", value: "select_account"),
        ]
        return components.url
    }

    static func randomPKCEVerifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else {
            return UUID().uuidString.replacingOccurrences(of: "-", with: "")
        }
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func pkceChallengeS256(verifier: String) -> String? {
        guard let data = verifier.data(using: .utf8) else { return nil }
        let hash = SHA256.hash(data: data)
        return Data(hash).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func exchangeCodeForTokens(
        code: String,
        clientId: String,
        codeVerifier: String,
        redirectURI: String,
        clientSecret: String,
        completion: @escaping (Result<Tokens, Error>) -> Void
    ) {
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        var bodyFields: [String: String] = [
            "code": code,
            "client_id": clientId,
            "code_verifier": codeVerifier,
            "grant_type": "authorization_code",
            "redirect_uri": redirectURI,
        ]
        let trimmedSecret = clientSecret.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedSecret.isEmpty {
            bodyFields["client_secret"] = trimmedSecret
        }

        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
        let body = bodyFields
            .map { key, value -> String in
                let enc = value.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
                return "\(key)=\(enc)"
            }
            .joined(separator: "&")

        request.httpBody = body.data(using: .utf8)

        URLSession.shared.dataTask(with: request) { data, _, err in
            if let err {
                completion(.failure(err))
                return
            }
            guard let data else {
                completion(.failure(OAuthError.tokenExchangeFailed("Resposta vazia do Google.")))
                return
            }

            guard
                let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else {
                completion(.failure(OAuthError.tokenExchangeFailed("JSON inválido do token.")))
                return
            }

            if let errorMessage = json["error"] as? String {
                let desc = (json["error_description"] as? String) ?? errorMessage
                completion(.failure(OAuthError.tokenExchangeFailed(desc)))
                return
            }

            guard let idToken = json["id_token"] as? String, !idToken.isEmpty else {
                completion(.failure(OAuthError.missingIDToken))
                return
            }

            let access = json["access_token"] as? String
            completion(.success(Tokens(idToken: idToken, accessToken: access)))
        }.resume()
    }
}
