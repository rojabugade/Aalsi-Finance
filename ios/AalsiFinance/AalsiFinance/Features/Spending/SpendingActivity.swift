import SwiftUI
import AalsiFinanceKit

struct SpendingActivity: View {
    let snapshot: SpendingSnapshot
    let period: SpendPeriod
    let filter: SpendFilter
    var currency: String = "USD"
    var isSelecting = false
    var selectedTransactionIDs: Set<UUID> = []
    let onFilterChange: (SpendFilter) -> Void
    let onToggleSelection: (UUID) -> Void
    let onRoute: (SpendingRoute) -> Void
    var onConfirm: ((AalsiFinanceKit.Transaction) -> Void)?

    @State private var showsFilters = false

    var body: some View {
        LazyVStack(spacing: 14) {
            ActivityMonthSummary(
                period: period,
                count: rows.count,
                net: ledgerTotal,
                currency: currency
            )

            SpendFilterBar(
                filter: filter,
                categories: snapshot.categories,
                onOpen: { showsFilters = true },
                onRemove: onFilterChange
            )

            if snapshot.transactions.isEmpty {
                dataEmptyState
            } else if unfilteredPeriodRows.isEmpty {
                periodEmptyState
            } else if rows.isEmpty {
                noMatchesState
            } else {
                SpendRankedPreview(
                    title: "Categories",
                    categories: Array(rankedCategoryRows.prefix(3)),
                    currency: currency,
                    onSelect: { onRoute(.category($0)) }
                )

                SpendRankedPreview(
                    title: "Merchants",
                    merchants: Array(rankedMerchantRows.prefix(3)),
                    currency: currency,
                    onSelect: { onRoute(.merchant($0)) }
                )

                ForEach(daySections) { section in
                    DayTransactionSection(
                        section: section,
                        categoryPath: { snapshot.categoryPath(for: $0.categoryId) },
                        isSelecting: isSelecting,
                        selectedTransactionIDs: selectedTransactionIDs,
                        onSelect: { transaction in
                            if isSelecting {
                                onToggleSelection(transaction.id)
                            } else {
                                onRoute(.transaction(transaction.id))
                            }
                        },
                        onConfirm: onConfirm
                    )
                }
            }
        }
        .padding(.horizontal, 20)
        .sheet(isPresented: $showsFilters) {
            SpendFilterSheet(
                filter: filter,
                categories: snapshot.categories,
                onApply: onFilterChange
            )
        }
    }

    private var rows: [AalsiFinanceKit.Transaction] {
        snapshot.filteredTransactions(period: period, filter: filter)
    }

    private var unfilteredPeriodRows: [AalsiFinanceKit.Transaction] {
        snapshot.filteredTransactions(period: period, filter: SpendFilter())
    }

    /// Apply the same filter over both comparison windows before asking the
    /// canonical derivations to compute current/prior rankings and deltas.
    private var filteredComparableTransactions: [AalsiFinanceKit.Transaction] {
        let comparisonPeriod = SpendPeriod(
            monthStart: period.previous.start,
            current: DateWindow(start: period.previous.start, end: period.current.end),
            previous: period.previous,
            isCurrentMonth: false
        )
        return snapshot.filteredTransactions(period: comparisonPeriod, filter: filter)
    }

    private var rankedCategoryRows: [CategorySpendRow] {
        SpendDerivation.categoryRows(
            transactions: filteredComparableTransactions,
            categories: snapshot.categories,
            period: period
        )
    }

    private var rankedMerchantRows: [MerchantSpendRow] {
        SpendDerivation.merchantRows(
            transactions: filteredComparableTransactions,
            categories: snapshot.categories,
            period: period,
            recurringMerchantKeys: Set(snapshot.recurringRows.compactMap(\.merchantKey))
        )
    }

