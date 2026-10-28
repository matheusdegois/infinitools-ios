import XCTest
@testable import InfinitoolsCore

final class ResultStoreTests: XCTestCase {
    private var folder: URL!
    private var store: ResultStore!
    override func setUpWithError() throws {
        folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        store = try ResultStore(directory: folder)
    }
    override func tearDownWithError() throws { store = nil; try FileManager.default.removeItem(at: folder) }
    func testChunkedBinaryIntegrityAndRestart() throws {
        let bytes = Data((0..<900001).map { UInt8($0 % 251) })
        let id = try store.start(name: "integridade.bin", mime: "application/octet-stream", size: Int64(bytes.count))
        for offset in stride(from: 0, to: bytes.count, by: 196608) {
            try store.chunk(id: id, base64: bytes.subdata(in: offset..<min(offset + 196608, bytes.count)).base64EncodedString())
        }
        let result = try store.finish(id: id)
        XCTAssertEqual(try Data(contentsOf: store.fileURL(result)), bytes)
        store = try ResultStore(directory: folder)
        XCTAssertEqual(try store.list(), [result])
        try store.delete(result)
        XCTAssertTrue(try store.list().isEmpty)
    }
    func testIncompleteResultIsNeverListed() throws {
        let id = try store.start(name: "incompleto", mime: "bad", size: 2)
        try store.chunk(id: id, base64: Data([1]).base64EncodedString())
        XCTAssertThrowsError(try store.finish(id: id))
        XCTAssertTrue(try store.list().isEmpty)
        store.abortAll()
        XCTAssertFalse(try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil).contains { $0.pathExtension == "part" })
    }
    func testInvalidChunksSizesAndConcurrentTransfers() throws {
        XCTAssertThrowsError(try store.start(name: "a", mime: "x/y", size: -1))
        XCTAssertThrowsError(try store.start(name: "a", mime: "x/y", size: ResultStore.maximumBytes + 1))
        let id = try store.start(name: "a", mime: "x/y", size: 1)
        XCTAssertThrowsError(try store.start(name: "b", mime: "x/y", size: 1))
        XCTAssertThrowsError(try store.chunk(id: UUID(), base64: "AA=="))
        XCTAssertThrowsError(try store.chunk(id: id, base64: "!!!!"))
        XCTAssertThrowsError(try store.chunk(id: id, base64: Data([1,2]).base64EncodedString()))
        XCTAssertThrowsError(try store.chunk(id: id, base64: String(repeating: "A", count: 262148)))
        store.abort(id: UUID())
        try store.chunk(id: id, base64: "AA==")
        XCTAssertEqual(try store.finish(id: id).bytes, 1)
    }
    func testZeroByteFileAndMimeFallback() throws {
        let id = try store.start(name: "../vazio.txt", mime: "text/plain\r\nInjected: evil", size: 0)
        let result = try store.finish(id: id)
        XCTAssertEqual(result.mime, "application/octet-stream")
        XCTAssertEqual(result.name, "_vazio.txt")
        XCTAssertEqual(try store.list().count, 1)
    }
    func testStalePartsAreCleanedWithoutDeletingFinishedFiles() throws {
        let id = try store.start(name: "ok.txt", mime: "text/plain; charset=utf-8", size: 0)
        let result = try store.finish(id: id)
        try Data([1]).write(to: folder.appendingPathComponent("stale.part"))
        store = try ResultStore(directory: folder)
        XCTAssertEqual(try store.list(), [result])
        XCTAssertFalse(FileManager.default.fileExists(atPath: folder.appendingPathComponent("stale.part").path))
    }
    func testTamperedMetadataAndSizeAreIgnored() throws {
        try Data("{}".utf8).write(to: folder.appendingPathComponent("invalid.json"))
        let id = try store.start(name: "ok.txt", mime: "text/plain", size: 0)
        let result = try store.finish(id: id)
        try Data([1]).write(to: store.fileURL(result))
        XCTAssertTrue(try store.list().isEmpty)
    }
    func testCrashBeforeMetadataDoesNotLeaveOrphanedPayload() throws {
        let orphan = folder.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: orphan, withIntermediateDirectories: true)
        try Data([1,2,3]).write(to: orphan.appendingPathComponent("incompleto.bin"))
        store = try ResultStore(directory: folder)
        XCTAssertFalse(FileManager.default.fileExists(atPath: orphan.path))
    }
}
