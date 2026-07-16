import Foundation

/// Create/update payload for `/budgets`. The backend treats a nil category as
/// the household-wide "Overall" budget.
public struct BudgetUpsertRequest: Encodable, Sendable {
    public let categoryId: UUID?
    public let period: String
    public let amount: Money
    public let currency: String

    public init(categoryId: UUID?, period: String = "monthly", amount: Money, currency: String) {
        self.categoryId = categoryId
        self.period = period
        self.amount = amount
        self.currency = currency
    }

    enum CodingKeys: String, CodingKey {
        case categoryId
        case period
        case amount
        case currency
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(categoryId, forKey: .categoryId)
        try container.encode(period, forKey: .period)
        try container.encode(amount, forKey: .amount)
        try container.encode(currency, forKey: .currency)
    }
}
