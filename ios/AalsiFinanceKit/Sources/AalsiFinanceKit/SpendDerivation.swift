import Foundation

public enum SpendDerivation {
    /// Canonical storage convention (enforced by the backend for every source,
    /// including Plaid, whose raw feed is sign-inverted): spend is negative,
    /// money-in is positive. Positive rows split three ways — income (payroll,
    /// interest), transfers, and credits/refunds that offset spending. A credit
    /// must never read as income, and must never be dropped from spend totals.
    public static func classify(
        _ transaction: Transaction,
        categories: [Category]
    ) -> SpendClassification {
        let amount = transaction.amount.value
        let magnitude = transaction.amount.magnitude
        let flags = transaction.flags ?? [:]

        guard amount != 0 else { return .ignored }

        if flags["transfer"]?.boolValue == true {
            return .transfer(magnitude)
        }
        if flags["refund"]?.boolValue == true, amount > 0 {
            return .refund(magnitude)
        }

        // Plaid's personal-finance-category rides along in flags and is the
        // strongest signal for rows the household never categorized.
        if let pfcPrimary = plaidPrimaryCategory(flags) {
            if pfcPrimary == "TRANSFER_IN" || pfcPrimary == "TRANSFER_OUT" {
                return .transfer(magnitude)
            }
            if pfcPrimary == "INCOME", amount > 0 {
                return .income(magnitude)
            }
        }

        let categoriesByID = Dictionary(uniqueKeysWithValues: categories.map { ($0.id, $0) })
        let topCategory = topCategory(for: transaction.categoryId, categoriesByID: categoriesByID)

        if isTransfer(topCategory) {
            return .transfer(magnitude)
        }
        if amount > 0 {
            if isIncome(topCategory) || looksLikeIncome(merchant: transaction.merchant) {
                return .income(magnitude)
            }
            // Any other positive row is money returned against spending —
            // a card credit, reimbursement, or refund without the flag set.
            return .refund(magnitude)
        }
        if !isIncome(topCategory) {
            return .spend(magnitude)
        }
        return .ignored
    }

    private static func plaidPrimaryCategory(_ flags: [String: JSONValue]) -> String? {
        guard case let .object(pfc)? = flags["plaid_pfc"],
              case let .string(primary)? = pfc["primary"] else { return nil }
        return primary.uppercased()
    }

    /// Merchant-text fallback for uncategorized deposits so a paycheck without
    /// a category or Plaid taxonomy doesn't get netted against spending.
    private static func looksLikeIncome(merchant: String?) -> Bool {
        guard let merchant else { return false }
        let text = merchant.lowercased()
        return ["payroll", "salary", "direct deposit", "direct dep", "paycheck", "dividend", "interest payment"]
            .contains { text.contains($0) }
    }

