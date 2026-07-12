import Foundation

// Codable mirrors of the backend pydantic response models. Keys are snake_case
// on the wire; `JSONDecoder.api()` converts them.

struct AccessToken: Decodable, Sendable {
    let accessToken: String
    let tokenType: String
}

struct Household: Decodable, Sendable {
    let id: UUID
    let name: String
    let baseCurrency: String
    let sharingEnabled: Bool
}

// MARK: - Transactions

struct Transaction: Decodable, Identifiable, Hashable, Sendable {
    let id: UUID
    let householdId: UUID
    let accountId: UUID?
    let merchantId: UUID?
    let merchant: String?
    let amount: Money
    let currency: String
    let baseAmount: Money?
    let txnDate: Date
    let categoryId: UUID?
    let status: String
    let sourceChannel: String?
    let isShared: Bool
    let notes: String?
    let confidence: Double?
    let createdAt: Date
    let lineItems: [LineItem]

    var isDraft: Bool { status == "draft" }
    var displayMerchant: String { merchant?.isEmpty == false ? merchant! : "Unknown merchant" }
}

struct LineItem: Decodable, Identifiable, Hashable, Sendable {
    let id: UUID
    let transactionId: UUID
    let name: String
    let amount: Money
    let quantity: Money?
}

struct Category: Decodable, Identifiable, Hashable, Sendable {
    let id: UUID
    let parentId: UUID?
    let name: String
    let kind: String
    let isSystem: Bool
}

// MARK: - Cashflow

struct CashflowSummary: Decodable, Sendable {
    let currency: String
    let incomeMonthly: Money
    let recurringMonthly: Money
    let debtEmiMonthly: Money
    let cardMinMonthly: Money
    let discretionaryMonthly: Money
    let leftoverMonthly: Money
    let breakdown: [CashflowLine]
}

struct CashflowLine: Decodable, Hashable, Sendable {
    let label: String
    let amount: Money
    let kind: String // income | recurring | debt | card | discretionary | leftover
}

// MARK: - Analytics

struct AnalyticsRow: Decodable, Hashable, Sendable {
    let dimensions: [String: String?]
    let total: Money
    let contributionPct: Money?

    func dimension(_ key: String) -> String? {
        dimensions[key] ?? nil
    }
}

struct Breakdown: Decodable, Sendable {
    let dimension: String
    let rows: [AnalyticsRow]
}

struct TimeSeries: Decodable, Sendable {
    let metric: String
    let interval: String
    let fromDate: Date
    let toDate: Date
    let points: [TimeSeriesPoint]
}

struct TimeSeriesPoint: Decodable, Hashable, Sendable {
    let period: String
    let spend: Money
    let income: Money
    let net: Money
}

struct NetWorth: Decodable, Sendable {
    let asOf: Date
    let currency: String
    let assets: Money
    let liabilities: Money
    let netWorth: Money
    let points: [NetWorthPoint]
}

struct NetWorthPoint: Decodable, Hashable, Sendable {
    let period: String
    let assets: Money
    let liabilities: Money
    let netWorth: Money
}

struct Budget: Decodable, Identifiable, Hashable, Sendable {
    let id: UUID
    let categoryId: UUID?
    let period: String
    let amount: Money
    let currency: String
    let spent: Money
    let remaining: Money
    let progressPct: Money
    let overspent: Bool
}
