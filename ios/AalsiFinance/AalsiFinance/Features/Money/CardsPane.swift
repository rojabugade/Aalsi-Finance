import SwiftUI
import AalsiFinanceKit

struct CardsPane: View {
    @Environment(AppTheme.self) private var theme
    let cards: [CreditCardSummary]
    var onEdit: ((CreditCardSummary) -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            if cards.isEmpty {
                ContentUnavailableView(
                    "No credit cards tracked",
                    systemImage: "creditcard",
                    description: Text("Add cards on the web app to track dues and utilization here.")
                )
                .card()
            }
            ForEach(cards) { card in
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text(card.loan.name).font(.subheadline.weight(.semibold))
                        Spacer()
                        if let due = card.loan.nextDueDate {
                            let urgent = Calendar.current.isDateInToday(due)
                            Text(urgent ? "Due today" : "Due \(due, format: .dateTime.month(.abbreviated).day())")
                                .font(.caption.weight(urgent ? .semibold : .regular))
                                .foregroundStyle(urgent ? .pink : .secondary)
                        }
                        if let onEdit {
                            Button {
                                onEdit(card)
                            } label: {
                                Image(systemName: "pencil.circle")
                                    .foregroundStyle(.secondary)
                                    .frame(width: 32, height: 32)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Edit \(card.loan.name)")
                        }
                    }

                    HStack(spacing: 20) {
                        amount("Balance", card.statementBalance ?? card.loan.outstandingBalance, card.loan.currency)
                        amount("Min due", card.loan.minOrEmiAmount, card.loan.currency)
                        amount("Available", card.availableCredit, card.loan.currency)
                    }

                    if let utilization = card.utilization {
                        let fraction = min(max(utilization.doubleValue, 0), 100)
                        VStack(alignment: .leading, spacing: 3) {
                            ProgressView(value: fraction / 100)
                                .tint(fraction > 50 ? .orange : theme.accentColor)
                            Text("\(Int(fraction.rounded()))% of limit used")
                                .font(.caption2)
                                .foregroundStyle(fraction > 50 ? .orange : .secondary)
                        }
                    }
                }
                .card()
            }
        }
    }

    private func amount(_ label: String, _ value: Money?, _ code: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            if let value {
                Text(value.compact(code: code)).font(.caption.weight(.semibold)).monospacedDigit()
            } else {
                Text("—").font(.caption).foregroundStyle(.tertiary)
            }
        }
    }
}
