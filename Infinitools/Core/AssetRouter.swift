import Foundation

struct RemoteAsset: Codable {
    let sha256: String
    let bytes: Int64
}

struct AssetRouter {
    let root: URL
    let routes: [String: String]
    let remote: [String: RemoteAsset]
    private let onlinePages: Set<String>
    // Public processing endpoints only. No arbitrary URL, administrative or PHP source proxy.
    static let endpoints: Set<String> = [
        "/api/compiler.php", "/api/compiler-preferences.php", "/api/html-pdf.php",
        "/api/pdfa.php", "/api/raster-pdf.php", "/api/downloader.php"
    ]

    init(root: URL, catalog: Catalog) throws {
        self.root = root
        routes = try JSONDecoder().decode([String: String].self, from: Data(contentsOf: root.appendingPathComponent("routes.json")))
        remote = try JSONDecoder().decode([String: RemoteAsset].self, from: Data(contentsOf: root.appendingPathComponent("remote-assets.json")))
        onlinePages = Set(catalog.tools.filter { $0.slug == "youtube-download" }.flatMap { ["/" + $0.route, "/" + $0.route + ".php"] })
        guard remote.allSatisfy({ $0.key.hasPrefix("/assets/") && $0.value.bytes > 0 &&
            $0.value.sha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }) else {
            throw AppFailure("Manifesto de motores inválido.")
        }
    }

    func resolve(target: String) throws -> (path: String, local: URL?) {
        guard let parts = URLComponents(string: target), parts.scheme == nil, parts.host == nil else { throw AppFailure("Rota inválida.") }
        let path = try SafePath.decode(parts.percentEncodedPath)
        if path.hasPrefix("/assets/") || path.hasPrefix("/android/") || path.hasPrefix("/ios/") {
            let relative = String(path.dropFirst()) + (path.hasSuffix(".gz") ? ".raw" : "")
            let file = try SafePath.contained("web/" + relative, in: root)
            return (path, FileManager.default.fileExists(atPath: file.path) ? file : nil)
        }
        var key = path.hasSuffix(".php") ? String(path.dropLast(4)) : path
        if let tool = parts.queryItems?.first(where: { $0.name == "tool" })?.value { key += "?tool=" + tool }
        guard let relative = routes[key] else { return (path, nil) }
        return (path, try SafePath.contained("web/" + relative, in: root))
    }

    func mayProxy(_ path: String) -> Bool { Self.endpoints.contains(path) || onlinePages.contains(path) }

    static func mime(_ url: URL) -> String {
        let ext = url.pathExtension == "raw" ? url.deletingPathExtension().pathExtension : url.pathExtension
        switch ext.lowercased() {
        case "js", "mjs": return "text/javascript"
        case "html": return "text/html; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json"
        case "wasm": return "application/wasm"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "gif": return "image/gif"
        case "ico": return "image/x-icon"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "ttf": return "font/ttf"
        case "gz": return "application/gzip"
        case "pdf": return "application/pdf"
        case "txt", "md": return "text/plain; charset=utf-8"
        default: return "application/octet-stream"
        }
    }
}
