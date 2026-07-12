import AalsiFinanceKit
import Foundation
import Observation

@MainActor
@Observable
final class SpendingViewModel {
    var state = SpendingState()

    func load(api: APIClient, force: Bool = false) async {
        guard force || state.coreSnapshot == nil else { return }

        state.beginRefresh()
        let recurringTask = Task { [weak self] in
            guard let self else { return }
            await self.receiveRecurring(api: api)
        }

        do {
            async let transactions = api.transactions()
            async let categories = api.categories()
            let (loadedTransactions, loadedCategories) = try await (transactions, categories)
            state.receiveCore(
                SpendingSnapshot(
                    transactions: loadedTransactions,
                    categories: loadedCategories,
                    canonicalRecurring: state.canonicalRecurring
                )
            )
        } catch {
            state.receiveCoreFailure(error.localizedDescription)
        }

        await recurringTask.value
    }

    func refresh(api: APIClient) async {
        await load(api: api, force: true)
    }

    func refreshRecurring(api: APIClient) async {
        state.beginRecurringRefresh()
        await receiveRecurring(api: api)
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
            state.receiveMutationSuccess()
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
            state.receiveMutationSuccess()
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
        parts: [SplitPartRequest],
        api: APIClient
    ) async -> Bool {
        state.beginMutation(splitDraft: parts)
        do {
            _ = try await api.splitTransaction(id: id, body: SplitRequest(parts: parts))
            state.receiveMutationSuccess()
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

    @discardableResult
    func mergeTransactions(
        ids: [UUID],
        notes: String? = nil,
        api: APIClient
    ) async -> Bool {
        state.beginMutation()
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

    private func receiveRecurring(api: APIClient) async {
        do {
            state.receiveRecurring(try await api.recurringSeries())
        } catch {
            state.receiveRecurringFailure(error.localizedDescription)
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
