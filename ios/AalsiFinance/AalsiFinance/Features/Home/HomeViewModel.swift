import Foundation
import Observation

@MainActor
@Observable
final class HomeViewModel {
    struct Snapshot: Sendable {
        let cashflow: CashflowSummary
        let netWorth: NetWorth
        let budgets: [Budget]
        let recent: [Transaction]
        let categoryNames: [UUID: String]
    }

    private(set) var state: Loadable<Snapshot> = .idle

    func load(api: APIClient, force: Bool = false) async {
        if case .loaded = state, !force { return }
        if case .idle = state { state = .loading }
        do {
            async let cashflow = api.cashflowSummary()
            async let netWorth = api.netWorth()
            async let budgets = api.budgets()
            async let transactions = api.transactions()
            async let categories = api.categories()

            let names = Dictionary(uniqueKeysWithValues: try await categories.map { ($0.id, $0.name) })
            state = .loaded(
                Snapshot(
                    cashflow: try await cashflow,
                    netWorth: try await netWorth,
                    budgets: try await budgets,
                    recent: Array(try await transactions.prefix(6)),
                    categoryNames: names
                )
            )
        } catch {
            if state.value == nil {
                state = .failed(error.localizedDescription)
            }
        }
    }
}
