import Testing
import Foundation
@testable import Alsi

@Suite struct SnapshotTests {
    @Test func fetchSnapshotComposesAllEndpoints() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [SnapshotStubProtocol.self]
        let session = URLSession(configuration: config)
        let service = FinanceService(client: APIClient(
            baseURL: URL(string: "http://localhost:8000")!, session: session))
        let snap = try await service.fetchSnapshot(accessToken: "x")
        #expect(snap.netWorth?.netWorth.decimal == 6)
        #expect(snap.transactions.isEmpty)
        #expect(snap.currency == "USD")
    }
}

final class SnapshotStubProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url?.path ?? ""
        let body: String
        switch path {
        case let p where p.hasSuffix("net-worth"):
            body = "{\"currency\":\"USD\",\"assets\":\"10\",\"liabilities\":\"4\",\"net_worth\":\"6\"}"
        case let p where p.hasSuffix("cashflow/summary"):
            body = "{\"currency\":\"USD\",\"income_monthly\":\"0\",\"recurring_monthly\":\"0\",\"debt_emi_monthly\":\"0\",\"card_min_monthly\":\"0\",\"discretionary_monthly\":\"0\",\"leftover_monthly\":\"0\",\"breakdown\":[]}"
        case let p where p.hasSuffix("review-queue"):
            body = "{\"groups\":[],\"items\":[]}"
        default:
            body = "[]"
        }
        let resp = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
