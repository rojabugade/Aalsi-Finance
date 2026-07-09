import Foundation

struct FinanceSnapshot {
    static let empty = FinanceSnapshot(
        cashflow: nil, transactions: [], reviewQueue: .empty,
        recurringSeries: [], budgets: [], netWorth: nil
    )

    let cashflow: CashflowSummary?
    let transactions: [Transaction]
    let reviewQueue: ReviewQueue
    let recurringSeries: [RecurringSeries]
    let budgets: [Budget]
    let netWorth: NetWorth?

    var currency: String {
        cashflow?.currency
            ?? transactions.first?.currency
            ?? recurringSeries.first?.currency
            ?? budgets.first?.currency
            ?? netWorth?.currency
            ?? "USD"
    }

    var draftTransactionCount: Int { transactions.filter(\.isDraft).count }

    var pendingReviewCount: Int { reviewQueue.pendingCount + draftTransactionCount }

    var hasLiveData: Bool {
        cashflow != nil || !transactions.isEmpty || reviewQueue.pendingCount > 0
            || !recurringSeries.isEmpty || !budgets.isEmpty || netWorth != nil
    }
}
