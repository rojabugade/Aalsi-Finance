import Foundation

// Codable mirrors of the backend pydantic response models. Keys are snake_case
// on the wire; `JSONDecoder.api()` converts them.

public enum JSONValue: Codable, Hashable, Sendable {
    case bool(Bool)
    case string(String)
    case number(Decimal)
    case array([JSONValue])
    case object([String: JSONValue])
    case null

    public var boolValue: Bool? {
        if case .bool(let value) = self { value } else { nil }
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode(Decimal.self) {
            self = .number(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unsupported JSON primitive"
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .bool(let value):
            try container.encode(value)
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }
}

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
    public let paymentMethodId: UUID?
    public let recurringSeriesId: UUID?
    public let ownerUserId: UUID?
    public let merchantId: UUID?
    public let merchant: String?
    public let amount: Money
    public let currency: String
    public let baseAmount: Money?
    public let fxRate: Money?
    public let txnDate: Date
    public let categoryId: UUID?
    public let status: String
    public let sourceDocumentId: UUID?
    public let sourceChannel: String?
    public let isShared: Bool
    public let flags: [String: JSONValue]?
    public let notes: String?
    public let confidence: Double?
    public let externalId: String?
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
    public let itemTypeCategoryId: UUID?
    public let confidence: Double?
}

public struct Category: Decodable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public let parentId: UUID?
    public let name: String
    public let kind: String
    public let isSystem: Bool

    public init(id: UUID, parentId: UUID?, name: String, kind: String, isSystem: Bool) {
        self.id = id
        self.parentId = parentId
        self.name = name
        self.kind = kind
        self.isSystem = isSystem
    }
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
