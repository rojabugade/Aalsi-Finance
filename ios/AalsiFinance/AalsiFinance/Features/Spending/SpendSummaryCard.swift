import SwiftUI
import AalsiFinanceKit

struct SpendSummaryCard: View {
    let title: String
    let amount: Money
    let currency: String
    let comparisonText: String
    let comparisonSystemImage: String
    let comparisonColor: Color
    let supportingLabel: String
    let supportingAmount: Money
    let chartValues: [Money]

    @Environment(AppTheme.self) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)

            MoneyText(
                amount: amount,
                code: currency,
                font: .system(.largeTitle, design: .rounded, weight: .bold)
            )

            Label(comparisonText, systemImage: comparisonSystemImage)
                .font(.caption.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(comparisonColor)

            if !chartValues.isEmpty {
                LineSparkline(values: sparklineValues, color: theme.accentColor)
                    .frame(height: 64)
                    .accessibilityHidden(true)
            }

            HStack(alignment: .firstTextBaseline) {
                Text(supportingLabel)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 12)
                MoneyText(
                    amount: supportingAmount,
                    code: currency,
                    font: .subheadline.weight(.semibold)
                )
            }
        }
        .card()
    }

    private var sparklineValues: [Double] {
        let values = chartValues.map(\.doubleValue)
        return values.count == 1 ? [values[0], values[0]] : values
    }
}

struct SpendPulseCard: View {
    let overview: SpendOverview
    let currency: String
    var isCurrentMonth = true

    var body: some View {
        SpendSummaryCard(
            title: isCurrentMonth ? "Spent so far" : "Spent",
            amount: overview.total,
            currency: currency,
            comparisonText: comparison.text,
            comparisonSystemImage: comparison.systemImage,
            comparisonColor: comparison.color,
            supportingLabel: "Daily pace",
            supportingAmount: overview.dailyPace,
            chartValues: overview.cumulativeDaily
        )
    }

    private var comparison: (text: String, systemImage: String, color: Color) {
        let delta = Money(overview.total.value - overview.previousTotal.value)

        if delta.value > 0 {
            return (
                "\(delta.magnitude.compact(code: currency)) more than last month",
                "arrow.up.right",
                .red
            )
        }

        if delta.value < 0 {
            return (
                "\(delta.magnitude.compact(code: currency)) less than last month",
                "arrow.down.right",
                .green
            )
        }

        return ("No change from last month", "arrow.right", .secondary)
    }
}

struct SpendInsightCard: View {
    let insight: SpendInsight
    let currency: String
    let action: (() -> Void)?

    var body: some View {
        Group {
            if let action {
                Button(action: action) {
                    content(showsDisclosure: true)
                }
                .buttonStyle(.plain)
            } else {
                content(showsDisclosure: false)
            }
        }
        .card()
    }

    private func content(showsDisclosure: Bool) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Label(insight.title, systemImage: "sparkles")
                    .font(.headline)

                Text(insight.detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                if insight.delta.value != 0 {
                    Label(
                        insight.delta.magnitude.compact(code: currency),
                        systemImage: insight.delta.value > 0 ? "arrow.up.right" : "arrow.down.right"
                    )
                    .font(.caption.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(insight.delta.value > 0 ? Color.red : Color.green)
                }
            }

            Spacer(minLength: 8)

            if showsDisclosure {
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
        }
        .contentShape(Rectangle())
    }
}

struct SpendRankedPreview: View {
    private enum Content {
        case categories([CategorySpendRow], (UUID) -> Void)
        case merchants([MerchantSpendRow], (String) -> Void)
    }

    let title: String
    let currency: String
    private let content: Content

    @Environment(AppTheme.self) private var theme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    init(
        title: String,
        categories: [CategorySpendRow],
        currency: String,
        onSelect: @escaping (UUID) -> Void
    ) {
        self.title = title
        self.currency = currency
        content = .categories(categories, onSelect)
    }

    init(
        title: String,
        merchants: [MerchantSpendRow],
        currency: String,
        onSelect: @escaping (String) -> Void
    ) {
        self.title = title
        self.currency = currency
        content = .merchants(merchants, onSelect)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.headline)

            switch content {
            case let .categories(rows, onSelect):
                if rows.isEmpty {
                    emptyState
                } else {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 { Divider() }
                        Button { onSelect(row.id) } label: {
                            rankedRow(
                                title: row.name,
                                detail: "\(row.share.formatted(.percent.precision(.fractionLength(0)))) of spend",
                                amount: row.total
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }

            case let .merchants(rows, onSelect):
                if rows.isEmpty {
                    emptyState
                } else {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 { Divider() }
                        Button { onSelect(row.id) } label: {
                            rankedRow(
                                title: row.name,
                                detail: merchantDetail(for: row),
                                amount: row.total
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .card()
    }

    private var emptyState: some View {
        Text("No \(title.lowercased()) to rank for this month.")
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 8)
    }

    @ViewBuilder
    private func rankedRow(title: String, detail: String, amount: Money) -> some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) {
                rankIdentity(title: title, detail: detail, allowsWrapping: true)

                HStack(alignment: .center, spacing: 8) {
                    MoneyText(amount: amount, code: currency, font: .subheadline.weight(.semibold))
                    Spacer(minLength: 8)
                    disclosureIndicator
                }
            }
            .padding(.vertical, 6)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        } else {
            HStack(alignment: .center, spacing: 12) {
                rankIdentity(title: title, detail: detail, allowsWrapping: false)

                Spacer(minLength: 8)

                MoneyText(amount: amount, code: currency, font: .subheadline.weight(.semibold))
                disclosureIndicator
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
    }

    private func rankIdentity(title: String, detail: String, allowsWrapping: Bool) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
                .lineLimit(allowsWrapping ? 2 : 1)
            Text(detail)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(allowsWrapping ? 3 : 1)
        }
    }

    private var disclosureIndicator: some View {
        Image(systemName: "chevron.right")
            .font(.caption2.weight(.bold))
            .foregroundStyle(.tertiary)
            .accessibilityHidden(true)
    }

    private func merchantDetail(for row: MerchantSpendRow) -> String {
        var parts = ["\(row.count) \(row.count == 1 ? "visit" : "visits")"]
        if let topCategory = row.topCategory, !topCategory.isEmpty {
            parts.append(topCategory)
        }
        if row.isRecurring {
            parts.append("Recurring")
        }
        return parts.joined(separator: " · ")
    }
}
