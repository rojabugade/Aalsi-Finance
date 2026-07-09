import Testing
import Foundation
@testable import Alsi

final class StubProtocol: URLProtocol {
    nonisolated(unsafe) static var status = 200
    nonisolated(unsafe) static var body = Data("{}".utf8)
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let resp = HTTPURLResponse(url: request.url!, statusCode: Self.status,
                                   httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@Suite(.serialized) struct APIClientTests {
    private func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        return URLSession(configuration: config)
    }

    @Test func buildsURLWithPathAndQuery() throws {
        let url = try APIClient.makeURL(
            base: URL(string: "http://localhost:8000")!,
            path: "/cashflow/summary/",
            query: ["months": "6"]
        )
        #expect(url.absoluteString == "http://localhost:8000/cashflow/summary?months=6")
    }

    @Test func unauthorizedMapsToError() async {
        StubProtocol.status = 401
        StubProtocol.body = Data("{}".utf8)
        let client = APIClient(baseURL: URL(string: "http://localhost:8000")!, session: makeSession())
        await #expect(throws: FinanceAPIError.unauthorized) {
            let _: NetWorth = try await client.get("analytics/net-worth", accessToken: "x")
        }
    }

    @Test func decodesSuccessBody() async throws {
        StubProtocol.status = 200
        StubProtocol.body = Data("""
        {"currency":"USD","assets":"10","liabilities":"4","net_worth":"6"}
        """.utf8)
        let client = APIClient(baseURL: URL(string: "http://localhost:8000")!, session: makeSession())
        let nw: NetWorth = try await client.get("analytics/net-worth", accessToken: "x")
        #expect(nw.netWorth.decimal == 6)
    }
}
