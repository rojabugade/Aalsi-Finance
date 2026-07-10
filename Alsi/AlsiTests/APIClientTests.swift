import Testing
import Foundation
@testable import Alsi

final class StubProtocol: URLProtocol {
    nonisolated(unsafe) static var status = 200
    nonisolated(unsafe) static var body = Data("{}".utf8)
    nonisolated(unsafe) static var lastRequest: URLRequest?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lastRequest = request
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

    @Test func loginSendsTheMfaCodeExpectedByTheBackend() async throws {
        StubProtocol.status = 200
        StubProtocol.body = Data("{\"access_token\":\"access\"}".utf8)
        let service = FinanceService(client: APIClient(
            baseURL: URL(string: "http://localhost:8000")!, session: makeSession()
        ))

        let token = try await service.login(
            email: "dev@example.com", password: "hunter2pass", totpCode: "123456"
        )

        #expect(token == "access")
        let body = try #require(StubProtocol.lastRequest?.httpBody)
        let json = try #require(JSONSerialization.jsonObject(with: body) as? [String: String])
        #expect(json["totp_code"] == "123456")
    }

    @Test func sessionRefreshForwardsTheCsrfCookie() async throws {
        StubProtocol.status = 200
        StubProtocol.body = Data("{\"access_token\":\"fresh\"}".utf8)
        let storage = HTTPCookieStorage()
        storage.setCookie(HTTPCookie(properties: [
            .domain: "localhost",
            .path: "/",
            .name: "cbf_csrf",
            .value: "csrf-value"
        ])!)
        let client = APIClient(
            baseURL: URL(string: "http://localhost:8000")!,
            session: makeSession(),
            cookieStorage: storage
        )

        let response: RefreshResponse = try await client.cookieAuthenticatedPost("auth/refresh")

        #expect(response.accessToken == "fresh")
        #expect(StubProtocol.lastRequest?.value(forHTTPHeaderField: "X-CSRF-Token") == "csrf-value")
    }
}

private struct RefreshResponse: Decodable {
    let accessToken: String

    enum CodingKeys: String, CodingKey { case accessToken = "access_token" }
}
