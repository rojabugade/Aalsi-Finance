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
    var onBeginSelection: (() -> Void)?
    var onEndSelection: (() -> Void)?

    @State private var showsFilters = false
    @State private var breakdownDimension = 0

    var body: some View {
        LazyVStack(spacing: 14) {
            toolbar

            if snapshot.transactions.isEmpty {
                dataEmptyState
            } else if unfilteredPeriodRows.isEmpty {
                periodEmptyState
            } else if rows.isEmpty {
                noMatchesState
            } else {
                summaryCard

                ForEach(daySections) { section in
                    DayTransactionSection(
                        section: section,
                        categoryPath: { snapshot.categoryPath(for: $0.categoryId) },
                        classify: { SpendDerivation.classify($0, categories: snapshot.categories) },
                        daySpent: daySpentTotal(section),
                        currency: currency,
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

    /// Single control row. Browsing: filter chip left; Select and Export fold
    /// into one overflow menu on the right so the row carries two controls,
    /// not three. Selecting: Cancel replaces the filter chip on the left —
    /// entry and exit live in the same corner — with the live count on the
    /// right.
    private var toolbar: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                if isSelecting {
                    Button("Cancel") {
                        onEndSelection?()
                    }
                    .font(.subheadline.weight(.medium))
                    .buttonStyle(.glass)
                    .accessibilityHint("Exits selection mode")

                    Spacer()

                    Text("\(selectedTransactionIDs.count) selected")
                        .font(.subheadline.weight(.semibold))
                        .contentTransition(.numericText())
                        .animation(.snappy(duration: 0.2), value: selectedTransactionIDs.count)
                } else {
                    Button {
                        showsFilters = true
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: filter.activeCount == 0
                                ? "line.3.horizontal.decrease.circle"
                                : "line.3.horizontal.decrease.circle.fill")
                            Text(filter.activeCount == 0 ? "Filters" : "Filters · \(filter.activeCount)")
                        }
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 12)
                        .frame(minHeight: 36)
                        .foregroundStyle(filter.activeCount == 0 ? AnyShapeStyle(.primary) : AnyShapeStyle(.tint))
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.interactive(), in: .capsule)
                    .accessibilityLabel(filter.activeCount == 0 ? "Filters" : "Filters, \(filter.activeCount) active")
                    .accessibilityHint("Opens spending filters")

                    Spacer()

                    if !rows.isEmpty {
                        Menu {
                            if let onBeginSelection {
                                Button {
                                    onBeginSelection()
                                } label: {
                                    Label("Select Transactions", systemImage: "checkmark.circle")
                                }
                            }
                            ShareLink(
                                item: csvExport,
                                preview: SharePreview(csvExport.fileName)
                            ) {
                                Label("Export CSV", systemImage: "square.and.arrow.up")
                            }
                        } label: {
                            Image(systemName: "ellipsis")
                                .font(.subheadline.weight(.semibold))
                                .frame(width: 36, height: 36)
                                .foregroundStyle(.primary)
                        }
                        .glassEffect(.regular.interactive(), in: .circle)
                        .accessibilityLabel("More actions")
                        .accessibilityHint("Select transactions or export \(rows.count) filtered transactions as CSV")
                    }
                }
            }

            ActiveSpendFilters(
                filter: filter,
                categories: snapshot.categories,
                onRemove: onFilterChange
            )
        }
        .padding(.horizontal, 4)
    }

    /// One glanceable card for the month: spent / received / count up top,
    /// then the top-4 breakdown as a proportion bar with a tappable legend.
    /// Spend and income stay separate — a single "net" figure conflated
    /// paychecks with purchases and contradicted the Overview total. Spend is
    /// net of refunds so a returned purchase doesn't double-count. While
    /// selecting, the breakdown hides to keep the list in focus.
    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    MoneyText(amount: spentTotal, code: currency, font: .title3.weight(.semibold))
                    Text("spent · \(rows.count) \(rows.count == 1 ? "transaction" : "transactions")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                if incomeTotal.value > 0 {
                    VStack(alignment: .trailing, spacing: 2) {
                        MoneyText(amount: incomeTotal, code: currency, font: .subheadline.weight(.semibold))
                            .foregroundStyle(.green)
                        Text("received")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if !isSelecting {
                breakdown
            }
        }
        .card()
    }

    @ViewBuilder
    private var breakdown: some View {
        let entries = breakdownDimension == 0 ? categoryEntries : merchantEntries

        VStack(alignment: .leading, spacing: 10) {
            Menu {
                Picker("Breakdown", selection: $breakdownDimension) {
                    Text("Top categories").tag(0)
                    Text("Top merchants").tag(1)
                }
            } label: {
                HStack(spacing: 4) {
                    Text(breakdownDimension == 0 ? "Top categories" : "Top merchants")
                        .font(.footnote.weight(.semibold))
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption2.weight(.semibold))
                }
                .foregroundStyle(.secondary)
                .frame(minHeight: 28)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Breakdown by \(breakdownDimension == 0 ? "categories" : "merchants")")
            .accessibilityHint("Switches between categories and merchants")

            if entries.isEmpty {
                Text(breakdownDimension == 0
                    ? "No categorized spending this month."
                    : "No merchants to rank this month.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ProportionBar(segments: entries.map { ($0.id, $0.share, $0.color) })
                    .accessibilityHidden(true)

                LazyVGrid(
                    columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
                    alignment: .leading,
                    spacing: 0
                ) {
                    ForEach(entries) { entry in
                        Button {
                            onRoute(entry.route)
                        } label: {
                            // Name and amount stack instead of sharing one
                            // line so long category names never truncate
                            // against the figure.
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 7) {
                                    Circle()
                                        .fill(entry.color)
                                        .frame(width: 8, height: 8)
                                    Text(entry.name)
                                        .font(.footnote.weight(.medium))
                                        .foregroundStyle(.primary)
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.85)
                                }
                                MoneyText(amount: entry.total, code: currency, font: .footnote)
                                    .foregroundStyle(.secondary)
                                    .padding(.leading, 15)
                            }
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(entry.name), \(entry.total.formatted(code: currency)), \(entry.accessibilityDetail)")
                        .accessibilityHint("Opens breakdown")
                    }
                }
            }
        }
    }

    /// A breakdown row ready to draw: top-4 slice with a stable color from the
    /// shared category identity, plus its share of the bar.
    private struct BreakdownEntry: Identifiable {
        let id: String
        let name: String
        let total: Money
        let share: Double
        let color: Color
        let route: SpendingRoute
        let accessibilityDetail: String
    }

    private var categoryEntries: [BreakdownEntry] {
        SpendDerivation.categoryRows(
            transactions: snapshot.transactions,
            categories: snapshot.categories,
            period: period
        ).prefix(4).map { row in
            BreakdownEntry(
                id: row.id.uuidString,
                name: row.name,
                total: row.total,
                share: row.share,
                color: CategoryStyle.style(for: row.name).color,
                route: .category(row.id),
                accessibilityDetail: "\(row.share.formatted(.percent.precision(.fractionLength(0)))) of spend"
            )
        }
    }

    private var merchantEntries: [BreakdownEntry] {
        let all = SpendDerivation.merchantRows(
            transactions: snapshot.transactions,
            categories: snapshot.categories,
            period: period
        )
        let denominator = all.reduce(Decimal.zero) { $0 + $1.total.value }
        guard denominator > 0 else { return [] }
        return all.prefix(4).map { row in
            BreakdownEntry(
                id: row.id,
                name: row.name,
                total: row.total,
                share: NSDecimalNumber(decimal: row.total.value / denominator).doubleValue,
                color: CategoryStyle.style(for: row.topCategory ?? row.name).color,
                route: .merchant(row.id),
                accessibilityDetail: "\(row.count) \(row.count == 1 ? "visit" : "visits")"
            )
        }
    }

    private var csvExport: SpendCSVExport {
        SpendCSVExport(
            transactions: rows,
            categories: snapshot.categories,
            period: period
        )
    }

    private var rows: [AalsiFinanceKit.Transaction] {
        snapshot.filteredTransactions(period: period, filter: filter)
    }

    private var unfilteredPeriodRows: [AalsiFinanceKit.Transaction] {
        snapshot.filteredTransactions(period: period, filter: SpendFilter())
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
    /// than combined into a false mixed-currency total. Classification (not
    /// raw sign) decides which bucket a row lands in, so refunds net against
    /// spend instead of inflating "in", and transfers stay out of both.
    private enum FlowBucket { case spend, refund, income }

    private func total(bucket: FlowBucket, in transactions: [AalsiFinanceKit.Transaction]) -> Money {
        Money(transactions.reduce(Decimal.zero) { sum, transaction in
            let value: Decimal
            if let baseAmount = transaction.baseAmount {
                value = baseAmount.value
            } else if transaction.currency.caseInsensitiveCompare(currency) == .orderedSame {
                value = transaction.amount.value
            } else {
                return sum
            }
            switch SpendDerivation.classify(transaction, categories: snapshot.categories) {
            case .spend where bucket == .spend,
                 .refund where bucket == .refund,
                 .income where bucket == .income:
                return sum + value.magnitude
            default:
                return sum
            }
        })
    }

    private func netSpent(in transactions: [AalsiFinanceKit.Transaction]) -> Money {
        Money(max(
            total(bucket: .spend, in: transactions).value - total(bucket: .refund, in: transactions).value,
            0
        ))
    }

    private var spentTotal: Money { netSpent(in: rows) }

    private var incomeTotal: Money { total(bucket: .income, in: rows) }

    /// Day headers carry the day's net spend so the list scans without math;
    /// income-only days show nothing rather than a misleading $0.
    private func daySpentTotal(_ section: SpendDaySection) -> Money? {
        let spent = netSpent(in: section.transactions)
        return spent.value > 0 ? spent : nil
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

/// Thin stacked bar showing each slice's share of the month; the remainder
/// past the top slices renders as a muted tail so the bar always reads as a
/// whole.
struct ProportionBar: View {
    let segments: [(id: String, share: Double, color: Color)]

    var body: some View {
        GeometryReader { geo in
            let shown = segments.filter { $0.share > 0 }
            let remainder = max(1 - shown.reduce(0) { $0 + $1.share }, 0)
            let spacing: CGFloat = 2
            let slots = shown.count + (remainder > 0.001 ? 1 : 0)
            let available = geo.size.width - spacing * CGFloat(max(slots - 1, 0))

            HStack(spacing: spacing) {
                ForEach(shown, id: \.id) { segment in
                    Capsule()
                        .fill(segment.color)
                        .frame(width: max(available * segment.share, 4))
                }
                if remainder > 0.001 {
                    Capsule()
                        .fill(.quaternary)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .frame(height: 6)
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
    var classify: ((AalsiFinanceKit.Transaction) -> SpendClassification)? = nil
    var daySpent: Money? = nil
    var currency: String = "USD"
    let isSelecting: Bool
    let selectedTransactionIDs: Set<UUID>
    let onSelect: (AalsiFinanceKit.Transaction) -> Void
    let onConfirm: ((AalsiFinanceKit.Transaction) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(dayTitle)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)

                Spacer()

                if let daySpent {
                    MoneyText(amount: daySpent, code: currency, font: .footnote.weight(.medium))
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("\(daySpent.formatted(code: currency)) spent")
                }
            }
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
                                classification: classify?(transaction),
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
