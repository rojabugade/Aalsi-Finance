import Foundation

public enum TransactionDirection: String, Codable, CaseIterable, Sendable {
    case spend
    case income

    public func signed(_ amount: Money) -> Money {
        Money(self == .spend ? -abs(amount.value) : abs(amount.value))
    }
}

public struct TransactionCreateRequest: Encodable, Sendable {
    public let amount: Money
    public let direction: TransactionDirection
    public let merchant: String?
    public let currency: String
    public let txnDate: Date
    public let categoryId: UUID?
    public let status: String
    public let notes: String?

    public init(
        amount: Money,
        direction: TransactionDirection,
        merchant: String?,
        currency: String,
        txnDate: Date,
        categoryId: UUID?,
        status: String = "draft",
        notes: String?
    ) {
        self.amount = amount
        self.direction = direction
        self.merchant = merchant
        self.currency = currency
        self.txnDate = txnDate
        self.categoryId = categoryId
        self.status = status
        self.notes = notes
    }

    enum CodingKeys: String, CodingKey {
        case amount
        case merchant
        case currency
        case txnDate
        case categoryId
        case status
        case notes
        case sourceChannel
        case isShared
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(direction.signed(amount), forKey: .amount)
        try container.encodeIfPresent(merchant, forKey: .merchant)
        try container.encode(currency, forKey: .currency)
        try container.encode(APIDateParser.dateString(txnDate), forKey: .txnDate)
        try container.encodeIfPresent(categoryId, forKey: .categoryId)
        try container.encode(status, forKey: .status)
        try container.encodeIfPresent(notes, forKey: .notes)
        try container.encode("manual", forKey: .sourceChannel)
        try container.encode(false, forKey: .isShared)
    }
}

public struct TransactionPatchRequest: Encodable, Sendable {
    public let merchant: String?
    public let amount: Money
    public let direction: TransactionDirection
    public let currency: String
    public let txnDate: Date
    public let categoryId: UUID?
    public let status: String
    public let notes: String?

    public init(
        merchant: String?,
        amount: Money,
        direction: TransactionDirection,
        currency: String,
        txnDate: Date,
        categoryId: UUID?,
        status: String,
        notes: String?
    ) {
        self.merchant = merchant
        self.amount = amount
        self.direction = direction
        self.currency = currency
        self.txnDate = txnDate
        self.categoryId = categoryId
        self.status = status
        self.notes = notes
    }

    enum CodingKeys: String, CodingKey {
        case merchant
        case amount
        case currency
        case txnDate
        case categoryId
        case status
        case notes
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(merchant, forKey: .merchant)
        try container.encode(direction.signed(amount), forKey: .amount)
        try container.encode(currency, forKey: .currency)
        try container.encode(APIDateParser.dateString(txnDate), forKey: .txnDate)
        try container.encode(categoryId, forKey: .categoryId)
        try container.encode(status, forKey: .status)
        try container.encode(notes, forKey: .notes)
    }
}

public struct SplitPartRequest: Encodable, Sendable {
    public let amount: Money
    public let categoryId: UUID?
    public let notes: String?

    public init(amount: Money, categoryId: UUID?, notes: String? = nil) {
        self.amount = amount
        self.categoryId = categoryId
        self.notes = notes
    }
}

public struct SplitRequest: Encodable, Sendable {
    public let parts: [SplitPartRequest]

    public init(parts: [SplitPartRequest]) {
        self.parts = parts
    }
}

public struct MergeRequest: Encodable, Sendable {
    public let transactionIds: [UUID]
    public let notes: String?

    public init(transactionIds: [UUID], notes: String?) {
        self.transactionIds = transactionIds
        self.notes = notes
    }
}