    private var daySections: [SpendDaySection] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let grouped = Dictionary(grouping: rows) { calendar.startOfDay(for: $0.txnDate) }
        return grouped
            .map { day, transactions in
                SpendDaySection(
                    day: day,
                    transactions: transactions.sorted {
                        if $0.txnDate != $1.txnDate { return $0.txnDate > $1.txnDate }
                        return $0.createdAt > $1.createdAt
                    }
                )
            }
            .sorted { $0.day > $1.day }
    }

    /// Activity can include native and base-backed rows. The caller supplies
    /// the household/base currency; unmatched unbased rows are omitted rather
    /// than combined into a false mixed-currency total.
    private var ledgerTotal: Money {
        Money(rows.reduce(Decimal.zero) { total, transaction in
            if let baseAmount = transaction.baseAmount {
                return total + baseAmount.value
            }
            guard transaction.currency.caseInsensitiveCompare(currency) == .orderedSame else {
                return total
            }
            return total + transaction.amount.value
        })
    }

    private var dataEmptyState: some View {
        ContentUnavailableView {
            Label("No transactions yet", systemImage: "tray")
        } description: {
            Text("Plaid activity, receipt imports, and manual entries will appear here.")
        }
        .frame(maxWidth: .infinity)
        .card()
    }

    private var noMatchesState: some View {
        ContentUnavailableView {
            Label("No matches", systemImage: "line.3.horizontal.decrease.circle")
        } description: {
            Text("No transactions match the active filters for this month.")
        } actions: {
            Button("Clear Filters") {
                onFilterChange(SpendFilter())
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity)
        .card()
    }

    private var periodEmptyState: some View {
        ContentUnavailableView {
            Label("No activity this month", systemImage: "calendar")
        } description: {
            Text("There are transactions in other periods, but none in this selected month.")
        }
        .frame(maxWidth: .infinity)
        .card()
    }
}

struct ActivityMonthSummary: View {
    let period: SpendPeriod
    let count: Int
    let net: Money
    let currency: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(monthTitle)
                    .font(.headline)
                Text("\(count) \(count == 1 ? "transaction" : "transactions")")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 4) {
                Text("Net activity")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                MoneyText(amount: net, code: currency, font: .headline)
            }
        }
        .card()
    }

    private var monthTitle: String {
        var format = Date.FormatStyle().month(.wide).year()
        format.timeZone = TimeZone(secondsFromGMT: 0)!
        return period.monthStart.formatted(format)
    }
}

struct SpendDaySection: Identifiable {
    let day: Date
    let transactions: [AalsiFinanceKit.Transaction]
    var id: Date { day }
}

struct DayTransactionSection: View {
    let section: SpendDaySection
    let categoryPath: (AalsiFinanceKit.Transaction) -> AalsiFinanceKit.CategoryPath
    let isSelecting: Bool
    let selectedTransactionIDs: Set<UUID>
    let onSelect: (AalsiFinanceKit.Transaction) -> Void
    let onConfirm: ((AalsiFinanceKit.Transaction) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(dayTitle)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 4)

            VStack(spacing: 0) {
                ForEach(Array(section.transactions.enumerated()), id: \.element.id) { index, transaction in
                    if index > 0 {
                        Divider()
                    }

                    HStack(spacing: 8) {
                        Button {
                            onSelect(transaction)
                        } label: {
                            TransactionRow(
                                transaction: transaction,
                                categoryPath: categoryPath(transaction),
                                showsSelection: isSelecting,
                                isSelected: selectedTransactionIDs.contains(transaction.id)
                            )
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)

                        if !isSelecting, transaction.isDraft, let onConfirm {
                            Button {
                                onConfirm(transaction)
                            } label: {
                                Image(systemName: "checkmark.circle.fill")
                                    .frame(width: 44, height: 44)
                            }
                            .foregroundStyle(.green)
                            .accessibilityLabel("Confirm \(transaction.displayMerchant)")
                        }
                    }
                }
            }
            .card()
        }
    }

    private var dayTitle: String {
        var format = Date.FormatStyle()
            .weekday(.wide)
            .month(.abbreviated)
            .day()
        format.timeZone = TimeZone(secondsFromGMT: 0)!
        return section.day.formatted(format)
    }
}

