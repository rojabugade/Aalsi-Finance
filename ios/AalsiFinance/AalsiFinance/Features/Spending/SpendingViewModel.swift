import AalsiFinanceKit
import Foundation
import Observation

private enum SpendingLoadResult: Sendable {
    case core([AalsiFinanceKit.Transaction], [AalsiFinanceKit.Category])
    case coreFailure(String)
    case recurring([RecurringSeries])
    case recurringFailure(String)
}

@MainActor
@Observable
final class SpendingViewModel {
    var state = SpendingState()

    func load(api: APIClient, force: Bool = false) async {
        guard force || state.coreSnapshot == nil else { return }

        let token = state.beginRefresh()
        await withTaskGroup(of: SpendingLoadResult.self) { group in
            group.addTask {
                do {
                    async let transactions = api.transactions()
                    async let categories = api.categories()
                    let (loadedTransactions, loadedCategories) = try await (transactions, categories)
                    return .core(loadedTransactions, loadedCategories)
                } catch {
                    return .coreFailure(error.localizedDescription)
                }
            }
            group.addTask {
                do {
                    let recurring = try await api.recurringSeries()
                    return .recurring(recurring)
                } catch {
                    return .recurringFailure(error.localizedDescription)
                }
            }

            for await result in group {
                guard !Task.isCancelled else {
                    group.cancelAll()
                    break
                }
                switch result {
                case .core(let transactions, let categories):
                    state.receiveCore(
                        SpendingSnapshot(
                            transactions: transactions,
                            categories: categories,
                            canonicalRecurring: state.canonicalRecurring
                        ),
                        token: token
                    )
                case .coreFailure(let message):
                    state.receiveCoreFailure(message, token: token)
                case .recurring(let recurring):
                    state.receiveRecurring(recurring, token: token)
                case .recurringFailure(let message):
                    state.receiveRecurringFailure(message, token: token)
                }
            }
        }

        if Task.isCancelled {
            state.cancelRefresh(token: token)
        }
    }

    func refresh(api: APIClient) async {
        await load(api: api, force: true)
    }

    func refreshRecurring(api: APIClient) async {
        let token = state.beginRecurringRefresh()
        do {
            let recurring = try await api.recurringSeries()
            guard !Task.isCancelled else {
                state.cancelRecurringRefresh(token: token)
                return
            }
            state.receiveRecurring(recurring, token: token)
        } catch {
            if Task.isCancelled {
                state.cancelRecurringRefresh(token: token)
            } else {
                state.receiveRecurringFailure(error.localizedDescription, token: token)
            }
        }
    }

    @discardableResult
    func createTransaction(
        api: APIClient,
        draft: TransactionEditorDraft
    ) async -> Bool {
        state.beginMutation(editorDraft: draft)
        guard let amount = positiveAmount(from: draft) else {
            state.receiveMutationFailure("Enter an amount greater than zero.", editorDraft: draft)
            return false
        }
        let currency = draft.currency.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !currency.isEmpty else {
            state.receiveMutationFailure("Enter a currency.", editorDraft: draft)
            return false
        }

        do {
            let transaction = try await api.createTransaction(
                TransactionCreateRequest(
                    amount: amount,
                    direction: draft.direction,
                    merchant: optionalText(draft.merchant),
                    currency: currency,
                    txnDate: draft.date,
                    categoryId: draft.categoryId,
                    status: draft.status,
                    notes: optionalText(draft.notes)
                )
            )
            state.receiveCreatedTransaction(transaction)
            state.receiveEditorMutationSuccess()
            await refresh(api: api)
            return true
        } catch {
            state.receiveMutationFailure(error.localizedDescription, editorDraft: draft)
            return false
        }
    }

    @discardableResult
    func patchTransaction(
        id: UUID,
        api: APIClient,
        draft: TransactionEditorDraft
    ) async -> Bool {
        state.beginMutation(editorDraft: draft)
        guard let amount = positiveAmount(from: draft) else {
            state.receiveMutationFailure("Enter an amount greater than zero.", editorDraft: draft)
            return false
        }
        let currency = draft.currency.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !currency.isEmpty else {
            state.receiveMutationFailure("Enter a currency.", editorDraft: draft)
            return false
        }

        do {
            _ = try await api.patchTransaction(
                id: id,
                body: TransactionPatchRequest(
                    merchant: optionalText(draft.merchant),
                    amount: amount,
                    direction: draft.direction,
                    currency: currency,
                    txnDate: draft.date,
                    categoryId: draft.categoryId,
                    status: draft.status,
                    notes: optionalText(draft.notes)
                )
            )
            state.receiveEditorMutationSuccess()
            await refresh(api: api)
            return true
        } catch {
            state.receiveMutationFailure(error.localizedDescription, editorDraft: draft)
            return false
        }
    }

    @discardableResult
    func confirmTransaction(id: UUID, api: APIClient) async -> Bool {
        state.beginMutation()
        do {
            _ = try await api.confirmTransaction(id: id)
            state.receiveMutationSuccess()
            await refresh(api: api)
            return true
        } catch {
            state.receiveMutationFailure(error.localizedDescription)
            return false
        }
    }

    @discardableResult
    func splitTransaction(
        id: UUID,
        sourceAmount: Money,
        parts: [SplitPartRequest],
        api: APIClient
    ) async -> Bool {
        guard state.beginSplit(source: sourceAmount, parts: parts) else {
            return false
        }
        do {
            _ = try await api.splitTransaction(id: id, body: SplitRequest(parts: parts))
            state.receiveSplitMutationSuccess()
            await refresh(api: api)
            return true
        } catch {
            state.receiveMutationFailure(error.localizedDescription, splitDraft: parts)
            return false
        }
    }

    @discardableResult
    func deleteTransaction(id: UUID, api: APIClient) async -> Bool {
        state.beginMutation()
        do {
            try await api.deleteTransaction(id: id)
            state.receiveMutationSuccess()
            await refresh(api: api)
            return true
        } catch {
            state.receiveMutationFailure(error.localizedDescription)
            return false
        }
    }

    func beginSelection() {
        state.isSelecting = true
        state.selectedTransactionIDs = []
    }

    func endSelection() {
        state.isSelecting = false
        state.selectedTransactionIDs = []
    }

    func toggleSelection(_ id: UUID) {
        if state.selectedTransactionIDs.contains(id) {
            state.selectedTransactionIDs.remove(id)
        } else {
            state.selectedTransactionIDs.insert(id)
        }
    }

    @discardableResult
    func mergeTransactions(
        ids: [UUID],
        notes: String? = nil,
        api: APIClient
    ) async -> Bool {
        guard state.beginMerge(ids: ids) else {
            return false
        }
        do {
            _ = try await api.mergeTransactions(
                MergeRequest(transactionIds: ids, notes: notes)
            )
            state.receiveMutationSuccess()
            state.isSelecting = false
            state.selectedTransactionIDs.removeAll()
            await refresh(api: api)
            return true
        } catch {
            state.receiveMutationFailure(error.localizedDescription)
            return false
        }
    }

    private func positiveAmount(from draft: TransactionEditorDraft) -> Money? {
        let text = draft.amount.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let value = Decimal(string: text), value > 0 else { return nil }
        return Money(value)
    }

    private func optionalText(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
