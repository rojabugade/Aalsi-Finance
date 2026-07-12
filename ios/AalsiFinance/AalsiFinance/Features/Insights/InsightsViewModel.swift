import Foundation
import Observation

@MainActor
@Observable
final class InsightsViewModel {
    enum Period: String, CaseIterable, Identifiable {
        case month = "1M"
        case quarter = "3M"
        case halfYear = "6M"
        case year = "1Y"
        var id: String { rawValue }

        var months: Int {
            switch self {
            case .month: 1
            case .quarter: 3
            case .halfYear: 6
            case .year: 12
            }
        }

        var title: String {
            switch self {
            case .month: "This month"
            case .quarter: "Last 3 months"
            case .halfYear: "Last 6 months"
            case .year: "Last 12 months"
            }
        }
    }

    struct Snapshot: Sendable {
        let categories: Breakdown
        let merchants: Breakdown
        let series: TimeSeries
        let currency: String
    }

    private(set) var state: Loadable<Snapshot> = .idle
    var period: Period = .quarter {
        didSet { generation &+= 1 }
    }
    /// Bumped whenever the period changes so the view's `.task(id:)` reloads.
    private(set) var generation = 0

    func load(api: APIClient, force: Bool = false) async {
        if case .loaded = state, !force { return }
        if state.value == nil { state = .loading }
        let calendar = Calendar.current
        let to = Date()
        let from = calendar.date(byAdding: .month, value: -period.months, to: calendar.startOfDay(for: to)) ?? to
        do {
            async let categories = api.breakdown(dimension: "category", from: from, to: to)
            async let merchants = api.breakdown(dimension: "merchant", from: from, to: to)
            async let series = api.timeseries(interval: "monthly", from: from, to: to)
            async let household = api.household()
            state = .loaded(
                Snapshot(
                    categories: try await categories,
                    merchants: try await merchants,
                    series: try await series,
                    currency: try await household.baseCurrency
                )
            )
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}
