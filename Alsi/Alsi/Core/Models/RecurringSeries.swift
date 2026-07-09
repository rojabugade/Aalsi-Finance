import Foundation

struct RecurringSeries: Decodable, Identifiable {
    let id: String
    let name: String
    let amount: MoneyValue?
    let currency: String
    let cadence: String
    let type: String
    let status: String
    let nextDueDate: String?
    let merchantName: String?
    let categoryName: String?

    enum CodingKeys: String, CodingKey {
        case id, name, amount, currency, cadence, type, status
        case nextDueDate = "next_due_date"
        case merchantName = "merchant_name"
        case categoryName = "category_name"
    }
}
