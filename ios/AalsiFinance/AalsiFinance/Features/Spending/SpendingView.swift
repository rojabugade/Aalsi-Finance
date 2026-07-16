import AalsiFinanceKit
import SwiftUI

struct SpendingView: View {
    private enum SpendingSheet: Identifiable {
        case create
        case edit(AalsiFinanceKit.Transaction)
        case split(AalsiFinanceKit.Transaction)
        case trackRecurring(RecurringSpendRow?)
        case editRecurring(RecurringSeries)

        var id: String {
            switch self {
            case .create: "create"
            case .edit(let transaction): "edit-\(transaction.id)"
            case .split(let transaction): "split-\(transaction.id)"
            case .trackRecurring(let row): "track-recurring-\(row?.id ?? "new")"
            case .editRecurring(let series): "edit-recurring-\(series.id)"
            }
        }
    }

    @Environment(AppSession.self) private var session
    @State private var model: SpendingViewModel
    @State private var sheet: SpendingSheet?
    @State private var recurringActionError: String?

    init() {
        let model = SpendingViewModel()
        #if DEBUG
        // Test hook: lets simulator automation open a specific pill directly.
        if let raw = ProcessInfo.processInfo.environment["AALSI_INITIAL_SPEND_PILL"],
           let value = Int(raw),
           let pill = SpendingPill(rawValue: value) {
            model.state.selectedPill = pill
        }
        if ProcessInfo.processInfo.environment["AALSI_SPEND_SELECTING"] == "1" {
            model.state.isSelecting = true
        }
        #endif
        _model = State(initialValue: model)
    }

    private static let pills = ["Overview", "Activity", "Recurring"]

