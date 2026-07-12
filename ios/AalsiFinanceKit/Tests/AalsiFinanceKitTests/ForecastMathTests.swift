import Foundation
import Testing
@testable import AalsiFinanceKit

@Suite struct ForecastMathTests {
    // income 110000, recurring 20000, emi 18400, cardMin 3200 → fixedAvailable 68400
    private func input(daily: [Decimal], planned: Decimal?, daysInMonth: Int = 30) -> ForecastInput {
        ForecastInput(
            incomeMonthly: 110_000, recurringMonthly: 20_000,
            debtEmiMonthly: 18_400, cardMinMonthly: 3_200,
            dailyDiscretionary: daily,
            plannedDiscretionaryMonthly: planned,
            daysInMonth: daysInMonth
        )
    }

    @Test func projectsLeftoverProRata() {
        let f = ForecastMath.forecast(input(daily: Array(repeating: 1_500, count: 10), planned: nil))
        #expect(f.projectedLeftover == 23_400)
        #expect(f.deltaVsPlan == 0)
        #expect(f.isOnTrack)
    }

    @Test func deltaAgainstPlannedBudget() {
        let f = ForecastMath.forecast(input(daily: Array(repeating: 1_500, count: 10), planned: 30_000))
        #expect(f.deltaVsPlan == -15_000)
        #expect(!f.isOnTrack)

        let g = ForecastMath.forecast(input(daily: Array(repeating: 500, count: 10), planned: 30_000))
        #expect(g.deltaVsPlan == 15_000)
        #expect(g.isOnTrack)
    }

    @Test func curveShape() {
        let f = ForecastMath.forecast(input(daily: Array(repeating: 1_500, count: 10), planned: nil))
        #expect(f.points.count == 30)
        #expect(f.points.prefix(10).allSatisfy { !$0.isProjected })
        #expect(f.points.dropFirst(10).allSatisfy { $0.isProjected })
        #expect(f.points.last?.value == f.projectedLeftover)
        #expect(f.points[9].value == 7_800)
    }

    @Test func emptyDaysDoesNotCrash() {
        let f = ForecastMath.forecast(input(daily: [], planned: nil))
        #expect(f.projectedLeftover == 68_400)
        #expect(f.points.count == 30)
    }
}
