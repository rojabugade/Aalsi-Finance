import Foundation
import Observation
import AalsiFinanceKit

@MainActor
@Observable
final class ActivityViewModel {
    enum StatusFilter: String, CaseIterable, Identifiable {
        case all = "All"
        case draft = "Drafts"
        case confirmed = "Confirmed"
        var id: String { rawValue }
    }

    struct DaySection: Identifiable {
        let date: Date
        let transactions: [AalsiFinanceKit.Transaction]
        var id: Date { date }
    }

    private(set) var state: Loadable<[AalsiFinanceKit.Transaction]> = .idle
    private(set) var categoryNames: [UUID: String] = [:]
    private(set) var confirmingIds: Set<UUID> = []
    var searchText = ""
    var statusFilter: StatusFilter = .all
    var actionError: String?

    var draftCount: Int {
        state.value?.count(where: \.isDraft) ?? 0
    }

    var sections: [DaySection] {
        guard let transactions = state.value else { return [] }
        let filtered = transactions.filter { txn in
            let matchesStatus: Bool = switch statusFilter {
            case .all: true
            case .draft: txn.isDraft
            case .confirmed: !txn.isDraft
            }
            guard matchesStatus else { return false }
            guard !searchText.isEmpty else { return true }
            let haystack = [
                txn.merchant,
                txn.notes,
                txn.categoryId.flatMap { categoryNames[$0] },
            ]
            return haystack.contains { $0?.localizedCaseInsensitiveContains(searchText) == true }
        }
        let grouped = Dictionary(grouping: filtered) { Calendar.current.startOfDay(for: $0.txnDate) }
        return grouped
            .map { DaySection(date: $0.key, transactions: $0.value.sorted { $0.createdAt > $1.createdAt }) }
            .sorted { $0.date > $1.date }
    }

    func load(api: APIClient, force: Bool = false) async {
        if case .loaded = state, !force { return }
        if case .idle = state { state = .loading }
        do {
            async let transactions = api.transactions()
            async let categories = api.categories()
            categoryNames = Dictionary(uniqueKeysWithValues: try await categories.map { ($0.id, $0.name) })
            state = .loaded(try await transactions)
        } catch {
            if state.value == nil {
                state = .failed(error.localizedDescription)
            }
        }
    }

    func confirm(_ transaction: AalsiFinanceKit.Transaction, api: APIClient) async {
        guard transaction.isDraft, !confirmingIds.contains(transaction.id) else { return }
        confirmingIds.insert(transaction.id)
        defer { confirmingIds.remove(transaction.id) }
        do {
            let updated = try await api.confirmTransaction(id: transaction.id)
            if var transactions = state.value,
               let index = transactions.firstIndex(where: { $0.id == updated.id }) {
                transactions[index] = updated
                state = .loaded(transactions)
            }
        } catch {
            actionError = error.localizedDescription
        }
    }

    func categoryName(for transaction: AalsiFinanceKit.Transaction) -> String? {
        transaction.categoryId.flatMap { categoryNames[$0] }
    }
}
