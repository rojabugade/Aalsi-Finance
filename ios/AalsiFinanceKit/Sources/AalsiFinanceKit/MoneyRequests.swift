import Foundation

/// Create/patch body for `/recurring-series`. The backend accepts partial
/// bodies on PATCH; encoding skips nil fields so an edit only sends what the
/// user actually changed.
public struct RecurringSeriesUpsertRequest: Encodable, Sendable {
    public let name: String?
    public let amount: Money?
    public let currency: String?
    public let cadence: String?
    public let type: String?
    public let status: String?
    public let nextDueDate: Date?

    public init(
        name: String? = nil,
        amount: Money? = nil,
        currency: String? = nil,
        cadence: String? = nil,
        type: String? = nil,
        status: String? = nil,
        nextDueDate: Date? = nil
    ) {
        self.name = name
        self.amount = amount
        self.currency = currency
        self.cadence = cadence
        self.type = type
        self.status = status
        self.nextDueDate = nextDueDate
    }

    enum CodingKeys: String, CodingKey {
        case name, amount, currency, cadence, type, status, nextDueDate
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(name, forKey: .name)
        try container.encodeIfPresent(amount.map { $0.magnitude }, forKey: .amount)
        try container.encodeIfPresent(currency, forKey: .currency)
        try container.encodeIfPresent(cadence, forKey: .cadence)
        try container.encodeIfPresent(type, forKey: .type)
        try container.encodeIfPresent(status, forKey: .status)
        try container.encodeIfPresent(nextDueDate.map(APIDateParser.dateString), forKey: .nextDueDate)
    }
}

/// Patch body for `/loans/{id}` — covers the fields the app lets you edit.
public struct LoanPatchRequest: Encodable, Sendable {
    public let name: String?
    public let principal: Money?
    public let interestRate: Money?
    public let minOrEmiAmount: Money?
    public let dueDay: Int?

    public init(
        name: String? = nil,
        principal: Money? = nil,
        interestRate: Money? = nil,
        minOrEmiAmount: Money? = nil,
        dueDay: Int? = nil
    ) {
        self.name = name
        self.principal = principal
        self.interestRate = interestRate
        self.minOrEmiAmount = minOrEmiAmount
        self.dueDay = dueDay
    }

    enum CodingKeys: String, CodingKey {
        case name, principal, interestRate, minOrEmiAmount, dueDay
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(name, forKey: .name)
        try container.encodeIfPresent(principal, forKey: .principal)
        try container.encodeIfPresent(interestRate, forKey: .interestRate)
        try container.encodeIfPresent(minOrEmiAmount, forKey: .minOrEmiAmount)
        try container.encodeIfPresent(dueDay, forKey: .dueDay)
    }
}

/// PUT body for `/loans/{id}/credit-card-detail`.
public struct CreditCardDetailRequest: Encodable, Sendable {
    public let creditLimit: Money?
    public let statementBalance: Money?
    public let statementDay: Int?

    public init(creditLimit: Money? = nil, statementBalance: Money? = nil, statementDay: Int? = nil) {
        self.creditLimit = creditLimit
        self.statementBalance = statementBalance
        self.statementDay = statementDay
    }
}

/// Patch body for `/income-sources/{id}`. The backend has no DELETE for
/// income sources, so editing is the full lifecycle on mobile.
public struct IncomeSourcePatchRequest: Encodable, Sendable {
    public let employer: String?
    public let country: String?
    public let currency: String?
    public let frequency: String?
    public let gross: Money?
    public let net: Money?

    public init(
        employer: String? = nil,
        country: String? = nil,
        currency: String? = nil,
        frequency: String? = nil,
        gross: Money? = nil,
        net: Money? = nil
    ) {
        self.employer = employer
        self.country = country
        self.currency = currency
        self.frequency = frequency
        self.gross = gross
        self.net = net
    }

    enum CodingKeys: String, CodingKey {
        case employer, country, currency, frequency, gross, net
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(employer, forKey: .employer)
        try container.encodeIfPresent(country, forKey: .country)
        try container.encodeIfPresent(currency, forKey: .currency)
        try container.encodeIfPresent(frequency, forKey: .frequency)
        try container.encodeIfPresent(gross, forKey: .gross)
        try container.encodeIfPresent(net, forKey: .net)
    }
}

/// Patch body for `/holdings/{id}`.
public struct HoldingPatchRequest: Encodable, Sendable {
    public let name: String?
    public let symbol: String?
    public let quantity: Money?
    public let avgBuyPrice: Money?

    public init(name: String? = nil, symbol: String? = nil, quantity: Money? = nil, avgBuyPrice: Money? = nil) {
        self.name = name
        self.symbol = symbol
        self.quantity = quantity
        self.avgBuyPrice = avgBuyPrice
    }

    enum CodingKeys: String, CodingKey {
        case name, symbol, quantity, avgBuyPrice
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(name, forKey: .name)
        try container.encodeIfPresent(symbol, forKey: .symbol)
        try container.encodeIfPresent(quantity, forKey: .quantity)
        try container.encodeIfPresent(avgBuyPrice, forKey: .avgBuyPrice)
    }
}

/// Household member row from `/household/members`.
public struct HouseholdMember: Decodable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public let email: String
    public let displayName: String?
    public let role: String
    public let mfaEnabled: Bool
    public let isActive: Bool
}

/// `/auth/mfa/enroll` response: shared secret + otpauth URI for authenticators.
public struct MfaEnrollment: Decodable, Sendable {
    public let secret: String
    public let otpauthUri: String
}
