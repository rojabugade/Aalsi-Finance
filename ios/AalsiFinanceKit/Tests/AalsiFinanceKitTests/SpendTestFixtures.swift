import Foundation
@testable import AalsiFinanceKit

enum SpendTestFixtures {
    static let foodID = UUID(uuidString: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")!
    static let groceriesID = UUID(uuidString: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")!
    static let incomeID = UUID(uuidString: "cccccccc-cccc-cccc-cccc-cccccccccccc")!
    static let transferID = UUID(uuidString: "dddddddd-dddd-dddd-dddd-dddddddddddd")!

    static let categories = [
        Category(id: foodID, parentId: nil, name: "Food", kind: "category", isSystem: true),
        Category(id: groceriesID, parentId: foodID, name: "Groceries", kind: "category", isSystem: true),
        Category(id: incomeID, parentId: nil, name: "Income", kind: "income", isSystem: true),
        Category(id: transferID, parentId: nil, name: "Transfers", kind: "transfer", isSystem: true),
    ]

    static var july2026: SpendPeriod {
        let start = APIDateParser.parse("2026-07-01")!
        let end = APIDateParser.parse("2026-07-31T23:59:59")!
        let previousStart = APIDateParser.parse("2026-06-01")!
        let previousEnd = APIDateParser.parse("2026-06-30T23:59:59")!
        return SpendPeriod(
            monthStart: start,
            current: .init(start: start, end: end),
            previous: .init(start: previousStart, end: previousEnd),
            isCurrentMonth: false
        )
    }

    static func transaction(
        _ amount: String,
        date: String,
        category: UUID?,
        merchant: String = "Store",
        flags: String = "null",
        notes: String? = nil,
        lineItemsJSON: String = "[]"
    ) throws -> Transaction {
        let categoryJSON = category.map { "\"\($0.uuidString)\"" } ?? "null"
        let notesJSON = notes.map { "\"\($0.replacingOccurrences(of: "\"", with: "\\\""))\"" } ?? "null"
        let json = """
        {"id":"\(UUID())","household_id":"11111111-1111-1111-1111-111111111111","account_id":null,"payment_method_id":null,"recurring_series_id":null,"owner_user_id":null,"merchant_id":null,"merchant":"\(merchant)","amount":"\(amount)","currency":"USD","base_amount":null,"fx_rate":null,"txn_date":"\(date)","category_id":\(categoryJSON),"status":"confirmed","source_document_id":null,"source_channel":"manual","is_shared":false,"flags":\(flags),"notes":\(notesJSON),"confidence":null,"external_id":null,"created_at":"\(date)T12:00:00","line_items":\(lineItemsJSON)}
        """
        return try JSONDecoder.api().decode(Transaction.self, from: Data(json.utf8))
    }

    static func transactionWithMetadata(
        _ amount: String,
        date: String,
        createdAt: String,
        category: UUID?,
        merchant: String = "Store",
        status: String = "confirmed",
        notes: String? = nil
    ) throws -> Transaction {
        let categoryJSON = category.map { "\"\($0.uuidString)\"" } ?? "null"
        let notesJSON = notes.map { "\"\($0.replacingOccurrences(of: "\"", with: "\\\""))\"" } ?? "null"
        let json = """
        {"id":"\(UUID())","household_id":"11111111-1111-1111-1111-111111111111","account_id":null,"payment_method_id":null,"recurring_series_id":null,"owner_user_id":null,"merchant_id":null,"merchant":"\(merchant)","amount":"\(amount)","currency":"USD","base_amount":null,"fx_rate":null,"txn_date":"\(date)","category_id":\(categoryJSON),"status":"\(status)","source_document_id":null,"source_channel":"manual","is_shared":false,"flags":null,"notes":\(notesJSON),"confidence":null,"external_id":null,"created_at":"\(createdAt)","line_items":[]}
        """
        return try JSONDecoder.api().decode(Transaction.self, from: Data(json.utf8))
    }
}