private enum SpendingActivityPreviewFixtures {
    static let foodID = UUID(uuidString: "33333333-3333-3333-3333-333333333333")!
    static let diningID = UUID(uuidString: "44444444-4444-4444-4444-444444444444")!

    static let categories = [
        AalsiFinanceKit.Category(id: foodID, parentId: nil, name: "Food", kind: "category", isSystem: true),
        AalsiFinanceKit.Category(id: diningID, parentId: foodID, name: "Dining", kind: "category", isSystem: true)
    ]

    static let transactions: [AalsiFinanceKit.Transaction] = {
        let json = #"""
        [
          {"id":"11111111-1111-1111-1111-111111111111","household_id":"22222222-2222-2222-2222-222222222222","account_id":null,"payment_method_id":null,"recurring_series_id":null,"owner_user_id":null,"merchant_id":null,"merchant":"Corner Cafe","amount":"-24.50","currency":"USD","base_amount":null,"fx_rate":null,"txn_date":"2026-07-12","category_id":"44444444-4444-4444-4444-444444444444","status":"draft","source_document_id":null,"source_channel":"manual","is_shared":false,"flags":null,"notes":"Lunch","confidence":null,"external_id":null,"created_at":"2026-07-12T13:00:00Z","line_items":[]},
          {"id":"55555555-5555-5555-5555-555555555555","household_id":"22222222-2222-2222-2222-222222222222","account_id":null,"payment_method_id":null,"recurring_series_id":null,"owner_user_id":null,"merchant_id":null,"merchant":"Market","amount":"-82.10","currency":"USD","base_amount":null,"fx_rate":null,"txn_date":"2026-07-11","category_id":"33333333-3333-3333-3333-333333333333","status":"confirmed","source_document_id":null,"source_channel":"plaid","is_shared":false,"flags":null,"notes":null,"confidence":null,"external_id":null,"created_at":"2026-07-11T18:30:00Z","line_items":[]}
        ]
        """#
        return try! JSONDecoder.api().decode([AalsiFinanceKit.Transaction].self, from: Data(json.utf8))
    }()

    static let snapshot = SpendingSnapshot(
        transactions: transactions,
        categories: categories,
        canonicalRecurring: []
    )

    static let period = SpendDerivation.period(
        containing: APIDateParser.parse("2026-07-12")!,
        now: APIDateParser.parse("2026-07-12T18:00:00Z")!
    )
}

#Preview("Activity Light") {
    ScrollView {
        SpendingActivity(
            snapshot: SpendingActivityPreviewFixtures.snapshot,
            period: SpendingActivityPreviewFixtures.period,
            filter: SpendFilter(),
            onFilterChange: { _ in },
            onToggleSelection: { _ in },
            onRoute: { _ in }
        )
        .padding(.vertical, 20)
    }
    .background(Color(.systemGroupedBackground))
    .environment(AppTheme())
    .preferredColorScheme(.light)
}

#Preview("Activity Dark") {
    ScrollView {
        SpendingActivity(
            snapshot: SpendingActivityPreviewFixtures.snapshot,
            period: SpendingActivityPreviewFixtures.period,
            filter: SpendFilter(),
            isSelecting: true,
            selectedTransactionIDs: [SpendingActivityPreviewFixtures.transactions[0].id],
            onFilterChange: { _ in },
            onToggleSelection: { _ in },
            onRoute: { _ in }
        )
        .padding(.vertical, 20)
    }
    .background(Color(.systemGroupedBackground))
    .environment(AppTheme())
    .preferredColorScheme(.dark)
}

#Preview("Activity No Matches") {
    ScrollView {
        SpendingActivity(
            snapshot: SpendingActivityPreviewFixtures.snapshot,
            period: SpendingActivityPreviewFixtures.period,
            filter: SpendFilter(query: "No such merchant"),
            onFilterChange: { _ in },
            onToggleSelection: { _ in },
            onRoute: { _ in }
        )
        .padding(.vertical, 20)
    }
    .background(Color(.systemGroupedBackground))
    .environment(AppTheme())
    .preferredColorScheme(.light)
}
