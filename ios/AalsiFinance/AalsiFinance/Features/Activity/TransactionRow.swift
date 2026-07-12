import SwiftUI
import Foundation
import AalsiFinanceKit

/// Compact transaction row shared by Home's recent-activity card and the
/// Activity list.
struct TransactionRow: View {
    @Environment(AppTheme.self) private var theme

    let transaction: AalsiFinanceKit.Transaction
    var categoryName: String? = nil
    var categoryPath: CategoryPath? = nil
    var showsSelection = false
    var isSelected = false

    private var isSpend: Bool { transaction.amount.isNegative }
    private var isIncome: Bool { transaction.amount.value > .zero }

    var body: some View {
        HStack(spacing: 12) {
            if showsSelection {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(isSelected ? theme.accentColor : Color.secondary)
                    .frame(width: 24, height: 44)
                    .accessibilityHidden(true)
            }

            Image(systemName: iconName)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(theme.accentColor)
                .frame(width: 40, height: 40)
                .background(theme.accentColor.opacity(0.12), in: .circle)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(transaction.displayMerchant)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                HStack(spacing: 6) {
                    if let displayedCategory {
                        Text(displayedCategory)
                            .lineLimit(1)
                    }
                    Text(displayDate)
                        .fixedSize(horizontal: true, vertical: false)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 3) {
                MoneyText(
                    amount: transaction.amount,
                    code: transaction.currency,
                    font: .subheadline.weight(.semibold)
                )
                .foregroundStyle(isIncome ? Color.green : Color.primary)
                if transaction.isDraft {
                    StatusBadge(status: transaction.status)
                }
            }
        }
        .padding(.vertical, 8)
        .frame(minHeight: 44)
        .contentShape(.rect)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(accessibilityLabel))
    }

    private var displayedCategory: String? {
        if let categoryPath, !categoryPath.displayName.isEmpty {
            return categoryPath.displayName
        }
        return categoryName
    }

    private var accessibilityLabel: String {
        var parts = [transaction.displayMerchant]
        if let displayedCategory {
            parts.append(displayedCategory)
        }
        parts.append(accessibleDate)
        let direction = isSpend ? "Spent" : isIncome ? "Income" : "Amount"
        parts.append("\(direction) \(transaction.amount.formatted(code: transaction.currency))")
        if transaction.isDraft {
            parts.append("Draft")
        }
        if showsSelection {
            parts.append(isSelected ? "Selected" : "Not selected")
        }
        return parts.joined(separator: ", ")
    }

    private var displayDate: String {
        var format = Date.FormatStyle().month(.abbreviated).day()
        format.timeZone = TimeZone(secondsFromGMT: 0)!
        return transaction.txnDate.formatted(format)
    }

    private var accessibleDate: String {
        var format = Date.FormatStyle().year().month(.wide).day()
        format.timeZone = TimeZone(secondsFromGMT: 0)!
        return transaction.txnDate.formatted(format)
    }

    private var iconName: String {
        switch transaction.sourceChannel {
        case "plaid": "building.columns.fill"
        case "gmail": "envelope.fill"
        case "sms": "message.fill"
        case "document", "ocr": "doc.text.viewfinder"
        default: isSpend ? "cart.fill" : isIncome ? "arrow.down.left.circle.fill" : "creditcard.fill"
        }
    }
}
