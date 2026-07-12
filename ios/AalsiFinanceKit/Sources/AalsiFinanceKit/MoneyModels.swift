import Foundation

public struct Loan: Decodable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public let name: String
    public let type: String
    public let scheduleKind: String
    public let principal: Money
    public let currency: String
    public let interestRate: Money?
    public let minOrEmiAmount: Money?
    public let dueDay: Int?
    public let startDate: Date?
    public let endDate: Date?
    public let nextDueDate: Date?
    public let penaltyWarning: String?
    public let outstandingBalance: Money?
    public let totalPaid: Money?
    public let totalPrincipalPaid: Money?
    public let totalInterestPaid: Money?
    public let progressPct: Double?
    public let creditCardDetail: CreditCardDetail?

    public var isCreditCard: Bool { type == "credit_card" || creditCardDetail != nil }
}

public struct CreditCardDetail: Decodable, Hashable, Sendable {
    public let creditLimit: Money?
    public let statementBalance: Money?
    public let availableCredit: Money?
    public let statementDay: Int?
    public let utilization: Money?
}

public struct CreditCardSummary: Decodable, Identifiable, Hashable, Sendable {
    public var id: UUID { loan.id }
    public let loan: Loan
    public let creditLimit: Money?
    public let statementBalance: Money?
    public let availableCredit: Money?
    public let statementDay: Int?
    public let utilization: Money?
    public let detailComplete: Bool
}

public struct RecurringSeries: Decodable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public let name: String
    public let amount: Money?
    public let currency: String
    public let cadence: String
    public let type: String
    public let status: String
    public let nextDueDate: Date?
    public let merchantName: String?
    public let categoryName: String?
}

public struct IncomeSource: Decodable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public let employer: String?
    public let country: String?
    public let currency: String
    public let frequency: String
    public let gross: Money?
    public let net: Money?
}

public struct PaymentScheduleEntry: Decodable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public let loanId: UUID
    public let installmentNo: Int
    public let dueDate: Date
    public let principalComponent: Money?
    public let interestComponent: Money?
    public let balanceAfter: Money?
    public let status: String
}

public struct PersistentAlert: Decodable, Identifiable, Hashable, Sendable {
    public let id: String
    public let kind: String
    public let severity: Int
    public let tone: String
    public let state: String
    public let title: String
    public let detail: String
}

public struct MonitorOut: Decodable, Hashable, Sendable {
    public let alerts: [PersistentAlert]
}

public struct Holding: Decodable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public let assetType: String
    public let symbol: String?
    public let name: String
    public let quantity: Money
    public let avgBuyPrice: Money?
    public let currency: String
}
