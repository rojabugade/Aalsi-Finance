import AalsiFinanceKit
import SwiftUI

struct TransactionEditorView: View {
    enum Mode {
        case create
        case edit(AalsiFinanceKit.Transaction)

        var title: String {
            switch self {
            case .create: "New Transaction"
            case .edit: "Edit Transaction"
            }
        }

        var submitTitle: String {
            switch self {
            case .create: "Create Transaction"
            case .edit: "Save Changes"
            }
        }
    }

    let mode: Mode
    let categories: [AalsiFinanceKit.Category]
    let onSubmit: (TransactionEditorDraft) async -> Bool
    var mutationError: String?

    @Environment(\.dismiss) private var dismiss
    @State private var amount: String
    @State private var direction: TransactionDirection
    @State private var merchant: String
    @State private var currency: String
    @State private var date: Date
    @State private var parentCategoryID: UUID?
    @State private var categoryID: UUID?
    @State private var status: String
    @State private var notes: String
    @State private var showsValidation = false
    @State private var isSubmitting = false

    init(
        mode: Mode,
        categories: [AalsiFinanceKit.Category],
        currency: String = "USD",
        retainedDraft: TransactionEditorDraft? = nil,
        mutationError: String? = nil,
        onSubmit: @escaping (TransactionEditorDraft) async -> Bool
    ) {
        let draft = retainedDraft ?? Self.initialDraft(for: mode, currency: currency)
        self.mode = mode
        self.categories = categories
        self.mutationError = mutationError
        self.onSubmit = onSubmit
        _amount = State(initialValue: draft.amount)
        _direction = State(initialValue: draft.direction)
        _merchant = State(initialValue: draft.merchant)
        _currency = State(initialValue: draft.currency)
        _date = State(initialValue: draft.date)
        _parentCategoryID = State(initialValue: Self.rootCategoryID(for: draft.categoryId, categories: categories))
        _categoryID = State(initialValue: draft.categoryId)
        _status = State(initialValue: draft.status)
        _notes = State(initialValue: draft.notes)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Amount") {
                    TextField("Amount", text: $amount)
                        .keyboardType(.decimalPad)
                    if showsValidation, amountError != nil {
                        validationMessage(amountError!)
                    }

                    Picker("Direction", selection: $direction) {
                        Text("Expense").tag(TransactionDirection.spend)
                        Text("Income").tag(TransactionDirection.income)
                    }
                    .pickerStyle(.segmented)
                }

                Section("Details") {
                    TextField("Merchant", text: $merchant)
                    TextField("Currency", text: $currency)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                    if showsValidation, currencyError != nil {
                        validationMessage(currencyError!)
                    }
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    if showsValidation, dateError != nil {
                        validationMessage(dateError!)
                    }
                }

                Section("Category") {
                    Picker("Category", selection: $parentCategoryID) {
                        Text("Uncategorized").tag(UUID?.none)
                        ForEach(rootCategories) { category in
                            Text(category.name).tag(UUID?.some(category.id))
                        }
                    }
                    .onChange(of: parentCategoryID) { _, parentID in
                        guard let parentID else {
                            categoryID = nil
                            return
                        }
                        if categoryID != parentID, !childCategories.contains(where: { $0.id == categoryID }) {
                            categoryID = parentID
                        }
                    }

                    if !childCategories.isEmpty {
                        Picker("Subcategory", selection: $categoryID) {
                            if let parentCategoryID {
                                Text("All \(categoryName(for: parentCategoryID))")
                                    .tag(UUID?.some(parentCategoryID))
                            }
                            ForEach(childCategories) { category in
                                Text(category.name).tag(UUID?.some(category.id))
                            }
                        }
                    }
                }

                Section("Review") {
                    Picker("Status", selection: $status) {
                        Text("Draft").tag("draft")
                        Text("Confirmed").tag("confirmed")
                    }
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                }

                if let mutationError, !mutationError.isEmpty {
                    Section {
                        Label(mutationError, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(mode.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isSubmitting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(mode.submitTitle) {
                        submit()
                    }
                    .disabled(isSubmitting)
                }
            }
        }
    }

    private var draft: TransactionEditorDraft {
        TransactionEditorDraft(
            amount: amount,
            direction: direction,
            merchant: merchant,
            currency: currency,
            date: date,
            categoryId: categoryID,
            status: status,
            notes: notes
        )
    }

    private var amountError: String? {
        let text = amount.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let value = Decimal(string: text), value > 0 else {
            return "Enter an amount greater than zero."
        }
        return nil
    }

    private var currencyError: String? {
        currency.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Enter a currency." : nil
    }

    private var dateError: String? {
        date.timeIntervalSinceReferenceDate.isFinite ? nil : "Enter a valid date."
    }

    private var rootCategories: [AalsiFinanceKit.Category] {
        categories.filter { $0.parentId == nil }
    }

    private var childCategories: [AalsiFinanceKit.Category] {
        guard let parentCategoryID else { return [] }
        return categories.filter { $0.parentId == parentCategoryID }
    }

    private func categoryName(for id: UUID) -> String {
        categories.first(where: { $0.id == id })?.name ?? "Category"
    }

    private func validationMessage(_ message: String) -> some View {
        Label(message, systemImage: "exclamationmark.circle.fill")
            .font(.footnote)
            .foregroundStyle(.red)
    }

    private func submit() {
        showsValidation = true
        guard amountError == nil, currencyError == nil, dateError == nil else { return }
        isSubmitting = true
        Task {
            let didSubmit = await onSubmit(draft)
            isSubmitting = false
            if didSubmit {
                dismiss()
            }
        }
    }

    private static func initialDraft(for mode: Mode, currency: String) -> TransactionEditorDraft {
        switch mode {
        case .create:
            TransactionEditorDraft(
                amount: "",
                direction: .spend,
                merchant: "",
                currency: currency,
                status: "draft"
            )
        case .edit(let transaction):
            TransactionEditorDraft(
                amount: NSDecimalNumber(decimal: abs(transaction.amount.value)).stringValue,
                direction: transaction.amount.isNegative ? .spend : .income,
                merchant: transaction.merchant ?? "",
                currency: transaction.currency,
                date: transaction.txnDate,
                categoryId: transaction.categoryId,
                status: transaction.status,
                notes: transaction.notes ?? ""
            )
        }
    }

    private static func rootCategoryID(
        for categoryID: UUID?,
        categories: [AalsiFinanceKit.Category]
    ) -> UUID? {
        guard var currentID = categoryID else { return nil }
        let categoriesByID = Dictionary(uniqueKeysWithValues: categories.map { ($0.id, $0) })
        var visited = Set<UUID>()
        while visited.insert(currentID).inserted, let category = categoriesByID[currentID] {
            guard let parentID = category.parentId else { return category.id }
            currentID = parentID
        }
        return nil
    }
}
