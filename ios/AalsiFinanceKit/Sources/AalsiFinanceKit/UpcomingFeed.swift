import Foundation

public struct UpcomingItem: Equatable, Identifiable, Sendable {
    public enum Kind: String, Sendable { case emi, cardMinimum, subscription, bill, income, other }
    public let id: String
    public let title: String
    public let amount: Decimal?
    public let currency: String
    public let dueDate: Date
    public let kind: Kind
    public let isUrgent: Bool
}

public enum UpcomingFeed {
    private static var utcCalendar: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }

    public static func build(loans: [Loan], recurring: [RecurringSeries], today: Date, windowDays: Int = 14) -> [UpcomingItem] {
        let cal = utcCalendar
        let windowStart = cal.startOfDay(for: today)
        guard let windowEnd = cal.date(byAdding: .day, value: windowDays, to: windowStart) else { return [] }

        func inWindow(_ date: Date) -> Bool { date >= windowStart && date <= windowEnd }
        func urgent(_ date: Date) -> Bool { cal.isDate(date, inSameDayAs: today) }

        var items: [UpcomingItem] = []

        for loan in loans {
            guard let due = loan.nextDueDate, inWindow(due) else { continue }
            items.append(UpcomingItem(
                id: "loan-\(loan.id.uuidString.lowercased())",
                title: loan.name,
                amount: loan.minOrEmiAmount?.value,
                currency: loan.currency,
                dueDate: due,
                kind: loan.isCreditCard ? .cardMinimum : .emi,
                isUrgent: urgent(due)
            ))
        }

        for series in recurring {
            guard series.status == "active", series.type != "transfer",
                  let due = series.nextDueDate, inWindow(due) else { continue }
            let kind: UpcomingItem.Kind = switch series.type {
            case "subscription": .subscription
            case "bill": .bill
            case "income": .income
            default: .other
            }
            items.append(UpcomingItem(
                id: "recurring-\(series.id.uuidString.lowercased())",
                title: series.name,
                amount: series.amount?.value,
                currency: series.currency,
                dueDate: due,
                kind: kind,
                isUrgent: urgent(due)
            ))
        }

        return items.sorted { lhs, rhs in
            if lhs.dueDate != rhs.dueDate { return lhs.dueDate < rhs.dueDate }
            return (lhs.amount ?? -1) > (rhs.amount ?? -1)
        }
    }
}
