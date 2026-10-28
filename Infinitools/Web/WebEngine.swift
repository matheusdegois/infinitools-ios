import SwiftUI
import WebKit
import UIKit
import CoreFoundation

@MainActor
final class WebEngine: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    @Published var ready = false
    @Published var loading = false
    @Published var error: String?
    @Published var resultReady: (url: String, name: String)?
    @Published var savedMessage: String?
    private(set) var completedNavigations = 0
    private(set) var webView: WKWebView!
    let server: LocalServer
    let store: ResultStore
    private let io = DispatchQueue(label: "infinitools.results")
    private let backend: Backend
    private var activeTool: Tool?
    private var incoming: [URL] = []
    private var generation = 0
    var onResultsChanged: (() -> Void)?

    init(root: URL, catalog: Catalog, store: ResultStore, cacheDirectory: URL) throws {
        self.store = store
        backend = Backend()
        let cache = try EngineCache(directory: cacheDirectory, backend: backend)
        server = LocalServer(router: try AssetRouter(root: root, catalog: catalog), backend: backend, cache: cache)
        super.init()
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = .all
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        let handler = ExportHandler(engine: self)
        config.userContentController.addScriptMessageHandler(handler, contentWorld: .page, name: "infinitools")
        let transport = try String(contentsOf: root.appendingPathComponent("web/ios/transport.js"), encoding: .utf8)
        let bridge = try String(contentsOf: root.appendingPathComponent("web/android/bridge.js"), encoding: .utf8)
        config.userContentController.addUserScript(WKUserScript(source: transport + "\n" + bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self; webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.customUserAgent = nil
        #if DEBUG
        webView.isInspectable = true
        #endif
        server.start { [weak self] error in
            guard let self = self else { return }
            if let error = error {
                self.ready = false; self.webView.stopLoading()
                self.error = "Não foi possível iniciar o motor local: \(error.localizedDescription)"; return
            }
            guard let cookie = HTTPCookie(properties: [.domain: "127.0.0.1", .path: "/", .name: "infinitools_session", .value: self.server.token,
                                                       .sameSitePolicy: "Strict"]) else { self.error = "Não foi possível preparar a sessão local."; return }
            self.webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { [weak self] in
                Task { @MainActor in self?.ready = true }
            }
        }
    }

    func open(_ tool: Tool) {
        guard ready else { return }
        if activeTool?.id == tool.id, webView.url != nil { return }
        generation += 1
        io.async { self.store.abortAll() }
        activeTool = tool; resultReady = nil; error = nil; savedMessage = nil
        webView.stopLoading()
        webView.load(URLRequest(url: URL(string: LocalServer.origin.absoluteString + "/" + tool.route)!))
    }

    func reload() {
        io.async { self.store.abortAll() }
        resultReady = nil; error = nil
        webView.reload()
    }

    func close() {
        generation += 1; activeTool = nil
        webView.stopLoading(); webView.loadHTMLString("", baseURL: nil)
        resultReady = nil; loading = false; error = nil
        io.async { self.store.abortAll() }
    }

    func showLicenses() {
        generation += 1; activeTool = nil; resultReady = nil; error = nil
        webView.load(URLRequest(url: LocalServer.origin.appendingPathComponent("android/licenses.html")))
    }

    func exportReady() {
        guard let result = resultReady else { return }
        evaluate("window.infinitoolsExportUrl?.(\(quoted(result.url)),\(quoted(result.name)))")
    }
    func importIncoming() { evaluate("window.infinitoolsImportShared?.()") }
    func setIncoming(_ files: [URL]) { incoming = files }
    func clearCache(completion: @escaping () -> Void) { server.cache.clear(completion: completion) }
    func shutdown() { close(); server.stop(); backend.invalidate() }

    func listResults(_ completion: @escaping ([ResultFile], Error?) -> Void) {
        io.async {
            do { let results = try self.store.list(); DispatchQueue.main.async { completion(results, nil) } }
            catch { DispatchQueue.main.async { completion([], error) } }
        }
    }
    func delete(_ result: ResultFile, completion: @escaping (Error?) -> Void) {
        io.async {
            do { try self.store.delete(result); DispatchQueue.main.async { completion(nil) } }
            catch { DispatchQueue.main.async { completion(error) } }
        }
    }

    fileprivate func receive(_ message: WKScriptMessage, reply: @escaping (Any?, String?) -> Void) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == "http", origin.host == "127.0.0.1", origin.port == Int(LocalServer.port),
              message.webView === webView, isLocal(webView.url), let raw = message.body as? String, raw.utf8.count <= 280000,
              let data = raw.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let requestID = object["requestId"] as? String, requestID.count <= 40, let type = object["type"] as? String else {
            reply(nil, "Origem ou mensagem inválida."); return
        }
        let requestGeneration = generation
        if type == "resultReady" {
            let url = object["url"] as? String ?? "", name = object["name"] as? String ?? "arquivo"
            let valid = url.hasPrefix("blob:" + LocalServer.origin.absoluteString + "/") || url.hasPrefix("data:")
            resultReady = valid ? (url, SafePath.name(name)) : nil
            reply(["requestId": requestID], nil); return
        }
        if type == "shared" {
            server.setIncoming(incoming) { files in
                DispatchQueue.main.async { reply(["requestId": requestID, "files": files], nil) }
            }
            return
        }
        io.async {
            var response: [String: Any] = ["requestId": requestID]
            var saved: ResultFile?
            do {
                switch type {
                case "start":
                    guard let name = object["name"] as? String, let mime = object["mime"] as? String,
                          let size = object["size"] as? NSNumber, CFGetTypeID(size) != CFBooleanGetTypeID(),
                          size.doubleValue.isFinite, size.doubleValue.rounded() == size.doubleValue,
                          size.doubleValue >= 0, size.doubleValue <= Double(ResultStore.maximumBytes) else { throw AppFailure("Tamanho de exportação inválido.") }
                    response["transferId"] = try self.store.start(name: name, mime: mime, size: size.int64Value).uuidString
                case "chunk":
                    guard let value = object["transferId"] as? String, let id = UUID(uuidString: value), let encoded = object["data"] as? String else { throw AppFailure("Bloco inválido.") }
                    try self.store.chunk(id: id, base64: encoded)
                case "finish":
                    guard let value = object["transferId"] as? String, let id = UUID(uuidString: value) else { throw AppFailure("Exportação inválida.") }
                    saved = try self.store.finish(id: id); response["name"] = saved?.name
                case "abort":
                    guard let value = object["transferId"] as? String, let id = UUID(uuidString: value) else { throw AppFailure("Exportação inválida.") }
                    self.store.abort(id: id)
                case "abortAll": self.store.abortAll()
                default: throw AppFailure("Mensagem não reconhecida.")
                }
            } catch { response["error"] = error.localizedDescription }
            let finalResponse = response, finalSaved = saved
            DispatchQueue.main.async {
                if let saved = finalSaved { self.onResultsChanged?(); self.savedMessage = "\(saved.name) salvo na aba Arquivos." }
                guard requestGeneration == self.generation else { reply(nil, "A ferramenta foi encerrada."); return }
                reply(finalResponse, nil)
            }
        }
    }

    private func isLocal(_ url: URL?) -> Bool {
        url?.scheme == "http" && url?.host == "127.0.0.1" && url?.port == Int(LocalServer.port) && url?.user == nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if navigationAction.targetFrame?.isMainFrame == false {
            decisionHandler(["about", "blob", "data"].contains(url.scheme ?? "") || isLocal(url) ? .allow : .cancel); return
        }
        if isLocal(url) { decisionHandler(.allow); return }
        if url.absoluteString == "about:blank" { decisionHandler(.allow); return }
        if url.scheme == "https", url.host == Backend.origin.host, url.user == nil {
            decisionHandler(.cancel)
            webView.load(URLRequest(url: URL(string: LocalServer.origin.absoluteString + url.path + (url.query.map { "?" + $0 } ?? ""))!)); return
        }
        if navigationAction.navigationType == .linkActivated, ["https", "mailto", "tel"].contains(url.scheme ?? "") {
            UIApplication.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { loading = true; error = nil; resultReady = nil }
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if navigationResponse.isForMainFrame, let response = navigationResponse.response as? HTTPURLResponse, response.statusCode >= 400 {
            loading = false
            error = "Não foi possível carregar a ferramenta (HTTP \(response.statusCode)). Verifique a conexão e tente novamente."
        }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loading = false; completedNavigations += 1 }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { navigationFailed(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { navigationFailed(error) }
    private func navigationFailed(_ failure: Error) {
        if (failure as NSError).code == NSURLErrorCancelled { return }
        loading = false; error = "Não foi possível abrir a ferramenta. \(failure.localizedDescription)"
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        generation += 1; loading = false; resultReady = nil
        io.async { self.store.abortAll() }
        error = "O iOS encerrou o editor por falta de recursos. Reabra a ferramenta e use um arquivo menor."
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            if isLocal(url) { webView.load(navigationAction.request) }
            else if url.scheme == "https" { UIApplication.shared.open(url) }
        }
        return nil
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        presentDialog(message, confirm: false) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        presentDialog(message, confirm: true, completion: completionHandler)
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        guard let presenter = Self.presenter else { completionHandler(nil); return }
        let alert = UIAlertController(title: "Infinitools", message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancelar", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in completionHandler(alert?.textFields?.first?.text) })
        presenter.present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        // Scanning uses the system camera through input[type=file][capture].
        decisionHandler(.deny)
    }

    func printPage() {
        guard let presenter = Self.presenter else { return }
        let controller = UIPrintInteractionController.shared
        let info = UIPrintInfo(dictionary: nil); info.jobName = activeTool?.name ?? "Infinitools"
        controller.printInfo = info
        controller.printFormatter = webView.viewPrintFormatter()
        controller.present(from: CGRect(x: presenter.view.bounds.midX, y: 0, width: 1, height: 1), in: presenter.view, animated: true, completionHandler: nil)
    }

    private func evaluate(_ script: String) { webView.evaluateJavaScript(script) { _, error in if let error = error { self.error = error.localizedDescription } } }
    private func quoted(_ text: String) -> String { String(data: try! JSONSerialization.data(withJSONObject: [text]), encoding: .utf8)!.dropFirst().dropLast().description }
    private func presentDialog(_ message: String, confirm: Bool, completion: @escaping (Bool) -> Void) {
        guard let presenter = Self.presenter, presenter.presentedViewController == nil else { completion(false); return }
        let alert = UIAlertController(title: "Infinitools", message: message, preferredStyle: .alert)
        if confirm { alert.addAction(UIAlertAction(title: "Cancelar", style: .cancel) { _ in completion(false) }) }
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completion(true) })
        presenter.present(alert, animated: true)
    }
    static var presenter: UIViewController? {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive }
        var controller = scene?.windows.first(where: \.isKeyWindow)?.rootViewController
        while let presented = controller?.presentedViewController { controller = presented }
        return controller
    }
}

@MainActor
private final class ExportHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var engine: WebEngine?
    init(engine: WebEngine) { self.engine = engine }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let engine = engine else { replyHandler(nil, "Motor encerrado."); return }
        engine.receive(message, reply: replyHandler)
    }
}

struct ToolWebView: UIViewRepresentable {
    @ObservedObject var engine: WebEngine
    func makeUIView(context: Context) -> WKWebView { engine.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
