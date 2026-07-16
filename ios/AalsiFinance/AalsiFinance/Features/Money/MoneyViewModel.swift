import Foundation
import Observation
import AalsiFinanceKit

@MainActor
@Observable
final class MoneyViewModel {
    struct Snapshot: Sendable {
        let netWorth: NetWorth
        let loans: [Loan]
        let cards: [CreditCardSummary]
        let incomeSources: [IncomeSource]
        let holdings: [Holding]
    }

    private(set) var state: Loadable<Snapshot> = .idle

    // MARK: - Mutations
    // Each returns nil on success (after a forced reload so panes reflect the
    // change), else a user-facing error message.

    func patchLoan(id: UUID, api: APIClient, body: LoanPatchRequest) async -> String? {
        await mutate(api: api) { _ = try await api.patchLoan(id: id, body: body) }
    }

    func deleteLoan(id: UUID, api: APIClient) async -> String? {
        await mutate(api: api) { try await api.deleteLoan(id: id) }
    }

    func putCardDetail(loanId: UUID, api: APIClient, body: CreditCardDetailRequest) async -> String? {
        await mutate(api: api) { _ = try await api.putCreditCardDetail(loanId: loanId, body: body) }
    }

    func patchIncomeSource(id: UUID, api: APIClient, body: IncomeSourcePatchRequest) async -> String? {
        await mutate(api: api) { _ = try await api.patchIncomeSource(id: id, body: body) }
    }

    func patchHolding(id: UUID, api: APIClient, body: HoldingPatchRequest) async -> String? {
        await mutate(api: api) { _ = try await api.patchHolding(id: id, body: body) }
    }

    func deleteHolding(id: UUID, api: APIClient) async -> String? {
        await mutate(api: api) { try await api.deleteHolding(id: id) }
    }

    private func mutate(api: APIClient, _ operation: () async throws -> Void) async -> String? {
        do {
            try await operation()
            await load(api: api, force: true)
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    func load(api: APIClient, force: Bool = false) async {
        if case .loaded = state, !force { return }
        if case .idle = state { state = .loading }
        do {
            async let netWorth = api.netWorth()
            async let loans = api.loans()
            async let cards = api.creditCards()
            async let income = api.incomeSources()
            async let holdings = api.holdings()

            let allLoans = try await loans
            state = .loaded(Snapshot(
                netWorth: try await netWorth,
                loans: allLoans.filter { !$0.isCreditCard },
                cards: try await cards,
                incomeSources: try await income,
                holdings: (try? await holdings) ?? []
            ))
        } catch {
            if state.value == nil {
                state = .failed(error.localizedDescription)
            }
        }
    }
}
