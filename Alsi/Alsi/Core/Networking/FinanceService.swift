import Foundation

struct FinanceService {
    let client: APIClient

    private struct LoginRequest: Encodable { let email: String; let password: String }
    private struct AccessTokenResponse: Decodable {
        let accessToken: String
        enum CodingKeys: String, CodingKey { case accessToken = "access_token" }
    }

    func login(email: String, password: String) async throws -> String {
        let resp: AccessTokenResponse = try await client.send(
            "auth/login", method: "POST",
            body: LoginRequest(email: email, password: password), accessToken: nil)
        return resp.accessToken
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
