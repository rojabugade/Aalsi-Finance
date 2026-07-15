import Foundation
import Testing
@testable import AalsiFinanceKit

@Suite struct SpendExportTests {
    @Test func csvEscapesMerchantAndNotes() throws {
        let json = #"{"id":"11111111-1111-1111-1111-111111111111","household_id":"22222222-2222-2222-2222-222222222222","account_id":null,"payment_method_id":null,"recurring_series_id":null,"owner_user_id":null,"merchant_id":null,"merchant":"Store, Inc.","amount":"-12","currency":"USD","base_amount":null,"fx_rate":null,"txn_date":"2026-07-12","category_id":null,"status":"confirmed","source_document_id":null,"source_channel":"manual","is_shared":false,"flags":null,"notes":"said \"hi\"\nnext","confidence":null,"external_id":null,"created_at":"2026-07-12T10:00:00","line_items":[]}"#
        let transaction = try JSONDecoder.api().decode(Transaction.self, from: Data(json.utf8))
        let csv = SpendCSV.export(transactions: [transaction], categoryName: { _ in "Food" })
        #expect(csv.hasPrefix("date,merchant,category,amount,currency,status,notes\r\n"))
        #expect(csv.contains("\"Store, Inc.\""))
        #expect(csv.contains("\"said \"\"hi\"\" next\""))
    }

    @Test func csvPreservesHeaderAndFilteredRowOrder() throws {
        let first = try SpendTestFixtures.transaction("-20", date: "2026-07-11", category: SpendTestFixtures.groceriesID, merchant: "Alpha")
        let second = try SpendTestFixtures.transaction("-30", date: "2026-07-10", category: nil, merchant: "Beta")
        let csv = SpendCSV.export(transactions: [first, second], categoryName: { id in id == SpendTestFixtures.groceriesID ? "Groceries" : nil })
        let rows = csv.split(separator: "\r\n").map(String.init)
        #expect(rows.count == 3)
        #expect(rows[0] == "date,merchant,category,amount,currency,status,notes")
        #expect(rows[1] == "\"2026-07-11\",\"Alpha\",\"Groceries\",\"-20\",\"USD\",\"confirmed\",\"\"")
        #expect(rows[2] == "\"2026-07-10\",\"Beta\",\"\",\"-30\",\"USD\",\"confirmed\",\"\"")
    }
}
