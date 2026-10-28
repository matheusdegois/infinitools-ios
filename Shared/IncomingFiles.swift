import Foundation

enum IncomingFiles {
    static let group = "group.br.com.infinitools.ios"
    static let maximumBytes: Int64 = 512 * 1024 * 1024

    static func inbox() throws -> URL {
        guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
            throw NSError(domain: "Infinitools", code: 1, userInfo: [NSLocalizedDescriptionKey: "Ative o App Group group.br.com.infinitools.ios nos dois targets para receber compartilhamentos."])
        }
        let directory = root.appendingPathComponent("Incoming", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    /// One folder per document; the display name never selects a parent directory.
    static func copy(_ source: URL, to directory: URL, displayName: String? = nil) throws -> URL {
        let access = source.startAccessingSecurityScopedResource()
        defer { if access { source.stopAccessingSecurityScopedResource() } }
        let values = try source.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true,
              Int64(values.fileSize ?? 0) <= maximumBytes else {
            throw NSError(domain: "Infinitools", code: 2, userInfo: [NSLocalizedDescriptionKey: "Escolha um arquivo regular de até 512 MiB."])
        }
        let rawName = displayName ?? source.lastPathComponent
        let name = String(rawName.unicodeScalars.map { CharacterSet(charactersIn: "/\\:").union(.controlCharacters).contains($0) ? "_" : String($0) }.joined().prefix(150))
        let id = UUID().uuidString
        let folder = directory.appendingPathComponent("." + id + ".part", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let destination = folder.appendingPathComponent(name.isEmpty || name == "." || name == ".." ? "arquivo" : name)
        do {
            var coordinationError: NSError?
            var copyError: Error?
            NSFileCoordinator().coordinate(readingItemAt: source, options: .withoutChanges, error: &coordinationError) { url in
                do { try FileManager.default.copyItem(at: url, to: destination) } catch { copyError = error }
            }
            if let error = coordinationError { throw error }
            if let error = copyError { throw error }
            // Check the copy too, in case a provider changed the source while coordinating.
            let copied = try destination.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard Int64(copied) <= maximumBytes else { throw NSError(domain: "Infinitools", code: 3, userInfo: [NSLocalizedDescriptionKey: "Arquivo maior que 512 MiB."]) }
            let published = directory.appendingPathComponent(id, isDirectory: true)
            try FileManager.default.moveItem(at: folder, to: published)
            return published.appendingPathComponent(destination.lastPathComponent)
        } catch { try? FileManager.default.removeItem(at: folder); throw error }
    }

    static func pending() throws -> [URL] {
        let root = try inbox()
        return try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles])
            .filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }
            .flatMap { (try? FileManager.default.contentsOfDirectory(at: $0, includingPropertiesForKeys: [.isRegularFileKey])) ?? [] }
            .filter { (try? $0.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true }
    }
}
