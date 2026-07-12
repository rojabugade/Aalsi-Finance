import Foundation

// Codable mirrors of the backend pydantic response models. Keys are snake_case
// on the wire; `JSONDecoder.api()` converts them.

public struct AccessToken: Decodable, Sendable {
    public let accessToken: String
    public let tokenType: String
}

public struct Household: Decodable, Sendable {
    public let id: UUID
    public let name: String
    public let baseCurrency: String
    public let sharingEnabled: Bool
}

// MARK: - Transactions

public struct Transaction: Decodable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public let householdId: UUID
    public let accountId: UUID?
    public let merchantId: UUID?
    public let merchant: String?
    public let amount: Money
    public let currency: String
    public let baseAmount: Money?
    public let txnDate: Date
    public let categoryId: UUID?
    public let status: String
    public let sourceChannel: String?
    public let isShared: Bool
    public let notes: String?
    public let confidence: Double?
    public let createdAt: Date
    public let lineItems: [LineItem]

    public var isDraft: Bool { status == "draft" }
    public var displayMerchant: String { merchant?.isEmpty == false ? merchant! : "Unknown merchant" }
}

public struct LineItem: Decodable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public let transactionId: UUID
    public let name: String
    public let amount: Money
    public let quantity: Money?
}

public struct Category: Decodable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public let parentId: UUID?
    public let name: String
    public let kind: String
    public let isSystem: Bool
}

// MARK: - Cashflow

public struct CashflowSummary: Decodable, Sendable {
    public let currency: String
    public let incomeMonthly: Money
    public let recurringMonthly: Money
    public let debtEmiMonthly: Money
    public let cardMinMonthly: Money
    public let discretionaryMonthly: Money
    public let leftoverMonthly: Money
    public let breakdown: [CashflowLine]
}

public struct CashflowLine: Decodable, Hashable, Sendable {
    public let label: String
    public let amount: Money
    public let kind: String
}

// MARK: - Analytics

public struct AnalyticsRow: Decodable, Hashable, Sendable {
    public let dimensions: [String: String?]
    public let total: Money
    public let contributionPct: Money?

    public func dimension(_ key: String) -> String? {
        dimensions[key] ?? nil
    }
}

public struct Breakdown: Decodable, Sendable {
    public let dimension: String
    public let rows: [AnalyticsRow]
}

public struct TimeSeries: Decodable, Sendable {
    public let metric: String
    public let interval: String
    public let fromDate: Date
    public let toDate: Date
    public let points: [TimeSeriesPoint]
}

public struct TimeSeriesPoint: Decodable, Hashable, Sendable {
    public let period: String
    public let spend: Money
    public let income: Money
    public let net: Money
}

public struct NetWorth: Decodable, Sendable {
    public let asOf: Date
    public let currency: String
    public let assets: Money
    public let liabilities: Money
    public let netWorth: Money
    public let points: [NetWorthPoint]
}

public struct NetWorthPoint: Decodable, Hashable, Sendable {
    public let period: String
    public let assets: Money
    public let liabilities: Money
    public let netWorth: Money
}

public struct Budget: Decodable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public let categoryId: UUID?
    public let period: String
    public let amount: Money
    public let currency: String
    public let spent: Money
    public let remaining: Money
    public let progressPct: Money
    public let overspent: Bool
}
