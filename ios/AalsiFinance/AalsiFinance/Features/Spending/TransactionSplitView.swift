import AalsiFinanceKit
import SwiftUI

struct TransactionSplitView: View {
    private struct Part: Identifiable {
        let id: UUID
        var magnitude: Decimal
        var categoryID: UUID?
        var notes: String

        init(id: UUID = UUID(), magnitude: Decimal, categoryID: UUID? = nil, notes: String = "") {
            self.id = id
            self.magnitude = magnitude
            self.categoryID = categoryID
            self.notes = notes
        }
    }

    let transaction: AalsiFinanceKit.Transaction
    let categories: [AalsiFinanceKit.Category]
    let onSubmit: ([SplitPartRequest]) async -> Bool
    var mutationError: String?

    @Environment(\.dismiss) private var dismiss
    @State private var parts: [Part]
    @State private var isSubmitting = false

    init(
        transaction: AalsiFinanceKit.Transaction,
        categories: [AalsiFinanceKit.Category],
        retainedParts: [SplitPartRequest]? = nil,
        mutationError: String? = nil,
        onSubmit: @escaping ([SplitPartRequest]) async -> Bool
    ) {
        self.transaction = transaction
        self.categories = categories
        self.mutationError = mutationError
        self.onSubmit = onSubmit
        _parts = State(initialValue: Self.initialParts(for: transaction, retainedParts: retainedParts))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Original") {
                        MoneyText(amount: transaction.amount, code: transaction.currency, font: .body.weight(.semibold))
                    }
                    Text("Assign category amounts that add up to the original signed transaction.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Parts") {
                    ForEach($parts) { $part in
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                TextField("Amount", value: $part.magnitude, format: .number)
                                    .keyboardType(.decimalPad)
                                Text(transaction.currency)
                                    .foregroundStyle(.secondary)
                                if parts.count > 2 {
                                    Button(role: .destructive) {
                                        remove(part.id)
                                    } label: {
                                        Image(systemName: "minus.circle.fill")
                                    }
                                    .accessibilityLabel("Remove split part")
                                }
                            }
                            Picker("Category", selection: $part.categoryID) {
                                Text("Uncategorized").tag(UUID?.none)
                                ForEach(categories) { category in
                                    Text(categoryLabel(for: category)).tag(UUID?.some(category.id))
                                }
                            }
                            TextField("Notes (optional)", text: $part.notes, axis: .vertical)
                                .lineLimit(1...3)
                        }
                        .padding(.vertical, 4)
                    }

                    Button {
                        addPart()
                    } label: {
                        Label("Add Split Part", systemImage: "plus.circle.fill")
                    }
                }

                if let mutationError, !mutationError.isEmpty {
                    Section {
                        Label(mutationError, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                    }
                }

                Section {
                    HStack {
                        Text("Remainder")
                        Spacer()
                        MoneyText(amount: remainder, code: transaction.currency, font: .body.monospacedDigit())
                            .foregroundStyle(remainder.value == 0 ? Color.secondary : Color.red)
                    }
                    Button {
                        submit()
                    } label: {
                        if isSubmitting {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else {
                            Text("Split Transaction")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .disabled(!canSubmit || isSubmitting)
                }
            }
            .navigationTitle("Split Transaction")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isSubmitting)
                }
            }
        }
    }

    private var direction: TransactionDirection {
        transaction.amount.isNegative ? .spend : .income
    }

    private var remainder: Money {
        Money(transaction.amount.value - parts.reduce(Decimal.zero) { total, part in
            total + direction.signed(Money(part.magnitude)).value
        })
    }

    private var canSubmit: Bool {
        parts.count >= 2 && SpendDerivation.splitIsBalanced(
            source: transaction.amount,
            parts: parts.map { direction.signed(Money($0.magnitude)) }
        )
    }

    private var requests: [SplitPartRequest] {
        parts.map {
            SplitPartRequest(
                amount: direction.signed(Money($0.magnitude)),
                categoryId: $0.categoryID,
                notes: optionalText($0.notes)
            )
        }
    }

    private func addPart() {
        parts.append(Part(magnitude: 0))
    }

    private func remove(_ id: UUID) {
        guard parts.count > 2 else { return }
        parts.removeAll { $0.id == id }
    }

    private func categoryLabel(for category: AalsiFinanceKit.Category) -> String {
        guard let parentID = category.parentId,
              let parent = categories.first(where: { $0.id == parentID }) else {
            return category.name
        }
        return "\(parent.name) › \(category.name)"
    }

    private func optionalText(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func submit() {
        guard canSubmit else { return }
        isSubmitting = true
        Task {
            let didSubmit = await onSubmit(requests)
            isSubmitting = false
            if didSubmit {
                dismiss()
            }
        }
    }

    private static func initialParts(
        for transaction: AalsiFinanceKit.Transaction,
        retainedParts: [SplitPartRequest]?
    ) -> [Part] {
        if let retainedParts, retainedParts.count >= 2 {
            return retainedParts.map {
                Part(magnitude: abs($0.amount.value), categoryID: $0.categoryId, notes: $0.notes ?? "")
            }
        }

        let magnitude = abs(transaction.amount.value)
        let first = magnitude / 2
        return [
            Part(magnitude: first, categoryID: transaction.categoryId),
            Part(magnitude: magnitude - first, categoryID: transaction.categoryId)
        ]
    }
}
