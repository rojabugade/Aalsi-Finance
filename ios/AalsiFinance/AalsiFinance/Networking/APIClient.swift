import Foundation
import AalsiFinanceKit

enum APIError: LocalizedError {
    case invalidURL
    case transport(Error)
    case http(status: Int, detail: String?)
    case decoding(Error)
    case sessionExpired

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "The server address is invalid. Check it in Settings."
        case .transport(let error):
            return "Couldn't reach the server. \(error.localizedDescription)"
        case .http(let status, let detail):
            return detail ?? "The server returned an error (\(status))."
        case .decoding:
            return "The server sent a response the app couldn't read."
        case .sessionExpired:
            return "Your session has expired. Please sign in again."
        }
    }
}

/// Async REST client for the FastAPI backend.
///
/// Auth model: short-lived bearer access token kept in memory; long-lived
/// refresh token kept in the Keychain and sent in the body of `/auth/refresh`
/// (the backend's non-browser fallback — with no cookie attached the CSRF
/// check is skipped). Cookie storage is disabled so the httpOnly refresh
/// cookie never rides along and triggers the CSRF path.
actor APIClient {
    private var accessToken: String?
    private var onSessionExpired: (@Sendable () -> Void)?

    private let urlSession: URLSession
    private let decoder = JSONDecoder.api()
    private let encoder = JSONEncoder.api()

    init() {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieAcceptPolicy = .never
        config.httpShouldSetCookies = false
        config.timeoutIntervalForRequest = 20
        urlSession = URLSession(configuration: config)
    }

    func setOnSessionExpired(_ handler: @escaping @Sendable () -> Void) {
        onSessionExpired = handler
    }

    // MARK: - Auth

    func login(email: String, password: String, totpCode: String?) async throws {
        struct Body: Encodable {
            let email: String
            let password: String
            let totpCode: String?
        }
        try await authenticate(path: "/auth/login", body: Body(email: email, password: password, totpCode: totpCode))
    }

    func signup(email: String, password: String, displayName: String?, householdName: String?, baseCurrency: String) async throws {
        struct Body: Encodable {
            let email: String
            let password: String
            let displayName: String?
            let householdName: String?
            let baseCurrency: String
        }
        try await authenticate(
            path: "/auth/signup",
            body: Body(email: email, password: password, displayName: displayName, householdName: householdName, baseCurrency: baseCurrency)
        )
    }

    /// Resume a previous session from the Keychain refresh token.
    func restoreSession() async throws {
        try await refresh()
    }

    func logout() async {
        struct Body: Encodable { let refreshToken: String? }
        if let refreshToken = Keychain.readRefreshToken(),
           let body = try? encoder.encode(Body(refreshToken: refreshToken)) {
            _ = try? await perform(path: "/auth/logout", method: "POST", body: body, authorized: true)
        }
        accessToken = nil
        Keychain.deleteRefreshToken()
    }

    private func authenticate(path: String, body: some Encodable) async throws {
        let data = try encoder.encode(body)
        let (responseData, response) = try await perform(path: path, method: "POST", body: data, authorized: false)
        let token: AccessToken = try decode(from: responseData)
        accessToken = token.accessToken
        captureRefreshToken(from: response)
    }

    private func refresh() async throws {
        guard let refreshToken = Keychain.readRefreshToken() else {
            throw APIError.sessionExpired
        }
        struct Body: Encodable { let refreshToken: String }
        do {
            let data = try encoder.encode(Body(refreshToken: refreshToken))
            let (responseData, response) = try await perform(path: "/auth/refresh", method: "POST", body: data, authorized: false)
            let token: AccessToken = try decode(from: responseData)
            accessToken = token.accessToken
            captureRefreshToken(from: response)
        } catch APIError.http(let status, _) where status == 401 || status == 403 {
            Keychain.deleteRefreshToken()
            throw APIError.sessionExpired
        }
    }

    /// The refresh token arrives as a Set-Cookie header (httpOnly, scoped to
    /// /auth). We never store it as a cookie — we lift it into the Keychain.
    private func captureRefreshToken(from response: HTTPURLResponse) {
        guard let url = response.url,
              let headers = response.allHeaderFields as? [String: String]
        else { return }
        let cookies = HTTPCookie.cookies(withResponseHeaderFields: headers, for: url)
        if let refresh = cookies.first(where: { $0.name == "cbf_refresh" })?.value, !refresh.isEmpty {
            Keychain.storeRefreshToken(refresh)
        }
    }

    // MARK: - Requests

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        try await send(path: path, method: "GET", query: query, body: nil)
    }

    func post<T: Decodable>(_ path: String, body: (some Encodable)? = Optional<Int>.none) async throws -> T {
        let data = try body.map { try encoder.encode($0) }
        return try await send(path: path, method: "POST", query: [], body: data)
    }

    private func send<T: Decodable>(path: String, method: String, query: [URLQueryItem], body: Data?) async throws -> T {
        do {
            let (data, _) = try await perform(path: path, method: method, query: query, body: body, authorized: true)
            return try decode(from: data)
        } catch APIError.http(let status, _) where status == 401 {
            // Access token expired: refresh once, then retry the original call.
            do {
                try await refresh()
            } catch {
                onSessionExpired?()
                throw APIError.sessionExpired
            }
            let (data, _) = try await perform(path: path, method: method, query: query, body: body, authorized: true)
            return try decode(from: data)
        }
    }

    private func perform(
        path: String,
        method: String,
        query: [URLQueryItem] = [],
        body: Data?,
        authorized: Bool
    ) async throws -> (Data, HTTPURLResponse) {
        guard var components = URLComponents(url: ServerConfig.baseURL, resolvingAgainstBaseURL: false) else {
            throw APIError.invalidURL
        }
        components.path += path
        if !query.isEmpty {
            components.queryItems = query
        }
        guard let url = components.url else { throw APIError.invalidURL }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if authorized, let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = body

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await urlSession.data(for: request)
        } catch {
            throw APIError.transport(error)
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError.transport(URLError(.badServerResponse))
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(status: http.statusCode, detail: Self.errorDetail(from: data))
        }
        return (data, http)
    }

    private func decode<T: Decodable>(from data: Data) throws -> T {
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }

    /// FastAPI errors carry a `detail` that is a string for HTTPException and
    /// an array of objects for validation errors.
    private static func errorDetail(from data: Data) -> String? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        if let detail = object["detail"] as? String { return detail }
        if let problems = object["detail"] as? [[String: Any]] {
            let messages = problems.compactMap { $0["msg"] as? String }
            return messages.isEmpty ? nil : messages.joined(separator: "\n")
        }
        return nil
    }
}

