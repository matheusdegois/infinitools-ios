import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    @Published var catalog: Catalog?
    @Published var engine: WebEngine?
    @Published var startupError: String?
    @Published var message: String?
    @Published var results: [ResultFile] = []
    @Published var incoming: [URL] = []
    @Published var selectedTool: Tool?
    @Published var selectedTab = 0
    @Published var favoriteIDs: Set<String> { didSet { defaults.set(Array(favoriteIDs), forKey: "favorites") } }
    @Published var recentIDs: [String] { didSet { defaults.set(recentIDs, forKey: "recents") } }
    @Published var theme: String { didSet { defaults.set(theme, forKey: "theme") } }
    private let defaults: UserDefaults
    private let incomingQueue = DispatchQueue(label: "infinitools.incoming")
    private var importing = false

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        favoriteIDs = Set(defaults.stringArray(forKey: "favorites") ?? [])
        recentIDs = Array((defaults.stringArray(forKey: "recents") ?? []).prefix(16))
        theme = defaults.string(forKey: "theme") ?? "system"
        #if DEBUG
        // Unit tests create their own WKWebView/server; avoid competing for the persistent origin.
        if ProcessInfo.processInfo.environment["INFINITOOLS_UNIT_TEST_HOST"] == "1" { return }
        #endif
        do {
            guard let root = Bundle.main.url(forResource: "WebContent", withExtension: nil) else { throw AppFailure("Recursos locais ausentes. Execute a importação antes de compilar.") }
            let catalog = try Catalog(url: root.appendingPathComponent("catalog.json"))
            let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            let caches = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            let store = try ResultStore(directory: support.appendingPathComponent("Results", isDirectory: true))
            let engine = try WebEngine(root: root, catalog: catalog, store: store, cacheDirectory: caches.appendingPathComponent("Engines", isDirectory: true))
            self.catalog = catalog; self.engine = engine
            engine.onResultsChanged = { [weak self] in self?.refreshResults() }
            refreshResults()
            receivePending()
        } catch { startupError = error.localizedDescription }
    }

    var colorScheme: ColorScheme? { theme == "dark" ? .dark : theme == "light" ? .light : nil }
    func toggleFavorite(_ tool: Tool) {
        if favoriteIDs.contains(tool.id) { favoriteIDs.remove(tool.id) } else { favoriteIDs.insert(tool.id) }
    }
    func open(_ tool: Tool) {
        guard engine?.ready == true else { message = engine?.error ?? "O motor local ainda está iniciando."; return }
        recentIDs = Array(([tool.id] + recentIDs.filter { $0 != tool.id }).prefix(16))
        engine?.open(tool); selectedTool = tool
    }
    func refreshResults() {
        engine?.listResults { [weak self] results, error in
            if let error = error { self?.message = error.localizedDescription } else { self?.results = results }
        }
    }
    func delete(_ result: ResultFile) {
        engine?.delete(result) { [weak self] error in
            if let error = error { self?.message = error.localizedDescription }
            self?.refreshResults()
        }
    }
    func receivePending() {
        guard !importing else { return }
        importing = true
        incomingQueue.async {
            let files = (try? IncomingFiles.pending()) ?? []
            DispatchQueue.main.async {
                self.incoming = files; self.engine?.setIncoming(files); self.importing = false
            }
        }
    }
    func receive(_ url: URL) {
        incomingQueue.async {
            do { _ = try IncomingFiles.copy(url, to: IncomingFiles.inbox()); DispatchQueue.main.async { self.receivePending() } }
            catch { DispatchQueue.main.async { self.message = error.localizedDescription } }
        }
    }
    func dismissIncoming() {
        let files = incoming
        incoming = []; engine?.setIncoming([])
        incomingQueue.async {
            do {
                for file in files { try FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
            } catch { DispatchQueue.main.async { self.message = error.localizedDescription } }
        }
    }
}
