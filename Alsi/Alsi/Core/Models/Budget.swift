import Foundation

struct Budget: Decodable, Identifiable {
    let id: String
    let amount: MoneyValue
    let currency: String
    let spent: MoneyValue
    let remaining: MoneyValue
    let progressPct: MoneyValue
    let overspent: Bool

    enum CodingKeys: String, CodingKey {
        case id, amount, currency, spent, remaining
        case progressPct = "progress_pct"
        case overspent
    }
}
