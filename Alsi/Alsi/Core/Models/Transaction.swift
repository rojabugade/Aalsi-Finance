import Foundation

struct LineItem: Decodable, Identifiable {
    let id: String
    let name: String
    let amount: MoneyValue
}

struct Transaction: Decodable, Identifiable {
    let id: String
    let merchant: String?
    let amount: MoneyValue
    let currency: String
    let txnDate: String
    let status: String
    let sourceChannel: String?
    let lineItems: [LineItem]

    enum CodingKeys: String, CodingKey {
        case id, merchant, amount, currency
        case txnDate = "txn_date"
        case status
        case sourceChannel = "source_channel"
        case lineItems = "line_items"
    }

    var isDraft: Bool { status == "draft" }

    var displayName: String {
        if let m = merchant, !m.isEmpty { return m }
        if let s = sourceChannel, !s.isEmpty { return s.capitalized }
        return "Transaction"
    }
}
