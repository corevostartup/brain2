//
//  OpenAIClient.swift
//  Joi
//
//  Chat Completions API (streaming SSE). Modelo por defeito: gpt-5.4-mini.
//

import Foundation

enum OpenAIClientError: LocalizedError {
    case badStatus(Int, String)
    case emptyResponse
    case missingAPIKey

    var errorDescription: String? {
        switch self {
        case .badStatus(let code, let body):
            return "OpenAI HTTP \(code): \(body)"
        case .emptyResponse:
            return "Resposta vazia do modelo."
        case .missingAPIKey:
            return "Chave da API OpenAI em falta."
        }
    }
}

private struct OpenAIChatRequest: Encodable {
    let model: String
    let messages: [OllamaMessagePayload]
    let stream: Bool
}

private struct OpenAIStreamChunk: Decodable {
    struct Choice: Decodable {
        struct Delta: Decodable {
            var content: String?
            var role: String?
            /// Alguns modelos enviam recusa em `refusal` em vez de `content`.
            var refusal: String?
        }
        var delta: Delta?
    }
    var choices: [Choice]?
    var error: StreamErr?
    struct StreamErr: Decodable {
        var message: String?
        var type: String?
    }
}

private struct OpenAIHTTPErrorBody: Decodable {
    struct E: Decodable {
        var message: String?
    }
    var error: E?
}

/// Resposta `stream: false` — `message.content` / `message.refusal`.
private struct OpenAINonStreamResponse: Decodable {
    struct Choice: Decodable {
        struct Message: Decodable {
            var content: String?
            var refusal: String?
        }
        var message: Message?
    }
    var choices: [Choice]?
}

struct OpenAIClient {
    static let defaultModel = "gpt-5.4-mini"
    private static let completionsURL = URL(string: "https://api.openai.com/v1/chat/completions")!

    var session: URLSession

