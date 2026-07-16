import SwiftUI
import AalsiFinanceKit

// Small Form sheets for editing Money-page records. All share the pattern:
// prefilled fields, Save submits via an async closure returning nil on
// success or a user-facing error message shown inline.

// MARK: - Shared scaffolding

private struct EditorScaffold<Fields: View>: View {
    let title: String
    let canSubmit: Bool
    let onSubmit: () async -> String?
    @ViewBuilder let fields: Fields

    @Environment(\.dismiss) private var dismiss
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                fields

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting {
                        ProgressView()
                    } else {
                        Button("Save") { submit() }
                            .disabled(!canSubmit)
                    }
                }
            }
            .interactiveDismissDisabled(isSubmitting)
        }
    }

    private func submit() {
        errorMessage = nil
        isSubmitting = true
        Task {
            let failure = await onSubmit()
            isSubmitting = false
            if let failure {
                errorMessage = failure
            } else {
                dismiss()
            }
        }
    }
}

private func decimalOrNil(_ text: String) -> Money? {
    let trimmed = text.trimmingCharacters(in: .whitespaces)
    guard !trimmed.isEmpty, let value = Decimal(string: trimmed), value >= 0 else { return nil }
    return Money(value)
}

// MARK: - Loan

struct LoanEditorView: View {
    let loan: Loan
    let onSubmit: (LoanPatchRequest) async -> String?

    @State private var name: String
    @State private var principalText: String
    @State private var rateText: String
    @State private var emiText: String
    @State private var dueDay: Int

    init(loan: Loan, onSubmit: @escaping (LoanPatchRequest) async -> String?) {
        self.loan = loan
        self.onSubmit = onSubmit
        _name = State(initialValue: loan.name)
        _principalText = State(initialValue: "\(loan.principal.value)")
        _rateText = State(initialValue: loan.interestRate.map { "\($0.value)" } ?? "")
        _emiText = State(initialValue: loan.minOrEmiAmount.map { "\($0.value)" } ?? "")
        _dueDay = State(initialValue: loan.dueDay ?? 1)
    }

    var body: some View {
        EditorScaffold(
            title: "Edit Loan",
            canSubmit: !name.trimmingCharacters(in: .whitespaces).isEmpty && decimalOrNil(principalText) != nil,
            onSubmit: {
                await onSubmit(LoanPatchRequest(
                    name: name.trimmingCharacters(in: .whitespaces),
                    principal: decimalOrNil(principalText),
                    interestRate: decimalOrNil(rateText),
                    minOrEmiAmount: decimalOrNil(emiText),
                    dueDay: dueDay
                ))
            }
        ) {
            Section("Loan") {
                TextField("Name", text: $name)
                LabeledContent("Principal") {
                    TextField("0", text: $principalText)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                }
                LabeledContent("Interest rate %") {
                    TextField("Optional", text: $rateText)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                }
            }
            Section("Payments") {
                LabeledContent("EMI / minimum") {
                    TextField("Optional", text: $emiText)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                }
                Picker("Due day", selection: $dueDay) {
                    ForEach(1...31, id: \.self) { Text("\($0)").tag($0) }
                }
            }
        }
    }
}

// MARK: - Credit card detail

struct CardDetailEditorView: View {
    let card: CreditCardSummary
    let onSubmit: (CreditCardDetailRequest) async -> String?

    @State private var limitText: String
    @State private var statementText: String
    @State private var statementDay: Int

    init(card: CreditCardSummary, onSubmit: @escaping (CreditCardDetailRequest) async -> String?) {
        self.card = card
        self.onSubmit = onSubmit
        _limitText = State(initialValue: card.creditLimit.map { "\($0.value)" } ?? "")
        _statementText = State(initialValue: card.statementBalance.map { "\($0.value)" } ?? "")
        _statementDay = State(initialValue: card.statementDay ?? 1)
    }

