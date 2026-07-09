import Testing
import Foundation
@testable import Alsi

@Suite struct ModelDecodingTests {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    @Test func moneyValueAcceptsNumberAndString() throws {
        let a = try decode(MoneyValue.self, "12.50")
        let b = try decode(MoneyValue.self, "\"12.50\"")
        #expect(a.decimal == Decimal(string: "12.50"))
        #expect(b.decimal == Decimal(string: "12.50"))
    }

    @Test func cashflowMapsSnakeCase() throws {
        let json = """
        {"currency":"USD","income_monthly":"5000","recurring_monthly":"1200",
         "debt_emi_monthly":"300","card_min_monthly":"100","discretionary_monthly":"900",
         "leftover_monthly":"2500","breakdown":[{"label":"Rent","amount":"1000","kind":"recurring"}]}
        """
        let c = try decode(CashflowSummary.self, json)
        #expect(c.currency == "USD")
        #expect(c.leftoverMonthly.decimal == 2500)
        #expect(c.breakdown.first?.kind == "recurring")
    }

    @Test func transactionExposesDraftAndDisplayName() throws {
        let json = """
        {"id":"t1","merchant":"","amount":"-9.99","currency":"USD","txn_date":"2026-07-01",
         "status":"draft","source_channel":"gmail","line_items":[]}
        """
        let t = try decode(Transaction.self, json)
        #expect(t.isDraft)
        #expect(t.displayName == "Gmail")
    }

    @Test func snapshotCountsDrafts() throws {
        let t = try decode(Transaction.self,
            "{\"id\":\"t1\",\"amount\":\"1\",\"currency\":\"USD\",\"txn_date\":\"2026-07-01\",\"status\":\"draft\",\"line_items\":[]}")
        let snap = FinanceSnapshot(cashflow: nil, transactions: [t], reviewQueue: .empty,
                                   recurringSeries: [], budgets: [], netWorth: nil)
        #expect(snap.draftTransactionCount == 1)
        #expect(snap.currency == "USD")
    }
}
