import Foundation
import Testing
@testable import AalsiFinanceKit

@Suite struct SpendingStateTests {
    private let july = APIDateParser.parse("2026-07-01")!

    @Test func refreshPreservesNavigationAndFilters() throws {
        var state = SpendingState(
            selectedPill: .activity,
            monthStart: july,
            filter: .init(query: "uber")
        )
        state.navigationPath = [.merchant("Uber")]

        let refresh = state.beginRefresh()
        state.receiveCore(try snapshot(), token: refresh)

        #expect(state.selectedPill == .activity)
        #expect(state.monthStart == july)
        #expect(state.filter.query == "uber")
        #expect(state.navigationPath == [.merchant("Uber")])
    }

    @Test func recurringFailureDoesNotFailCore() throws {
        var state = SpendingState()
        let refresh = state.beginRefresh()
        state.receiveCore(try snapshot(), token: refresh)

        state.receiveRecurringFailure("offline", token: refresh)

        #expect(state.coreSnapshot != nil)
        #expect(state.coreError == nil)
        #expect(state.recurringError == "offline")
    }

    @Test func mutationFailureKeepsDraft() {
        var state = SpendingState()
        state.editorDraft = .init(amount: "42", direction: .spend, merchant: "Market")

        state.receiveMutationFailure("offline")

        #expect(state.editorDraft?.merchant == "Market")
        #expect(state.mutationError == "offline")
    }

    @Test func selectedPillIndexMapsAllPillsWithoutDuplicateState() {
        var state = SpendingState()

        #expect(state.selectedPillIndex == 0)
        state.selectedPillIndex = 1
        #expect(state.selectedPill == .activity)
        #expect(state.selectedPillIndex == 1)
        state.selectedPillIndex = 2
        #expect(state.selectedPill == .recurring)
        #expect(state.selectedPillIndex == 2)
        state.selectedPillIndex = 0
        #expect(state.selectedPill == .overview)
    }

    @Test func receiveRecurringReplacesCanonicalDataInCoreSnapshot() throws {
        let original = try recurringSeries(id: "11111111-1111-1111-1111-111111111111", name: "Original")
        let replacement = try recurringSeries(id: "22222222-2222-2222-2222-222222222222", name: "Replacement")
        var state = SpendingState()
        let refresh = state.beginRefresh()
        state.receiveCore(try snapshot(canonicalRecurring: [original]), token: refresh)

        state.receiveRecurring([replacement], token: refresh)

        #expect(state.canonicalRecurring == [replacement])
        #expect(state.coreSnapshot?.canonicalRecurring == [replacement])
        #expect(state.coreSnapshot?.recurringRows.map(\.name) == ["Replacement"])
    }

    @Test func receiveRecurringBeforeCoreIsRetainedByCoreSnapshot() throws {
        let recurring = try recurringSeries(id: "33333333-3333-3333-3333-333333333333", name: "Early")
        var state = SpendingState()

        let refresh = state.beginRefresh()
        state.receiveRecurring([recurring], token: refresh)
        state.receiveCore(try snapshot(), token: refresh)

        #expect(state.coreSnapshot?.canonicalRecurring == [recurring])
    }

    @Test func selectionSurvivesRefreshAndCoreFailure() throws {
        let transaction = try SpendTestFixtures.transaction(
            "-20",
            date: "2026-07-12",
            category: SpendTestFixtures.foodID
        )
        var state = SpendingState()
        state.isSelecting = true
        state.selectedTransactionIDs = [transaction.id]

        let refresh = state.beginRefresh()
        state.receiveCoreFailure("offline", token: refresh)

        #expect(state.isSelecting)
        #expect(state.selectedTransactionIDs == [transaction.id])
        #expect(state.coreError == "offline")
    }

    @Test func successfulCreateInsertsReturnedTransactionImmediately() throws {
        let existing = try SpendTestFixtures.transaction(
            "-10",
            date: "2026-07-10",
            category: SpendTestFixtures.foodID,
            merchant: "Existing"
        )
        let created = try SpendTestFixtures.transaction(
            "-42",
            date: "2026-07-12",
            category: SpendTestFixtures.foodID,
            merchant: "Market"
        )
        var state = SpendingState()
        let refresh = state.beginRefresh()
        state.receiveCore(
            SpendingSnapshot(
                transactions: [existing],
                categories: SpendTestFixtures.categories,
                canonicalRecurring: []
            ),
            token: refresh
        )

        state.receiveCreatedTransaction(created)

        #expect(state.coreSnapshot?.transactions.map(\.id) == [created.id, existing.id])
    }