    var body: some View {
        EditorScaffold(
            title: "Edit Card",
            canSubmit: true,
            onSubmit: {
                await onSubmit(CreditCardDetailRequest(
                    creditLimit: decimalOrNil(limitText),
                    statementBalance: decimalOrNil(statementText),
                    statementDay: statementDay
                ))
            }
        ) {
            Section(card.loan.name) {
                LabeledContent("Credit limit") {
                    TextField("Optional", text: $limitText)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                }
                LabeledContent("Statement balance") {
                    TextField("Optional", text: $statementText)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                }
                Picker("Statement day", selection: $statementDay) {
                    ForEach(1...31, id: \.self) { Text("\($0)").tag($0) }
                }
            }
        }
    }
}

// MARK: - Income source

struct IncomeSourceEditorView: View {
    let source: IncomeSource
    let onSubmit: (IncomeSourcePatchRequest) async -> String?

    @State private var employer: String
    @State private var frequency: String
    @State private var currency: String
    @State private var grossText: String
    @State private var netText: String

    private static let frequencies = ["weekly", "biweekly", "semimonthly", "monthly", "quarterly", "annual"]

    init(source: IncomeSource, onSubmit: @escaping (IncomeSourcePatchRequest) async -> String?) {
        self.source = source
        self.onSubmit = onSubmit
        _employer = State(initialValue: source.employer ?? "")
        let normalized = source.frequency.lowercased()
        _frequency = State(initialValue: Self.frequencies.contains(normalized) ? normalized : "monthly")
        _currency = State(initialValue: source.currency)
        _grossText = State(initialValue: source.gross.map { "\($0.value)" } ?? "")
        _netText = State(initialValue: source.net.map { "\($0.value)" } ?? "")
    }

    var body: some View {
        EditorScaffold(
            title: "Edit Income",
            canSubmit: true,
            onSubmit: {
                await onSubmit(IncomeSourcePatchRequest(
                    employer: employer.trimmingCharacters(in: .whitespaces).isEmpty
                        ? nil
                        : employer.trimmingCharacters(in: .whitespaces),
                    currency: currency.trimmingCharacters(in: .whitespaces).uppercased(),
                    frequency: frequency,
                    gross: decimalOrNil(grossText),
                    net: decimalOrNil(netText)
                ))
            }
        ) {
            Section("Source") {
                TextField("Employer", text: $employer)
                Picker("Frequency", selection: $frequency) {
                    ForEach(Self.frequencies, id: \.self) { Text($0.capitalized).tag($0) }
                }
                TextField("Currency", text: $currency)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
            }
            Section("Per paycheck") {
                LabeledContent("Gross") {
                    TextField("Optional", text: $grossText)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                }
                LabeledContent("Net") {
                    TextField("Optional", text: $netText)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                }
            }
        }
    }
}

// MARK: - Holding

struct HoldingEditorView: View {
    let holding: Holding
    let onSubmit: (HoldingPatchRequest) async -> String?

    @State private var name: String
    @State private var symbol: String
    @State private var quantityText: String
    @State private var avgPriceText: String

    init(holding: Holding, onSubmit: @escaping (HoldingPatchRequest) async -> String?) {
        self.holding = holding
        self.onSubmit = onSubmit
        _name = State(initialValue: holding.name)
        _symbol = State(initialValue: holding.symbol ?? "")
        _quantityText = State(initialValue: "\(holding.quantity.value)")
        _avgPriceText = State(initialValue: holding.avgBuyPrice.map { "\($0.value)" } ?? "")
    }

    var body: some View {
        EditorScaffold(
            title: "Edit Holding",
            canSubmit: !name.trimmingCharacters(in: .whitespaces).isEmpty && decimalOrNil(quantityText) != nil,
            onSubmit: {
                await onSubmit(HoldingPatchRequest(
                    name: name.trimmingCharacters(in: .whitespaces),
                    symbol: symbol.trimmingCharacters(in: .whitespaces).isEmpty
                        ? nil
                        : symbol.trimmingCharacters(in: .whitespaces).uppercased(),
                    quantity: decimalOrNil(quantityText),
                    avgBuyPrice: decimalOrNil(avgPriceText)
                ))
            }
        ) {
            Section("Holding") {
                TextField("Name", text: $name)
                TextField("Symbol", text: $symbol)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                LabeledContent("Quantity") {
                    TextField("0", text: $quantityText)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                }
                LabeledContent("Avg buy price") {
                    TextField("Optional", text: $avgPriceText)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                }
            }
        }
    }
}
