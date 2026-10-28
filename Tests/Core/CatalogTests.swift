import XCTest
@testable import InfinitoolsCore

final class CatalogTests: XCTestCase {
    private var root: URL { URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent() }
    func testEveryAndroidToolIsPresent() throws {
        let catalog = try Catalog(url: root.appendingPathComponent("Infinitools/Resources/WebContent/catalog.json"))
        XCTAssertEqual(catalog.tools.count, 158)
        XCTAssertEqual(catalog.byID.count, 158)
        XCTAssertEqual(catalog.tools.filter { $0.mode == "local" }.count, 145)
        XCTAssertEqual(catalog.tools.filter { $0.mode == "hybrid" }.count, 11)
        XCTAssertEqual(catalog.tools.filter { $0.mode == "online" }.count, 2)
        XCTAssertEqual(catalog.byID["utility:publicador-web"]?.name, "Testar protótipo web")
    }
    func testSearchIgnoresAccentsAndCaseAndRequiresAllTerms() throws {
        let catalog = try Catalog(url: root.appendingPathComponent("Infinitools/Resources/WebContent/catalog.json"))
        XCTAssertEqual(catalog.search(" ÁUDIO ").map(\.id), catalog.search("audio").map(\.id))
        XCTAssertTrue(catalog.search("  JUNTAR   PDF  ").contains { $0.id == "pdf:merge" })
        XCTAssertTrue(catalog.search("juntar", family: "image").allSatisfy { $0.family == "image" })
        XCTAssertTrue(catalog.search("xyzinexistente").isEmpty)
        XCTAssertEqual(catalog.search("").count, 158)
    }
    func testEveryLocalRouteResolvesAndMissingFilesDoNotProxy() throws {
        let bundle = root.appendingPathComponent("Infinitools/Resources/WebContent")
        let catalog = try Catalog(url: bundle.appendingPathComponent("catalog.json"))
        let router = try AssetRouter(root: bundle, catalog: catalog)
        for tool in catalog.tools {
            let resolved = try router.resolve(target: "/" + tool.route)
            if tool.slug == "youtube-download" { XCTAssertNil(resolved.local); XCTAssertTrue(router.mayProxy(resolved.path)) }
            else { XCTAssertTrue(FileManager.default.fileExists(atPath: try XCTUnwrap(resolved.local).path), tool.id) }
        }
        XCTAssertFalse(router.mayProxy("/private/config.php"))
        XCTAssertFalse(router.mayProxy("/api/prototypes.php"))
        XCTAssertTrue(router.mayProxy("/api/downloader.php"))
        let raw = try XCTUnwrap(router.resolve(target: "/assets/vendor/tessdata/por.traineddata.gz").local)
        XCTAssertEqual(raw.pathExtension, "raw")
    }
    func testUnsafePathsAreRejected() throws {
        for value in ["/../secret", "/%2e%2e/secret", "/assets/%252e%252e/secret", "/a\\b", "/a%00b", "https://host/", "/a/./b"] {
            XCTAssertThrowsError(try SafePath.decode(value), value)
        }
        XCTAssertEqual(try SafePath.decode("/assets/a%20b.txt"), "/assets/a b.txt")
        XCTAssertThrowsError(try SafePath.contained("../outside", in: root))
    }
    func testNamesRemainSinglePathComponentsAndBounded() {
        XCTAssertEqual(SafePath.name("../../pasta:segredo.pdf"), "_.._pasta_segredo.pdf")
        XCTAssertEqual(SafePath.name("..."), "arquivo")
        XCTAssertEqual(SafePath.name("  normal.pdf  "), "normal.pdf")
        XCTAssertEqual(SafePath.name("a\u{0}b\nc"), "a_b_c")
        XCTAssertLessThanOrEqual(SafePath.name(String(repeating: "🎨", count: 100)).utf8.count, 180)
    }
}
