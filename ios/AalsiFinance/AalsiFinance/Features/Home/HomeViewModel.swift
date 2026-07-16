import Foundation
import Observation
import AalsiFinanceKit

@MainActor
@Observable
final class HomeViewModel {
    struct Snapshot: Sendable {
        let cashflow: CashflowSummary
        let netWorth: NetWorth
        let forecast: Forecast
        let dailySpend: [Double]
        let budgets: [Budget]
        let upcoming: [UpcomingItem]
        let insights: [PersistentAlert]
        let recent: [Transaction]
        let categoryNames: [UUID: String]
    }
    private(set) var state: Loadable<Snapshot> = .idle

    func load(api: APIClient, force: Bool = false) async {
        if case .loaded = state, !force { return }
        if case .idle = state { state = .loading }
        do {
            let now = Date()
            var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "UTC")!
            let monthStart = cal.date(from: cal.dateComponents([.year, .month], from: now))!
            let monthFrom = cal.date(byAdding: .day, value: -30, to: now)!
            async let cashflow = api.cashflowSummary(); async let netWorth = api.netWorth(); async let budgets = api.budgets()
            async let transactions = api.transactions(); async let categories = api.categories(); async let loans = api.loans()
            async let recurring = api.recurringSeries(); async let monitor = api.monitorAlerts(from: monthFrom, to: now)
            let cats = try await categories
            let names = Dictionary(uniqueKeysWithValues: cats.map { ($0.id, $0.name) })
            let txns = try await transactions; let flow = try await cashflow; let budgetList = try await budgets
            let input = Self.forecastInput(cashflow: flow, budgets: budgetList, transactions: txns, monthStart: monthStart, now: now, calendar: cal)
            let forecast = ForecastMath.forecast(input)
            let upcoming = UpcomingFeed.build(loans: try await loans, recurring: try await recurring, today: now)
            let insights = (try? await monitor)?.alerts.filter { $0.state == "active" }.sorted { $0.severity > $1.severity } ?? []
            state = .loaded(Snapshot(
                cashflow: flow,
                netWorth: try await netWorth,
                forecast: forecast,
                dailySpend: input.dailyDiscretionary.map { NSDecimalNumber(decimal: $0).doubleValue },
                budgets: budgetList,
                upcoming: upcoming,
                insights: insights,
                recent: Array(txns.prefix(4)),
                categoryNames: names
            ))
        } catch { if state.value == nil { state = .failed(error.localizedDescription) } }
    }

    /// Spend follows the web convention: outflows are NEGATIVE, income/refunds
    /// positive. Discretionary-so-far is therefore the magnitude of negative
    /// amounts only — positive rows (payroll, refunds) never count as spend.
    static func forecastInput(cashflow: CashflowSummary, budgets: [Budget], transactions: [Transaction], monthStart: Date, now: Date, calendar: Calendar) -> ForecastInput {
        let dayOfMonth = calendar.component(.day, from: now)
        let daysInMonth = calendar.range(of: .day, in: .month, for: now)?.count ?? 30
        var daily = [Decimal](repeating: .zero, count: dayOfMonth)
        for txn in transactions where !txn.isDraft && txn.txnDate >= monthStart && txn.txnDate <= now {
            guard txn.amount.isNegative else { continue }
            let day = calendar.component(.day, from: txn.txnDate)
            if day >= 1 && day <= dayOfMonth { daily[day - 1] += -txn.amount.value }
        }
        let monthlyBudgetTotal = budgets.filter { $0.period == "monthly" }.reduce(Decimal.zero) { $0 + $1.amount.value }
        return ForecastInput(incomeMonthly: cashflow.incomeMonthly.value, recurringMonthly: cashflow.recurringMonthly.value, debtEmiMonthly: cashflow.debtEmiMonthly.value, cardMinMonthly: cashflow.cardMinMonthly.value, dailyDiscretionary: daily, plannedDiscretionaryMonthly: monthlyBudgetTotal > 0 ? monthlyBudgetTotal : nil, daysInMonth: daysInMonth)
    }
}
