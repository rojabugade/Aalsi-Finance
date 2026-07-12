import Foundation
import Testing
@testable import AalsiFinanceKit

@Suite struct DecodingTests {
    @Test func parsesAllBackendDateShapes() {
        #expect(APIDateParser.parse("2026-07-12T10:30:00Z") != nil)
        #expect(APIDateParser.parse("2026-07-12T10:30:00.123456") != nil)
        #expect(APIDateParser.parse("2026-07-12T10:30:00") != nil)
        #expect(APIDateParser.parse("2026-07-12") != nil)
        #expect(APIDateParser.parse("July 12") == nil)
    }

    @Test func decodesTransactionFromSnakeCase() throws {
        let json = """
        {
          "id": "11111111-1111-1111-1111-111111111111",
          "household_id": "22222222-2222-2222-2222-222222222222",
          "account_id": null, "merchant_id": null,
          "merchant": "BigBasket",
          "amount": "2140.00", "currency": "INR", "base_amount": null,
          "txn_date": "2026-07-10",
          "category_id": null, "status": "confirmed", "source_channel": null,
          "is_shared": false, "notes": null, "confidence": null,
          "created_at": "2026-07-10T09:14:00",
          "line_items": []
        }
        """
        let txn = try JSONDecoder.api().decode(Transaction.self, from: Data(json.utf8))
        #expect(txn.displayMerchant == "BigBasket")
        #expect(txn.amount.value == Decimal(string: "2140.00", locale: Locale(identifier: "en_US_POSIX")))
        #expect(!txn.isDraft)
    }

    @Test func decodesCashflowSummary() throws {
        let json = """
        {
          "currency": "INR",
          "income_monthly": "110000", "recurring_monthly": "20000",
          "debt_emi_monthly": "18400", "card_min_monthly": "3200",
          "discretionary_monthly": "42300", "leftover_monthly": "26100",
          "breakdown": [{"label": "Salary", "amount": "110000", "kind": "income"}]
        }
        """
        let summary = try JSONDecoder.api().decode(CashflowSummary.self, from: Data(json.utf8))
        #expect(summary.leftoverMonthly.value == Decimal(26100))
        #expect(summary.breakdown.count == 1)
    }
}
