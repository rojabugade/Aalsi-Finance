import SwiftUI
import AalsiFinanceKit

struct DebtPane: View {
    @Environment(AppTheme.self) private var theme
    let loans: [Loan]
    var onEdit: ((Loan) -> Void)?
    var onDelete: ((Loan) -> Void)?

    @State private var pendingDelete: Loan?

    var body: some View {
        VStack(spacing: 12) {
            if loans.isEmpty {
                ContentUnavailableView(
                    "No loans tracked",
                    systemImage: "building.columns",
                    description: Text("Add loans on the web app to see payoff progress here.")
                )
                .card()
            }
            ForEach(loans) { loan in
                loanCard(loan)
            }
        }
        .navigationDestination(for: Loan.self) { loan in
            LoanDetailView(loan: loan)
        }
        .confirmationDialog(
            "Delete \(pendingDelete?.name ?? "loan")?",
            isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete Loan", role: .destructive) {
                if let pendingDelete { onDelete?(pendingDelete) }
                pendingDelete = nil
            }
        } message: {
            Text("Removes the loan, its schedule, and payment history from tracking.")
        }
    }

    /// Tap body opens the detail; the trailing menu keeps edit/delete
    /// discoverable without hiding them behind long-press alone.
    private func loanCard(_ loan: Loan) -> some View {
        HStack(alignment: .top, spacing: 4) {
            NavigationLink(value: loan) {
                loanContent(loan)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if onEdit != nil || onDelete != nil {
                Menu {
                    menuItems(loan)
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .foregroundStyle(.secondary)
                        .frame(width: 36, height: 36)
                }
                .accessibilityLabel("Actions for \(loan.name)")
            }
        }
        .card()
        .contextMenu { menuItems(loan) }
    }

    @ViewBuilder
    private func menuItems(_ loan: Loan) -> some View {
        if let onEdit {
            Button {
                onEdit(loan)
            } label: {
                Label("Edit", systemImage: "pencil")
            }
        }
        if onDelete != nil {
            Button(role: .destructive) {
                pendingDelete = loan
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }

    private func loanContent(_ loan: Loan) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(loan.name).font(.subheadline.weight(.semibold))
                    if let rate = loan.interestRate {
                        Text("\(rate.value.formatted(.number.precision(.fractionLength(0...2))))% · \(loan.type.replacingOccurrences(of: "_", with: " "))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    if let balance = loan.outstandingBalance {
                        MoneyText(amount: balance, code: loan.currency, font: .subheadline.weight(.semibold))
                    }
                    Text("left").font(.caption2).foregroundStyle(.secondary)
                }
            }
            ProgressView(value: (loan.progressPct ?? 0) / 100)
                .tint(theme.accentColor)
            HStack {
                if let pct = loan.progressPct {
                    Text("\(Int(pct.rounded()))% paid").font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
                if let due = loan.nextDueDate {
                    Text("Next due \(due, format: .dateTime.month(.abbreviated).day())")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
