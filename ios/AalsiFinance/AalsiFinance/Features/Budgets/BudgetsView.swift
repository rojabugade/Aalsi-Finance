import SwiftUI
import AalsiFinanceKit

struct BudgetsView: View {
    private enum EditorContext: Identifiable {
        case create
        case edit(Budget)

        var id: String {
            switch self {
            case .create: "create"
            case .edit(let budget): "edit-\(budget.id)"
            }
        }
    }

    @Environment(AppSession.self) private var session
    @Environment(AppTheme.self) private var theme
    @State private var budgets: [Budget] = []
    @State private var categories: [AalsiFinanceKit.Category] = []
    @State private var state: Loadable<Bool> = .idle
    @State private var editor: EditorContext?
    @State private var mutationError: String?

    /// Demo households are seeded in USD; budgets carry their own currency.
    private let currency = "USD"

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    AppHeader(title: "Budgets")

                    switch state {
                    case .idle, .loading:
                        VStack(spacing: 14) {
                            LoadingCard(height: 150)
                            LoadingCard(height: 220)
                        }
                        .padding(.horizontal, 20)
                    case .failed(let message):
                        ErrorStateView(message: message) { Task { await load(force: true) } }
                            .padding(.top, 40)
                    case .loaded:
                        if budgets.isEmpty {
                            emptyState
                        } else {
                            content
                        }
                    }
                }
                .padding(.bottom, 24)
            }
            .background(Color(.systemGroupedBackground))
            .scrollEdgeEffectStyle(.soft, for: .top)
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await load(force: true) }
        }
        .task { await load() }
        .sheet(item: $editor) { context in
            editorSheet(context)
        }
    }

    // MARK: - Content

    private var content: some View {
        VStack(spacing: 16) {
            summaryCard

            VStack(spacing: 10) {
                HStack {
                    Text("Monthly budgets")
                        .font(.headline)
                    Spacer()
                    Button {
                        mutationError = nil
                        editor = .create
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .font(.title2)
                    }
                    .accessibilityLabel("New budget")
                }
                .padding(.horizontal, 4)

                VStack(spacing: 0) {
                    ForEach(sortedBudgets) { budget in
                        Button {
                            mutationError = nil
                            editor = .edit(budget)
                        } label: {
                            BudgetRowView(
                                name: name(for: budget),
                                budget: budget,
                                tint: tint(for: budget)
                            )
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)

                        if budget.id != sortedBudgets.last?.id {
                            Divider().padding(.vertical, 4)
                        }
                    }
                }
                .card()
            }
        }
        .padding(.horizontal, 20)
    }

    /// The one number budgets exist to answer: how much is safe to spend.
    private var summaryCard: some View {
        let budgeted = budgets.reduce(Decimal.zero) { $0 + $1.amount.value }
        let spent = budgets.reduce(Decimal.zero) { $0 + $1.spent.value }
        let left = budgeted - spent
        let usage = budgeted > 0 ? min(max(NSDecimalNumber(decimal: spent / budgeted).doubleValue, 0), 1) : 0

        return VStack(alignment: .leading, spacing: 10) {
            Text(left < 0 ? "Over budget in \(monthName)" : "Left to spend in \(monthName)")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)

            MoneyText(
                amount: Money(left).magnitude,
                code: currency,
                font: .system(.largeTitle, design: .rounded, weight: .bold)
            )

            ProgressView(value: usage)
                .tint(left < 0 ? .red : usage > 0.85 ? .orange : theme.accentColor)

            HStack {
                Text("\(Money(spent).compact(code: currency)) of \(Money(budgeted).compact(code: currency)) spent")
                Spacer()
                Text(daysLeftLabel)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .monospacedDigit()
        }
        .card()
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No budgets yet", systemImage: "chart.pie")
        } description: {
            Text("Set a monthly limit per category and track how much is safe to spend.")
        } actions: {
            Button {
                mutationError = nil
                editor = .create
            } label: {
                Label("Create Budget", systemImage: "plus")
            }
            .buttonStyle(.glassProminent)
        }
        .padding(.top, 40)
    }

    @ViewBuilder
    private func editorSheet(_ context: EditorContext) -> some View {
        switch context {
        case .create:
            BudgetEditorView(
                mode: .create,
                categories: eligibleCategories(excludingCurrent: nil),
                currency: currency,
                mutationError: mutationError,
                onSubmit: { request in await createBudget(request) },
                onDelete: nil
            )
        case .edit(let budget):
            BudgetEditorView(
                mode: .edit(budget),
                categories: eligibleCategories(excludingCurrent: budget.categoryId),
                currency: currency,
                mutationError: mutationError,
                onSubmit: { request in await updateBudget(id: budget.id, request) },
                onDelete: { await deleteBudget(id: budget.id) }
            )
        }
    }

    // MARK: - Derivations

    private var sortedBudgets: [Budget] {
        budgets.sorted {
            let lhs = $0.progressPct.doubleValue
            let rhs = $1.progressPct.doubleValue
            if lhs != rhs { return lhs > rhs }
            return name(for: $0).localizedStandardCompare(name(for: $1)) == .orderedAscending
        }
    }

    private func name(for budget: Budget) -> String {
        guard let id = budget.categoryId else { return "Overall" }
        return categories.first { $0.id == id }?.name ?? "Category"
    }

    private func tint(for budget: Budget) -> Color {
        if budget.overspent { return .red }
        return budget.progressPct.doubleValue > 85 ? .orange : theme.accentColor
    }

    /// Root spending categories that don't already carry a budget; the
    /// current selection stays offered while editing.
    private func eligibleCategories(excludingCurrent current: UUID?) -> [AalsiFinanceKit.Category] {
        let taken = Set(budgets.compactMap(\.categoryId)).subtracting([current].compactMap { $0 })
        return categories
            .filter { $0.parentId == nil && $0.kind == "category" && !taken.contains($0.id) }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    private var monthName: String {
        Date.now.formatted(.dateTime.month(.wide))
    }

    private var daysLeftLabel: String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let day = cal.component(.day, from: .now)
        let total = cal.range(of: .day, in: .month, for: .now)?.count ?? 30
        let left = max(total - day, 0)
        return left == 1 ? "1 day left" : "\(left) days left"
    }

    // MARK: - Networking

    private func load(force: Bool = false) async {
        if case .loaded = state, !force { return }
        if case .idle = state { state = .loading }
        do {
            async let budgetList = session.api.budgets()
            async let categoryList = session.api.categories()
            budgets = try await budgetList
            categories = try await categoryList
            state = .loaded(true)
        } catch {
            if case .loaded = state {} else { state = .failed(error.localizedDescription) }
        }
    }

    private func createBudget(_ request: BudgetUpsertRequest) async -> Bool {
        do {
            let created = try await session.api.createBudget(request)
            budgets.append(created)
            mutationError = nil
            return true
        } catch {
            mutationError = error.localizedDescription
            return false
        }
    }

    private func updateBudget(id: UUID, _ request: BudgetUpsertRequest) async -> Bool {
        do {
            let updated = try await session.api.patchBudget(id: id, body: request)
            if let index = budgets.firstIndex(where: { $0.id == id }) {
                budgets[index] = updated
            }
            mutationError = nil
            return true
        } catch {
            mutationError = error.localizedDescription
            return false
        }
    }

    private func deleteBudget(id: UUID) async -> Bool {
        do {
            try await session.api.deleteBudget(id: id)
            budgets.removeAll { $0.id == id }
            mutationError = nil
            return true
        } catch {
            mutationError = error.localizedDescription
            return false
        }
    }
}

