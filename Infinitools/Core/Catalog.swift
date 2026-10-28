import Foundation

struct Tool: Codable, Identifiable, Hashable {
    let id: String
    let slug: String
    let name: String
    let description: String
    let icon: String
    let family: String
    let group: String
    let route: String
    let accept: String
    let multiple: Bool
    let mode: String

    var searchText: String { Self.fold("\(name) \(description) \(group) \(slug)") }
    var modeLabel: String {
        switch mode {
        case "online": return "Usa internet"
        case "hybrid": return "Pode usar servidor"
        default: return "No aparelho*"
        }
    }
    var symbol: String {
        switch family {
        case "pdf": return "doc.richtext"
        case "image": return "photo"
        case "media": return "play.rectangle"
        default: return "square.grid.2x2"
        }
    }
    static func fold(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pt_BR"))
    }
}

struct Catalog {
    let tools: [Tool]
    let byID: [String: Tool]

    init(url: URL) throws {
        let tools = try JSONDecoder().decode([Tool].self, from: Data(contentsOf: url))
        guard !tools.isEmpty, Set(tools.map(\.id)).count == tools.count,
              tools.allSatisfy({ ["pdf", "image", "media", "utility"].contains($0.family) &&
                  ["local", "hybrid", "online"].contains($0.mode) &&
                  !$0.route.hasPrefix("/") && !$0.route.contains(":") && !$0.route.contains("..") }) else {
            throw AppFailure("O catálogo de ferramentas é inválido.")
        }
        self.tools = tools
        self.byID = Dictionary(uniqueKeysWithValues: tools.map { ($0.id, $0) })
    }

    func search(_ query: String, family: String? = nil) -> [Tool] {
        let terms = Tool.fold(query).split(whereSeparator: \.isWhitespace).map(String.init)
        return tools.filter { tool in
            (family == nil || tool.family == family) && terms.allSatisfy { tool.searchText.contains($0) }
        }
    }
}

struct AppFailure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

enum SafePath {
    static func name(_ name: String) -> String {
        let forbidden = CharacterSet(charactersIn: "\\/:*?\"<>|").union(.controlCharacters)
        var result = String(name.unicodeScalars.map { forbidden.contains($0) ? "_" : String($0) }.joined()
            .trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: ".")))
        while result.utf8.count > 180 { result.removeLast() }
        return result.isEmpty ? "arquivo" : result
    }

    static func decode(_ encoded: String) throws -> String {
        guard let path = encoded.removingPercentEncoding, path.hasPrefix("/"),
              !path.contains("\\"), !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              !path.contains("%"), !path.split(separator: "/", omittingEmptySubsequences: false).contains(where: { $0 == "." || $0 == ".." }) else {
            throw AppFailure("Caminho inválido.")
        }
        return path
    }

    static func contained(_ path: String, in root: URL) throws -> URL {
        let url = root.appendingPathComponent(path).standardizedFileURL.resolvingSymlinksInPath()
        let base = root.standardizedFileURL.resolvingSymlinksInPath().path + "/"
        guard url.path.hasPrefix(base) else { throw AppFailure("Caminho fora do armazenamento.") }
        return url
    }
}
