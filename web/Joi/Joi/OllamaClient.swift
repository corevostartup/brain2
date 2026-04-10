//
//  OllamaClient.swift
//  Joi
//

import Foundation

enum OllamaClientError: LocalizedError {
    case invalidURL
    case badStatus(Int, String)
    case decoding(Error)
    case emptyResponse

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "URL inválida."
        case .badStatus(let code, let body):
            return "Erro HTTP \(code): \(body)"
        case .decoding:
            return "Não foi possível interpretar a resposta do Ollama."
        case .emptyResponse:
            return "Resposta vazia do modelo."
        }
    }
}

struct OllamaChatRequest: Encodable {
    let model: String
    let messages: [OllamaMessagePayload]
    let stream: Bool
}

struct OllamaMessagePayload: Codable {
    let role: String
    let content: String
}

struct OllamaChatResponse: Decodable {
    let message: OllamaMessagePayload?
}

/// Linha NDJSON do modo `stream: true` em `/api/chat`.
private struct OllamaStreamChunk: Decodable {
    var message: StreamMessage?
    var done: Bool?
    var error: String?

    struct StreamMessage: Decodable {
        var content: String?
    }
}

struct OllamaClient {
    /// Ordem: IPv4 literal, depois localhost (ATS costuma tratar melhor o host nome).
    static let defaultLoopbackBases: [URL] = [
        URL(string: "http://127.0.0.1:11434")!,
        URL(string: "http://localhost:11434")!
    ]

    var baseURL: URL
    var session: URLSession

    init(baseURL: URL = OllamaClient.defaultLoopbackBases[0], session: URLSession? = nil) {
        self.baseURL = baseURL
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            // Ollama pode ficar minutos sem enviar bytes enquanto gera; limites baixos causam "The request timed out".
            config.timeoutIntervalForRequest = 3_600
            config.timeoutIntervalForResource = 86_400
            self.session = URLSession(configuration: config)
        }
    }

    func chat(model: String, userMessage: String) async throws -> String {
        try await chat(model: model, messages: [OllamaMessagePayload(role: "user", content: userMessage)])
    }

    /// Histórico completo — usa **streaming** para receber tokens logo (evita parecer “preso” minutos sem feedback).
    func chat(model: String, messages: [OllamaMessagePayload]) async throws -> String {
        try await chatStreaming(model: model, messages: messages, onAccumulated: { _ in })
    }

    /// Streaming NDJSON: `onAccumulated` é chamado na main thread a cada atualização do texto acumulado.
    func chatStreaming(
        model: String,
        messages: [OllamaMessagePayload],
        onAccumulated: @escaping @MainActor (String) -> Void
    ) async throws -> String {
        var lastError: Error?
        for base in Self.defaultLoopbackBases {
            let client = OllamaClient(baseURL: base, session: session)
            do {
                return try await client.chatStreamingSingleBase(
                    model: model,
                    messages: messages,
                    onAccumulated: onAccumulated
                )
            } catch let err as OllamaClientError {
                throw err
            } catch {
                lastError = error
                if !OllamaConnectionDiagnostics.isTransportLayerFailure(error) {
                    throw error
                }
            }
        }
        throw lastError ?? OllamaClientError.invalidURL
    }

    /// Não usar `appendingPathComponent("api/chat")`: a `/` pode virar `%2F` e quebrar o caminho.
    private func chatStreamingSingleBase(
        model: String,
        messages: [OllamaMessagePayload],
        onAccumulated: @escaping @MainActor (String) -> Void
    ) async throws -> String {
        let url = baseURL
            .appendingPathComponent("api")
            .appendingPathComponent("chat")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 86_400
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body = OllamaChatRequest(
            model: model,
            messages: messages,
            stream: true
        )
        request.httpBody = try JSONEncoder().encode(body)

        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw OllamaClientError.badStatus(-1, "Resposta inválida")
        }
        guard (200 ... 299).contains(http.statusCode) else {
            var bodyText = ""
            for try await b in bytes {
                if bodyText.count > 4_096 { break }
                guard let u = UnicodeScalar(UInt32(b)) else { continue }
                bodyText.append(Character(u))
            }
            throw OllamaClientError.badStatus(http.statusCode, bodyText)
        }

        var accumulated = ""
        var lineBuffer = Data()
        let nl = Data("\n".utf8)

        for try await byte in bytes {
            lineBuffer.append(byte)
            while let range = lineBuffer.range(of: nl) {
                let lineData = lineBuffer.subdata(in: lineBuffer.startIndex ..< range.lowerBound)
                lineBuffer.removeSubrange(lineBuffer.startIndex ..< range.upperBound)

                guard !lineData.isEmpty else { continue }
                guard let chunk = try Self.decodeStreamLine(lineData) else { continue }
                if let err = chunk.error, !err.isEmpty {
                    throw OllamaClientError.badStatus(500, err)
                }
                if let piece = chunk.message?.content, !piece.isEmpty {
                    accumulated.append(piece)
                    let snapshot = accumulated
                    await MainActor.run {
                        onAccumulated(snapshot)
                    }
                }
            }
        }

        if !lineBuffer.isEmpty, let chunk = try Self.decodeStreamLine(lineBuffer) {
            if let err = chunk.error, !err.isEmpty {
                throw OllamaClientError.badStatus(500, err)
            }
            if let piece = chunk.message?.content, !piece.isEmpty {
                accumulated.append(piece)
                let snapshot = accumulated
                await MainActor.run { onAccumulated(snapshot) }
            }
        }

        let trimmed = accumulated.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw OllamaClientError.emptyResponse }
        return trimmed
    }

    private static func decodeStreamLine(_ lineData: Data) throws -> OllamaStreamChunk? {
        let line = String(data: lineData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !line.isEmpty else { return nil }
        return try JSONDecoder().decode(OllamaStreamChunk.self, from: Data(line.utf8))
    }
}

