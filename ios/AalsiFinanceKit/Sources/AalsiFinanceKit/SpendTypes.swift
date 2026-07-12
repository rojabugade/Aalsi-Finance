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
