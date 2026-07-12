import SwiftUI
import AalsiFinanceKit

struct CategoryDrillView: View {
    let categoryID: UUID
    let snapshot: SpendingSnapshot
    let period: SpendPeriod
    var currency: String = "USD"
    let onRoute: (SpendingRoute) -> Void

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 14) {
                DrillHeroCard(
                    title: category?.name ?? "Category",
                    total: overview.total,
                    previous: overview.previousTotal,
                    currency: currency,
                    supportingText: "\(overview.transactionCount) \(overview.transactionCount == 1 ? "transaction" : "transactions")"
                )

                if !childRows.isEmpty {
                    DrillSectionCard(title: "Subcategories") {
                        ForEach(Array(childRows.enumerated()), id: \.element.category.id) { index, row in
                            if index > 0 { Divider() }
                            Button {
                                onRoute(.category(row.category.id))
                            } label: {
                                HStack(spacing: 10) {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(row.category.name)
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(.primary)
                                        Text("\(row.count) \(row.count == 1 ? "transaction" : "transactions")")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer(minLength: 8)
                                    MoneyText(amount: row.total, code: currency, font: .subheadline.weight(.semibold))
                                    Image(systemName: "chevron.right")
                                        .font(.caption2.weight(.bold))
                                        .foregroundStyle(.tertiary)
                                }
                                .frame(minHeight: 44)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                SpendRankedPreview(
                    title: "Top merchants",
                    merchants: Array(merchantRows.prefix(5)),
                    currency: currency,
                    onSelect: { onRoute(.merchant($0)) }
                )

                DrillTransactionList(
                    title: "Transactions",
                    transactions: currentTransactions,
                    snapshot: snapshot,
                    onSelect: { onRoute(.transaction($0)) }
                )
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(category?.name ?? "Category")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var category: AalsiFinanceKit.Category? {
        snapshot.categories.first { $0.id == categoryID }
    }

    private var scopedTransactions: [AalsiFinanceKit.Transaction] {
        transactions(including: categoryID)
    }

    private var overview: SpendOverview {
        SpendDerivation.overview(
            transactions: scopedTransactions,
            categories: snapshot.categories,
            period: period
        )
    }

    private var merchantRows: [MerchantSpendRow] {
        SpendDerivation.merchantRows(
            transactions: scopedTransactions,
            categories: snapshot.categories,
            period: period
        )
    }

    private var currentTransactions: [AalsiFinanceKit.Transaction] {
        SpendDerivation.filter(
            scopedTransactions,
            categories: snapshot.categories,
            period: period,
            filter: SpendFilter()
        )
    }

    private var childRows: [CategoryDrillRow] {
        snapshot.categories
            .filter { $0.parentId == categoryID }
            .map { child in
                let childTransactions = transactions(including: child.id)
                let childOverview = SpendDerivation.overview(
                    transactions: childTransactions,
                    categories: snapshot.categories,
                    period: period
                )
                return CategoryDrillRow(
                    category: child,
                    total: childOverview.total,
                    count: childOverview.transactionCount
                )
            }
            .sorted {
                if $0.total.value != $1.total.value { return $0.total.value > $1.total.value }
                return $0.category.name.localizedStandardCompare($1.category.name) == .orderedAscending
            }
    }

    private func transactions(including selectedID: UUID) -> [AalsiFinanceKit.Transaction] {
        let byID = Dictionary(uniqueKeysWithValues: snapshot.categories.map { ($0.id, $0) })
        return snapshot.transactions.filter { transaction in
            guard var currentID = transaction.categoryId else { return false }
            var visited = Set<UUID>()
            while visited.insert(currentID).inserted {
                if currentID == selectedID { return true }
                guard let parentID = byID[currentID]?.parentId else { return false }
                currentID = parentID
            }
            return false
        }
    }
}

struct MerchantDrillView: View {
    let merchantKey: String
    let snapshot: SpendingSnapshot
    let period: SpendPeriod
    var currency: String = "USD"
    let onRoute: (SpendingRoute) -> Void

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 14) {
                DrillHeroCard(
                    title: merchantRow?.name ?? fallbackMerchantName,
                    total: merchantRow?.total ?? Money(),
                    previous: merchantRow?.previous ?? Money(),
                    currency: currency,
                    supportingText: visitSummary
                )

                merchantMetrics

                if !categoryRows.isEmpty {
                    DrillSectionCard(title: "Category mix") {
                        ForEach(Array(categoryRows.enumerated()), id: \.element.id) { index, row in
                            if index > 0 { Divider() }
                            Button {
                                onRoute(.category(row.id))
                            } label: {
                                HStack(spacing: 10) {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(row.name)
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(.primary)
                                        Text(row.share.formatted(.percent.precision(.fractionLength(0))))
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer(minLength: 8)
                                    MoneyText(amount: row.total, code: currency, font: .subheadline.weight(.semibold))
                                    Image(systemName: "chevron.right")
                                        .font(.caption2.weight(.bold))
                                        .foregroundStyle(.tertiary)
                                }
                                .frame(minHeight: 44)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                itemSection

                DrillTransactionList(
                    title: "Transactions",
                    transactions: currentTransactions,
                    snapshot: snapshot,
                    onSelect: { onRoute(.transaction($0)) }
                )
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(merchantRow?.name ?? fallbackMerchantName)
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private var merchantMetrics: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) {
                DrillCompactMetric(
                    label: "Average",
                    value: average.compact(code: currency),
                    systemImage: "divide.circle"
                )
                DrillCompactMetric(
                    label: "Category",
                    value: merchantRow?.topCategory ?? "Uncategorized",
                    systemImage: "square.grid.2x2"
                )
                DrillCompactMetric(
                    label: "Recurring",
                    value: isRecurring ? "Yes" : "No",
                    systemImage: "repeat"
                )
            }

            VStack(spacing: 10) {
                DrillCompactMetric(
                    label: "Average purchase",
                    value: average.formatted(code: currency),
                    systemImage: "divide.circle"
                )
                DrillCompactMetric(
                    label: "Dominant category",
                    value: merchantRow?.topCategory ?? "Uncategorized",
                    systemImage: "square.grid.2x2"
                )
                DrillCompactMetric(
                    label: "Recurring pattern",
                    value: isRecurring ? "Detected" : "Not detected",
                    systemImage: "repeat"
                )
            }
        }
    }

    @ViewBuilder
    private var itemSection: some View {
        if itemRows.isEmpty {
            ContentUnavailableView {
                Label("No receipt items yet", systemImage: "doc.text.viewfinder")
            } description: {
                Text("Capture or import a receipt to see products bought from this merchant.")
            }
            .frame(maxWidth: .infinity)
            .card()
        } else {
            DrillSectionCard(title: "Top receipt items") {
                ForEach(Array(itemRows.prefix(8).enumerated()), id: \.element.id) { index, item in
                    if index > 0 { Divider() }
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(item.name)
                                .font(.subheadline.weight(.semibold))
                            if let quantity = item.quantity {
                                Text("Quantity \(quantity.value.formatted())")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer(minLength: 8)
                        MoneyText(amount: item.total, code: currency, font: .subheadline.weight(.semibold))
                    }
                    .frame(minHeight: 44)
                }
            }
        }
    }

    private var normalizedKey: String {
        merchantKey.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private var merchantTransactions: [AalsiFinanceKit.Transaction] {
        snapshot.transactions.filter {
            $0.merchant?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == normalizedKey
        }
    }

    private var merchantRow: MerchantSpendRow? {
        SpendDerivation.merchantRows(
            transactions: merchantTransactions,
            categories: snapshot.categories,
            period: period,
            recurringMerchantKeys: recurringKeys
        ).first { $0.id == normalizedKey }
    }

    private var categoryRows: [CategorySpendRow] {
        SpendDerivation.categoryRows(
            transactions: merchantTransactions,
            categories: snapshot.categories,
            period: period
        )
    }

    private var itemRows: [ItemSpendRow] {
        SpendDerivation.itemRows(
            transactions: merchantTransactions,
            categories: snapshot.categories,
            period: period
        )
    }

    private var currentTransactions: [AalsiFinanceKit.Transaction] {
        SpendDerivation.filter(
            merchantTransactions,
            categories: snapshot.categories,
            period: period,
            filter: SpendFilter()
        )
    }

    private var recurringKeys: Set<String> {
        Set(snapshot.recurringRows.compactMap(\.merchantKey))
    }

    private var isRecurring: Bool {
        merchantRow?.isRecurring == true || recurringKeys.contains(normalizedKey)
    }

    private var average: Money {
        guard let merchantRow, merchantRow.count > 0 else { return Money() }
        return Money(merchantRow.total.value / Decimal(merchantRow.count))
    }

    private var visitSummary: String {
        let count = merchantRow?.count ?? 0
        return "\(count) \(count == 1 ? "visit" : "visits")"
    }

    private var fallbackMerchantName: String {
        merchantTransactions
            .compactMap(\.merchant)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .sorted()
            .first ?? "Merchant"
    }
}

private struct CategoryDrillRow {
    let category: AalsiFinanceKit.Category
    let total: Money
    let count: Int
}

private struct DrillHeroCard: View {
    let title: String
    let total: Money
    let previous: Money
    let currency: String
    let supportingText: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)

            MoneyText(
                amount: total,
                code: currency,
                font: .system(.largeTitle, design: .rounded, weight: .bold)
            )

            Label(deltaText, systemImage: deltaSystemImage)
                .font(.caption.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(deltaColor)

            Text(supportingText)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .card()
    }

    private var delta: Money { Money(total.value - previous.value) }

    private var deltaText: String {
        if delta.value > 0 { return "\(delta.magnitude.compact(code: currency)) more than last month" }
        if delta.value < 0 { return "\(delta.magnitude.compact(code: currency)) less than last month" }
        return "No change from last month"
    }

    private var deltaSystemImage: String {
        if delta.value > 0 { return "arrow.up.right" }
        if delta.value < 0 { return "arrow.down.right" }
        return "arrow.right"
    }

    private var deltaColor: Color {
        if delta.value > 0 { return .red }
        if delta.value < 0 { return .green }
        return .secondary
    }
}

private struct DrillCompactMetric: View {
    let label: String
    let value: String
    let systemImage: String

    @Environment(AppTheme.self) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(label, systemImage: systemImage)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline.weight(.semibold))
                .lineLimit(2)
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
        .background(theme.accentColor.opacity(0.1), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

private struct DrillSectionCard<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.headline)
            content
        }
        .card()
    }
}

private struct DrillTransactionList: View {
    let title: String
    let transactions: [AalsiFinanceKit.Transaction]
    let snapshot: SpendingSnapshot
    let onSelect: (UUID) -> Void

    var body: some View {
        DrillSectionCard(title: title) {
            if transactions.isEmpty {
                Text("No transactions in this period.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 8)
            } else {
                ForEach(Array(transactions.enumerated()), id: \.element.id) { index, transaction in
                    if index > 0 { Divider() }
                    Button {
                        onSelect(transaction.id)
                    } label: {
                        HStack(spacing: 8) {
                            TransactionRow(
                                transaction: transaction,
                                categoryPath: snapshot.categoryPath(for: transaction.categoryId)
                            )
                            Image(systemName: "chevron.right")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(.tertiary)
                                .accessibilityHidden(true)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

private enum SpendDrillPreviewFixtures {
    static let foodID = UUID(uuidString: "33333333-3333-3333-3333-333333333333")!
    static let diningID = UUID(uuidString: "44444444-4444-4444-4444-444444444444")!

    static let categories = [
        AalsiFinanceKit.Category(id: foodID, parentId: nil, name: "Food", kind: "category", isSystem: true),
        AalsiFinanceKit.Category(id: diningID, parentId: foodID, name: "Dining", kind: "category", isSystem: true)
    ]

    static let snapshot = SpendingSnapshot(
        transactions: transactions(withItems: true),
        categories: categories,
        canonicalRecurring: []
    )

    static let snapshotWithoutItems = SpendingSnapshot(
        transactions: transactions(withItems: false),
        categories: categories,
        canonicalRecurring: []
    )

    static let period = SpendDerivation.period(
        containing: APIDateParser.parse("2026-07-12")!,
        now: APIDateParser.parse("2026-07-12T18:00:00Z")!
    )

    private static func transactions(withItems: Bool) -> [AalsiFinanceKit.Transaction] {
        let lineItems = withItems
            ? #"[{"id":"66666666-6666-6666-6666-666666666666","transaction_id":"11111111-1111-1111-1111-111111111111","name":"Iced Tea","amount":"5.50","quantity":"1","item_type_category_id":null,"confidence":"0.98"}]"#
            : "[]"
        let json = #"""
        [
          {"id":"11111111-1111-1111-1111-111111111111","household_id":"22222222-2222-2222-2222-222222222222","account_id":null,"payment_method_id":null,"recurring_series_id":null,"owner_user_id":null,"merchant_id":null,"merchant":"Corner Cafe","amount":"-24.50","currency":"USD","base_amount":null,"fx_rate":null,"txn_date":"2026-07-12","category_id":"44444444-4444-4444-4444-444444444444","status":"confirmed","source_document_id":null,"source_channel":"manual","is_shared":false,"flags":null,"notes":"Lunch","confidence":null,"external_id":null,"created_at":"2026-07-12T13:00:00Z","line_items":\#(lineItems)},
          {"id":"55555555-5555-5555-5555-555555555555","household_id":"22222222-2222-2222-2222-222222222222","account_id":null,"payment_method_id":null,"recurring_series_id":null,"owner_user_id":null,"merchant_id":null,"merchant":"Corner Cafe","amount":"-18.00","currency":"USD","base_amount":null,"fx_rate":null,"txn_date":"2026-07-05","category_id":"44444444-4444-4444-4444-444444444444","status":"confirmed","source_document_id":null,"source_channel":"plaid","is_shared":false,"flags":null,"notes":null,"confidence":null,"external_id":null,"created_at":"2026-07-05T18:30:00Z","line_items":[]}
        ]
        """#
        return try! JSONDecoder.api().decode([AalsiFinanceKit.Transaction].self, from: Data(json.utf8))
    }
}

#Preview("Category Drill Light") {
    NavigationStack {
        CategoryDrillView(
            categoryID: SpendDrillPreviewFixtures.foodID,
            snapshot: SpendDrillPreviewFixtures.snapshot,
            period: SpendDrillPreviewFixtures.period,
            onRoute: { _ in }
        )
    }
    .environment(AppTheme())
    .preferredColorScheme(.light)
}

#Preview("Category Drill Dark") {
    NavigationStack {
        CategoryDrillView(
            categoryID: SpendDrillPreviewFixtures.diningID,
            snapshot: SpendDrillPreviewFixtures.snapshot,
            period: SpendDrillPreviewFixtures.period,
            onRoute: { _ in }
        )
    }
    .environment(AppTheme())
    .preferredColorScheme(.dark)
}

#Preview("Merchant Drill Light") {
    NavigationStack {
        MerchantDrillView(
            merchantKey: "corner cafe",
            snapshot: SpendDrillPreviewFixtures.snapshot,
            period: SpendDrillPreviewFixtures.period,
            onRoute: { _ in }
        )
    }
    .environment(AppTheme())
    .preferredColorScheme(.light)
}

#Preview("Merchant Drill Dark") {
    NavigationStack {
        MerchantDrillView(
            merchantKey: "corner cafe",
            snapshot: SpendDrillPreviewFixtures.snapshot,
            period: SpendDrillPreviewFixtures.period,
            onRoute: { _ in }
        )
    }
    .environment(AppTheme())
    .preferredColorScheme(.dark)
}

#Preview("Merchant Drill No Items") {
    NavigationStack {
        MerchantDrillView(
            merchantKey: "corner cafe",
            snapshot: SpendDrillPreviewFixtures.snapshotWithoutItems,
            period: SpendDrillPreviewFixtures.period,
            onRoute: { _ in }
        )
    }
    .environment(AppTheme())
    .preferredColorScheme(.dark)
}