    public static func period(
        containing date: Date,
        now: Date = .now,
        calendar: Calendar = .current
    ) -> SpendPeriod {
        // API date-only values decode at UTC midnight, so month windows must
        // use that same canonical domain regardless of the display timezone.
        var canonicalCalendar = calendar
        canonicalCalendar.timeZone = TimeZone(secondsFromGMT: 0)!

        let selectedMonth = canonicalCalendar.dateInterval(of: .month, for: date)!
        let previousMonthDate = canonicalCalendar.date(byAdding: .month, value: -1, to: selectedMonth.start)!
        let previousMonth = canonicalCalendar.dateInterval(of: .month, for: previousMonthDate)!
        let previousInclusiveEnd = previousMonth.end.addingTimeInterval(-1)
        let isCurrentMonth = canonicalCalendar.isDate(selectedMonth.start, equalTo: now, toGranularity: .month)

        let currentEnd: Date
        let previousEnd: Date
        if isCurrentMonth {
            currentEnd = now
            let comparableEnd = canonicalCalendar.date(byAdding: .month, value: -1, to: now)!
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

    public static func overview(
        transactions: [Transaction],
        categories: [Category],
        period: SpendPeriod
    ) -> SpendOverview {
        let moneyDomain = historicalMoneyDomain(
            transactions,
            categories: categories,
            windows: [period.current, period.previous]
        )
        let current = spendEntries(
            transactions,
            categories: categories,
            window: period.current,
            moneyDomain: moneyDomain
        )
        let previous = spendEntries(
            transactions,
            categories: categories,
            window: period.previous,
            moneyDomain: moneyDomain
        )
        let total = current.reduce(Decimal.zero) { $0 + $1.contribution }
        let previousTotal = previous.reduce(Decimal.zero) { $0 + $1.contribution }
        let cumulativeDaily = cumulativeDaily(entries: current, window: period.current)
        let elapsedDays = cumulativeDaily.count
        let dailyPace = elapsedDays > 0
            ? Money(total / Decimal(elapsedDays))
            : Money()
        let categoryRows = categoryRows(
            transactions: transactions,
            categories: categories,
            period: period
        )
        let merchantRows = merchantRows(
            transactions: transactions,
            categories: categories,
            period: period
        )

        return SpendOverview(
            total: Money(total),
            previousTotal: Money(previousTotal),
            transactionCount: spendTransactionCount(
                transactions,
                categories: categories,
                window: period.current
            ),
            dailyPace: dailyPace,
            cumulativeDaily: cumulativeDaily,
            categories: categoryRows,
            merchants: merchantRows,
            insight: insight(
                categories: categoryRows,
                merchants: merchantRows,
                current: current,
                hasPriorEvidence: !previous.isEmpty,
                total: total,
                previousTotal: previousTotal
            )
        )
    }

    public static func categoryRows(
        transactions: [Transaction],
        categories: [Category],
        period: SpendPeriod
    ) -> [CategorySpendRow] {
        let categoriesByID = Dictionary(uniqueKeysWithValues: categories.map { ($0.id, $0) })
        let moneyDomain = historicalMoneyDomain(
            transactions,
            categories: categories,
            windows: [period.current, period.previous]
        )
        let current = spendEntries(
            transactions,
            categories: categories,
            window: period.current,
            moneyDomain: moneyDomain
        )
        let previous = spendEntries(
            transactions,
            categories: categories,
            window: period.previous,
            moneyDomain: moneyDomain
        )
        let currentTotal = current.reduce(Decimal.zero) { $0 + $1.contribution }
        var aggregates: [UUID: CategoryAggregate] = [:]

        for entry in current {
            guard let category = topCategory(
                for: entry.transaction.categoryId,
                categoriesByID: categoriesByID
            ) else { continue }
            var aggregate = aggregates[category.id] ?? CategoryAggregate(category: category)
            aggregate.current += entry.contribution
            aggregate.count += 1
            aggregates[category.id] = aggregate
        }

        for entry in previous {
            guard let category = topCategory(
                for: entry.transaction.categoryId,
                categoriesByID: categoriesByID
            ) else { continue }
            var aggregate = aggregates[category.id] ?? CategoryAggregate(category: category)
            aggregate.previous += entry.contribution
            aggregates[category.id] = aggregate
        }

        return aggregates.values.map { aggregate in
            CategorySpendRow(
                id: aggregate.category.id,
                name: aggregate.category.name,
                total: Money(aggregate.current),
                previous: Money(aggregate.previous),
                delta: Money(aggregate.current - aggregate.previous),
                share: currentTotal > 0
                    ? NSDecimalNumber(decimal: aggregate.current / currentTotal).doubleValue
                    : 0,
                count: aggregate.count
            )
        }.sorted(by: categoryRowPrecedes)
    }

    public static func merchantRows(
        transactions: [Transaction],
        categories: [Category],
        period: SpendPeriod,
        recurringMerchantKeys: Set<String> = []
    ) -> [MerchantSpendRow] {
        let categoriesByID = Dictionary(uniqueKeysWithValues: categories.map { ($0.id, $0) })
        let moneyDomain = historicalMoneyDomain(
            transactions,
            categories: categories,
            windows: [period.current, period.previous]
        )
        let current = spendEntries(
            transactions,
            categories: categories,
            window: period.current,
            moneyDomain: moneyDomain
        )
        let previous = spendEntries(
            transactions,
            categories: categories,
            window: period.previous,
            moneyDomain: moneyDomain
        )
        var aggregates: [String: MerchantAggregate] = [:]

        for entry in current {
            let key = merchantKey(entry.transaction.merchant)
            guard !key.isEmpty else { continue }
            var aggregate = aggregates[key] ?? MerchantAggregate()
            aggregate.current += entry.contribution
            aggregate.count += 1
            aggregate.hasCanonicalAssociation = aggregate.hasCanonicalAssociation
                || entry.transaction.recurringSeriesId != nil
            addMerchantName(entry.transaction.merchant, to: &aggregate.names)
            if let category = topCategory(
                for: entry.transaction.categoryId,
                categoriesByID: categoriesByID
            ) {
                aggregate.categoryTotals[category.id, default: 0] += entry.contribution
            }
            aggregates[key] = aggregate
        }

        for entry in previous {
            let key = merchantKey(entry.transaction.merchant)
            guard !key.isEmpty else { continue }
            var aggregate = aggregates[key] ?? MerchantAggregate()
            aggregate.previous += entry.contribution
            aggregate.hasCanonicalAssociation = aggregate.hasCanonicalAssociation
                || entry.transaction.recurringSeriesId != nil
            addMerchantName(entry.transaction.merchant, to: &aggregate.names)
            aggregates[key] = aggregate
        }

        let suppliedRecurringKeys = Set(
            recurringMerchantKeys.map(merchantKey).filter { !$0.isEmpty }
        )
        let inferredRecurringKeys = Set(
            inferredRecurringRows(transactions: transactions, categories: categories)
                .compactMap(\.merchantKey)
        )

        return aggregates.map { key, aggregate in
            let topCategory = aggregate.categoryTotals
                .sorted { left, right in
                    if left.value != right.value { return left.value > right.value }
                    let leftName = normalized(categoriesByID[left.key]?.name ?? "")
                    let rightName = normalized(categoriesByID[right.key]?.name ?? "")
                    if leftName != rightName { return leftName < rightName }
                    return left.key.uuidString < right.key.uuidString
                }
                .first
                .flatMap { categoriesByID[$0.key]?.name }

            return MerchantSpendRow(
                id: key,
                name: aggregate.names.sorted().first ?? key,
                total: Money(aggregate.current),
                previous: Money(aggregate.previous),
                delta: Money(aggregate.current - aggregate.previous),
                count: aggregate.count,
                topCategory: topCategory,
                isRecurring: aggregate.hasCanonicalAssociation
                    || suppliedRecurringKeys.contains(key)
                    || inferredRecurringKeys.contains(key)
            )
        }.sorted(by: merchantRowPrecedes)
    }

    public static func itemRows(
        transactions: [Transaction],
        categories: [Category],
        period: SpendPeriod
    ) -> [ItemSpendRow] {
        let moneyDomain = historicalMoneyDomain(
            transactions,
            categories: categories,
            windows: [period.current]
        )
        let entries = spendEntries(
            transactions,
            categories: categories,
            window: period.current,
            moneyDomain: moneyDomain
        )
        var aggregates: [String: ItemAggregate] = [:]

        for entry in entries {
            let sign = entry.contribution < 0 ? Decimal(-1) : Decimal(1)
            let amountScale = baseAmountScale(for: entry.transaction)
            for item in entry.transaction.lineItems {
                let key = normalized(item.name)
                guard !key.isEmpty else { continue }
                var aggregate = aggregates[key] ?? ItemAggregate()
                aggregate.names.insert(item.name.trimmingCharacters(in: .whitespacesAndNewlines))
                aggregate.total += abs(item.amount.value) * amountScale * sign
                if let quantity = item.quantity {
                    aggregate.quantity = (aggregate.quantity ?? 0) + abs(quantity.value) * sign
                }
                aggregates[key] = aggregate
            }
        }

        return aggregates.map { key, aggregate in
            ItemSpendRow(
                name: aggregate.names.sorted().first ?? key,
                total: Money(aggregate.total),
                quantity: aggregate.quantity.map(Money.init)
            )
        }.sorted { left, right in
            if left.total.value != right.total.value { return left.total.value > right.total.value }
            return left.id < right.id
        }
    }

    public static func recurringRows(
        transactions: [Transaction],
        categories: [Category],
        canonical: [RecurringSeries]
    ) -> [RecurringSpendRow] {
        var referencedMerchantKeys: [UUID: Set<String>] = [:]
        for transaction in transactions {
            guard let seriesID = transaction.recurringSeriesId else { continue }
            let key = merchantKey(transaction.merchant)
            guard !key.isEmpty else { continue }
            referencedMerchantKeys[seriesID, default: []].insert(key)
        }

        let canonicalEntries = canonical.compactMap { series -> CanonicalRecurringEntry? in
            let status = normalized(series.status)
            let type = normalized(series.type)
            guard status == "active", type != "income", type != "transfer" else { return nil }
            let explicitKey = series.merchantName.map(merchantKey).flatMap { $0.isEmpty ? nil : $0 }
            var suppressionKeys = referencedMerchantKeys[series.id] ?? []
            if let explicitKey {
                suppressionKeys.insert(explicitKey)
            }
            return CanonicalRecurringEntry(
                row: RecurringSpendRow(
                    id: "canonical:\(series.id.uuidString.lowercased())",
                    name: series.name,
                    amount: series.amount ?? Money(),
                    currency: series.currency,
                    cadence: series.cadence,
                    nextDueDate: series.nextDueDate,
                    merchantKey: explicitKey ?? suppressionKeys.sorted().first,
                    source: .canonical,
                    seriesId: series.id
                ),
                suppressionKeys: suppressionKeys
            )
        }
        let canonicalRows = canonicalEntries.map(\.row).sorted(by: recurringRowPrecedes)
        let canonicalMerchantKeys = Set(canonicalEntries.flatMap(\.suppressionKeys))
        let inferredRows = inferredRecurringRows(transactions: transactions, categories: categories)
            .filter { row in
                guard let key = row.merchantKey else { return true }
                return !canonicalMerchantKeys.contains(key)
            }
            .sorted(by: recurringRowPrecedes)

        return canonicalRows + inferredRows
    }

    public static func recurringMonthlyTotal(
        _ rows: [RecurringSpendRow],
        currency: String
    ) -> Money {
        let currencyKey = normalized(currency)
        return Money(rows.reduce(Decimal.zero) { total, row in
            guard normalized(row.currency) == currencyKey, let monthly = row.monthlyAmount else {
                return total
            }
            return total + monthly.value
        })
    }

    public static func splitIsBalanced(source: Money, parts: [Money]) -> Bool {
        parts.count >= 2 && parts.reduce(Decimal.zero) { $0 + $1.value } == source.value
    }

    public static func mergeIsEligible(_ transactionIDs: [UUID]) -> Bool {
        Set(transactionIDs).count >= 2
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
        return normalized(category.kind) == "income"
            || ["income", "salary", "payroll", "wages", "earnings"].contains(normalized(category.name))
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

    private static func spendEntries(
        _ transactions: [Transaction],
        categories: [Category],
        window: DateWindow,
        moneyDomain: HistoricalMoneyDomain
    ) -> [SpendEntry] {
        transactions.compactMap { transaction in
            guard window.start...window.end ~= transaction.txnDate else { return nil }
            switch classify(transaction, categories: categories) {
            case .spend(let amount):
                guard let contribution = moneyDomain.magnitude(
                    for: transaction,
                    classifiedMagnitude: amount
                ) else { return nil }
                return SpendEntry(transaction: transaction, contribution: contribution)
            case .refund(let amount):
                guard let contribution = moneyDomain.magnitude(
                    for: transaction,
                    classifiedMagnitude: amount
                ) else { return nil }
                return SpendEntry(transaction: transaction, contribution: -contribution)
            case .income, .transfer, .ignored:
                return nil
            }
        }
    }

    private static func historicalMoneyDomain(
        _ transactions: [Transaction],
        categories: [Category],
        windows: [DateWindow]
    ) -> HistoricalMoneyDomain {
        let relevant = transactions.filter { transaction in
            guard windows.contains(where: { $0.start...$0.end ~= transaction.txnDate }) else {
                return false
            }
            switch classify(transaction, categories: categories) {
            case .spend, .refund:
                return true
            case .income, .transfer, .ignored:
                return false
            }
        }
        let based = relevant.filter { $0.baseAmount != nil }
        let unbasedCurrencies = Set(
            relevant
                .filter { $0.baseAmount == nil }
                .map { normalized($0.currency) }
        )

        // A native currency is a safe base-domain fallback only when the
        // dataset is wholly legacy and single-currency, or a base-backed row
        // proves a 1:1 native/base rate. Conflicting evidence disables fallback.
        let inferredBaseCurrencies = Set(based.compactMap { transaction -> String? in
            guard let baseMagnitude = transaction.baseAmount?.magnitude.value else { return nil }
            let nativeMagnitude = transaction.amount.magnitude.value
            let hasBaseRate = baseMagnitude == nativeMagnitude
                || transaction.fxRate?.magnitude.value == 1
            return hasBaseRate ? normalized(transaction.currency) : nil
        })

        let fallbackCurrency: String?
        if based.isEmpty, unbasedCurrencies.count == 1 {
            fallbackCurrency = unbasedCurrencies.first
        } else if inferredBaseCurrencies.count == 1 {
            fallbackCurrency = inferredBaseCurrencies.first
        } else {
            fallbackCurrency = nil
        }
        return HistoricalMoneyDomain(nativeFallbackCurrency: fallbackCurrency)
    }

    private static func spendTransactionCount(
        _ transactions: [Transaction],
        categories: [Category],
        window: DateWindow
    ) -> Int {
        transactions.reduce(into: 0) { count, transaction in
            guard window.start...window.end ~= transaction.txnDate else { return }
            switch classify(transaction, categories: categories) {
            case .spend, .refund:
                count += 1
            case .income, .transfer, .ignored:
                break
            }
        }
    }

    private static func baseAmountScale(for transaction: Transaction) -> Decimal {
        let nativeMagnitude = transaction.amount.magnitude.value
        guard let baseMagnitude = transaction.baseAmount?.magnitude.value,
              nativeMagnitude > 0 else {
            return 1
        }
        return baseMagnitude / nativeMagnitude
    }

    private static func cumulativeDaily(entries: [SpendEntry], window: DateWindow) -> [Money] {
        let calendar = utcCalendar
        let start = calendar.startOfDay(for: window.start)
        let end = calendar.startOfDay(for: window.end)
        guard end >= start,
              let difference = calendar.dateComponents([.day], from: start, to: end).day else {
            return []
        }
        var daily = Array(repeating: Decimal.zero, count: difference + 1)
        for entry in entries {
            let transactionDay = calendar.startOfDay(for: entry.transaction.txnDate)
            guard let index = calendar.dateComponents([.day], from: start, to: transactionDay).day,
                  daily.indices.contains(index) else { continue }
            daily[index] += entry.contribution
        }

        var running = Decimal.zero
        return daily.map { value in
            running += value
            return Money(running)
        }
    }

    private static func insight(
        categories: [CategorySpendRow],
        merchants: [MerchantSpendRow],
        current: [SpendEntry],
        hasPriorEvidence: Bool,
        total: Decimal,
        previousTotal: Decimal
    ) -> SpendInsight {
        if hasPriorEvidence, let category = categories
            .filter({ $0.delta.value > 0 })
            .sorted(by: categoryInsightPrecedes)
            .first {
            return SpendInsight(
                kind: .category(category.id),
                title: "\(category.name) increased",
                detail: "This category has the largest positive comparable-period change.",
                delta: category.delta
            )
        }

        if hasPriorEvidence, let merchant = merchants
            .filter({ $0.delta.value > 0 })
            .sorted(by: merchantInsightPrecedes)
            .first {
            return SpendInsight(
                kind: .merchant(merchant.id),
                title: "\(merchant.name) increased",
                detail: "This merchant has the largest positive comparable-period change.",
                delta: merchant.delta
            )
        }

        if !hasPriorEvidence, let purchase = current
            .filter({ $0.contribution > 0 })
            .sorted(by: purchasePrecedes)
            .first {
            let amount = Money(purchase.contribution)
            return SpendInsight(
                kind: .transaction(purchase.transaction.id),
                title: "Largest purchase",
                detail: "\(purchase.transaction.displayMerchant) is the largest purchase in this period.",
                delta: amount
            )
        }

        return SpendInsight(
            kind: .pace,
            title: "Current pace",
            detail: "No positive category or merchant change stands out in this comparison.",
            delta: Money(total - previousTotal)
        )
    }

    private static func inferredRecurringRows(
        transactions: [Transaction],
        categories: [Category]
    ) -> [RecurringSpendRow] {
        let spendTransactions = transactions.filter { transaction in
            if case .spend = classify(transaction, categories: categories) {
                return !merchantKey(transaction.merchant).isEmpty
            }
            return false
        }
        let byMerchant = Dictionary(grouping: spendTransactions) { merchantKey($0.merchant) }

        return byMerchant.compactMap { key, merchantTransactions in
            let byCurrency = Dictionary(grouping: merchantTransactions) { normalized($0.currency) }
            guard let currencyGroup = byCurrency.sorted(by: currencyGroupPrecedes).first else { return nil }
            let matching = currencyGroup.value
            let monthCount = Set(matching.map(monthKey)).count
            guard monthCount >= 3, let cadence = inferredCadence(for: matching) else { return nil }

            let total = matching.reduce(Decimal.zero) { result, transaction in
                switch classify(transaction, categories: categories) {
                case .spend(let amount): return result + amount.value
                case .income, .transfer, .refund, .ignored: return result
                }
            }
            let refunds = transactions.reduce(Decimal.zero) { result, transaction in
                guard merchantKey(transaction.merchant) == key,
                      normalized(transaction.currency) == currencyGroup.key else {
                    return result
                }
                if case .refund(let amount) = classify(transaction, categories: categories) {
                    return result + amount.value
                }
                return result
            }
            let netTotal = total - refunds
            guard netTotal > 0 else { return nil }
            let amount = Money(netTotal / Decimal(matching.count))
            let names = matching.compactMap(\.merchant)
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .sorted()
            let lastDate = matching.map(\.txnDate).max()

            return RecurringSpendRow(
                id: "inferred:\(key):\(currencyGroup.key)",
                name: names.first ?? key,
                amount: amount,
                currency: matching.map(\.currency).sorted().first ?? currencyGroup.key.uppercased(),
                cadence: cadence,
                nextDueDate: lastDate.flatMap { nextDueDate(after: $0, cadence: cadence) },
                merchantKey: key,
                source: .inferred
            )
        }.sorted(by: recurringRowPrecedes)
    }

    private static func inferredCadence(for transactions: [Transaction]) -> String? {
        let dates = Array(Set(transactions.map(\.txnDate))).sorted()
        let gaps = zip(dates, dates.dropFirst())
            .map { earlier, later in later.timeIntervalSince(earlier) / 86_400 }
            .filter { $0 > 0 }
            .sorted()
        guard !gaps.isEmpty else { return nil }
        let middle = gaps.count / 2
        let median = gaps.count.isMultiple(of: 2)
            ? (gaps[middle - 1] + gaps[middle]) / 2
            : gaps[middle]
        let candidates: [(String, Double)] = [
            ("weekly", 7),
            ("biweekly", 14),
            ("monthly", 30),
            ("quarterly", 91),
            ("yearly", 365),
        ]
        return candidates.first { _, nominal in
            abs(median - nominal) <= nominal * 0.35
        }?.0
    }

    private static func nextDueDate(after date: Date, cadence: String) -> Date? {
        let calendar = utcCalendar
        switch cadence {
        case "weekly":
            return calendar.date(byAdding: .day, value: 7, to: date)
        case "biweekly":
            return calendar.date(byAdding: .day, value: 14, to: date)
        case "monthly":
            return calendar.date(byAdding: .month, value: 1, to: date)
        case "quarterly":
            return calendar.date(byAdding: .month, value: 3, to: date)
        case "yearly", "annual":
            return calendar.date(byAdding: .year, value: 1, to: date)
        default:
            return nil
        }
    }

    private static func monthKey(_ transaction: Transaction) -> String {
        let components = utcCalendar.dateComponents([.year, .month], from: transaction.txnDate)
        return "\(components.year ?? 0)-\(components.month ?? 0)"
    }

    private static func addMerchantName(_ merchant: String?, to names: inout Set<String>) {
        guard let name = merchant?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else {
            return
        }
        names.insert(name)
    }

    private static func categoryRowPrecedes(_ left: CategorySpendRow, _ right: CategorySpendRow) -> Bool {
        if left.total.value != right.total.value { return left.total.value > right.total.value }
        let leftName = normalized(left.name)
        let rightName = normalized(right.name)
        if leftName != rightName { return leftName < rightName }
        return left.id.uuidString < right.id.uuidString
    }

    private static func merchantRowPrecedes(_ left: MerchantSpendRow, _ right: MerchantSpendRow) -> Bool {
        if left.total.value != right.total.value { return left.total.value > right.total.value }
        return left.id < right.id
    }

    private static func categoryInsightPrecedes(_ left: CategorySpendRow, _ right: CategorySpendRow) -> Bool {
        if left.delta.value != right.delta.value { return left.delta.value > right.delta.value }
        return categoryRowPrecedes(left, right)
    }

    private static func merchantInsightPrecedes(_ left: MerchantSpendRow, _ right: MerchantSpendRow) -> Bool {
        if left.delta.value != right.delta.value { return left.delta.value > right.delta.value }
        return merchantRowPrecedes(left, right)
    }

    private static func purchasePrecedes(_ left: SpendEntry, _ right: SpendEntry) -> Bool {
        if left.contribution != right.contribution { return left.contribution > right.contribution }
        if left.transaction.txnDate != right.transaction.txnDate {
            return left.transaction.txnDate > right.transaction.txnDate
        }
        if left.transaction.createdAt != right.transaction.createdAt {
            return left.transaction.createdAt > right.transaction.createdAt
        }
        return left.transaction.id.uuidString < right.transaction.id.uuidString
    }

    private static func recurringRowPrecedes(_ left: RecurringSpendRow, _ right: RecurringSpendRow) -> Bool {
        let leftName = normalized(left.name)
        let rightName = normalized(right.name)
        if leftName != rightName { return leftName < rightName }
        return left.id < right.id
    }

    private static func currencyGroupPrecedes(
        _ left: (key: String, value: [Transaction]),
        _ right: (key: String, value: [Transaction])
    ) -> Bool {
        if left.value.count != right.value.count { return left.value.count > right.value.count }
        return left.key < right.key
    }

    private static var utcCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }

    private struct SpendEntry {
        let transaction: Transaction
        let contribution: Decimal
    }

    private struct HistoricalMoneyDomain {
        let nativeFallbackCurrency: String?

        func magnitude(
            for transaction: Transaction,
            classifiedMagnitude: Money
        ) -> Decimal? {
            if let baseAmount = transaction.baseAmount {
                return baseAmount.magnitude.value
            }
            let currency = transaction.currency
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()
            guard currency == nativeFallbackCurrency else { return nil }
            return classifiedMagnitude.value
        }
    }

    private struct CategoryAggregate {
        let category: Category
        var current = Decimal.zero
        var previous = Decimal.zero
        var count = 0
    }

    private struct MerchantAggregate {
        var names = Set<String>()
        var current = Decimal.zero
        var previous = Decimal.zero
        var count = 0
        var categoryTotals: [UUID: Decimal] = [:]
        var hasCanonicalAssociation = false
    }

    private struct ItemAggregate {
        var names = Set<String>()
        var total = Decimal.zero
        var quantity: Decimal?
    }

    private struct CanonicalRecurringEntry {
        let row: RecurringSpendRow
        let suppressionKeys: Set<String>
    }
}
