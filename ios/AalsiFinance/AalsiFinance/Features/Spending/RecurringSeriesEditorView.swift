import SwiftUI
import AalsiFinanceKit

/// Create/edit form for a tracked recurring series. Create mode is also the
/// "Track this" path for inferred rows, arriving prefilled from the pattern.
struct RecurringSeriesEditorView: View {
    enum Mode {
        case create(prefill: RecurringSpendRow?)
        case edit(RecurringSeries)
    }

    let mode: Mode
    /// Returns nil on success, or a user-facing error message.
    let onSubmit: (RecurringSeriesUpsertRequest) async -> String?

    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var amountText = ""
    @State private var currency = "USD"
    @State private var cadence = "monthly"
    @State private var type = "subscription"
    @State private var hasNextDueDate = false
    @State private var nextDueDate = Date.now
    @State private var isPaused = false
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private static let cadences = ["weekly", "biweekly", "monthly", "quarterly", "annual", "irregular"]
    private static let types = ["subscription", "bill", "income", "transfer", "other"]

    private var isEditing: Bool {
        if case .edit = mode { return true }
        return false
    }

    private var canSubmit: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && parsedAmount != nil && !isSubmitting
    }

    private var parsedAmount: Money? {
        guard let value = Decimal(string: amountText.trimmingCharacters(in: .whitespaces)),
              value > 0 else { return nil }
        return Money(value)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Details") {
                    TextField("Name", text: $name)
                    HStack {
                        TextField("Amount", text: $amountText)
                            .keyboardType(.decimalPad)
                        TextField("USD", text: $currency)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .frame(width: 72)
                            .multilineTextAlignment(.trailing)
                    }
                }

                Section("Schedule") {
                    Picker("Repeats", selection: $cadence) {
                        ForEach(Self.cadences, id: \.self) { Text($0.capitalized).tag($0) }
                    }
                    Picker("Type", selection: $type) {
                        ForEach(Self.types, id: \.self) { Text($0.capitalized).tag($0) }
                    }
                    Toggle("Next charge date", isOn: $hasNextDueDate.animation())
                    if hasNextDueDate {
                        DatePicker("Next charge", selection: $nextDueDate, displayedComponents: .date)
                    }
                }

                if isEditing {
                    Section {
                        Toggle("Paused", isOn: $isPaused)
                    } footer: {
                        Text("Paused series stay saved but drop out of your monthly commitment.")
                    }
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(isEditing ? "Edit Recurring" : "Track Recurring")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isEditing ? "Save" : "Track") { submit() }
                        .disabled(!canSubmit)
                }
            }
            .interactiveDismissDisabled(isSubmitting)
        }
        .onAppear(perform: populate)
    }

    private func populate() {
        switch mode {
        case .create(let prefill):
            guard let prefill else { return }
            name = prefill.name
            amountText = prefill.amount.magnitude.value == 0 ? "" : "\(prefill.amount.magnitude.value)"
            currency = prefill.currency
            cadence = Self.cadences.contains(prefill.cadence.lowercased()) ? prefill.cadence.lowercased() : "monthly"
            if let due = prefill.nextDueDate {
                hasNextDueDate = true
                nextDueDate = due
            }
        case .edit(let series):
            name = series.name
            if let amount = series.amount {
                amountText = "\(amount.magnitude.value)"
            }
            currency = series.currency
            cadence = Self.cadences.contains(series.cadence.lowercased()) ? series.cadence.lowercased() : "monthly"
            type = Self.types.contains(series.type.lowercased()) ? series.type.lowercased() : "other"
            if let due = series.nextDueDate {
                hasNextDueDate = true
                nextDueDate = due
            }
            isPaused = series.status.lowercased() == "paused"
        }
    }

    private func submit() {
        errorMessage = nil
        isSubmitting = true
        let body = RecurringSeriesUpsertRequest(
            name: name.trimmingCharacters(in: .whitespaces),
            amount: parsedAmount,
            currency: currency.trimmingCharacters(in: .whitespaces).uppercased(),
            cadence: cadence,
            type: type,
            status: isEditing ? (isPaused ? "paused" : "active") : "active",
            nextDueDate: hasNextDueDate ? nextDueDate : nil
        )
        Task {
            let failure = await onSubmit(body)
            isSubmitting = false
            if let failure {
                errorMessage = failure
            } else {
                dismiss()
            }
        }
    }
}
