import SwiftUI
import AalsiFinanceKit

struct SpendingOverview: View {
    let period: SpendPeriod
    let overview: SpendOverview
    var currency: String = "USD"
    let onPrevious: () -> Void
    let onNext: () -> Void
    let onRoute: (SpendingRoute) -> Void

    var body: some View {
        LazyVStack(spacing: 14) {
            MonthSelector(
                monthStart: period.monthStart,
                canGoForward: !period.isCurrentMonth,
                onPrevious: onPrevious,
                onNext: onNext
            )

            SpendPulseCard(overview: overview, currency: currency)

            if let insight = overview.insight {
                let destination = route(for: insight.kind)
                SpendInsightCard(
                    insight: insight,
                    currency: currency,
                    action: destination.map { route in { onRoute(route) } }
                )
            }

            SpendRankedPreview(
                title: "Categories",
                categories: Array(overview.categories.prefix(3)),
                currency: currency,
                onSelect: { onRoute(.category($0)) }
            )

            SpendRankedPreview(
                title: "Merchants",
                merchants: Array(overview.merchants.prefix(3)),
                currency: currency,
                onSelect: { onRoute(.merchant($0)) }
            )
        }
        .padding(.horizontal, 20)
    }

    private func route(for kind: SpendInsightKind) -> SpendingRoute? {
        switch kind {
        case let .category(id): .category(id)
        case let .merchant(key): .merchant(key)
        case let .transaction(id): .transaction(id)
        case .pace: nil
        }
    }
}

struct MonthSelector: View {
    let monthStart: Date
    let canGoForward: Bool
    let onPrevious: () -> Void
    let onNext: () -> Void

    var body: some View {
        HStack(spacing: 16) {
            Button(action: onPrevious) {
                Image(systemName: "chevron.left")
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Previous month")

            Spacer(minLength: 8)

            Text(monthTitle)
                .font(.headline)
                .fontDesign(.rounded)
                .accessibilityAddTraits(.isHeader)

            Spacer(minLength: 8)

            Button(action: onNext) {
                Image(systemName: "chevron.right")
                    .frame(width: 44, height: 44)
            }
            .disabled(!canGoForward)
            .opacity(canGoForward ? 1 : 0.35)
            .accessibilityLabel("Next month")
        }
        .frame(minHeight: 44)
    }

    private var monthTitle: String {
        var format = Date.FormatStyle().month(.wide).year()
        format.timeZone = TimeZone(secondsFromGMT: 0)!
        return monthStart.formatted(format)
    }
}

private enum SpendingOverviewPreviewFixtures {
    static let categoryID = UUID(uuidString: "0CBE97A4-27F3-4971-AB01-92307AF267E7")!

    static let period = SpendPeriod(
        monthStart: date(2026, 7, 1),
        current: DateWindow(start: date(2026, 7, 1), end: date(2026, 8, 1)),
        previous: DateWindow(start: date(2026, 6, 1), end: date(2026, 7, 1)),
        isCurrentMonth: true
    )

    static let overview = SpendOverview(
        total: Money(Decimal(string: "2847.32")!),
        previousTotal: Money(Decimal(string: "2460.18")!),
        transactionCount: 42,
        dailyPace: Money(Decimal(string: "91.85")!),
        cumulativeDaily: [230, 540, 890, 1220, 1680, 1950, 2330, 2847].map { Money(Decimal($0)) },
        categories: [
            CategorySpendRow(
                id: categoryID,
                name: "Food & Dining",
                total: Money(Decimal(string: "1042.18")!),
                previous: Money(Decimal(string: "920.40")!),
                delta: Money(Decimal(string: "121.78")!),
                share: 0.366,
                count: 18
            ),
            CategorySpendRow(
                id: UUID(uuidString: "2A1D52C6-D1E7-4842-9D79-A60F74A9EB49")!,
                name: "Travel",
                total: Money(Decimal(string: "780.00")!),
                previous: Money(Decimal(string: "600.00")!),
                delta: Money(180),
                share: 0.274,
                count: 4
            )
        ],
        merchants: [
            MerchantSpendRow(
                id: "whole-foods",
                name: "Whole Foods",
                total: Money(Decimal(string: "438.52")!),
                previous: Money(Decimal(string: "390.14")!),
                delta: Money(Decimal(string: "48.38")!),
                count: 6,
                topCategory: "Groceries",
                isRecurring: false
            ),
            MerchantSpendRow(
                id: "delta-air-lines",
                name: "Delta Air Lines",
                total: Money(Decimal(string: "382.00")!),
                previous: Money(),
                delta: Money(382),
                count: 1,
                topCategory: "Travel",
                isRecurring: false
            )
        ],
        insight: SpendInsight(
            kind: .category(categoryID),
            title: "Dining is leading this month",
            detail: "It accounts for the largest share of your July spending.",
            delta: Money(Decimal(string: "121.78")!)
        )
    )

    static let empty = SpendOverview(
        total: Money(),
        previousTotal: Money(),
        transactionCount: 0,
        dailyPace: Money(),
        cumulativeDaily: [],
        categories: [],
        merchants: [],
        insight: nil
    )

    private static func date(_ year: Int, _ month: Int, _ day: Int) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar.date(from: DateComponents(year: year, month: month, day: day))!
    }
}

#Preview("Overview Dark") {
    ScrollView {
        SpendingOverview(
            period: SpendingOverviewPreviewFixtures.period,
            overview: SpendingOverviewPreviewFixtures.overview,
            onPrevious: {},
            onNext: {},
            onRoute: { _ in }
        )
        .padding(.vertical, 20)
    }
    .background(Color(.systemGroupedBackground))
    .environment(AppTheme())
    .preferredColorScheme(.dark)
}

#Preview("Overview Light") {
    ScrollView {
        SpendingOverview(
            period: SpendingOverviewPreviewFixtures.period,
            overview: SpendingOverviewPreviewFixtures.overview,
            onPrevious: {},
            onNext: {},
            onRoute: { _ in }
        )
        .padding(.vertical, 20)
    }
    .background(Color(.systemGroupedBackground))
    .environment(AppTheme())
    .preferredColorScheme(.light)
}

#Preview("Overview Empty") {
    ScrollView {
        SpendingOverview(
            period: SpendingOverviewPreviewFixtures.period,
            overview: SpendingOverviewPreviewFixtures.empty,
            onPrevious: {},
            onNext: {},
            onRoute: { _ in }
        )
        .padding(.vertical, 20)
    }
    .background(Color(.systemGroupedBackground))
    .environment(AppTheme())
    .preferredColorScheme(.light)
}
