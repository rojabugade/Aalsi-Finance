import SwiftUI

struct TransactionDetailView: View {
    let transaction: Transaction
    let model: ActivityViewModel

    @Environment(AppSession.self) private var session

    /// Prefer the live copy from the list so a confirm updates this screen.
    private var current: Transaction {
        model.state.value?.first(where: { $0.id == transaction.id }) ?? transaction
    }

    var body: some View {
        let txn = current
        ScrollView {
            VStack(spacing: 20) {
                header(txn)

                VStack(spacing: 0) {
                    detailRow("Date", txn.txnDate.formatted(date: .abbreviated, time: .omitted))
                    if let category = model.categoryName(for: txn) {
                        divider
                        detailRow("Category", category)
                    }
                    divider
                    detailRow("Status", txn.status.capitalized)
                    if let channel = txn.sourceChannel {
                        divider
                        detailRow("Source", channel.capitalized)
                    }
                    if txn.isShared {
                        divider
                        detailRow("Shared", "Yes")
                    }
                    if let confidence = txn.confidence {
                        divider
                        detailRow("Extraction confidence", confidence.formatted(.percent.precision(.fractionLength(0))))
                    }
                    if let notes = txn.notes, !notes.isEmpty {
                        divider
                        detailRow("Notes", notes)
                    }
                }
                .card()

                if !txn.lineItems.isEmpty {
                    VStack(spacing: 12) {
                        SectionHeader(title: "Line Items", systemImage: "list.bullet")
                        VStack(spacing: 0) {
                            ForEach(txn.lineItems) { item in
                                HStack {
                                    Text(item.name).font(.subheadline)
                                    Spacer()
                                    MoneyText(amount: item.amount, code: txn.currency, font: .subheadline.weight(.medium))
                                }
                                .padding(.vertical, 8)
                                if item.id != txn.lineItems.last?.id {
                                    Divider()
                                }
                            }
                        }
                        .card()
                    }
                }

                if txn.isDraft {
                    Button {
                        Task { await model.confirm(txn, api: session.api) }
                    } label: {
                        if model.confirmingIds.contains(txn.id) {
                            ProgressView().tint(.white)
                        } else {
                            Label("Confirm Transaction", systemImage: "checkmark.circle.fill")
                                .fontWeight(.semibold)
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.glassProminent)
                    .controlSize(.large)
                    .tint(.green)
                    .disabled(model.confirmingIds.contains(txn.id))
                }
            }
            .padding(20)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Transaction")
        .navigationBarTitleDisplayMode(.inline)
        .scrollEdgeEffectStyle(.soft, for: .top)
    }

    private func header(_ txn: Transaction) -> some View {
        VStack(spacing: 10) {
            Text(txn.displayMerchant)
                .font(.title3.weight(.semibold))
                .multilineTextAlignment(.center)

            MoneyText(
                amount: txn.amount.magnitude,
                code: txn.currency,
                font: .system(size: 40, weight: .bold)
            )
            .foregroundStyle(txn.amount.isNegative ? Color.green : Color.primary)

            StatusBadge(status: txn.status)
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .glassEffect(.regular.tint(.indigo.opacity(0.15)), in: .rect(cornerRadius: 32))
    }

    private var divider: some View {
        Divider().padding(.vertical, 2)
    }

    private func detailRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.subheadline).foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.subheadline.weight(.medium))
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 6)
    }
}
