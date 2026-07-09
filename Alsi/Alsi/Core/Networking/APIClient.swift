import Foundation

private struct EmptyBody: Encodable {}

struct APIClient {
    let baseURL: URL
    let session: URLSession

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
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
        body: Body?, accessToken: String?
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

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw FinanceAPIError.emptyResponse }
        if http.statusCode == 401 { throw FinanceAPIError.unauthorized }
        guard 200..<300 ~= http.statusCode else { throw FinanceAPIError.badStatus(http.statusCode) }
        guard !data.isEmpty else { throw FinanceAPIError.emptyResponse }
        return try JSONDecoder().decode(Response.self, from: data)
    }
}