    /// Demo households are seeded in USD; the transaction contracts carry
    /// per-row currency so rows never mislabel foreign amounts.
    private let currency = "USD"

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.state.navigationPath) {
            ScrollView {
                VStack(spacing: 14) {
                    AppHeader(title: "Spending")
                    pillRow
                    content
                }
                .padding(.bottom, 24)
            }
            .background(Color(.systemGroupedBackground))
            .scrollEdgeEffectStyle(.soft, for: .top)
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await model.load(api: session.api, force: true) }
            .navigationDestination(for: SpendingRoute.self) { route in
                destination(for: route)
            }
            .safeAreaInset(edge: .bottom) {
                if model.state.isSelecting {
                    SpendMergeBar(
                        selectedCount: model.state.selectedTransactionIDs.count,
                        isMutating: model.state.isMutating,
                        onMerge: {
                            Task {
                                await model.mergeTransactions(
                                    ids: Array(model.state.selectedTransactionIDs),
                                    api: session.api
                                )
                            }
                        }
                    )
                }
            }
        }
        .task { await model.load(api: session.api) }
        .sheet(item: $sheet) { sheet in
            sheetContent(sheet)
        }
        .alert(
            "Couldn't update recurring",
            isPresented: Binding(
                get: { recurringActionError != nil },
                set: { if !$0 { recurringActionError = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(recurringActionError ?? "")
        }
    }

    private var pillRow: some View {
        @Bindable var model = model
        return HStack(spacing: 4) {
            PillNav(items: Self.pills, selection: $model.state.selectedPillIndex)

            Button {
                sheet = .create
            } label: {
                Image(systemName: "plus.circle.fill")
                    .font(.title2)
            }
            .disabled(model.state.coreSnapshot == nil)
            .accessibilityLabel("Add transaction")
            .padding(.trailing, 20)
        }
    }

    @ViewBuilder
    private var content: some View {
        if let snapshot = model.state.coreSnapshot {
            let period = model.state.period()
            // Month navigation lives above the pill content so Overview and
            // Activity stay on the same period without duplicating controls.
            if model.state.selectedPill != .recurring {
                MonthSelector(
                    monthStart: period.monthStart,
                    canGoForward: !period.isCurrentMonth,
                    onPrevious: { shiftMonth(-1) },
                    onNext: { shiftMonth(1) }
                )
                .padding(.horizontal, 20)
            }
            switch model.state.selectedPill {
            case .overview:
                SpendingOverview(
                    period: period,
                    overview: snapshot.overview(period: period),
                    currency: currency,
                    onRoute: push
                )
            case .activity:
                SpendingActivity(
                    snapshot: snapshot,
                    period: period,
                    filter: model.state.filter,
                    currency: currency,
                    isSelecting: model.state.isSelecting,
                    selectedTransactionIDs: model.state.selectedTransactionIDs,
                    onFilterChange: { model.state.filter = $0 },
                    onToggleSelection: { model.toggleSelection($0) },
                    onRoute: push,
                    onConfirm: { transaction in
                        Task { await model.confirmTransaction(id: transaction.id, api: session.api) }
                    },
                    onBeginSelection: { model.beginSelection() },
                    onEndSelection: { model.endSelection() }
                )
            case .recurring:
                SpendingRecurring(
                    rows: snapshot.recurringRows,
                    monthlyTotal: snapshot.recurringMonthlyTotal(currency: currency),
                    currency: currency,
                    isLoading: model.state.isRecurringLoading,
                    canonicalError: model.state.recurringError,
                    onRetry: {
                        Task { await model.refreshRecurring(api: session.api) }
                    },
                    onRoute: push,
                    onEdit: { row in
                        if let series = canonicalSeries(for: row) {
                            sheet = .editRecurring(series)
                        }
                    },
                    onDelete: { row in
                        guard let id = row.seriesId else { return }
                        Task {
                            recurringActionError = await model.deleteRecurringSeries(id: id, api: session.api)
                        }
                    },
                    onTrack: { row in
                        sheet = .trackRecurring(row)
                    }
                )
            }
        } else if let error = model.state.coreError {
            ErrorStateView(message: error) {
                Task { await model.load(api: session.api, force: true) }
            }
            .padding(.top, 40)
        } else {
            VStack(spacing: 14) {
                LoadingCard(height: 150)
                LoadingCard(height: 90)
                LoadingCard(height: 220)
            }
            .padding(.horizontal, 20)
        }
    }

    @ViewBuilder
    private func destination(for route: SpendingRoute) -> some View {
        let snapshot = model.state.coreSnapshot ?? SpendingSnapshot(
            transactions: [],
            categories: [],
            canonicalRecurring: []
        )
        let period = model.state.period()

        switch route {
        case .category(let id):
            CategoryDrillView(
                categoryID: id,
                snapshot: snapshot,
                period: period,
                currency: currency,
                onRoute: push
            )
        case .merchant(let key):
            MerchantDrillView(
                merchantKey: key,
                snapshot: snapshot,
                period: period,
                currency: currency,
                onRoute: push
            )
        case .transaction(let id):
            if let transaction = transaction(for: id) {
                TransactionDetailView(
                    transaction: transaction,
                    categoryName: { categoryDisplayName(for: $0) },
                    currentTransaction: { self.transaction(for: id) },
                    mutationError: { model.state.mutationError },
                    onEdit: { sheet = .edit($0) },
                    onSplit: { sheet = .split($0) },
                    onConfirm: { await model.confirmTransaction(id: $0.id, api: session.api) },
                    onDelete: { await model.deleteTransaction(id: $0.id, api: session.api) }
                )
            } else {
                ContentUnavailableView(
                    "Transaction unavailable",
                    systemImage: "tray",
                    description: Text("This transaction is no longer in the loaded data.")
                )
            }
        }
    }

    @ViewBuilder
    private func sheetContent(_ sheet: SpendingSheet) -> some View {
        let categories = model.state.coreSnapshot?.categories ?? []

        switch sheet {
        case .create:
            TransactionEditorView(
                mode: .create,
                categories: categories,
                currency: currency,
                retainedDraft: model.state.editorDraft,
                mutationError: model.state.mutationError,
                onSubmit: { draft in
                    await model.createTransaction(api: session.api, draft: draft)
                }
            )
        case .edit(let transaction):
            TransactionEditorView(
                mode: .edit(transaction),
                categories: categories,
                currency: transaction.currency,
                mutationError: model.state.mutationError,
                onSubmit: { draft in
                    await model.patchTransaction(id: transaction.id, api: session.api, draft: draft)
                }
            )
        case .split(let transaction):
            TransactionSplitView(
                transaction: transaction,
                categories: categories,
                retainedParts: model.state.splitDraft,
                mutationError: model.state.mutationError,
                onSubmit: { parts in
                    await model.splitTransaction(
                        id: transaction.id,
                        sourceAmount: transaction.amount,
                        parts: parts,
                        api: session.api
                    )
                }
            )
        case .trackRecurring(let prefill):
            RecurringSeriesEditorView(mode: .create(prefill: prefill)) { body in
                await model.createRecurringSeries(api: session.api, body: body)
            }
        case .editRecurring(let series):
            RecurringSeriesEditorView(mode: .edit(series)) { body in
                await model.patchRecurringSeries(id: series.id, api: session.api, body: body)
            }
        }
    }

    private func canonicalSeries(for row: RecurringSpendRow) -> RecurringSeries? {
        guard let id = row.seriesId else { return nil }
        return model.state.canonicalRecurring.first { $0.id == id }
    }

    private func push(_ route: SpendingRoute) {
        model.state.navigationPath.append(route)
    }

    private func transaction(for id: UUID) -> AalsiFinanceKit.Transaction? {
        model.state.coreSnapshot?.transactions.first { $0.id == id }
    }

    private func categoryDisplayName(for transaction: AalsiFinanceKit.Transaction) -> String? {
        guard let snapshot = model.state.coreSnapshot else { return nil }
        let name = snapshot.categoryPath(for: transaction.categoryId).displayName
        return name.isEmpty ? nil : name
    }

    private func shiftMonth(_ delta: Int) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let shifted = calendar.date(byAdding: .month, value: delta, to: model.state.monthStart) else {
            return
        }
        model.state.monthStart = shifted
    }
}
