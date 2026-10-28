import Foundation

struct LocalRequest {
    let method: String
    let target: String
    let headers: [String: String]
    let bodyURL: URL
    let bodyBytes: Int64
    func cleanup() { try? FileManager.default.removeItem(at: bodyURL) }
}

struct HTTPFailure: LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }
}

/// Incremental, bounded-memory parser; POST bodies are spooled to a private file.
final class HTTPRequestDecoder {
    private var buffer = Data()
    private var method = "", target = "", headers: [String: String] = [:]
    private var length: Int64?
    private var chunked = false
    private enum Chunk { case size, bytes(Int), delimiter, trailers }
    private var chunk: Chunk = .size
    private var received: Int64 = 0
    private var parsedHeaders = false, completed = false
    private let bodyURL: URL
    private let file: FileHandle
    private let validateHeaders: (([String: String]) throws -> Void)?
    static let limit = ResultStore.maximumBytes

    init(temporaryDirectory: URL = FileManager.default.temporaryDirectory, validateHeaders: (([String: String]) throws -> Void)? = nil) throws {
        self.validateHeaders = validateHeaders
        bodyURL = temporaryDirectory.appendingPathComponent(UUID().uuidString + ".request")
        guard FileManager.default.createFile(atPath: bodyURL.path, contents: nil) else { throw AppFailure("Sem espaço para a entrada.") }
        file = try FileHandle(forWritingTo: bodyURL)
    }

    func feed(_ data: Data) throws -> LocalRequest? {
        guard !completed else { throw AppFailure("Requisição já encerrada.") }
        buffer.append(data)
        if !parsedHeaders {
            guard let range = buffer.range(of: Data("\r\n\r\n".utf8)) else {
                guard buffer.count <= 65536 else { throw AppFailure("Cabeçalho muito grande.") }
                return nil
            }
            guard range.lowerBound <= 65536, let text = String(data: buffer[..<range.lowerBound], encoding: .utf8) else { throw AppFailure("Cabeçalho inválido.") }
            buffer.removeSubrange(..<range.upperBound)
            try parseHeaders(text)
            try validateHeaders?(headers)
            parsedHeaders = true
        }
        if chunked {
            while true {
                switch chunk {
                case .size:
                    guard let end = buffer.range(of: Data("\r\n".utf8)) else {
                        guard buffer.count < 1024 else { throw AppFailure("Bloco HTTP inválido.") }; return nil
                    }
                    let token = String(decoding: buffer[..<end.lowerBound], as: UTF8.self).split(separator: ";", maxSplits: 1, omittingEmptySubsequences: false)[0]
                    guard !token.isEmpty, token.allSatisfy({ $0.isHexDigit }), let size = Int(token, radix: 16),
                          Int64(size) <= Self.limit - received else { throw AppFailure("Bloco HTTP inválido ou grande demais.") }
                    buffer.removeSubrange(..<end.upperBound)
                    chunk = size == 0 ? .trailers : .bytes(size)
                case .bytes(let remaining):
                    guard !buffer.isEmpty else { return nil }
                    let count = min(remaining, buffer.count)
                    try write(Data(buffer.prefix(count)))
                    buffer.removeFirst(count)
                    chunk = count == remaining ? .delimiter : .bytes(remaining - count)
                case .delimiter:
                    guard buffer.count >= 2 else { return nil }
                    guard buffer.prefix(2) == Data("\r\n".utf8) else { throw AppFailure("Delimitador HTTP inválido.") }
                    buffer.removeFirst(2); chunk = .size
                case .trailers:
                    // Clients used here need no trailers. Reject rather than ambiguously parse them.
                    guard buffer.count >= 2 else { return nil }
                    guard buffer == Data("\r\n".utf8) else { throw AppFailure("Trailers HTTP não aceitos.") }
                    buffer.removeAll(); return try finish()
                }
            }
        }
        let expected = length ?? 0
        guard Int64(buffer.count) <= expected - received else { throw AppFailure("Corpo HTTP maior que o declarado.") }
        try write(buffer); buffer.removeAll(keepingCapacity: true)
        return received == expected ? try finish() : nil
    }

    private func parseHeaders(_ text: String) throws {
        let lines = text.components(separatedBy: "\r\n")
        let first = lines[0].split(separator: " ", omittingEmptySubsequences: false)
        guard first.count == 3, ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"].contains(String(first[0])),
              first[2] == "HTTP/1.1", first[1].hasPrefix("/"), !first[1].hasPrefix("//"), !first[1].contains("#") else {
            throw AppFailure("Linha HTTP inválida.")
        }
        method = String(first[0]); target = String(first[1])
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { throw AppFailure("Cabeçalho inválido.") }
            let name = String(line[..<colon]).lowercased()
            guard !name.isEmpty, name.utf8.allSatisfy({ (97...122).contains($0) || (48...57).contains($0) || $0 == 45 }),
                  headers[name] == nil else { throw AppFailure("Cabeçalho duplicado ou inválido.") }
            let value = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            guard !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { throw AppFailure("Valor de cabeçalho inválido.") }
            headers[name] = value
        }
        guard headers["host"] != nil, headers["expect"] == nil else { throw AppFailure("Host ausente ou Expect não aceito.") }
        if let value = headers["content-length"] {
            guard !value.isEmpty, value.utf8.allSatisfy({ (48...57).contains($0) }), let size = Int64(value),
                  (0...Self.limit).contains(size) else { throw AppFailure("Tamanho HTTP inválido.") }
            length = size
        }
        if let encoding = headers["transfer-encoding"] {
            guard encoding.lowercased() == "chunked", length == nil else { throw AppFailure("Codificação HTTP ambígua.") }
            chunked = true
        }
    }

    private func write(_ data: Data) throws {
        guard received + Int64(data.count) <= Self.limit else { throw AppFailure("Limite de 512 MiB.") }
        try file.write(contentsOf: data); received += Int64(data.count)
    }
    private func finish() throws -> LocalRequest {
        try file.close(); completed = true
        return LocalRequest(method: method, target: target, headers: headers, bodyURL: bodyURL, bodyBytes: received)
    }
    deinit { try? file.close(); if !completed { try? FileManager.default.removeItem(at: bodyURL) } }
}

enum HTTPRange {
    static func resolve(_ header: String?, size: Int64) throws -> (offset: Int64, length: Int64, partial: Bool) {
        guard let header = header else { return (0, size, false) }
        guard header.hasPrefix("bytes="), !header.contains(","), size > 0 else { throw AppFailure("Intervalo inválido.") }
        let values = header.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
        guard values.count == 2 else { throw AppFailure("Intervalo inválido.") }
        if values[0].isEmpty {
            guard let suffix = Int64(values[1]), suffix > 0 else { throw AppFailure("Intervalo inválido.") }
            let count = min(suffix, size); return (size - count, count, true)
        }
        guard let start = Int64(values[0]), start >= 0, start < size else { throw AppFailure("Intervalo inválido.") }
        let end: Int64
        if values[1].isEmpty { end = size - 1 }
        else { guard let value = Int64(values[1]), value >= start else { throw AppFailure("Intervalo inválido.") }; end = min(value, size - 1) }
        return (start, end - start + 1, true)
    }
}