// MARK: - Diagnóstico (sandbox / ATS / Ollama parado)

enum OllamaConnectionDiagnostics {
    /// Mensagem amigável quando a falha parece ser rede local ou política de segurança.
    static func userMessage(for error: Error, model: String) -> String {
        let detail = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        let modelTrim = model.trimmingCharacters(in: .whitespacesAndNewlines)

        if isTimedOut(error) {
            return """
            O pedido ao Ollama esgotou o tempo de espera.

            • Na primeira vez, o modelo pode demorar muito a carregar na memória antes de responder.
            • Teste no Terminal: `ollama run \(modelTrim) "oi"` — se também demorar, o Joi passará a usar os mesmos limites longos (24 h).
            • Confirme que o Ollama responde: `curl http://127.0.0.1:11434/api/tags`
            • Detalhe: \(detail.isEmpty ? "(sem descrição)" : detail)
            """
        }

        if isTransportLayerFailure(error) {
            return """
            Não foi possível conectar ao Ollama em http://127.0.0.1:11434 nem em http://localhost:11434.

            • Garanta que o Ollama está em execução (ícone na barra de menus ou `brew services start ollama`).
            • Teste no Terminal: `curl http://127.0.0.1:11434/api/tags`
            • Modelo: `ollama pull \(modelTrim)` (se ainda não tiver)
            • Detalhe: \(detail.isEmpty ? "(sem descrição)" : detail)
            """
        }
        return detail.isEmpty ? error.localizedDescription : detail
    }

    private static func isTimedOut(_ error: Error) -> Bool {
        if let u = error as? URLError, u.code == .timedOut { return true }
        return errorChain(error).contains { ($0 as NSError).domain == NSURLErrorDomain && ($0 as NSError).code == URLError.timedOut.rawValue }
    }

    /// Falhas em que vale tentar outro host loopback (não inclui erros HTTP/decodificação).
    static func isTransportLayerFailure(_ error: Error) -> Bool {
        looksLikeOllamaUnreachable(error)
    }

    /// Códigos `NSURLErrorDomain` que indicam falha de rede / ATS (comparados por `rawValue` por compatibilidade entre SDKs).
    private static let unreachableURLCodes: Set<Int> = [
        URLError.Code.cannotConnectToHost.rawValue,
        URLError.Code.cannotFindHost.rawValue,
        URLError.Code.timedOut.rawValue,
        URLError.Code.networkConnectionLost.rawValue,
        URLError.Code.dnsLookupFailed.rawValue,
        URLError.Code.notConnectedToInternet.rawValue,
        URLError.Code.secureConnectionFailed.rawValue,
        URLError.Code.appTransportSecurityRequiresSecureConnection.rawValue,
        URLError.Code.dataNotAllowed.rawValue
    ]

    private static func looksLikeOllamaUnreachable(_ error: Error) -> Bool {
        for case let err as NSError in errorChain(error) {
            if err.domain == NSPOSIXErrorDomain, err.code == 61 { return true }
            if err.domain == NSURLErrorDomain, unreachableURLCodes.contains(err.code) { return true }
        }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .cannotConnectToHost, .cannotFindHost, .timedOut, .networkConnectionLost,
                 .dnsLookupFailed, .notConnectedToInternet, .secureConnectionFailed,
                 .appTransportSecurityRequiresSecureConnection, .dataNotAllowed:
                return true
            default:
                break
            }
        }
        return false
    }

    private static func errorChain(_ error: Error) -> [Error] {
        var out: [Error] = [error]
        var current = error as NSError
        while let underlying = current.userInfo[NSUnderlyingErrorKey] as? NSError {
            out.append(underlying)
            current = underlying
        }
        return out
    }
}
