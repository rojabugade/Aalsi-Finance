import Foundation

struct MoneyValue: Decodable, Hashable {
    let decimal: Decimal

    init(_ decimal: Decimal) { self.decimal = decimal }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let d = try? c.decode(Decimal.self) { decimal = d }
        else if let s = try? c.decode(String.self), let d = Decimal(string: s) { decimal = d }
        else if let dbl = try? c.decode(Double.self) { decimal = Decimal(dbl) }
        else if let i = try? c.decode(Int.self) { decimal = Decimal(i) }
        else { decimal = 0 }
    }
}
