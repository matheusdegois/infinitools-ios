import Foundation
import Network
import UniformTypeIdentifiers

/// Loopback only; fixed origin preserves IndexedDB drafts between launches.
final class LocalServer {
    static let port: UInt16 = 18763
    static let origin = URL(string: "http://127.0.0.1:\(port)")!
    let token = UUID().uuidString + UUID().uuidString
    private let router: AssetRouter
    private let backend: Backend
    let cache: EngineCache
    private let queue = DispatchQueue(label: "infinitools.loopback")
    private var listener: NWListener?
    private var connections: [UUID: NWConnection] = [:]
    private var incoming: [URL] = []
    private var incomingToken = UUID().uuidString

    init(router: AssetRouter, backend: Backend, cache: EngineCache) {
        self.router = router; self.backend = backend; self.cache = cache
    }

    func start(completion: @escaping (Error?) -> Void) {
        queue.async {
            do {
                let parameters = NWParameters.tcp
                parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: Self.port)!)
                let listener = try NWListener(using: parameters)
                self.listener = listener
                var reported = false
                listener.stateUpdateHandler = { state in
                    switch state {
                    case .ready:
                        if !reported { reported = true; DispatchQueue.main.async { completion(nil) } }
                    case .failed(let error):
                        reported = true; DispatchQueue.main.async { completion(error) }
                    default: break
                    }
                }
                listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
                listener.start(queue: self.queue)
            } catch { DispatchQueue.main.async { completion(error) } }
        }
    }

    func setIncoming(_ files: [URL], completion: @escaping ([[String: String]]) -> Void) {
        queue.async {
            self.incoming = files; self.incomingToken = UUID().uuidString
            let descriptors = files.enumerated().map { index, url in
                ["name": url.lastPathComponent, "mime": self.incomingMIME(url),
                 "url": Self.origin.absoluteString + "/ios-incoming/\(self.incomingToken)/\(index)"]
            }
            completion(descriptors)
        }
    }

    func stop() {
        queue.async {
            self.listener?.cancel(); self.listener = nil
            let active = Array(self.connections.values)
            self.connections.removeAll()
            active.forEach { $0.cancel() }
        }
    }

    private func accept(_ connection: NWConnection) {
        guard connections.count < 48 else { connection.cancel(); return }
        let id = UUID()
        connections[id] = connection
        connection.stateUpdateHandler = { [weak self] state in
            if case .cancelled = state { self?.connections.removeValue(forKey: id) }
            if case .failed = state { connection.cancel() }
        }
        connection.start(queue: queue)
        do { receive(connection, decoder: try HTTPRequestDecoder(validateHeaders: { [weak self] headers in
            guard let self = self, self.authorized(headers) else { throw HTTPFailure(status: 403, message: "Acesso local não autorizado.") }
        })) }
        catch { send(.text(error.localizedDescription, status: 500), request: nil, to: connection) }
        // Bound slow/incomplete requests and stalled clients.
        queue.asyncAfter(deadline: .now() + 660) { [weak connection] in connection?.cancel() }
    }

    private func receive(_ connection: NWConnection, decoder: HTTPRequestDecoder) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, done, error in
            guard let self = self else { connection.cancel(); return }
            do {
                if let data = data, let request = try decoder.feed(data) {
                    self.route(request) { reply in self.queue.async { self.send(reply, request: request, to: connection) } }
                } else if done || error != nil { connection.cancel() }
                else { self.receive(connection, decoder: decoder) }
            } catch { self.send(.text(error.localizedDescription, status: (error as? HTTPFailure)?.status ?? 400), request: nil, to: connection) }
        }
    }

    private func route(_ request: LocalRequest, completion: @escaping (WebReply) -> Void) {
        guard authorized(request.headers) else {
            completion(.text("Acesso local não autorizado.", status: 403)); return
        }
        do {
            let resolved = try router.resolve(target: request.target)
            if ["GET", "HEAD"].contains(request.method), let file = resolved.local {
                completion(WebReply(headers: ["Content-Type": AssetRouter.mime(file)], file: file)); return
            }
            if ["GET", "HEAD"].contains(request.method), let spec = router.remote[resolved.path] {
                cache.obtain(path: resolved.path, spec: spec, completion: completion); return
            }
            let prefix = "/ios-incoming/\(incomingToken)/"
            if request.method == "GET", resolved.path.hasPrefix(prefix),
               let index = Int(resolved.path.dropFirst(prefix.count)), incoming.indices.contains(index) {
                let file = incoming[index]
                completion(WebReply(headers: ["Content-Type": incomingMIME(file)], file: file)); return
            }
            guard router.mayProxy(resolved.path) else { completion(.text("Recurso não encontrado.", status: 404)); return }
            backend.fetch(target: request.target, method: request.method, headers: request.headers,
                          body: request.bodyBytes > 0 ? request.bodyURL : nil) { result in
                var unforwarded: URL?
                do {
                    var reply = try result.get()
                    unforwarded = reply.temporary ? reply.file : nil
                    if let location = reply.headers["Location"] {
                        if let url = URL(string: location, relativeTo: Backend.origin)?.absoluteURL, url.host == Backend.origin.host, url.scheme == "https" {
                            reply.headers["Location"] = Self.origin.absoluteString + url.path + (url.query.map { "?" + $0 } ?? "")
                        } else { reply.headers.removeValue(forKey: "Location"); reply.status = 502 }
                    }
                    if (reply.headers["Content-Type"] ?? "").contains("text/html"), let file = reply.file {
                        let size = (try file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                        guard size < 8 * 1024 * 1024 else { throw AppFailure("Página do servidor grande demais.") }
                        var html = try String(contentsOf: file, encoding: .utf8)
                        html = html.replacingOccurrences(of: Backend.origin.absoluteString + "/", with: "/")
                        html = html.replacingOccurrences(of: "<script\\b[^>]*src=[\"'][^\"']*privacy-consent[^\"']*[\"'][^>]*>\\s*</script>", with: "", options: [.regularExpression, .caseInsensitive])
                        let additions = "<base href=\"/\"><script src=\"/ios/transport.js\"></script><script src=\"/android/bridge.js\"></script><link rel=\"stylesheet\" href=\"/android/mobile.css\">"
                        if let head = html.range(of: "<head>", options: .caseInsensitive) { html.insert(contentsOf: additions, at: head.upperBound) }
                        else { throw AppFailure("Página do servidor sem cabeçalho.") }
                        try html.write(to: file, atomically: true, encoding: .utf8)
                    }
                    unforwarded = nil; completion(reply)
                } catch {
                    if let file = unforwarded { try? FileManager.default.removeItem(at: file) }
                    completion(.text("Serviço indisponível: \(error.localizedDescription)", status: 502))
                }
            }
        } catch { completion(.text(error.localizedDescription, status: 400)) }
    }

    private func send(_ original: WebReply, request: LocalRequest?, to connection: NWConnection) {
        var reply = original
        var fileHandle: FileHandle?
        var length: Int64 = Int64(reply.data?.count ?? 0)
        var offset: Int64 = 0
        do {
            if let file = reply.file {
                let size = Int64(try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0)
                let range = try HTTPRange.resolve(reply.status == 200 ? request?.headers["range"] : nil, size: size)
                offset = range.offset; length = range.length
                if range.partial {
                    reply.status = 206
                    reply.headers["Content-Range"] = "bytes \(offset)-\(offset + length - 1)/\(size)"
                }
                reply.headers["Accept-Ranges"] = "bytes"
                fileHandle = try FileHandle(forReadingFrom: file)
                try fileHandle?.seek(toOffset: UInt64(offset))
            }
        } catch {
            try? fileHandle?.close(); fileHandle = nil
            reply = .text("Arquivo ou intervalo indisponível.", status: 416)
            length = Int64(reply.data?.count ?? 0)
        }
        reply.headers["Content-Length"] = String(length)
        reply.headers["Connection"] = "close"
        reply.headers["Cache-Control"] = "no-store"
        reply.headers["X-Content-Type-Options"] = "nosniff"
        reply.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        reply.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
        reply.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        reply.headers["Referrer-Policy"] = "no-referrer"
        // Prevent external frames from embedding a page with access to the native export bridge.
        reply.headers["Content-Security-Policy"] = "frame-ancestors 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:; connect-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'"
        let lines = reply.headers.filter { !$0.value.contains("\r") && !$0.value.contains("\n") }.map { "\($0.key): \($0.value)" }.joined(separator: "\r\n")
        let header = Data("HTTP/1.1 \(reply.status) Response\r\n\(lines)\r\n\r\n".utf8)
        let finalHandle = fileHandle, finalReply = reply
        let cleanup = {
            try? finalHandle?.close()
            if original.temporary, let file = original.file { try? FileManager.default.removeItem(at: file) }
            request?.cleanup(); connection.cancel()
        }
        connection.send(content: header, completion: .contentProcessed { error in
            if error != nil || request?.method == "HEAD" { cleanup(); return }
            if let handle = finalHandle { self.sendFile(handle, remaining: length, to: connection, cleanup: cleanup) }
            else { connection.send(content: finalReply.data ?? Data(), completion: .contentProcessed { _ in cleanup() }) }
        })
    }

    private func sendFile(_ file: FileHandle, remaining: Int64, to connection: NWConnection, cleanup: @escaping () -> Void) {
        guard remaining > 0 else { cleanup(); return }
        do {
            guard let data = try file.read(upToCount: Int(min(65536, remaining))), !data.isEmpty else { cleanup(); return }
            connection.send(content: data, completion: .contentProcessed { error in
                if error != nil { cleanup() }
                else { self.sendFile(file, remaining: remaining - Int64(data.count), to: connection, cleanup: cleanup) }
            })
        } catch { cleanup() }
    }

    private func authorized(_ headers: [String: String]) -> Bool {
        let cookies = (headers["cookie"] ?? "").components(separatedBy: ";").map { $0.trimmingCharacters(in: .whitespaces) }
        return headers["host"] == "127.0.0.1:\(Self.port)" && cookies.contains("infinitools_session=" + token) &&
            (headers["origin"].map { $0 == Self.origin.absoluteString } ?? true) &&
            (headers["sec-fetch-site"].map { $0 != "cross-site" } ?? true)
    }

    private func incomingMIME(_ url: URL) -> String {
        UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
    }
}
