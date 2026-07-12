import Foundation
import Testing
@testable import AalsiFinanceKit

@Suite struct MoneyTests {
    @Test func decodesDecimalString() throws {
        let money = try JSONDecoder.api().decode(Money.self, from: Data(#""1234.56""#.utf8))
        #expect(money.value == Decimal(string: "1234.56", locale: Locale(identifier: "en_US_POSIX")))
    }

    @Test func decodesPlainNumber() throws {
        let money = try JSONDecoder.api().decode(Money.self, from: Data("42.5".utf8))
        #expect(money.doubleValue == 42.5)
    }

    @Test func negativeAndMagnitude() {
        let money = Money(Decimal(-300))
        #expect(money.isNegative)
        #expect(money.magnitude.value == Decimal(300))
    }

    @Test func compactUsesKAboveTenThousand() {
        let money = Money(Decimal(12_500))
        #expect(money.compact(code: "USD") == "$12.5K")
    }

    @Test func encodesAsString() throws {
        let data = try JSONEncoder.api().encode(Money(Decimal(7)))
        #expect(String(data: data, encoding: .utf8) == #""7""#)
    }
}