    init(session: URLSession? = nil) {
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 600
            config.timeoutIntervalForResource = 3_600
            self.session = URLSession(configuration: config)
        }
    }

    func chatStreaming(
        apiKey: String,
        model: String,
        messages: [OllamaMessagePayload],
        onAccumulated: @escaping @MainActor (String) -> Void
    ) async throws -> String {
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedKey.isEmpty else { throw OpenAIClientError.missingAPIKey }

        var request = URLRequest(url: Self.completionsURL)
        request.httpMethod = "POST"
        request.timeoutInterval = 600
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(trimmedKey)", forHTTPHeaderField: "Authorization")
        let body = OpenAIChatRequest(model: model, messages: messages, stream: true)
        request.httpBody = try JSONEncoder().encode(body)

        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw OpenAIClientError.badStatus(-1, "Resposta inválida")
        }
        guard (200 ... 299).contains(http.statusCode) else {
            var bodyText = ""
            for try await b in bytes {
                if bodyText.count > 8_192 { break }
                guard let u = UnicodeScalar(UInt32(b)) else { continue }
                bodyText.append(Character(u))
            }
            let friendly = Self.friendlyHTTPError(jsonBody: bodyText) ?? bodyText
            throw OpenAIClientError.badStatus(http.statusCode, friendly)
        }

        var accumulated = ""
        var lineBuffer = Data()
        let nl = Data("\n".utf8)

        for try await byte in bytes {
            lineBuffer.append(byte)
            while let range = lineBuffer.range(of: nl) {
                let lineData = lineBuffer.subdata(in: lineBuffer.startIndex ..< range.lowerBound)
                lineBuffer.removeSubrange(lineBuffer.startIndex ..< range.upperBound)

                guard let line = String(data: lineData, encoding: .utf8) else { continue }
                try await Self.processSSELine(line, accumulated: &accumulated, onAccumulated: onAccumulated)
            }
        }

        if !lineBuffer.isEmpty, let line = String(data: lineBuffer, encoding: .utf8) {
            try await Self.processSSELine(line, accumulated: &accumulated, onAccumulated: onAccumulated)
        }

        let trimmed = accumulated.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            return trimmed
        }

        return try await chatNonStreaming(
            apiKey: trimmedKey,
            model: model,
            messages: messages,
            onAccumulated: onAccumulated
        )
    }

    /// Se o stream não trouxe texto (parser, proxy, etc.), um pedido completo costuma funcionar.
    private func chatNonStreaming(
        apiKey: String,
        model: String,
        messages: [OllamaMessagePayload],
        onAccumulated: @escaping @MainActor (String) -> Void
    ) async throws -> String {
        var request = URLRequest(url: Self.completionsURL)
        request.httpMethod = "POST"
        request.timeoutInterval = 600
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        let body = OpenAIChatRequest(model: model, messages: messages, stream: false)
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw OpenAIClientError.badStatus(-1, "Resposta inválida")
        }
        let bodyText = String(data: data, encoding: .utf8) ?? ""
        guard (200 ... 299).contains(http.statusCode) else {
            let friendly = Self.friendlyHTTPError(jsonBody: bodyText) ?? bodyText
            throw OpenAIClientError.badStatus(http.statusCode, friendly)
        }

        let decoded = try JSONDecoder().decode(OpenAINonStreamResponse.self, from: data)
        let msg = decoded.choices?.first?.message
        let content = msg?.content?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let refusal = msg?.refusal?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let out = !content.isEmpty ? content : refusal
        guard !out.isEmpty else { throw OpenAIClientError.emptyResponse }
        await MainActor.run { onAccumulated(out) }
        return out
    }

    /// Uma linha SSE: opcionalmente `data: {...}` ou `[DONE]`.
    private static func processSSELine(
        _ rawLine: String,
        accumulated: inout String,
        onAccumulated: @escaping @MainActor (String) -> Void
    ) async throws {
        var trimmed = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("\u{FEFF}") {
            trimmed = String(trimmed.dropFirst())
        }
        guard !trimmed.isEmpty else { return }
        guard trimmed.hasPrefix("data:") else { return }
        let payload = trimmed.dropFirst(4).trimmingCharacters(in: .whitespaces)
        if payload == "[DONE]" { return }

        guard let json = payload.data(using: .utf8) else { return }
        try await appendStreamDelta(from: json, accumulated: &accumulated, onAccumulated: onAccumulated)
    }

    private static func appendStreamDelta(
        from json: Data,
        accumulated: inout String,
        onAccumulated: @escaping @MainActor (String) -> Void
    ) async throws {
        if let chunk = try? JSONDecoder().decode(OpenAIStreamChunk.self, from: json) {
            if let msg = chunk.error?.message, !msg.isEmpty {
                throw OpenAIClientError.badStatus(500, msg)
            }
            let delta = chunk.choices?.first?.delta
            if let piece = delta?.content, !piece.isEmpty {
                accumulated.append(piece)
                let snapshot = accumulated
                await MainActor.run { onAccumulated(snapshot) }
                return
            }
            if let refusal = delta?.refusal, !refusal.isEmpty {
                accumulated.append(refusal)
                let snapshot = accumulated
                await MainActor.run { onAccumulated(snapshot) }
                return
            }
            return
        }

        guard let root = try? JSONSerialization.jsonObject(with: json) as? [String: Any] else { return }
        if let err = root["error"] as? [String: Any], let msg = err["message"] as? String, !msg.isEmpty {
            throw OpenAIClientError.badStatus(500, msg)
        }
        guard let choices = root["choices"] as? [[String: Any]],
              let first = choices.first,
              let delta = first["delta"] as? [String: Any]
        else { return }

        var piece: String?
        if let c = delta["content"] as? String, !c.isEmpty {
            piece = c
        } else if let r = delta["refusal"] as? String, !r.isEmpty {
            piece = r
        } else if let arr = delta["content"] as? [[String: Any]] {
            let texts = arr.compactMap { $0["text"] as? String }
            let joined = texts.joined()
            if !joined.isEmpty { piece = joined }
        }

        guard let p = piece else { return }
        accumulated.append(p)
        let snapshot = accumulated
        await MainActor.run { onAccumulated(snapshot) }
    }

    private static func friendlyHTTPError(jsonBody: String) -> String? {
        guard let d = jsonBody.data(using: .utf8),
              let env = try? JSONDecoder().decode(OpenAIHTTPErrorBody.self, from: d),
              let m = env.error?.message, !m.isEmpty
        else { return nil }
        return m
    }
}

enum OpenAIConnectionDiagnostics {
    static func userMessage(for error: Error, model: String) -> String {
        let detail = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        let m = model.trimmingCharacters(in: .whitespacesAndNewlines)

        if let oe = error as? OpenAIClientError {
            switch oe {
            case .missingAPIKey:
                return """
                Chave da API OpenAI em falta.

                • Clique no ícone da chave na barra do compositor e guarde a chave (fica na Keychain).
                • Crie uma chave em: https://platform.openai.com/api-keys
                """
            default:
                break
            }
        }

        if detail.localizedCaseInsensitiveContains("incorrect api key")
            || detail.localizedCaseInsensitiveContains("invalid_api_key")
        {
            return """
            A chave da API OpenAI foi recusada.

            • Confirme a chave em https://platform.openai.com/api-keys
            • Guarde de novo na Joi (ícone da chave).
            • Detalhe: \(detail)
            """
        }

        return """
        Erro ao contactar a OpenAI (modelo \(m)).

        • Verifique a ligação à Internet e o saldo / limites da conta OpenAI.
        • Detalhe: \(detail.isEmpty ? "(sem descrição)" : detail)
        """
    }
}
