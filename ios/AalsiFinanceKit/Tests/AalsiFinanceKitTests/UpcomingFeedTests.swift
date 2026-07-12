import Foundation
import Testing
@testable import AalsiFinanceKit

private func utcDate(_ y: Int, _ m: Int, _ d: Int) -> Date {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "UTC")!
    return cal.date(from: DateComponents(year: y, month: m, day: d))!
}

private func makeLoan(id: String, name: String, type: String, emi: String?, due: Date?) throws -> Loan {
    var fields = """
    "id": "\(id)", "name": "\(name)", "type": "\(type)",
    "schedule_kind": "amortizing", "principal": "100000", "currency": "INR"
    """
    if let emi { fields += #", "min_or_emi_amount": "\#(emi)""# }
    if let due {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        fields += #", "next_due_date": "\#(f.string(from: due))""#
    }
    return try JSONDecoder.api().decode(Loan.self, from: Data("{\(fields)}".utf8))
}

private func makeRecurring(id: String, name: String, type: String, status: String, amount: String?, due: Date?) throws -> RecurringSeries {
    var fields = """
    "id": "\(id)", "name": "\(name)", "currency": "INR",
    "cadence": "monthly", "type": "\(type)", "status": "\(status)"
    """
    if let amount { fields += #", "amount": "\#(amount)""# }
    if let due {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        fields += #", "next_due_date": "\#(f.string(from: due))""#
    }
    return try JSONDecoder.api().decode(RecurringSeries.self, from: Data("{\(fields)}".utf8))
}

@Suite struct UpcomingFeedTests {
    let today = utcDate(2026, 7, 12)

    @Test func mergesSortsAndFlagsUrgent() throws {
        let card = try makeLoan(id: "33333333-3333-3333-3333-333333333333", name: "Amex", type: "credit_card", emi: "3200", due: utcDate(2026, 7, 12))
        let home = try makeLoan(id: "13333333-3333-3333-3333-333333333333", name: "HDFC Home Loan", type: "home", emi: "18400", due: utcDate(2026, 7, 18))
        let netflix = try makeRecurring(id: "44444444-4444-4444-4444-444444444444", name: "Netflix", type: "subscription", status: "active", amount: "649", due: utcDate(2026, 7, 20))

        let items = UpcomingFeed.build(loans: [home, card], recurring: [netflix], today: today)
        #expect(items.map(\.title) == ["Amex", "HDFC Home Loan", "Netflix"])
        #expect(items[0].isUrgent && items[0].kind == .cardMinimum)
        #expect(!items[1].isUrgent && items[1].kind == .emi)
        #expect(items[2].kind == .subscription)
    }

    @Test func dropsOutOfWindowInactiveAndDateless() throws {
        let farAway = try makeLoan(id: "23333333-3333-3333-3333-333333333333", name: "Car", type: "auto", emi: "9000", due: utcDate(2026, 8, 15))
        let dateless = try makeLoan(id: "33333333-3333-3333-3333-333333333333", name: "Personal", type: "personal", emi: "5000", due: nil)
        let paused = try makeRecurring(id: "54444444-4444-4444-4444-444444444444", name: "Gym", type: "bill", status: "paused", amount: "1500", due: utcDate(2026, 7, 14))
        let transfer = try makeRecurring(id: "64444444-4444-4444-4444-444444444444", name: "To savings", type: "transfer", status: "active", amount: "10000", due: utcDate(2026, 7, 14))

        let items = UpcomingFeed.build(loans: [farAway, dateless], recurring: [paused, transfer], today: today)
        #expect(items.isEmpty)
    }

    @Test func tieBreaksByAmountDescending() throws {
        let a = try makeRecurring(id: "74444444-4444-4444-4444-444444444444", name: "Small", type: "bill", status: "active", amount: "100", due: utcDate(2026, 7, 15))
        let b = try makeRecurring(id: "84444444-4444-4444-4444-444444444444", name: "Big", type: "bill", status: "active", amount: "900", due: utcDate(2026, 7, 15))
        let items = UpcomingFeed.build(loans: [], recurring: [a, b], today: today)
        #expect(items.map(\.title) == ["Big", "Small"])
    }
}
