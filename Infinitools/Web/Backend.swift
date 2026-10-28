import Foundation
import CryptoKit

struct WebReply {
    var status = 200
    var headers: [String: String] = [:]
    var data: Data?
    var file: URL?
    var temporary = false

    static func text(_ text: String, status: Int) -> WebReply {
        WebReply(status: status, headers: ["Content-Type": "text/plain; charset=utf-8"], data: Data(text.utf8))
    }
}

/// HTTPS, system certificate validation, isolated ephemeral cookies and disk-backed responses.
final class Backend: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    static let origin = URL(string: "https://www.infinitools.com.br")!
    private struct Job {
        let url: URL
        let handle: FileHandle
        let completion: (Result<WebReply, Error>) -> Void
        var response: HTTPURLResponse?
        var size: Int64 = 0
    }
    private var jobs: [Int: Job] = [:]
    private let lock = NSLock()
    private var session: URLSession!

    override init() {
        super.init()
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 120
        config.timeoutIntervalForResource = 600
        config.httpShouldSetCookies = true
        config.urlCache = nil
        config.httpAdditionalHeaders = ["User-Agent": "Mozilla/5.0 InfinitoolsIOS/1.0"]
        let queue = OperationQueue(); queue.maxConcurrentOperationCount = 1
        session = URLSession(configuration: config, delegate: self, delegateQueue: queue)
    }

    func invalidate() { session.invalidateAndCancel() }

    func fetch(target: String, method: String = "GET", headers: [String: String] = [:], body: URL? = nil,
               completion: @escaping (Result<WebReply, Error>) -> Void) {
        guard let url = URL(string: Self.origin.absoluteString + target), url.scheme == "https", url.host == Self.origin.host,
              url.user == nil, url.password == nil else { completion(.failure(AppFailure("Servidor inválido."))); return }
        var request = URLRequest(url: url)
        request.httpMethod = method
        for key in ["content-type", "accept", "accept-language", "x-requested-with", "x-csrf-token", "range"] {
            if let value = headers[key] { request.setValue(value, forHTTPHeaderField: key) }
        }
        request.setValue(Self.origin.absoluteString, forHTTPHeaderField: "Origin")
        request.setValue(Self.origin.absoluteString + "/", forHTTPHeaderField: "Referer")
        let output = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".response")
        do {
            guard FileManager.default.createFile(atPath: output.path, contents: nil) else { throw AppFailure("Sem espaço para resposta.") }
            let handle = try FileHandle(forWritingTo: output)
            let task: URLSessionTask
            if let body = body, !["GET", "HEAD"].contains(method) { task = session.uploadTask(with: request, fromFile: body) }
            else { task = session.dataTask(with: request) }
            lock.lock(); jobs[task.taskIdentifier] = Job(url: output, handle: handle, completion: completion); lock.unlock()
            task.resume()
        } catch { try? FileManager.default.removeItem(at: output); completion(.failure(error)) }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let response = response as? HTTPURLResponse,
              response.expectedContentLength <= ResultStore.maximumBytes else { completionHandler(.cancel); return }
        lock.lock(); jobs[dataTask.taskIdentifier]?.response = response; lock.unlock()
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock(); defer { lock.unlock() }
        guard var job = jobs[dataTask.taskIdentifier] else { return }
        do {
            job.size += Int64(data.count)
            guard job.size <= ResultStore.maximumBytes else { throw AppFailure("Resposta maior que 512 MiB.") }
            try job.handle.write(contentsOf: data)
            jobs[dataTask.taskIdentifier] = job
        } catch { dataTask.cancel() }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock(); let job = jobs.removeValue(forKey: task.taskIdentifier); lock.unlock()
        guard let job = job else { return }
        do {
            try job.handle.close()
            if let error = error { throw error }
            guard let response = job.response else { throw AppFailure("Resposta HTTPS ausente.") }
            var headers: [String: String] = [:]
            for name in ["Content-Type", "Content-Disposition", "Location", "Content-Range", "Accept-Ranges", "X-PDFA-Validated"] {
                if let value = response.value(forHTTPHeaderField: name) { headers[name] = value }
            }
            job.completion(.success(WebReply(status: response.statusCode, headers: headers, file: job.url, temporary: true)))
        } catch { try? FileManager.default.removeItem(at: job.url); job.completion(.failure(error)) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        // Redirects go through the local router again, preserving the endpoint allowlist.
        completionHandler(nil)
    }

    func clearCookies() { session.configuration.httpCookieStorage?.removeCookies(since: .distantPast) }
}

final class EngineCache {
    private let directory: URL
    private let backend: Backend
    private let queue = DispatchQueue(label: "infinitools.engine-cache")
    private var waiting: [String: [(WebReply) -> Void]] = [:]

    init(directory: URL, backend: Backend) throws {
        self.directory = directory; self.backend = backend
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        for url in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) where url.pathExtension == "part" {
            try? FileManager.default.removeItem(at: url)
        }
    }

    func obtain(path: String, spec: RemoteAsset, completion: @escaping (WebReply) -> Void) {
        queue.async {
            if self.waiting[path] != nil { self.waiting[path]?.append(completion); return }
            self.waiting[path] = [completion]
            let output = self.directory.appendingPathComponent(spec.sha256)
            // Validate cached bytes as well; size alone does not authenticate a WASM engine.
            if self.valid(output, spec: spec) { self.deliver(path, reply: WebReply(headers: ["Content-Type": AssetRouter.mime(URL(fileURLWithPath: path))], file: output)); return }
            self.backend.fetch(target: path) { result in
                self.queue.async {
                    do {
                        let reply = try result.get()
                        guard let file = reply.file else { throw AppFailure("Motor sem conteúdo.") }
                        defer { try? FileManager.default.removeItem(at: file) }
                        guard reply.status == 200, self.valid(file, spec: spec) else { throw AppFailure("Motor com versão ou integridade diferente. Atualize o aplicativo.") }
                        if FileManager.default.fileExists(atPath: output.path) { try FileManager.default.removeItem(at: output) }
                        try FileManager.default.moveItem(at: file, to: output)
                        self.deliver(path, reply: WebReply(headers: ["Content-Type": AssetRouter.mime(URL(fileURLWithPath: path))], file: output))
                    } catch { self.deliver(path, reply: .text("Motor indisponível: \(error.localizedDescription)", status: 503)) }
                }
            }
        }
    }

    private func valid(_ url: URL, spec: RemoteAsset) -> Bool {
        guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, Int64(size) == spec.bytes,
              let handle = try? FileHandle(forReadingFrom: url) else { return false }
        defer { try? handle.close() }
        var hasher = SHA256()
        do {
            while let chunk = try handle.read(upToCount: 1024 * 1024), !chunk.isEmpty { hasher.update(data: chunk) }
            return hasher.finalize().map { String(format: "%02x", $0) }.joined() == spec.sha256
        } catch { return false }
    }

    private func deliver(_ path: String, reply: WebReply) {
        let callbacks = waiting.removeValue(forKey: path) ?? []
        callbacks.forEach { $0(reply) }
    }

    func clear(completion: @escaping () -> Void) {
        queue.async {
            if let urls = try? FileManager.default.contentsOfDirectory(at: self.directory, includingPropertiesForKeys: nil) {
                urls.forEach { try? FileManager.default.removeItem(at: $0) }
            }
            DispatchQueue.main.async(execute: completion)
        }
    }
}
