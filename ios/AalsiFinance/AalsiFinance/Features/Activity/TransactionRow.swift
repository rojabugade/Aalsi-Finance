import SwiftUI

/// Compact transaction row shared by Home's recent-activity card and the
/// Activity list.
struct TransactionRow: View {
    let transaction: Transaction
    var categoryName: String?

    private var isCredit: Bool { transaction.amount.isNegative }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: iconName)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.indigo)
                .frame(width: 40, height: 40)
                .background(.indigo.opacity(0.12), in: .circle)

            VStack(alignment: .leading, spacing: 2) {
                Text(transaction.displayMerchant)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                HStack(spacing: 6) {
                    if let categoryName {
                        Text(categoryName)
                    }
                    Text(transaction.txnDate, format: .dateTime.month(.abbreviated).day())
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 3) {
                MoneyText(
                    amount: transaction.amount.magnitude,
                    code: transaction.currency,
                    font: .subheadline.weight(.semibold)
                )
                .foregroundStyle(isCredit ? .green : .primary)
                if transaction.isDraft {
                    StatusBadge(status: transaction.status)
                }
            }
        }
        .padding(.vertical, 8)
    }

    private var iconName: String {
        switch transaction.sourceChannel {
        case "plaid": "building.columns.fill"
        case "gmail": "envelope.fill"
        case "sms": "message.fill"
        case "document", "ocr": "doc.text.viewfinder"
        default: isCredit ? "arrow.down.left.circle.fill" : "cart.fill"
        }
    }
}