    @Test func mutationFailureRetainsCallerProvidedReplacementDraft() {
        let original = TransactionEditorDraft(amount: "1", direction: .spend, merchant: "Old")
        let submitted = TransactionEditorDraft(
            amount: "42",
            direction: .income,
            merchant: "Market",
            currency: "CAD",
            date: july,
            categoryId: SpendTestFixtures.incomeID,
            status: "draft",
            notes: "invoice"
        )
        var state = SpendingState()
        state.editorDraft = original

        state.receiveMutationFailure("offline", editorDraft: submitted)

        #expect(state.editorDraft == submitted)
        #expect(state.mutationError == "offline")
        #expect(!state.isMutating)
    }

    @Test func newerCoreResultWinsOverStaleResultAndFailure() throws {
        let oldTransaction = try SpendTestFixtures.transaction(
            "-10",
            date: "2026-07-10",
            category: SpendTestFixtures.foodID,
            merchant: "Old"
        )
        let newTransaction = try SpendTestFixtures.transaction(
            "-20",
            date: "2026-07-11",
            category: SpendTestFixtures.foodID,
            merchant: "New"
        )
        var state = SpendingState()
        let oldRefresh = state.beginRefresh()
        let newRefresh = state.beginRefresh()

        state.receiveCore(
            SpendingSnapshot(
                transactions: [newTransaction],
                categories: SpendTestFixtures.categories,
                canonicalRecurring: []
            ),
            token: newRefresh
        )
        state.receiveCore(
            SpendingSnapshot(
                transactions: [oldTransaction],
                categories: [],
                canonicalRecurring: []
            ),
            token: oldRefresh
        )
        state.receiveCoreFailure("stale offline", token: oldRefresh)

        #expect(state.coreSnapshot?.transactions.map(\.id) == [newTransaction.id])
        #expect(state.coreSnapshot?.categories == SpendTestFixtures.categories)
        #expect(state.coreError == nil)
        #expect(!state.isCoreLoading)
    }

    @Test func newerRecurringResultWinsOverStaleResultAndFailure() throws {
        let oldSeries = try recurringSeries(
            id: "44444444-4444-4444-4444-444444444444",
            name: "Old"
        )
        let newSeries = try recurringSeries(
            id: "55555555-5555-5555-5555-555555555555",
            name: "New"
        )
        var state = SpendingState()
        let oldRefresh = state.beginRefresh()
        let newRefresh = state.beginRefresh()

        state.receiveRecurring([newSeries], token: newRefresh)
        state.receiveRecurring([oldSeries], token: oldRefresh)
        state.receiveRecurringFailure("stale offline", token: oldRefresh)

        #expect(state.canonicalRecurring == [newSeries])
        #expect(state.recurringError == nil)
        #expect(!state.isRecurringLoading)
    }

    @Test func cancellingOldRefreshCannotClearNewerLoadingFlags() {
        var state = SpendingState()
        let oldRefresh = state.beginRefresh()
        let newRefresh = state.beginRefresh()

        state.cancelRefresh(token: oldRefresh)

        #expect(state.isCoreLoading)
        #expect(state.isRecurringLoading)

        state.cancelRefresh(token: newRefresh)
        #expect(!state.isCoreLoading)
        #expect(!state.isRecurringLoading)
    }

    @Test func recurringOnlyRefreshDoesNotInvalidateActiveCoreRefresh() throws {
        let coreTransaction = try SpendTestFixtures.transaction(
            "-30",
            date: "2026-07-12",
            category: SpendTestFixtures.foodID
        )
        let recurring = try recurringSeries(
            id: "66666666-6666-6666-6666-666666666666",
            name: "Recurring"
        )
        var state = SpendingState()
        let fullRefresh = state.beginRefresh()
        let recurringRefresh = state.beginRecurringRefresh()

        state.receiveCore(
            SpendingSnapshot(
                transactions: [coreTransaction],
                categories: SpendTestFixtures.categories,
                canonicalRecurring: []
            ),
            token: fullRefresh
        )
        state.receiveRecurring([recurring], token: recurringRefresh)

        #expect(state.coreSnapshot?.transactions.map(\.id) == [coreTransaction.id])
        #expect(state.canonicalRecurring == [recurring])
    }

