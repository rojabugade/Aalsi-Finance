import AalsiFinanceKit
import SwiftUI

struct TransactionDetailView: View {
    let transaction: AalsiFinanceKit.Transaction
    private let categoryName: (AalsiFinanceKit.Transaction) -> String?
    private let currentTransaction: () -> AalsiFinanceKit.Transaction?
    private let onEdit: (AalsiFinanceKit.Transaction) -> Void
    private let onSplit: (AalsiFinanceKit.Transaction) -> Void
    private let onConfirm: (AalsiFinanceKit.Transaction) async -> Bool
    private let onDelete: (AalsiFinanceKit.Transaction) async -> Bool
    private let mutationError: () -> String?
    private let legacyModel: ActivityViewModel?
    private let showsLifecycleActions: Bool

    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var showsDeleteConfirmation = false
    @State private var isMutating = false

    init(
        transaction: AalsiFinanceKit.Transaction,
        categoryName: @escaping (AalsiFinanceKit.Transaction) -> String? = { _ in nil },
        currentTransaction: @escaping () -> AalsiFinanceKit.Transaction? = { nil },
        mutationError: @escaping () -> String? = { nil },
        onEdit: @escaping (AalsiFinanceKit.Transaction) -> Void = { _ in },
        onSplit: @escaping (AalsiFinanceKit.Transaction) -> Void = { _ in },
        onConfirm: @escaping (AalsiFinanceKit.Transaction) async -> Bool = { _ in false },
        onDelete: @escaping (AalsiFinanceKit.Transaction) async -> Bool = { _ in false }
    ) {
        self.transaction = transaction
        self.categoryName = categoryName
        self.currentTransaction = currentTransaction
        self.mutationError = mutationError
        self.onEdit = onEdit
        self.onSplit = onSplit
        self.onConfirm = onConfirm
        self.onDelete = onDelete
        legacyModel = nil
        showsLifecycleActions = true
    }

    /// Compatibility for the legacy Activity screen. New Spending callers use
    /// the closure-based initializer above so this detail view has no feature
    /// model dependency in its normal lifecycle API.
    init(transaction: AalsiFinanceKit.Transaction, model: ActivityViewModel) {
        self.transaction = transaction
        categoryName = { model.categoryName(for: $0) }
        currentTransaction = { model.state.value?.first(where: { $0.id == transaction.id }) }
        mutationError = { model.actionError }
        onEdit = { _ in }
        onSplit = { _ in }
        onConfirm = { _ in false }
        onDelete = { _ in false }
        legacyModel = model
        showsLifecycleActions = false
    }

    private var current: AalsiFinanceKit.Transaction {
        currentTransaction() ?? transaction
    }

    var body: some View {
        let txn = current
        ScrollView {
            VStack(spacing: 20) {
                header(txn)

                VStack(spacing: 0) {
                    detailRow("Date", txn.txnDate.formatted(date: .abbreviated, time: .omitted))
                    if let category = categoryName(txn) {
                        divider
                        detailRow("Category", category)
                    }
                    divider
                    detailRow("Status", txn.status.capitalized)
                    if let channel = txn.sourceChannel {
                        divider
                        detailRow("Source", channel.capitalized)
                    }
                    if txn.sourceDocumentId != nil {
                        divider
                        detailRow("Source document", "Attached")
                    }
                    if txn.recurringSeriesId != nil {
                        divider
                        detailRow("Recurring", "Linked")
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

                if let error = mutationError(), !error.isEmpty {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(20)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Transaction")
        .navigationBarTitleDisplayMode(.inline)
        .scrollEdgeEffectStyle(.soft, for: .top)
        .toolbar {
            if showsLifecycleActions || txn.isDraft {
                ToolbarItem(placement: .topBarTrailing) {
                    actionsMenu(for: txn)
                }
            }
        }
        .confirmationDialog(
            "Delete this transaction?",
            isPresented: $showsDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete Transaction", role: .destructive) {
                delete(txn)
            }
        } message: {
            Text("This action cannot be undone.")
        }
    }

    private func actionsMenu(for txn: AalsiFinanceKit.Transaction) -> some View {
        Menu {
            if showsLifecycleActions {
                Button {
                    onEdit(txn)
                } label: {
                    Label("Edit", systemImage: "pencil")
                }
                .disabled(isMutating)

                Button {
                    onSplit(txn)
                } label: {
                    Label("Split", systemImage: "rectangle.split.2x1")
                }
                .disabled(isMutating)
            }

            if txn.isDraft {
                Button {
                    confirm(txn)
                } label: {
                    Label("Confirm", systemImage: "checkmark.circle.fill")
                }
                .disabled(isMutating)
            }

            if showsLifecycleActions {
                Divider()

                Button(role: .destructive) {
                    showsDeleteConfirmation = true
                } label: {
                    Label("Delete", systemImage: "trash")
                }
                .disabled(isMutating)
            }
        } label: {
            if isMutating {
                ProgressView()
            } else {
                Label("Actions", systemImage: "ellipsis.circle")
            }
        }
    }

    private func confirm(_ transaction: AalsiFinanceKit.Transaction) {
        isMutating = true
        Task {
            if let legacyModel {
                await legacyModel.confirm(transaction, api: session.api)
            } else {
                _ = await onConfirm(transaction)
            }
            isMutating = false
        }
    }

    private func delete(_ transaction: AalsiFinanceKit.Transaction) {
        isMutating = true
        Task {
            let didDelete = await onDelete(transaction)
            isMutating = false
            if didDelete {
                dismiss()
            }
        }
    }

    private func header(_ txn: AalsiFinanceKit.Transaction) -> some View {
        VStack(spacing: 10) {
            Text(txn.displayMerchant)
                .font(.title3.weight(.semibold))
                .multilineTextAlignment(.center)

            MoneyText(
                amount: txn.amount.magnitude,
                code: txn.currency,
                font: .system(size: 40, weight: .bold)
            )
            .foregroundStyle(txn.amount.isNegative ? Color.primary : Color.green)

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
