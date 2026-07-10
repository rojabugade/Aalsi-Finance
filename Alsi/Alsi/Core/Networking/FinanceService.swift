import Foundation

struct FinanceService {
    let client: APIClient

    private struct LoginRequest: Encodable {
        let email: String
        let password: String
        let totpCode: String?

        enum CodingKeys: String, CodingKey {
            case email, password
            case totpCode = "totp_code"
        }
    }
    private struct SignupRequest: Encodable {
        let email: String
        let password: String
        let displayName: String?
        let householdName: String?

        enum CodingKeys: String, CodingKey {
            case email, password
            case displayName = "display_name"
            case householdName = "household_name"
        }
    }
    private struct AccessTokenResponse: Decodable {
        let accessToken: String
        enum CodingKeys: String, CodingKey { case accessToken = "access_token" }
    }

    func login(email: String, password: String, totpCode: String? = nil) async throws -> String {
        let resp: AccessTokenResponse = try await client.send(
            "auth/login", method: "POST",
            body: LoginRequest(email: email, password: password, totpCode: totpCode), accessToken: nil)
        return resp.accessToken
    }

    func signup(
        email: String,
        password: String,
        displayName: String?,
        householdName: String?
    ) async throws -> String {
        let resp: AccessTokenResponse = try await client.send(
            "auth/signup",
            method: "POST",
            body: SignupRequest(
                email: email,
                password: password,
                displayName: displayName,
                householdName: householdName
            ),
            accessToken: nil
        )
        return resp.accessToken
    }

    func refreshAccessToken() async throws -> String {
        let resp: AccessTokenResponse = try await client.cookieAuthenticatedPost("auth/refresh")
        return resp.accessToken
    }

    func logout() async {
        try? await client.cookieAuthenticatedPost("auth/logout")
        client.clearAuthCookies()
    }

    func fetchSnapshot(accessToken token: String) async throws -> FinanceSnapshot {
        async let cashflow: CashflowSummary = client.get("cashflow/summary", query: ["months": "6"], accessToken: token)
        async let transactions: [Transaction] = client.get("transactions", accessToken: token)
        async let reviewQueue: ReviewQueue = client.get("review-queue", accessToken: token)
        async let recurring: [RecurringSeries] = client.get("recurring-series", query: ["status": "active"], accessToken: token)
        async let budgets: [Budget] = client.get("budgets", accessToken: token)
        async let netWorth: NetWorth = client.get("analytics/net-worth", accessToken: token)

        return try await FinanceSnapshot(
            cashflow: cashflow,
            transactions: transactions,
            reviewQueue: reviewQueue,
            recurringSeries: recurring,
            budgets: budgets,
            netWorth: netWorth
        )
    }
}
