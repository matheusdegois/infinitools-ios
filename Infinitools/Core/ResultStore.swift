import Foundation

struct ResultFile: Codable, Identifiable, Hashable {
    let id: UUID
    let name: String
    let mime: String
    let bytes: Int64
    let created: Date
}

/// All calls run on the engine's serial I/O queue (or serially in tests).
final class ResultStore {
    static let maximumBytes: Int64 = 512 * 1024 * 1024
    let directory: URL
    private struct Transfer {
        let id: UUID
        let name: String
        let mime: String
        let expected: Int64
        let url: URL
        let handle: FileHandle
        var received: Int64 = 0
    }
    private var transfer: Transfer?

    init(directory: URL) throws {
        self.directory = directory
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        for url in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) where url.pathExtension == "part" {
            try FileManager.default.removeItem(at: url)
        }
        for url in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isDirectoryKey]) {
            if UUID(uuidString: url.lastPathComponent) != nil,
               (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true,
               !FileManager.default.fileExists(atPath: directory.appendingPathComponent(url.lastPathComponent + ".json").path) {
                try FileManager.default.removeItem(at: url)
            }
        }
        var root = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? root.setResourceValues(values)
    }

    func start(name: String, mime: String, size: Int64) throws -> UUID {
        guard transfer == nil else { throw AppFailure("Uma exportação já está em andamento.") }
        guard (0...Self.maximumBytes).contains(size) else { throw AppFailure("Limite de 512 MiB por resultado.") }
        let attributes = try FileManager.default.attributesOfFileSystem(forPath: directory.path)
        if let available = (attributes[.systemFreeSize] as? NSNumber)?.int64Value, available < size + 50 * 1024 * 1024 {
            throw AppFailure("Libere espaço no aparelho antes de exportar.")
        }
        let id = UUID(), url = directory.appendingPathComponent(UUID().uuidString + ".part")
        guard FileManager.default.createFile(atPath: url.path, contents: nil) else { throw AppFailure("Não foi possível criar o resultado.") }
        let normalized = String(mime.split(separator: ";").first ?? "").trimmingCharacters(in: .whitespaces)
        let valid = normalized.range(of: "^[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+$", options: .regularExpression) != nil
        transfer = Transfer(id: id, name: SafePath.name(name), mime: valid ? normalized : "application/octet-stream",
                            expected: size, url: url, handle: try FileHandle(forWritingTo: url))
        return id
    }

    func chunk(id: UUID, base64: String) throws {
        guard var current = transfer, current.id == id else { throw AppFailure("Exportação encerrada.") }
        guard base64.utf8.count <= 262144, let data = Data(base64Encoded: base64),
              current.received + Int64(data.count) <= current.expected else {
            throw AppFailure("Bloco de exportação inválido.")
        }
        try current.handle.write(contentsOf: data)
        current.received += Int64(data.count)
        transfer = current
    }

    func finish(id: UUID) throws -> ResultFile {
        guard let current = transfer, current.id == id else { throw AppFailure("Exportação encerrada.") }
        guard current.received == current.expected else { throw AppFailure("Exportação incompleta. Tente novamente.") }
        try current.handle.synchronize()
        try current.handle.close()
        let result = ResultFile(id: id, name: current.name, mime: current.mime, bytes: current.expected, created: Date())
        let folder = directory.appendingPathComponent(id.uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try FileManager.default.moveItem(at: current.url, to: folder.appendingPathComponent(result.name))
            try JSONEncoder().encode(result).write(to: metadata(id), options: .atomic)
            transfer = nil
            return result
        } catch {
            try? FileManager.default.removeItem(at: folder)
            abortAll()
            throw error
        }
    }

    func abort(id: UUID) { if transfer?.id == id { abortAll() } }
    func abortAll() {
        guard let current = transfer else { return }
        try? current.handle.close()
        try? FileManager.default.removeItem(at: current.url)
        transfer = nil
    }

    func list() throws -> [ResultFile] {
        try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }.compactMap { url -> ResultFile? in
                guard let data = try? Data(contentsOf: url), let result = try? JSONDecoder().decode(ResultFile.self, from: data),
                      url.lastPathComponent == result.id.uuidString + ".json", result.name == SafePath.name(result.name),
                      let file = try? fileURL(result),
                      let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize,
                      Int64(size) == result.bytes else { return nil }
                return result
            }.sorted { $0.created > $1.created }
    }

    func fileURL(_ result: ResultFile) throws -> URL {
        guard result.name == SafePath.name(result.name) else { throw AppFailure("Nome de resultado inválido.") }
        return try SafePath.contained(result.id.uuidString + "/" + result.name, in: directory)
    }

    func delete(_ result: ResultFile) throws {
        try FileManager.default.removeItem(at: directory.appendingPathComponent(result.id.uuidString))
        try FileManager.default.removeItem(at: metadata(result.id))
    }

    private func metadata(_ id: UUID) -> URL { directory.appendingPathComponent(id.uuidString + ".json") }
    deinit { abortAll() }
}