// MARK: - Endpoint helpers

extension APIClient {
    func household() async throws -> Household {
        try await get("/household")
    }

    func transactions() async throws -> [AalsiFinanceKit.Transaction] {
        try await get("/transactions")
    }

    func confirmTransaction(id: UUID) async throws -> AalsiFinanceKit.Transaction {
        try await post("/transactions/\(id.uuidString.lowercased())/confirm")
    }

    func categories() async throws -> [AalsiFinanceKit.Category] {
        try await get("/categories")
    }

    func cashflowSummary() async throws -> CashflowSummary {
        try await get("/cashflow/summary")
    }

    func netWorth() async throws -> NetWorth {
        try await get("/analytics/net-worth")
    }

    func budgets() async throws -> [Budget] {
        try await get("/budgets")
    }

    func breakdown(dimension: String, from: Date, to: Date) async throws -> Breakdown {
        try await get("/analytics/breakdown", query: [
            URLQueryItem(name: "dimension", value: dimension),
            URLQueryItem(name: "from", value: Self.dateParam(from)),
            URLQueryItem(name: "to", value: Self.dateParam(to)),
        ])
    }

    func timeseries(metric: String = "spend", interval: String = "monthly", from: Date, to: Date) async throws -> TimeSeries {
        try await get("/analytics/timeseries", query: [
            URLQueryItem(name: "metric", value: metric),
            URLQueryItem(name: "interval", value: interval),
            URLQueryItem(name: "from", value: Self.dateParam(from)),
            URLQueryItem(name: "to", value: Self.dateParam(to)),
        ])
    }

    func loans() async throws -> [Loan] {
        try await get("/loans")
    }

    func creditCards() async throws -> [CreditCardSummary] {
        try await get("/credit-cards")
    }

    func recurringSeries() async throws -> [RecurringSeries] {
        try await get("/recurring-series", query: [URLQueryItem(name: "status", value: "active")])
    }

    func incomeSources() async throws -> [IncomeSource] {
        try await get("/income-sources")
    }

    func holdings() async throws -> [Holding] {
        try await get("/holdings")
    }

    func loanSchedule(loanId: UUID) async throws -> [PaymentScheduleEntry] {
        try await get("/loans/\(loanId.uuidString.lowercased())/schedule")
    }

    func monitorAlerts(from: Date, to: Date) async throws -> MonitorOut {
        try await get("/analyst/monitor", query: [
            URLQueryItem(name: "from", value: Self.dateParam(from)),
            URLQueryItem(name: "to", value: Self.dateParam(to)),
        ])
    }

    private static func dateParam(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}
