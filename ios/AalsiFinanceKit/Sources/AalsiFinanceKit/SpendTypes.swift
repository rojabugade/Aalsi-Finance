import Foundation

public struct DateWindow: Hashable, Sendable {
    public let start: Date
    public let end: Date

    public init(start: Date, end: Date) {
        self.start = start
        self.end = end
    }
}

public struct SpendPeriod: Hashable, Sendable {
    public let monthStart: Date
    public let current: DateWindow
    public let previous: DateWindow
    public let isCurrentMonth: Bool

    public init(monthStart: Date, current: DateWindow, previous: DateWindow, isCurrentMonth: Bool) {
        self.monthStart = monthStart
        self.current = current
        self.previous = previous
        self.isCurrentMonth = isCurrentMonth
    }
}

public enum SpendClassification: Hashable, Sendable {
    case spend(Money)
    case income(Money)
    case transfer(Money)
    case refund(Money)
    case ignored
}

public enum SpendDirectionFilter: String, CaseIterable, Sendable {
    case all
    case spend
    case income
}

public enum SpendAmountBand: String, CaseIterable, Sendable {
    case any
    case under25
    case from25To100
    case from100To500
    case over500
}

public struct SpendFilter: Hashable, Sendable {
    public var query: String
    public var categoryId: UUID?
    public var direction: SpendDirectionFilter
    public var amountBand: SpendAmountBand
    public var recurringOnly: Bool
    public var status: String?

    public init(
        query: String = "",
        categoryId: UUID? = nil,
        direction: SpendDirectionFilter = .all,
        amountBand: SpendAmountBand = .any,
        recurringOnly: Bool = false,
        status: String? = nil
    ) {
        self.query = query
        self.categoryId = categoryId
        self.direction = direction
        self.amountBand = amountBand
        self.recurringOnly = recurringOnly
        self.status = status
    }
}

public struct CategoryPath: Hashable, Sendable {
    public let parent: Category?
    public let leaf: Category?

    public init(parent: Category?, leaf: Category?) {
        self.parent = parent
        self.leaf = leaf
    }

    public var displayName: String {
        [parent?.name, leaf?.name]
            .compactMap { $0 }
            .joined(separator: " › ")
    }
}

public struct CategorySpendRow: Identifiable, Hashable, Sendable {
    public let id: UUID
    public let name: String
    public let total: Money
    public let previous: Money
    public let delta: Money
    public let share: Double
    public let count: Int

    public init(
        id: UUID,
        name: String,
        total: Money,
        previous: Money,
        delta: Money,
        share: Double,
        count: Int
    ) {
        self.id = id
        self.name = name
        self.total = total
        self.previous = previous
        self.delta = delta
        self.share = share
        self.count = count
    }
}

public struct MerchantSpendRow: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let total: Money
    public let previous: Money
    public let delta: Money
    public let count: Int
    public let topCategory: String?
    public let isRecurring: Bool

    public init(
        id: String,
        name: String,
        total: Money,
        previous: Money,
        delta: Money,
        count: Int,
        topCategory: String?,
        isRecurring: Bool
    ) {
        self.id = id
        self.name = name
        self.total = total
        self.previous = previous
        self.delta = delta
        self.count = count
        self.topCategory = topCategory
        self.isRecurring = isRecurring
    }
}

public struct ItemSpendRow: Identifiable, Hashable, Sendable {
    public var id: String { name.lowercased() }
    public let name: String
    public let total: Money
    public let quantity: Money?

    public init(name: String, total: Money, quantity: Money?) {
        self.name = name
        self.total = total
        self.quantity = quantity
    }
}

public enum SpendInsightKind: Hashable, Sendable {
    case category(UUID)
    case merchant(String)
    case transaction(UUID)
    case pace
}

public struct SpendInsight: Hashable, Sendable {
    public let kind: SpendInsightKind
    public let title: String
    public let detail: String
    public let delta: Money

    public init(kind: SpendInsightKind, title: String, detail: String, delta: Money) {
        self.kind = kind
        self.title = title
        self.detail = detail
        self.delta = delta
    }
}

public struct SpendOverview: Hashable, Sendable {
    public let total: Money
    public let previousTotal: Money
    public let transactionCount: Int
    public let dailyPace: Money
    public let cumulativeDaily: [Money]
    public let categories: [CategorySpendRow]
    public let merchants: [MerchantSpendRow]
    public let insight: SpendInsight?

    public init(
        total: Money,
        previousTotal: Money,
        transactionCount: Int,
        dailyPace: Money,
        cumulativeDaily: [Money],
        categories: [CategorySpendRow],
        merchants: [MerchantSpendRow],
        insight: SpendInsight?
    ) {
        self.total = total
        self.previousTotal = previousTotal
        self.transactionCount = transactionCount
        self.dailyPace = dailyPace
        self.cumulativeDaily = cumulativeDaily
        self.categories = categories
        self.merchants = merchants
        self.insight = insight
    }
}

public enum RecurringSpendSource: Hashable, Sendable {
    case canonical
    case inferred
}

public struct RecurringSpendRow: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let amount: Money
    public let currency: String
    public let cadence: String
    public let nextDueDate: Date?
    public let merchantKey: String?
    public let source: RecurringSpendSource

    public init(
        id: String,
        name: String,
        amount: Money,
        currency: String,
        cadence: String,
        nextDueDate: Date?,
        merchantKey: String?,
        source: RecurringSpendSource
    ) {
        self.id = id
        self.name = name
        self.amount = amount
        self.currency = currency
        self.cadence = cadence
        self.nextDueDate = nextDueDate
        self.merchantKey = merchantKey
        self.source = source
    }

    /// The exact monthly equivalent, or `nil` when the cadence is not
    /// normalizable. `amount` remains the per-cadence value shown to users.
    public var monthlyAmount: Money? {
        switch cadence.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "weekly":
            return Money(amount.value * Decimal(52) / Decimal(12))
        case "biweekly":
            return Money(amount.value * Decimal(26) / Decimal(12))
        case "monthly":
            return amount
        case "quarterly":
            return Money(amount.value / Decimal(3))
        case "yearly", "annual":
            return Money(amount.value / Decimal(12))
        default:
            return nil
        }
    }
}
