import XCTest
import WebKit
import UIKit
@testable import Infinitools

@MainActor
final class WebEngineTests: XCTestCase {
    func testLocalCatalogAndNativeExportInWKWebView() async throws {
        let root = try XCTUnwrap(Bundle.main.url(forResource: "WebContent", withExtension: nil))
        let catalog = try Catalog(url: root.appendingPathComponent("catalog.json"))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = try ResultStore(directory: directory.appendingPathComponent("results"))
        let engine = try WebEngine(root: root, catalog: catalog, store: store, cacheDirectory: directory.appendingPathComponent("cache"))
        defer { engine.shutdown(); try? FileManager.default.removeItem(at: directory) }
        try await wait { engine.ready || engine.error != nil }
        XCTAssertNil(engine.error)
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 393, height: 852))
        let controller = UIViewController(); window.rootViewController = controller
        controller.view.addSubview(engine.webView); engine.webView.frame = controller.view.bounds
        window.makeKeyAndVisible()
        defer { window.isHidden = true }
        for tool in catalog.tools where tool.mode == "local" {
            let previous = engine.completedNavigations
            engine.open(tool)
            try await wait { engine.completedNavigations > previous || engine.error != nil }
            XCTAssertNil(engine.error, tool.id)
            let installed = try await engine.webView.evaluateJavaScript("Boolean(window.infinitoolsExportUrl && document.body.innerText.length > 30)") as? Bool
            XCTAssertEqual(installed, true, tool.id)
        }
        let previous = engine.completedNavigations
        engine.open(try XCTUnwrap(catalog.byID["pdf:merge"]))
        try await wait { engine.completedNavigations > previous }
        let result = try await engine.webView.callAsyncJavaScript("""
            const data = new Uint8Array(900001);
            for (let i=0; i<data.length; i++) data[i] = i % 251;
            await window.infinitoolsExportUrl(URL.createObjectURL(new Blob([data])), 'integridade.bin');
            return true;
            """, arguments: [:], in: nil, contentWorld: .page)
        XCTAssertEqual(result as? Bool, true)
        let files = try store.list()
        let file = try XCTUnwrap(files.first)
        let bytes = try Data(contentsOf: store.fileURL(file))
        XCTAssertEqual(bytes, Data((0..<900001).map { UInt8($0 % 251) }))
        // Sandboxed previews have no native export capability.
        let bridgeInFrame = try await engine.webView.callAsyncJavaScript("""
            const f=document.createElement('iframe'); f.sandbox='allow-scripts';
            const result = new Promise(resolve => addEventListener('message', e => resolve(e.data), {once:true}));
            f.srcdoc='<script>parent.postMessage(Boolean(window.InfinitoolsNative), "*")<\\/script>';
            document.body.append(f); return await result;
            """, arguments: [:], in: nil, contentWorld: .page)
        XCTAssertEqual(bridgeInFrame as? Bool, false)
    }
    private func wait(_ condition: @escaping () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(45)
        while !condition() {
            guard Date() < deadline else { throw AppFailure("Tempo limite aguardando WKWebView.") }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
    }
}
