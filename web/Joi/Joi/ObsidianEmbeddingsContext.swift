//
//  ObsidianEmbeddingsContext.swift
//  Joi
//
//  Busca inteligente de notas usando embeddings do OpenAI + tags YAML.
//  Correlaciona o tipo de pergunta com notas relevantes usando análise semântica.
//

import Foundation

enum ObsidianEmbeddingsError: LocalizedError {
    case embeddingsFailed(String)
    case missingAPIKey
    
    var errorDescription: String? {
        switch self {
        case .embeddingsFailed(let msg):
            return "Falha ao gerar embeddings: \(msg)"
        case .missingAPIKey:
            return "Chave da API OpenAI em falta para embeddings"
        }
    }
}

// MARK: - Estruturas para OpenAI Embeddings API

private struct OpenAIEmbeddingRequest: Encodable {
    let model: String
    let input: String
    
    enum CodingKeys: String, CodingKey {
        case model, input
    }
}

private struct OpenAIEmbeddingResponse: Decodable {
    struct Data: Decodable {
        let embedding: [Double]
    }
    let data: [Data]
}

// MARK: - Context da busca com embeddings

enum ObsidianEmbeddingsContext {
    /// Tamanho total aproximado do bloco de memória (UTF-8)
    private static let maxBundleUTF8Bytes = 120_000
    private static let maxFileUTF8Bytes = 32_000
    
    private static let preamble = """
    És o assistente Joi. A seguir tens excertos da pasta Obsidian (vault) do utilizador — notas, índices e conversas exportadas. Usa este material como memória factual quando for relevante para a conversa. Se algo não constar aqui, diz claramente que não tens essa informação nos ficheiros disponíveis; não inventes. Responde no idioma que o utilizador usar.

    --- Memória Obsidian (caminhos relativos à pasta Joi autorizada) ---

    """
    
    private static let closing = "\n--- Fim da memória Obsidian ---\n"
    
    /// Cria bundle com ranking inteligente usando embeddings + tags + path + recência
    static func buildBundleForLLM(
        userMessage: String,
        conversationTitle: String,
        apiKey: String
    ) async -> String? {
        guard let root = ObsidianVaultBookmarkResolver.resolvedRootURL() else { return nil }
        guard root.startAccessingSecurityScopedResource() else { return nil }
        defer { root.stopAccessingSecurityScopedResource() }
        
        let fm = FileManager.default
        var items: [(URL, String)] = []
        collectTextFiles(in: root, root: root, fm: fm, into: &items)
        guard !items.isEmpty else { return nil }
        
        // Gera embedding da pergunta + contexto
        let queryText = userMessage + " " + conversationTitle
        let queryEmbedding: [Double]?
        do {
            queryEmbedding = try await generateEmbedding(for: queryText, apiKey: apiKey)
        } catch {
            // Se falhar embeddings, cai para fallback (path + keywords)
            queryEmbedding = nil
        }
        
        // Extrai keywords como fallback
        let keywords = tokenize(queryText)
        
        // Score cada ficheiro
        var scored: [(score: Double, url: URL, relPath: String, tags: [String], fileDate: Date)] = []
        
        for (url, rel) in items {
            let fileAttributes = try? fm.attributesOfItem(atPath: url.path)
            let fileDate = fileAttributes?[.modificationDate] as? Date ?? Date.distantPast
            
            // Extrai tags do YAML frontmatter
            guard let content = readTextFile(url) else { continue }
            let tags = extractTagsFromYAML(content)
            
            // Calcula score
            var score: Double = 0
            
            // 1. Similaridade semântica (embeddings) - 50% do peso
            if let queryEmb = queryEmbedding {
                if let fileEmb = try? await generateEmbedding(for: content.prefix(1000) + "...", apiKey: apiKey) {
                    let similarity = cosineSimilarity(queryEmb, fileEmb)
                    score += similarity * 50
                }
            }
            
            // 2. Match de tags - 30% do peso
            let tagScore = calculateTagScore(tags: tags, keywords: keywords)
            score += tagScore * 30
            
            // 3. Path relevance - 15% do peso
            let pathScore = pathRelevanceScore(relPath: rel, keywords: keywords)
            score += Double(pathScore) * 0.15
            
            // 4. Recência (ficheiros modificados há menos de 30 dias têm boost) - 5% do peso
            let recencyScore = calculateRecencyScore(fileDate: fileDate)
            score += recencyScore * 5
            
            scored.append((score: score, url: url, relPath: rel, tags: tags, fileDate: fileDate))
        }
        
        // Ordena por score descendente
        scored.sort { $0.score > $1.score }
        
        // Constrói bundle respeitando o limite
        let overhead = preamble.utf8.count + closing.utf8.count + 512
        var budget = max(0, maxBundleUTF8Bytes - overhead)
        var body = ""
        var omittedFiles = 0
        
        for (_, url, rel, tags, _) in scored {
            guard budget > 200 else {
                omittedFiles += 1
                continue
            }
            
            guard let raw = readTextFile(url) else { continue }
            let withoutYaml = stripYamlFrontmatter(raw)
            let clipped = clipUTF8Bytes(withoutYaml, maxBytes: min(maxFileUTF8Bytes, budget - 64))
            
            var tagStr = ""
            if !tags.isEmpty {
                tagStr = " (tags: \(tags.joined(separator: ", ")))"
            }
            
            let section = "### \(rel)\(tagStr)\n\n\(clipped)\n\n"
            let cost = section.utf8.count
            
            if cost > budget {
                omittedFiles += 1
                continue
            }
            
            body.append(section)
            budget -= cost
        }
        
        guard !body.isEmpty else { return nil }
        
        var note = ""
        if omittedFiles > 0 {
            note = "\n[Nota: \(omittedFiles) ficheiro(s) não incluídos por limite de contexto do modelo.]\n"
        }
        
        return preamble + body + note + closing
    }
    
