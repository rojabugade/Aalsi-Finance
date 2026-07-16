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
    /// Pass when the caller has the category tree; refunds and transfers then
    /// render distinctly instead of masquerading as income.
    var classification: SpendClassification? = nil
    var showsSelection = false
    var isSelected = false

    private var isIncome: Bool {
        if let classification {
            if case .income = classification { return true }
            return false
        }
        return transaction.amount.value > .zero
    }

    private var isRefund: Bool {
        if case .refund = classification { return true }
        return false
    }

    private var isTransfer: Bool {
        if case .transfer = classification { return true }
        return false
    }

    private var amountColor: Color {
        if isTransfer { return .secondary }
        if isIncome || isRefund { return .green }
        return .primary
    }

    var body: some View {
        HStack(spacing: 12) {
            if showsSelection {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(isSelected ? theme.accentColor : Color.secondary)
                    .frame(width: 24, height: 44)
                    .accessibilityHidden(true)
            }

            Image(systemName: iconStyle.symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(iconStyle.color)
                .frame(width: 38, height: 38)
                .background(iconStyle.color.opacity(0.14), in: .circle)
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
                    font: .subheadline.weight(.semibold),
                    signed: true
                )
                .foregroundStyle(amountColor)
                HStack(spacing: 4) {
                    if isRefund {
                        FlowBadge(label: "Refund", tint: .green)
                    } else if isTransfer {
                        FlowBadge(label: "Transfer", tint: .secondary)
                    }
                    if transaction.isDraft {
                        StatusBadge(status: transaction.status)
                    }
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
        // The signed amount is truthful without guessing whether a positive
        // transaction is income, a refund, or a transfer from amount alone.
        parts.append("Amount \(transaction.amount.formatted(code: transaction.currency))")
        if isRefund { parts.append("Refund") }
        if isTransfer { parts.append("Transfer") }
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

    /// Category identity drives the leading icon so a day of transactions is
    /// scannable at a glance; flow type (income/transfer) overrides it, and
    /// uncategorized rows fall back to their source channel.
    private var iconStyle: CategoryStyle {
        if isTransfer {
            return CategoryStyle(symbol: "arrow.left.arrow.right", color: .gray)
        }
        if isIncome {
            return CategoryStyle(symbol: "arrow.down.left.circle.fill", color: .green)
        }
        if let displayedCategory {
            return CategoryStyle.style(for: displayedCategory)
        }
        let channelSymbol: String = switch transaction.sourceChannel {
        case "plaid": "building.columns.fill"
        case "gmail": "envelope.fill"
        case "sms": "message.fill"
        case "document", "ocr": "doc.text.viewfinder"
        default: "cart.fill"
        }
        return CategoryStyle(symbol: channelSymbol, color: .gray)
    }
}
