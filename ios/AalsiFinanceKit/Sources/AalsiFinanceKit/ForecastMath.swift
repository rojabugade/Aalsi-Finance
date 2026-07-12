import Foundation

public struct ForecastInput: Sendable {
    public let incomeMonthly: Decimal
    public let recurringMonthly: Decimal
    public let debtEmiMonthly: Decimal
    public let cardMinMonthly: Decimal
    public let dailyDiscretionary: [Decimal]
    public let plannedDiscretionaryMonthly: Decimal?
    public let daysInMonth: Int

    public init(incomeMonthly: Decimal, recurringMonthly: Decimal, debtEmiMonthly: Decimal,
                cardMinMonthly: Decimal, dailyDiscretionary: [Decimal],
                plannedDiscretionaryMonthly: Decimal?, daysInMonth: Int) {
        self.incomeMonthly = incomeMonthly
        self.recurringMonthly = recurringMonthly
        self.debtEmiMonthly = debtEmiMonthly
        self.cardMinMonthly = cardMinMonthly
        self.dailyDiscretionary = dailyDiscretionary
        self.plannedDiscretionaryMonthly = plannedDiscretionaryMonthly
        self.daysInMonth = daysInMonth
    }
}

public struct ForecastPoint: Equatable, Sendable {
    public let day: Int
    public let value: Decimal
    public let isProjected: Bool
}

public struct Forecast: Equatable, Sendable {
    public let projectedLeftover: Decimal
    public let deltaVsPlan: Decimal
    public let isOnTrack: Bool
    public let points: [ForecastPoint]
}

public enum ForecastMath {
    public static func forecast(_ input: ForecastInput) -> Forecast {
        let fixedAvailable = input.incomeMonthly - input.recurringMonthly
            - input.debtEmiMonthly - input.cardMinMonthly
        let dayOfMonth = max(input.dailyDiscretionary.count, 1)
        let daysInMonth = max(input.daysInMonth, dayOfMonth)
        let spentToDate = input.dailyDiscretionary.reduce(Decimal.zero, +)
        let projectedDiscretionary = spentToDate / Decimal(dayOfMonth) * Decimal(daysInMonth)
        let projectedLeftover = fixedAvailable - projectedDiscretionary
        let planLeftover = fixedAvailable - (input.plannedDiscretionaryMonthly ?? projectedDiscretionary)
        let deltaVsPlan = projectedLeftover - planLeftover

        var points: [ForecastPoint] = []
        var cumulative = Decimal.zero
        for day in 1...dayOfMonth {
            if day <= input.dailyDiscretionary.count {
                cumulative += input.dailyDiscretionary[day - 1]
            }
            let value = fixedAvailable * Decimal(day) / Decimal(daysInMonth) - cumulative
            points.append(ForecastPoint(day: day, value: value, isProjected: false))
        }
        if dayOfMonth < daysInMonth, let lastHistory = points.last {
            let remaining = daysInMonth - dayOfMonth
            let step = (projectedLeftover - lastHistory.value) / Decimal(remaining)
            for offset in 1...remaining {
                let value = offset == remaining
                    ? projectedLeftover
                    : lastHistory.value + step * Decimal(offset)
                points.append(ForecastPoint(day: dayOfMonth + offset, value: value, isProjected: true))
            }
        }

        return Forecast(
            projectedLeftover: projectedLeftover,
            deltaVsPlan: deltaVsPlan,
            isOnTrack: deltaVsPlan >= 0,
            points: points
        )
    }
}
