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

        state.beginRefresh()
        state.receiveCore(try snapshot())

        #expect(state.selectedPill == .activity)
        #expect(state.monthStart == july)
        #expect(state.filter.query == "uber")
        #expect(state.navigationPath == [.merchant("Uber")])
    }

    @Test func recurringFailureDoesNotFailCore() throws {
        var state = SpendingState()
        state.receiveCore(try snapshot())

        state.receiveRecurringFailure("offline")

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
        state.receiveCore(try snapshot(canonicalRecurring: [original]))

        state.receiveRecurring([replacement])

        #expect(state.canonicalRecurring == [replacement])
        #expect(state.coreSnapshot?.canonicalRecurring == [replacement])
        #expect(state.coreSnapshot?.recurringRows.map(\.name) == ["Replacement"])
    }

    @Test func receiveRecurringBeforeCoreIsRetainedByCoreSnapshot() throws {
        let recurring = try recurringSeries(id: "33333333-3333-3333-3333-333333333333", name: "Early")
        var state = SpendingState()

        state.receiveRecurring([recurring])
        state.receiveCore(try snapshot())

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

        state.beginRefresh()
        state.receiveCoreFailure("offline")

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
        state.receiveCore(
            SpendingSnapshot(
                transactions: [existing],
                categories: SpendTestFixtures.categories,
                canonicalRecurring: []
            )
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
