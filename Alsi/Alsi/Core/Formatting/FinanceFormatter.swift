import Foundation

enum FinanceFormatter {
    static func currency(_ value: Decimal?, currency: String = "USD", signed: Bool = false) -> String {
        guard let value else { return "—" }
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = currency
        f.maximumFractionDigits = abs(value) >= 100 ? 0 : 2
        f.minimumFractionDigits = 0
        if signed, value > 0 { f.positivePrefix = "+\(f.positivePrefix ?? "")" }
        return f.string(from: NSDecimalNumber(decimal: value)) ?? "\(value)"
    }

    static func percent(_ value: Decimal?) -> String {
        guard let value else { return "—" }
        let f = NumberFormatter()
        f.numberStyle = .percent
        f.maximumFractionDigits = 0
        return f.string(from: NSDecimalNumber(decimal: value / 100)) ?? "\(value)%"
    }

    static func shortDate(_ raw: String) -> String {
        let parser = DateFormatter()
        parser.calendar = Calendar(identifier: .gregorian)
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.dateFormat = "yyyy-MM-dd"
        guard let date = parser.date(from: raw) else { return raw }
        let out = DateFormatter()
        out.dateFormat = "MMM d"
        return out.string(from: date)
    }
}
