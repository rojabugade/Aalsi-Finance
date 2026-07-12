import SwiftUI
import Charts

struct InsightsView: View {
    @Environment(AppSession.self) private var session
    @State private var model = InsightsViewModel()

    private static let palette: [Color] = [
        .indigo, .teal, .orange, .pink, .blue, .green, .purple, .yellow, .red, .mint,
    ]

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            ScrollView {
                VStack(spacing: 22) {
                    Picker("Period", selection: $model.period) {
                        ForEach(InsightsViewModel.Period.allCases) { period in
                            Text(period.rawValue).tag(period)
                        }
                    }
                    .pickerStyle(.segmented)

                    switch model.state {
                    case .idle, .loading:
                        LoadingCard(height: 260)
                        LoadingCard(height: 220)
                    case .failed(let message):
                        ErrorStateView(message: message) {
                            Task { await model.load(api: session.api, force: true) }
                        }
                        .padding(.top, 40)
                    case .loaded(let snapshot):
                        content(snapshot)
                    }
                }
                .padding(20)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Insights")
            .scrollEdgeEffectStyle(.soft, for: .top)
        }
        .task(id: model.generation) {
            await model.load(api: session.api, force: model.generation > 0)
        }
    }

    @ViewBuilder
    private func content(_ snapshot: InsightsViewModel.Snapshot) -> some View {
        let categoryRows = topRows(snapshot.categories, key: "category", limit: 8)
        let merchantRows = topRows(snapshot.merchants, key: "merchant", limit: 6)

        if categoryRows.isEmpty && merchantRows.isEmpty && snapshot.series.points.isEmpty {
            ContentUnavailableView(
                "Nothing to chart yet",
                systemImage: "chart.pie",
                description: Text("Spending for \(model.period.title.lowercased()) will show up here once transactions are confirmed.")
            )
            .padding(.top, 40)
        }

        if !categoryRows.isEmpty {
            VStack(spacing: 12) {
                SectionHeader(title: "Where It Went", systemImage: "chart.pie.fill")
                CategoryDonut(rows: categoryRows, currency: snapshot.currency, palette: Self.palette)
                    .card()
            }
        }

        if snapshot.series.points.count > 1 {
            VStack(spacing: 12) {
                SectionHeader(title: "Spend vs Income", systemImage: "chart.bar.fill")
                SpendIncomeChart(points: snapshot.series.points, currency: snapshot.currency)
                    .card()
            }
        }

        if !merchantRows.isEmpty {
            VStack(spacing: 12) {
                SectionHeader(title: "Top Merchants", systemImage: "storefront.fill")
                MerchantBars(rows: merchantRows, currency: snapshot.currency)
                    .card()
            }
        }
    }

    private func topRows(_ breakdown: Breakdown, key: String, limit: Int) -> [(name: String, total: Money)] {
        breakdown.rows
            .map { (name: $0.dimension(key) ?? "Uncategorized", total: $0.total) }
            .filter { !$0.total.isNegative && $0.total.value > 0 }
            .sorted { $0.total.value > $1.total.value }
            .prefix(limit)
            .map { $0 }
    }
}

// MARK: - Category donut

private struct CategoryDonut: View {
    let rows: [(name: String, total: Money)]
    let currency: String
    let palette: [Color]

    private var totalSpend: Decimal {
        rows.reduce(.zero) { $0 + $1.total.value }
    }

    var body: some View {
        VStack(spacing: 18) {
            Chart(Array(rows.enumerated()), id: \.offset) { index, row in
                SectorMark(
                    angle: .value("Spend", row.total.doubleValue),
                    innerRadius: .ratio(0.65),
                    angularInset: 2
                )
                .cornerRadius(5)
                .foregroundStyle(palette[index % palette.count])
            }
            .chartBackground { proxy in
                GeometryReader { geometry in
                    if let frame = proxy.plotFrame.map({ geometry[$0] }) {
                        VStack(spacing: 2) {
                            Text("Total")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(Money(totalSpend).compact(code: currency))
                                .font(.title3.bold())
                                .fontDesign(.rounded)
                                .monospacedDigit()
                        }
                        .position(x: frame.midX, y: frame.midY)
                    }
                }
            }
            .frame(height: 210)

            VStack(spacing: 8) {
                ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                    HStack(spacing: 8) {
                        Circle()
                            .fill(palette[index % palette.count])
                            .frame(width: 9, height: 9)
                        Text(row.name)
                            .font(.subheadline)
                            .lineLimit(1)
                        Spacer()
                        Text(row.total.formatted(code: currency))
                            .font(.subheadline.weight(.medium))
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}

// MARK: - Spend vs income bars

private struct SpendIncomeChart: View {
    let points: [TimeSeriesPoint]
    let currency: String

    var body: some View {
        Chart {
            ForEach(points, id: \.period) { point in
                BarMark(
                    x: .value("Period", shortPeriod(point.period)),
                    y: .value("Amount", point.spend.doubleValue),
                    width: .ratio(0.35)
                )
                .foregroundStyle(by: .value("Kind", "Spend"))
                .position(by: .value("Kind", "Spend"))
                .cornerRadius(4)

                BarMark(
                    x: .value("Period", shortPeriod(point.period)),
                    y: .value("Amount", point.income.doubleValue),
                    width: .ratio(0.35)
                )
                .foregroundStyle(by: .value("Kind", "Income"))
                .position(by: .value("Kind", "Income"))
                .cornerRadius(4)
            }
        }
        .chartForegroundStyleScale(["Spend": Color.indigo, "Income": Color.teal])
        .chartLegend(position: .top, alignment: .trailing)
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine()
                AxisValueLabel {
                    if let amount = value.as(Double.self) {
                        Text(Money(Decimal(amount)).compact(code: currency))
                    }
                }
            }
        }
        .frame(height: 220)
    }

    /// "2026-05" → "May", "2026-W23" → "W23".
    private func shortPeriod(_ period: String) -> String {
        let parts = period.split(separator: "-")
        guard parts.count >= 2 else { return period }
        let tail = String(parts[1])
        if tail.hasPrefix("W") { return tail }
        if let month = Int(tail), (1...12).contains(month) {
            return Calendar.current.shortMonthSymbols[month - 1]
        }
        return period
    }
}

// MARK: - Top merchants

private struct MerchantBars: View {
    let rows: [(name: String, total: Money)]
    let currency: String

    private var maxTotal: Double {
        rows.map(\.total.doubleValue).max() ?? 1
    }

    var body: some View {
        VStack(spacing: 12) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                VStack(spacing: 4) {
                    HStack {
                        Text(row.name)
                            .font(.subheadline.weight(.medium))
                            .lineLimit(1)
                        Spacer()
                        Text(row.total.formatted(code: currency))
                            .font(.subheadline)
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            Capsule().fill(.fill.tertiary)
                            Capsule()
                                .fill(Color.indigo.gradient)
                                .frame(width: max(6, geometry.size.width * (row.total.doubleValue / maxTotal)))
                        }
                    }
                    .frame(height: 8)
                }
            }
        }
    }
}
