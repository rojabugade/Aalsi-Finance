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

    var body: some View {
        SpendSummaryCard(
            title: transactionSummary,
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

    private var transactionSummary: String {
        let noun = overview.transactionCount == 1 ? "transaction" : "transactions"
        return "Spent across \(overview.transactionCount) \(noun)"
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
                Text("Insight")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)

                Text(insight.title)
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
                                detail: "\(row.count) \(row.count == 1 ? "transaction" : "transactions") · \(row.share.formatted(.percent.precision(.fractionLength(0))))",
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

    private func rankedRow(title: String, detail: String, amount: Money) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Circle()
                .fill(theme.accentColor.opacity(0.14))
                .frame(width: 32, height: 32)
                .overlay(
                    Circle()
                        .fill(theme.accentColor)
                        .frame(width: 8, height: 8)
                )
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            MoneyText(amount: amount, code: currency, font: .subheadline.weight(.semibold))

            Image(systemName: "chevron.right")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
        }
        .contentShape(Rectangle())
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
