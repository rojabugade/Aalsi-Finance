import Foundation

struct CashflowLine: Decodable, Identifiable {
    var id: String { "\(kind)-\(label)" }
    let label: String
    let amount: MoneyValue
    let kind: String
}

struct CashflowSummary: Decodable {
    let currency: String
    let incomeMonthly: MoneyValue
    let recurringMonthly: MoneyValue
    let debtEmiMonthly: MoneyValue
    let cardMinMonthly: MoneyValue
    let discretionaryMonthly: MoneyValue
    let leftoverMonthly: MoneyValue
    let breakdown: [CashflowLine]

    enum CodingKeys: String, CodingKey {
        case currency
        case incomeMonthly = "income_monthly"
        case recurringMonthly = "recurring_monthly"
        case debtEmiMonthly = "debt_emi_monthly"
        case cardMinMonthly = "card_min_monthly"
        case discretionaryMonthly = "discretionary_monthly"
        case leftoverMonthly = "leftover_monthly"
        case breakdown
    }
}
