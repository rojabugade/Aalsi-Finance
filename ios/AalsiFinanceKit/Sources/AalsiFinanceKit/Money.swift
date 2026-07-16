import Foundation

/// A monetary amount. pydantic v2 serializes `Decimal` as a JSON string, but be
/// tolerant of plain numbers too.
public struct Money: Hashable, Sendable {
    public var value: Decimal

    public init(_ value: Decimal = .zero) {
        self.value = value
    }

    public var isNegative: Bool { value < 0 }
    public var doubleValue: Double { NSDecimalNumber(decimal: value).doubleValue }
    public var magnitude: Money { Money(abs(value)) }

    public func formatted(code: String) -> String {
        value.formatted(.currency(code: code))
    }

    /// Explicit-sign form for transaction rows ("+$5,200.00", "-$15.54") so
    /// money-in and money-out never rely on color alone to read differently.
    public func signedFormatted(code: String) -> String {
        let base = magnitude.formatted(code: code)
        if value < 0 { return "-\(base)" }
        if value > 0 { return "+\(base)" }
        return base
    }

    /// Compact form for chart axes and dense rows: "$1.2K", "$3.4M".
    public func compact(code: String) -> String {
        let amount = abs(doubleValue)
        let sign = isNegative ? "-" : ""
        let symbol = Self.symbol(for: code)
        switch amount {
        case 1_000_000...:
            return "\(sign)\(symbol)\((amount / 1_000_000).formatted(.number.precision(.fractionLength(0...1))))M"
        case 10_000...:
            return "\(sign)\(symbol)\((amount / 1_000).formatted(.number.precision(.fractionLength(0...1))))K"
        case 100...:
            return value.formatted(.currency(code: code).precision(.fractionLength(0)))
        default:
            return formatted(code: code)
        }
    }

    /// Currency symbol as the user's locale renders it ("$", "₹", "€"), pulled
    /// from an actual formatted amount so it never falls back to "US$".
    private static func symbol(for code: String) -> String {
        let zero = Decimal.zero.formatted(.currency(code: code).precision(.fractionLength(0)))
        let symbol = zero.filter { !$0.isNumber && !$0.isWhitespace }
        return symbol.isEmpty ? code : symbol
    }
}

extension Money: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let string = try? container.decode(String.self), let decimal = Decimal(string: string, locale: Locale(identifier: "en_US_POSIX")) {
            value = decimal
        } else if let double = try? container.decode(Double.self) {
            value = Decimal(double)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Expected a decimal string or number"
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode("\(value)")
    }
}
