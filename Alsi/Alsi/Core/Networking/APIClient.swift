import Foundation

private struct EmptyBody: Encodable {}
private struct ErrorResponse: Decodable { let detail: String? }

struct APIClient {
    let baseURL: URL
    let session: URLSession
    private let cookieStorage: HTTPCookieStorage?

    init(
        baseURL: URL,
        session: URLSession = .shared,
        cookieStorage: HTTPCookieStorage? = .shared
    ) {
        self.baseURL = baseURL
        self.session = session
        self.cookieStorage = cookieStorage
    }

    static func validatedBaseURL(_ rawValue: String) throws -> URL {
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var components = URLComponents(string: value),
              let scheme = components.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              components.host?.isEmpty == false else {
            throw FinanceAPIError.invalidBaseURL
        }
        components.query = nil
        components.fragment = nil
        guard let url = components.url else { throw FinanceAPIError.invalidBaseURL }
        return url
    }

    static func makeURL(base: URL, path: String, query: [String: String]) throws -> URL {
        guard var comps = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
            throw FinanceAPIError.invalidBaseURL
        }
        let basePath = comps.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let endpoint = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        comps.path = "/" + [basePath, endpoint].filter { !$0.isEmpty }.joined(separator: "/")
        if !query.isEmpty {
            comps.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = comps.url else { throw FinanceAPIError.invalidBaseURL }
        return url
    }

    func get<Response: Decodable>(
        _ path: String, query: [String: String] = [:], accessToken: String
    ) async throws -> Response {
        try await send(path, method: "GET", query: query, body: Optional<EmptyBody>.none, accessToken: accessToken)
    }

    func send<Body: Encodable, Response: Decodable>(
        _ path: String, method: String, query: [String: String] = [:],
        body: Body?, accessToken: String?, additionalHeaders: [String: String] = [:]
    ) async throws -> Response {
        let url = try Self.makeURL(base: baseURL, path: path, query: query)
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let accessToken, !accessToken.isEmpty {
            req.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        additionalHeaders.forEach { req.setValue($0.value, forHTTPHeaderField: $0.key) }

        let (data, _) = try await perform(req)
        guard !data.isEmpty else { throw FinanceAPIError.emptyResponse }
        return try JSONDecoder().decode(Response.self, from: data)
    }

    func cookieAuthenticatedPost<Response: Decodable>(_ path: String) async throws -> Response {
        let url = try Self.makeURL(base: baseURL, path: path, query: [:])
        var headers: [String: String] = [:]
        if let csrf = csrfToken(for: url) {
            headers["X-CSRF-Token"] = csrf
        }
        return try await send(
            path,
            method: "POST",
            body: Optional<EmptyBody>.none,
            accessToken: nil,
            additionalHeaders: headers
        )
    }

    func cookieAuthenticatedPost(_ path: String) async throws {
        let url = try Self.makeURL(base: baseURL, path: path, query: [:])
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let csrf = csrfToken(for: url) {
            req.setValue(csrf, forHTTPHeaderField: "X-CSRF-Token")
        }
        _ = try await perform(req)
    }

    func clearAuthCookies() {
        guard let cookieStorage else { return }
        let paths = ["", "auth/refresh"]
        let cookies = paths.flatMap { path in
            let url = try? Self.makeURL(base: baseURL, path: path, query: [:])
            return url.flatMap(cookieStorage.cookies(for:)) ?? []
        }
        for cookie in cookies where ["cbf_refresh", "cbf_csrf"].contains(cookie.name) {
            cookieStorage.deleteCookie(cookie)
        }
    }

    private func csrfToken(for url: URL) -> String? {
        cookieStorage?
            .cookies(for: url)?
            .first(where: { $0.name == "cbf_csrf" })?
            .value
    }

    private func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError {
            throw FinanceAPIError.requestFailed(error.code)
        }

        guard let http = response as? HTTPURLResponse else { throw FinanceAPIError.emptyResponse }
        if http.statusCode == 401 { throw FinanceAPIError.unauthorized }
        guard 200..<300 ~= http.statusCode else {
            let detail = (try? JSONDecoder().decode(ErrorResponse.self, from: data))?.detail
            throw FinanceAPIError.badStatus(http.statusCode, detail)
        }
        return (data, http)
    }
}
