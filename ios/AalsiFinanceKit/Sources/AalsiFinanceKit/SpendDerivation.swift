import Foundation

public enum SpendDerivation {
    public static func classify(
        _ transaction: Transaction,
        categories: [Category]
    ) -> SpendClassification {
        let amount = transaction.amount.value
        let magnitude = transaction.amount.magnitude
        let flags = transaction.flags ?? [:]

        if flags["transfer"]?.boolValue == true {
            return .transfer(magnitude)
        }
        if flags["refund"]?.boolValue == true, amount > 0 {
            return .refund(magnitude)
        }

        let categoriesByID = Dictionary(uniqueKeysWithValues: categories.map { ($0.id, $0) })
        let topCategory = topCategory(for: transaction.categoryId, categoriesByID: categoriesByID)

        if isTransfer(topCategory) {
            return .transfer(magnitude)
        }
        if amount > 0, isIncome(topCategory) {
            return .income(magnitude)
        }
        if amount < 0, !isIncome(topCategory) {
            return .spend(magnitude)
        }
        return .ignored
    }

    public static func period(
        containing date: Date,
        now: Date = .now,
        calendar: Calendar = .current
    ) -> SpendPeriod {
        let selectedMonth = calendar.dateInterval(of: .month, for: date)!
        let previousMonthDate = calendar.date(byAdding: .month, value: -1, to: selectedMonth.start)!
        let previousMonth = calendar.dateInterval(of: .month, for: previousMonthDate)!
        let previousInclusiveEnd = previousMonth.end.addingTimeInterval(-1)
        let isCurrentMonth = calendar.isDate(selectedMonth.start, equalTo: now, toGranularity: .month)

        let currentEnd: Date
        let previousEnd: Date
        if isCurrentMonth {
            currentEnd = now
            let comparableEnd = calendar.date(byAdding: .month, value: -1, to: now)!
            previousEnd = min(comparableEnd, previousInclusiveEnd)
        } else {
            currentEnd = selectedMonth.end.addingTimeInterval(-1)
            previousEnd = previousInclusiveEnd
        }

        return SpendPeriod(
            monthStart: selectedMonth.start,
            current: DateWindow(start: selectedMonth.start, end: currentEnd),
            previous: DateWindow(start: previousMonth.start, end: previousEnd),
            isCurrentMonth: isCurrentMonth
        )
    }

    public static func categoryPath(
        for categoryID: UUID?,
        categories: [Category]
    ) -> CategoryPath {
        let categoriesByID = Dictionary(uniqueKeysWithValues: categories.map { ($0.id, $0) })
        guard let categoryID, let leaf = categoriesByID[categoryID] else {
            return CategoryPath(parent: nil, leaf: nil)
        }
        let root = topCategory(for: categoryID, categoriesByID: categoriesByID)
        return CategoryPath(parent: root?.id == leaf.id ? nil : root, leaf: leaf)
    }

    public static func filter(
        _ transactions: [Transaction],
        categories: [Category],
        period: SpendPeriod,
        filter: SpendFilter,
        recurringMerchantKeys: Set<String> = []
    ) -> [Transaction] {
        let query = filter.query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let normalizedRecurringKeys = Set(
            recurringMerchantKeys
                .map { merchantKey($0) }
                .filter { !$0.isEmpty }
        )

        return transactions.filter { transaction in
            guard period.current.start...period.current.end ~= transaction.txnDate else { return false }
            guard matchesDirection(transaction, categories: categories, direction: filter.direction) else { return false }
            guard matchesCategory(transaction.categoryId, selected: filter.categoryId, categories: categories) else { return false }
            guard matchesAmount(transaction.amount.magnitude.value, band: filter.amountBand) else { return false }
            guard filter.status == nil || transaction.status == filter.status else { return false }
            guard !filter.recurringOnly || normalizedRecurringKeys.contains(merchantKey(transaction.merchant)) else { return false }
            return query.isEmpty || [transaction.merchant, transaction.notes]
                .compactMap { $0?.lowercased() }
                .contains { $0.contains(query) }
        }.sorted {
            if $0.txnDate != $1.txnDate {
                return $0.txnDate > $1.txnDate
            }
            return $0.createdAt > $1.createdAt
        }
    }

    private static func topCategory(
        for categoryID: UUID?,
        categoriesByID: [UUID: Category]
    ) -> Category? {
        guard let categoryID, var category = categoriesByID[categoryID] else { return nil }
        var visited = Set([category.id])

        while let parentID = category.parentId,
              let parent = categoriesByID[parentID],
              visited.insert(parent.id).inserted {
            category = parent
        }
        return category
    }

    private static func isIncome(_ category: Category?) -> Bool {
        guard let category else { return false }
        return normalized(category.kind) == "income" || normalized(category.name) == "income"
    }

    private static func isTransfer(_ category: Category?) -> Bool {
        guard let category else { return false }
        return normalized(category.kind) == "transfer" || ["transfer", "transfers"].contains(normalized(category.name))
    }

    private static func matchesDirection(
        _ transaction: Transaction,
        categories: [Category],
        direction: SpendDirectionFilter
    ) -> Bool {
        switch direction {
        case .all:
            return true
        case .spend:
            switch classify(transaction, categories: categories) {
            case .spend, .refund:
                return true
            case .income, .transfer, .ignored:
                return false
            }
        case .income:
            if case .income = classify(transaction, categories: categories) {
                return true
            }
            return false
        }
    }

    private static func matchesCategory(
        _ categoryID: UUID?,
        selected selectedID: UUID?,
        categories: [Category]
    ) -> Bool {
        guard let selectedID else { return true }
        guard let categoryID else { return false }
        if categoryID == selectedID { return true }

        let categoriesByID = Dictionary(uniqueKeysWithValues: categories.map { ($0.id, $0) })
        var currentID = categoryID
        var visited = Set([categoryID])
        while let parentID = categoriesByID[currentID]?.parentId,
              visited.insert(parentID).inserted {
            if parentID == selectedID { return true }
            currentID = parentID
        }
        return false
    }

    private static func matchesAmount(_ amount: Decimal, band: SpendAmountBand) -> Bool {
        switch band {
        case .any:
            return true
        case .under25:
            return amount < 25
        case .from25To100:
            return amount >= 25 && amount < 100
        case .from100To500:
            return amount >= 100 && amount < 500
        case .over500:
            return amount >= 500
        }
    }

    private static func merchantKey(_ merchant: String?) -> String {
        normalized(merchant ?? "")
    }

    private static func normalized(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}