    // MARK: - Embedding Generation
    
    private static func generateEmbedding(for text: String, apiKey: String) async throws -> [Double] {
        let url = URL(string: "https://api.openai.com/v1/embeddings")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        
        let payload = OpenAIEmbeddingRequest(model: "text-embedding-3-small", input: text)
        request.httpBody = try JSONEncoder().encode(payload)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw ObsidianEmbeddingsError.embeddingsFailed("HTTP \((response as? HTTPURLResponse)?.statusCode ?? -1)")
        }
        
        let decoded = try JSONDecoder().decode(OpenAIEmbeddingResponse.self, from: data)
        guard let embedding = decoded.data.first?.embedding else {
            throw ObsidianEmbeddingsError.embeddingsFailed("Resposta vazia")
        }
        
        return embedding
    }
    
    // MARK: - Score Calculations
    
    private static func cosineSimilarity(_ a: [Double], _ b: [Double]) -> Double {
        guard a.count == b.count, !a.isEmpty else { return 0 }
        
        let dotProduct = zip(a, b).reduce(0) { $0 + ($1.0 * $1.1) }
        let normA = sqrt(a.reduce(0) { $0 + ($1 * $1) })
        let normB = sqrt(b.reduce(0) { $0 + ($1 * $1) })
        
        guard normA > 0, normB > 0 else { return 0 }
        return dotProduct / (normA * normB)
    }
    
    private static func calculateTagScore(tags: [String], keywords: Set<String>) -> Double {
        guard !tags.isEmpty else { return 0 }
        
        let tagsLower = Set(tags.map { $0.lowercased() })
        let matches = tagsLower.intersection(keywords).count
        
        return Double(matches) / Double(max(1, tags.count))
    }
    
    private static func calculateRecencyScore(fileDate: Date) -> Double {
        let daysSinceModify = -fileDate.timeIntervalSinceNow / 86400
        
        if daysSinceModify < 7 {
            return 1.0
        } else if daysSinceModify < 30 {
            return 0.7
        } else if daysSinceModify < 90 {
            return 0.4
        } else {
            return 0.1
        }
    }
    
    private static func pathRelevanceScore(relPath: String, keywords: Set<String>) -> Int {
        guard !keywords.isEmpty else { return 0 }
        let pathLower = relPath.lowercased()
        var score = 0
        for w in keywords where pathLower.contains(w) {
            score += 6
        }
        return score
    }
    
    // MARK: - YAML Tag Extraction
    
    private static func extractTagsFromYAML(_ content: String) -> [String] {
        var tags: [String] = []
        
        // Procura YAML frontmatter (entre --- e ---)
        let lines = content.split(separator: "\n", omittingEmptySubsequences: false)
        guard lines.count > 2, lines[0].trimmingCharacters(in: .whitespaces) == "---" else {
            return tags
        }
        
        var inFrontmatter = false
        var endIndex = 1
        
        for i in 1..<lines.count {
            let line = lines[i]
            if line.trimmingCharacters(in: .whitespaces) == "---" {
                endIndex = i
                break
            }
            inFrontmatter = true
        }
        
        if inFrontmatter {
            for i in 1..<endIndex {
                let line = String(lines[i])
                
                // Procura pattern: tags: [tag1, tag2] ou tags: \n  - tag1\n  - tag2
                if line.lowercased().contains("tags:") {
                    // Array inline: tags: [tag1, tag2, tag3]
                    if let start = line.firstIndex(of: "["), let end = line.firstIndex(of: "]") {
                        let arrayStr = String(line[line.index(after: start)..<end])
                        let items = arrayStr.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
                        tags.append(contentsOf: items)
                    }
                    // Array multiline (lookahead)
                    else {
                        var j = i + 1
                        while j < endIndex {
                            let nextLine = String(lines[j])
                            if nextLine.trimmingCharacters(in: .whitespaces).starts(with: "-") {
                                let tag = nextLine
                                    .trimmingCharacters(in: .whitespaces)
                                    .dropFirst()
                                    .trimmingCharacters(in: .whitespaces)
                                if !String(tag).isEmpty {
                                    tags.append(String(tag))
                                }
                                j += 1
                            } else {
                                break
                            }
                        }
                    }
                    break
                }
            }
        }
        
        return tags
    }
    
    // MARK: - Utilities (shared com ObsidianVaultContext)
    
    private static func collectTextFiles(in directory: URL, root: URL, fm: FileManager, into out: inout [(URL, String)]) {
        guard let entries = try? fm.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return }
        
        for url in entries {
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: url.path, isDirectory: &isDir) else { continue }
            if isDir.boolValue {
                collectTextFiles(in: url, root: root, fm: fm, into: &out)
                continue
            }
            let ext = url.pathExtension.lowercased()
            guard ext == "md" || ext == "markdown" || ext == "txt" else { continue }
            let rel = relativePath(from: root, to: url)
            out.append((url, rel))
        }
    }
    
    private static func relativePath(from root: URL, to file: URL) -> String {
        let r = root.standardizedFileURL.path
        let f = file.standardizedFileURL.path
        guard f.hasPrefix(r) else { return file.lastPathComponent }
        let idx = f.index(f.startIndex, offsetBy: r.count)
        var sub = String(f[idx...])
        while sub.hasPrefix("/") { sub.removeFirst() }
        return sub.isEmpty ? file.lastPathComponent : sub
    }
    
    private static func tokenize(_ s: String) -> Set<String> {
        let lower = s.lowercased()
        var set = Set<String>()
        for word in lower.split(whereSeparator: { !$0.isLetter && !$0.isNumber }) {
            let w = String(word)
            if w.count >= 3 { set.insert(w) }
        }
        return set
    }
    
    private static func readTextFile(_ url: URL) -> String? {
        try? String(contentsOf: url, encoding: .utf8)
    }
    
    private static func stripYamlFrontmatter(_ s: String) -> String {
        let lines = s.split(separator: "\n", omittingEmptySubsequences: false)
        guard lines.count > 2, lines[0].trimmingCharacters(in: .whitespaces) == "---" else {
            return s
        }
        for i in 1..<lines.count {
            if lines[i].trimmingCharacters(in: .whitespaces) == "---" {
                return lines[(i + 1)...].joined(separator: "\n")
            }
        }
        return s
    }
    
    private static func clipUTF8Bytes(_ s: String, maxBytes: Int) -> String {
        guard s.utf8.count > maxBytes else { return s }
        var result = ""
        var bytes = 0
        for char in s {
            let charBytes = String(char).utf8.count
            if bytes + charBytes > maxBytes {
                result += "…"
                break
            }
            result.append(char)
            bytes += charBytes
        }
        return result
    }
}