    @Test func successfulCreateWithoutCoreSurvivesFailedRefreshThenYieldsToAuthoritativeCore() throws {
        let created = try SpendTestFixtures.transaction(
            "-42",
            date: "2026-07-12",
            category: SpendTestFixtures.foodID,
            merchant: "Created"
        )
        let authoritative = try SpendTestFixtures.transaction(
            "-12",
            date: "2026-07-11",
            category: SpendTestFixtures.foodID,
            merchant: "Server"
        )
        let recurring = try recurringSeries(
            id: "77777777-7777-7777-7777-777777777777",
            name: "Retained"
        )
        var state = SpendingState()
        let initialRefresh = state.beginRefresh()
        state.receiveRecurring([recurring], token: initialRefresh)

        state.receiveCreatedTransaction(created)

        #expect(state.coreSnapshot?.transactions.map(\.id) == [created.id])
        #expect(state.coreSnapshot?.categories.isEmpty == true)
        #expect(state.coreSnapshot?.canonicalRecurring == [recurring])

        let failedRefresh = state.beginRefresh()
        state.receiveCoreFailure("offline", token: failedRefresh)
        #expect(state.coreSnapshot?.transactions.map(\.id) == [created.id])

        let successfulRefresh = state.beginRefresh()
        state.receiveCore(
            SpendingSnapshot(
                transactions: [authoritative],
                categories: SpendTestFixtures.categories,
                canonicalRecurring: []
            ),
            token: successfulRefresh
        )
        #expect(state.coreSnapshot?.transactions.map(\.id) == [authoritative.id])
    }

    @Test func editorSuccessClearsOnlyEditorDraft() {
        let split = SplitPartRequest(
            amount: Money(-10),
            categoryId: SpendTestFixtures.foodID
        )
        var state = SpendingState(
            editorDraft: .init(amount: "10", direction: .spend, merchant: "Market"),
            splitDraft: [split]
        )

        state.receiveEditorMutationSuccess()

        #expect(state.editorDraft == nil)
        #expect(state.splitDraft?.count == 1)
    }

    @Test func splitSuccessClearsOnlySplitDraft() {
        let editor = TransactionEditorDraft(amount: "10", direction: .spend, merchant: "Market")
        var state = SpendingState(
            editorDraft: editor,
            splitDraft: [.init(amount: Money(-10), categoryId: SpendTestFixtures.foodID)]
        )

        state.receiveSplitMutationSuccess()

        #expect(state.editorDraft == editor)
        #expect(state.splitDraft == nil)
    }

    @Test func unrelatedMutationSuccessPreservesAllDrafts() {
        let editor = TransactionEditorDraft(amount: "10", direction: .spend, merchant: "Market")
        var state = SpendingState(
            editorDraft: editor,
            splitDraft: [.init(amount: Money(-10), categoryId: SpendTestFixtures.foodID)]
        )

        state.receiveMutationSuccess()

        #expect(state.editorDraft == editor)
        #expect(state.splitDraft?.count == 1)
    }

    @Test func invalidMergeRetainsSelectionAndSetsInlineError() {
        let selected = UUID()
        var state = SpendingState(
            isSelecting: true,
            selectedTransactionIDs: [selected]
        )

        let canSubmit = state.beginMerge(ids: [selected, selected])

        #expect(!canSubmit)
        #expect(state.isSelecting)
        #expect(state.selectedTransactionIDs == [selected])
        #expect(state.mutationError == "Select at least two transactions to merge.")
        #expect(!state.isMutating)
    }

    @Test func unbalancedSplitRetainsPartsAndSetsInlineError() {
        let parts = [
            SplitPartRequest(amount: Money(-4), categoryId: SpendTestFixtures.foodID),
            SplitPartRequest(amount: Money(-5), categoryId: SpendTestFixtures.foodID),
        ]
        var state = SpendingState()

        let canSubmit = state.beginSplit(source: Money(-10), parts: parts)

        #expect(!canSubmit)
        #expect(state.splitDraft?.map(\.amount) == parts.map(\.amount))
        #expect(state.mutationError == "Split amounts must equal the source transaction.")
        #expect(!state.isMutating)
    }

    private func snapshot(canonicalRecurring: [RecurringSeries] = []) throws -> SpendingSnapshot {
        SpendingSnapshot(
            transactions: [
                try SpendTestFixtures.transaction(
                    "-12",
                    date: "2026-07-12",
                    category: SpendTestFixtures.foodID,
                    merchant: "Market"
                ),
            ],
            categories: SpendTestFixtures.categories,
            canonicalRecurring: canonicalRecurring
        )
    }

    private func recurringSeries(id: String, name: String) throws -> RecurringSeries {
        let json = """
        {"id":"\(id)","name":"\(name)","amount":"15","currency":"USD","cadence":"monthly","type":"subscription","status":"active","next_due_date":null,"merchant_name":"\(name)","category_name":null}
        """
        return try JSONDecoder.api().decode(RecurringSeries.self, from: Data(json.utf8))
    }
}
