import SwiftUI

struct ActivityView: View {
    @Environment(AppSession.self) private var session
    @State private var model = ActivityViewModel()

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            Group {
                switch model.state {
                case .idle, .loading:
                    ProgressView().controlSize(.large)
                case .failed(let message):
                    ErrorStateView(message: message) {
                        Task { await model.load(api: session.api, force: true) }
                    }
                case .loaded(let transactions):
                    if transactions.isEmpty {
                        ContentUnavailableView(
                            "No transactions yet",
                            systemImage: "tray",
                            description: Text("Once transactions land — from Plaid, receipts, or manual entry — they'll appear here.")
                        )
                    } else {
                        list
                    }
                }
            }
            .navigationTitle("Activity")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    filterMenu
                }
            }
            .searchable(text: $model.searchText, prompt: "Merchant, category, notes")
            .scrollEdgeEffectStyle(.soft, for: .top)
            .navigationDestination(for: Transaction.self) { txn in
                TransactionDetailView(transaction: txn, model: model)
            }
        }
        .task { await model.load(api: session.api) }
        .alert("Couldn't update", isPresented: .init(
            get: { model.actionError != nil },
            set: { if !$0 { model.actionError = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.actionError ?? "")
        }
    }

    private var list: some View {
        List {
            if model.draftCount > 0 && model.statusFilter == .all {
                Section {
                    Button {
                        withAnimation { model.statusFilter = .draft }
                    } label: {
                        Label("\(model.draftCount) draft\(model.draftCount == 1 ? "" : "s") awaiting review", systemImage: "tray.full.fill")
                            .font(.subheadline.weight(.medium))
                    }
                    .listRowBackground(Color.orange.opacity(0.12))
                    .foregroundStyle(.orange)
                }
            }

            ForEach(model.sections) { section in
                Section {
                    ForEach(section.transactions) { txn in
                        NavigationLink(value: txn) {
                            TransactionRow(transaction: txn, categoryName: model.categoryName(for: txn))
                        }
                        .swipeActions(edge: .leading) {
                            if txn.isDraft {
                                Button {
                                    Task { await model.confirm(txn, api: session.api) }
                                } label: {
                                    Label("Confirm", systemImage: "checkmark.circle.fill")
                                }
                                .tint(.green)
                            }
                        }
                    }
                } header: {
                    Text(section.date, format: .dateTime.weekday(.wide).month(.abbreviated).day())
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await model.load(api: session.api, force: true) }
    }

    private var filterMenu: some View {
        @Bindable var model = model
        return Menu {
            Picker("Status", selection: $model.statusFilter) {
                ForEach(ActivityViewModel.StatusFilter.allCases) { filter in
                    Text(filter.rawValue).tag(filter)
                }
            }
        } label: {
            Label("Filter", systemImage: model.statusFilter == .all
                ? "line.3.horizontal.decrease.circle"
                : "line.3.horizontal.decrease.circle.fill")
        }
    }
}
