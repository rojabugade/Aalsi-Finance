import Foundation

struct NetWorth: Decodable {
    let currency: String
    let assets: MoneyValue
    let liabilities: MoneyValue
    let netWorth: MoneyValue

    enum CodingKeys: String, CodingKey {
        case currency, assets, liabilities
        case netWorth = "net_worth"
    }
}
