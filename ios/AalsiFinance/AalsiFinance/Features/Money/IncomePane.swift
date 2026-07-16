import SwiftUI
import AalsiFinanceKit

struct IncomePane: View {
    let sources: [IncomeSource]
    let holdings: [Holding]
    var onEditIncome: ((IncomeSource) -> Void)?
    var onEditHolding: ((Holding) -> Void)?
    var onDeleteHolding: ((Holding) -> Void)?

    @State private var pendingHoldingDelete: Holding?

    var body: some View {
        VStack(spacing: 12) {
            if sources.isEmpty && holdings.isEmpty {
                ContentUnavailableView(
                    "No income or investments yet",
                    systemImage: "banknote",
                    description: Text("Add income sources and holdings on the web app.")
                )
                .card()
            }

            if !sources.isEmpty {
                VStack(spacing: 10) {
                    SectionHeaderLink(title: "Income")
                    VStack(spacing: 0) {
                        ForEach(sources) { source in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(source.employer ?? "Income source").font(.subheadline.weight(.medium))
                                    Text("\(source.frequency.capitalized)\(source.country.map { " · \($0)" } ?? "")")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if let gross = source.gross {
                                    VStack(alignment: .trailing, spacing: 2) {
                                        MoneyText(amount: gross, code: source.currency, font: .subheadline.weight(.semibold))
                                        Text("gross").font(.caption2).foregroundStyle(.secondary)
                                    }
                                }
                                if let onEditIncome {
                                    Button {
                                        onEditIncome(source)
                                    } label: {
                                        Image(systemName: "pencil.circle")
                                            .foregroundStyle(.secondary)
                                            .frame(width: 32, height: 44)
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel("Edit \(source.employer ?? "income source")")
                                }
                            }
                            .padding(.vertical, 8)
                            if source.id != sources.last?.id { Divider() }
                        }
                    }
                    .card()
                }
            }

            if !holdings.isEmpty {
                VStack(spacing: 10) {
                    SectionHeaderLink(title: "Investments")
                    VStack(spacing: 0) {
                        ForEach(holdings) { holding in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(holding.name).font(.subheadline.weight(.medium)).lineLimit(1)
                                    Text("\(holding.symbol ?? holding.assetType.capitalized) · qty \(holding.quantity.value.formatted(.number.precision(.fractionLength(0...2))))")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if let avg = holding.avgBuyPrice {
                                    VStack(alignment: .trailing, spacing: 2) {
                                        MoneyText(amount: avg, code: holding.currency, font: .caption.weight(.semibold))
                                        Text("avg buy").font(.caption2).foregroundStyle(.secondary)
                                    }
                                }
                                if onEditHolding != nil || onDeleteHolding != nil {
                                    Menu {
                                        if let onEditHolding {
                                            Button {
                                                onEditHolding(holding)
                                            } label: {
                                                Label("Edit", systemImage: "pencil")
                                            }
                                        }
                                        if onDeleteHolding != nil {
                                            Button(role: .destructive) {
                                                pendingHoldingDelete = holding
                                            } label: {
                                                Label("Delete", systemImage: "trash")
                                            }
                                        }
                                    } label: {
                                        Image(systemName: "ellipsis.circle")
                                            .foregroundStyle(.secondary)
                                            .frame(width: 32, height: 44)
                                    }
                                    .accessibilityLabel("Actions for \(holding.name)")
                                }
                            }
                            .padding(.vertical, 8)
                            if holding.id != holdings.last?.id { Divider() }
                        }
                    }
                    .card()
                }
            }
        }
        .confirmationDialog(
            "Delete \(pendingHoldingDelete?.name ?? "holding")?",
            isPresented: Binding(
                get: { pendingHoldingDelete != nil },
                set: { if !$0 { pendingHoldingDelete = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete Holding", role: .destructive) {
                if let pendingHoldingDelete { onDeleteHolding?(pendingHoldingDelete) }
                pendingHoldingDelete = nil
            }
        } message: {
            Text("Removes the holding and its valuation history.")
        }
    }
}
