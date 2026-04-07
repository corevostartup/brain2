//
//  GoogleDesktopOAuth.swift
//  Brain2
//
//  PKCE + troca de codigo por tokens (Google OAuth para app de computador).
//

import CryptoKit
import Foundation
import Network
import Security

enum GoogleDesktopOAuth {
    /// Google exige que a app esteja a escuta neste endereço quando usa redirect loopback.
    static let redirectPort: UInt16 = 8765
    static var redirectURI: String { "http://127.0.0.1:\(redirectPort)/" }

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
                return "Google nao devolveu id_token. Verifique os scopes e o cliente OAuth."
            }
        }
    }

    static func buildAuthorizationURL(clientId: String, challenge: String, state: String) -> URL? {
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

    /// Respostas comuns do endpoint token (ex.: client ID de tipo Web em vez de Desktop).
    private static func friendlyGoogleTokenError(error: String, description: String) -> String {
        let blob = "\(error) \(description)".lowercased()
        if blob.contains("client_secret") {
            return "O Google exige client_secret neste pedido. Confirme que o client ID e do tipo Computador (Desktop) e preencha googleOAuthDesktopClientSecret em NativeOAuthSecrets.swift com a chave secreta desse mesmo cliente (Credenciais > cliente OAuth > segredo, ou JSON transferido)."
        }
        return description
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
        clientSecret: String = "",
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
                completion(.failure(OAuthError.tokenExchangeFailed("JSON invalido do token.")))
                return
            }

            if let errorMessage = json["error"] as? String {
                let desc = (json["error_description"] as? String) ?? errorMessage
                let friendly = Self.friendlyGoogleTokenError(error: errorMessage, description: desc)
                completion(.failure(OAuthError.tokenExchangeFailed(friendly)))
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

/// HTTP minimo em 127.0.0.1 para o redirect OAuth; sem servidor o Safari mostra "nao pode conectar".
final class OAuthLoopbackRedirectReceiver {
    private let port: UInt16
    private let onOAuthURL: (URL) -> Void
    private var listener: NWListener?
    private let lock = NSLock()
    private var hasDeliveredOAuth = false
    private var startCompletionCalled = false

    init(port: UInt16, onOAuthURL: @escaping (URL) -> Void) {
        self.port = port
        self.onOAuthURL = onOAuthURL
    }

    func start(completion: @escaping (Error?) -> Void) {
        guard let nwPort = NWEndpoint.Port(rawValue: port) else {
            completion(NSError(domain: "Brain2OAuth", code: 1, userInfo: [NSLocalizedDescriptionKey: "Porta invalida."]))
            return
        }
        let listener: NWListener
        do {
            listener = try NWListener(using: NWParameters.tcp, on: nwPort)
        } catch {
            completion(error)
            return
        }
        self.listener = listener

        listener.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                self.callStartCompletion(completion, error: nil)
            case .failed(let err):
                self.stop()
                self.callStartCompletion(completion, error: err)
            default:
                break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            self?.handleConnection(connection)
        }
        listener.start(queue: .global(qos: .userInitiated))
    }

    private func callStartCompletion(_ completion: @escaping (Error?) -> Void, error: Error?) {
        lock.lock()
        defer { lock.unlock() }
        guard !startCompletionCalled else { return }
        startCompletionCalled = true
        DispatchQueue.main.async {
            completion(error)
        }
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    private func handleConnection(_ connection: NWConnection) {
        connection.start(queue: .global(qos: .userInitiated))
        receiveHeader(connection)
    }

    private func receiveHeader(_ connection: NWConnection, accumulated: Data = Data()) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, isComplete, error in
            guard let self else {
                connection.cancel()
                return
            }
            var buf = accumulated
            if let data, !data.isEmpty { buf.append(data) }
            if let sepRange = buf.range(of: Data([0x0D, 0x0A, 0x0D, 0x0A])) {
                self.handleHTTPHead(connection, header: Data(buf[..<sepRange.lowerBound]))
                return
            }
            if error != nil || isComplete {
                connection.cancel()
                return
            }
            self.receiveHeader(connection, accumulated: buf)
        }
    }

    private func handleHTTPHead(_ connection: NWConnection, header: Data) {
        guard let text = String(data: header, encoding: .utf8) else {
            sendHTTP(connection, status: 400, body: "")
            return
        }
        let firstLine = text.split(separator: "\r\n", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        let parts = firstLine.split(separator: " ")
        guard parts.count >= 2, parts[0] == "GET" else {
            sendHTTP(connection, status: 404, body: "")
            connection.cancel()
            return
        }
        let pathAndQuery = String(parts[1])
        guard let url = URL(string: "http://127.0.0.1:\(port)\(pathAndQuery)") else {
            sendHTTP(connection, status: 400, body: "")
            connection.cancel()
            return
        }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
        let isOAuth = items?.contains(where: { $0.name == "code" }) == true
            || items?.contains(where: { $0.name == "error" }) == true
        if isOAuth {
            sendHTTP(
                connection,
                status: 200,
                body: "<!DOCTYPE html><html><meta charset=\"utf-8\"><body>Pode fechar esta janela.</body></html>"
            )
            deliverOAuthIfNeeded(url)
            connection.cancel()
            return
        }
        sendHTTP(connection, status: 404, body: "")
        connection.cancel()
    }

    private func sendHTTP(_ connection: NWConnection, status: Int, body: String) {
        let phrase: String
        switch status {
        case 200: phrase = "OK"
        case 404: phrase = "Not Found"
        default: phrase = "Bad Request"
        }
        let bodyData = Data(body.utf8)
        let head =
            "HTTP/1.1 \(status) \(phrase)\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(bodyData.count)\r\nConnection: close\r\n\r\n"
        var packet = Data(head.utf8)
        packet.append(bodyData)
        connection.send(content: packet, isComplete: true, completion: .contentProcessed { _ in })
    }

    private func deliverOAuthIfNeeded(_ url: URL) {
        lock.lock()
        defer { lock.unlock() }
        guard !hasDeliveredOAuth else { return }
        hasDeliveredOAuth = true
        listener?.cancel()
        listener = nil
        DispatchQueue.main.async {
            self.onOAuthURL(url)
        }
    }
}
