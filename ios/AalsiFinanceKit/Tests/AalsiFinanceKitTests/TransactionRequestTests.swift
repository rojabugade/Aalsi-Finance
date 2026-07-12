import Foundation
import Testing
@testable import AalsiFinanceKit

@Suite struct TransactionRequestTests {
    @Test func createUsesSignedAmountAndSnakeCase() throws {
        let body = TransactionCreateRequest(
            amount: Money(42), direction: .spend, merchant: "Market",
            currency: "USD", txnDate: Date(timeIntervalSince1970: 1_783_814_400),
            categoryId: nil, status: "draft", notes: nil
        )
        let object = try #require(JSONSerialization.jsonObject(with: JSONEncoder.api().encode(body)) as? [String: Any])
        #expect(object["amount"] as? String == "-42")
        #expect(object["source_channel"] as? String == "manual")
        #expect(object["txn_date"] as? String == "2026-07-12")
    }

    @Test func patchEmitsNullForClearedFields() throws {
        let body = TransactionPatchRequest(
            merchant: nil, amount: Money(10), direction: .income, currency: "USD",
            txnDate: Date(timeIntervalSince1970: 1_783_814_400), categoryId: nil,
            status: "confirmed", notes: nil
        )
        let object = try #require(JSONSerialization.jsonObject(with: JSONEncoder.api().encode(body)) as? [String: Any])
        #expect(object["merchant"] is NSNull)
        #expect(object["category_id"] is NSNull)
        #expect(object["notes"] is NSNull)
        #expect(object["amount"] as? String == "10")
    }

    @Test func splitAndMergeUseBackendKeys() throws {
        let category = UUID(uuidString: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")!
        let id1 = UUID(uuidString: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")!
        let id2 = UUID(uuidString: "cccccccc-cccc-cccc-cccc-cccccccccccc")!
        let split = SplitRequest(parts: [.init(amount: Money(-6), categoryId: category), .init(amount: Money(-4), categoryId: nil)])
        let merge = MergeRequest(transactionIds: [id1, id2], notes: nil)
        let splitObject = try #require(JSONSerialization.jsonObject(with: JSONEncoder.api().encode(split)) as? [String: Any])
        let mergeObject = try #require(JSONSerialization.jsonObject(with: JSONEncoder.api().encode(merge)) as? [String: Any])
        #expect((splitObject["parts"] as? [[String: Any]])?.count == 2)
        #expect((mergeObject["transaction_ids"] as? [String])?.count == 2)
    }
}