// MARK: - Row

private struct BudgetRowView: View {
    let name: String
    let budget: Budget
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline) {
                Text(name)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                Spacer(minLength: 8)
                trailingLabel
            }

            ProgressView(value: min(max(budget.progressPct.doubleValue / 100, 0), 1))
                .tint(tint)

            Text("\(budget.spent.compact(code: budget.currency)) of \(budget.amount.compact(code: budget.currency))")
                .font(.caption)
                .foregroundStyle(.secondary)
                .monospacedDigit()
        }
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private var trailingLabel: some View {
        if budget.overspent {
            Text("over by \(budget.remaining.magnitude.compact(code: budget.currency))")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.red)
                .monospacedDigit()
        } else {
            HStack(spacing: 3) {
                MoneyText(amount: budget.remaining, code: budget.currency, font: .subheadline.weight(.semibold))
                Text("left")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - Editor

private struct BudgetEditorView: View {
    enum Mode {
        case create
        case edit(Budget)

        var title: String {
            switch self {
            case .create: "New Budget"
            case .edit: "Edit Budget"
            }
        }
    }

    let mode: Mode
    let categories: [AalsiFinanceKit.Category]
    let currency: String
    var mutationError: String?
    let onSubmit: (BudgetUpsertRequest) async -> Bool
    let onDelete: (() async -> Bool)?

    @Environment(\.dismiss) private var dismiss
    @State private var categoryID: UUID?
    @State private var amount: String
    @State private var showsValidation = false
    @State private var isSubmitting = false
    @State private var showsDeleteConfirm = false

    init(
        mode: Mode,
        categories: [AalsiFinanceKit.Category],
        currency: String,
        mutationError: String? = nil,
        onSubmit: @escaping (BudgetUpsertRequest) async -> Bool,
        onDelete: (() async -> Bool)?
    ) {
        self.mode = mode
        self.categories = categories
        self.currency = currency
        self.mutationError = mutationError
        self.onSubmit = onSubmit
        self.onDelete = onDelete
        switch mode {
        case .create:
            _categoryID = State(initialValue: categories.first?.id)
            _amount = State(initialValue: "")
        case .edit(let budget):
            _categoryID = State(initialValue: budget.categoryId)
            _amount = State(initialValue: NSDecimalNumber(decimal: budget.amount.value).stringValue)
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Category") {
                    // The backend can't clear a budget's category on PATCH,
                    // so identity is fixed after creation — edit the limit,
                    // or delete and recreate for a different category.
                    if case .edit = mode {
                        LabeledContent("Category", value: currentCategoryName)
                    } else {
                        Picker("Category", selection: $categoryID) {
                            Text("Overall").tag(UUID?.none)
                            ForEach(categories) { category in
                                Text(category.name).tag(UUID?.some(category.id))
                            }
                        }
                    }
                }

                Section {
                    TextField("0.00", text: $amount)
                        .keyboardType(.decimalPad)
                        .monospacedDigit()
                    if showsValidation, let amountError {
                        Text(amountError)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                } header: {
                    Text("Monthly limit (\(currency))")
                } footer: {
                    Text("Spending in this category counts toward the limit each month.")
                }

                if let mutationError {
                    Section {
                        Label(mutationError, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }

                if onDelete != nil {
                    Section {
                        Button("Delete Budget", role: .destructive) {
                            showsDeleteConfirm = true
                        }
                        .disabled(isSubmitting)
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
                    if isSubmitting {
                        ProgressView()
                    } else {
                        Button("Save") { submit() }
                    }
                }
            }
            .confirmationDialog(
                "Delete this budget?",
                isPresented: $showsDeleteConfirm,
                titleVisibility: .visible
            ) {
                Button("Delete Budget", role: .destructive) {
                    guard let onDelete else { return }
                    isSubmitting = true
                    Task {
                        let success = await onDelete()
                        isSubmitting = false
                        if success { dismiss() }
                    }
                }
            } message: {
                Text("Transactions are unaffected — only the limit goes away.")
            }
            .interactiveDismissDisabled(isSubmitting)
        }
    }

    private var currentCategoryName: String {
        guard let categoryID else { return "Overall" }
        return categories.first { $0.id == categoryID }?.name ?? "Category"
    }

    private var amountError: String? {
        let text = amount.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let value = Decimal(string: text, locale: .current), value > 0 else {
            return "Enter a limit greater than zero."
        }
        return nil
    }

    private func submit() {
        showsValidation = true
        guard amountError == nil else { return }
        let text = amount.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let value = Decimal(string: text, locale: .current) else { return }
        isSubmitting = true
        Task {
            let success = await onSubmit(BudgetUpsertRequest(
                categoryId: categoryID,
                amount: Money(value),
                currency: currency
            ))
            isSubmitting = false
            if success { dismiss() }
        }
    }
}
