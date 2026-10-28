import XCTest
@testable import InfinitoolsCore

final class HTTPTests: XCTestCase {
    func testBytewisePostPreservesBinaryBody() throws {
        let parser = try HTTPRequestDecoder()
        let body = Data([0, 1, 255, 13, 10])
        let wire = Data("POST /api/html-pdf.php?a=1 HTTP/1.1\r\nHost: 127.0.0.1:18763\r\nContent-Length: 5\r\nContent-Type: application/octet-stream\r\n\r\n".utf8) + body
        var request: LocalRequest?
        for byte in wire { request = try parser.feed(Data([byte])) ?? request }
        let value = try XCTUnwrap(request); defer { value.cleanup() }
        XCTAssertEqual(value.method, "POST"); XCTAssertEqual(value.bodyBytes, 5)
        XCTAssertEqual(try Data(contentsOf: value.bodyURL), body)
        XCTAssertThrowsError(try parser.feed(Data()))
    }
    func testChunkedUploadWithSplitDelimiters() throws {
        let parser = try HTTPRequestDecoder()
        let wire = "POST /api/pdfa.php HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n2;anything=yes\r\nde\r\n0\r\n\r\n"
        var request: LocalRequest?
        for byte in wire.utf8 { request = try parser.feed(Data([byte])) ?? request }
        let value = try XCTUnwrap(request); defer { value.cleanup() }
        XCTAssertEqual(try Data(contentsOf: value.bodyURL), Data("abcde".utf8))
    }
    func testGetAndHead() throws {
        for method in ["GET", "HEAD"] {
            let parser = try HTTPRequestDecoder()
            let request = try XCTUnwrap(parser.feed(Data("\(method) /tool?tool=merge HTTP/1.1\r\nHost: localhost\r\n\r\n".utf8)))
            request.cleanup(); XCTAssertEqual(request.bodyBytes, 0)
        }
    }
    func testAmbiguousAndMalformedRequestsAreRejected() throws {
        let requests = [
            "GET https://evil/ HTTP/1.1\r\nHost: x\r\n\r\n",
            "GET //evil/ HTTP/1.1\r\nHost: x\r\n\r\n",
            "GET / HTTP/1.1\r\n\r\n",
            "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: -1\r\n\r\n",
            "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 536870913\r\n\r\n",
            "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 1\r\ncontent-length: 1\r\n\r\na",
            "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\nTransfer-Encoding: chunked\r\n\r\n",
            "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 1\r\n\r\nab",
            "POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: gzip\r\n\r\n",
            "POST / HTTP/1.1\r\nHost: x\r\nExpect: 100-continue\r\n\r\n",
            "POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\nxyz\r\n",
            "POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n\r\n",
            "POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n1\r\naXX",
            "GET / HTTP/1.0\r\nHost: x\r\n\r\n"
        ]
        for wire in requests { XCTAssertThrowsError(try HTTPRequestDecoder().feed(Data(wire.utf8)), wire) }
    }
    func testOversizedHeadersAreRejected() throws {
        XCTAssertThrowsError(try HTTPRequestDecoder().feed(Data(String(repeating: "A", count: 65537).utf8)))
    }
    func testAuthenticationRunsBeforeAnyBodyIsWritten() throws {
        var called = false
        let parser = try HTTPRequestDecoder(validateHeaders: { headers in
            called = true
            XCTAssertEqual(headers["host"], "127.0.0.1:18763")
            throw HTTPFailure(status: 403, message: "Forbidden")
        })
        XCTAssertThrowsError(try parser.feed(Data("POST /api/pdfa.php HTTP/1.1\r\nHost: 127.0.0.1:18763\r\nContent-Length: 536870912\r\n\r\n".utf8)))
        XCTAssertTrue(called)
    }
    func testRanges() throws {
        var range = try HTTPRange.resolve(nil, size: 100)
        XCTAssertEqual(range.length, 100); XCTAssertFalse(range.partial)
        range = try HTTPRange.resolve("bytes=20-39", size: 100)
        XCTAssertEqual(range.offset, 20); XCTAssertEqual(range.length, 20); XCTAssertTrue(range.partial)
        range = try HTTPRange.resolve("bytes=-10", size: 100)
        XCTAssertEqual(range.offset, 90); XCTAssertEqual(range.length, 10)
        XCTAssertEqual(try HTTPRange.resolve("bytes=90-999", size: 100).length, 10)
        XCTAssertEqual(try HTTPRange.resolve("bytes=90-", size: 100).length, 10)
        for value in ["bytes=100-", "bytes=-0", "bytes=9-2", "bytes=0-1,4-5", "items=0-1", "bytes=a-b"] {
            XCTAssertThrowsError(try HTTPRange.resolve(value, size: 100))
        }
        XCTAssertThrowsError(try HTTPRange.resolve("bytes=0-", size: 0))
    }
}
