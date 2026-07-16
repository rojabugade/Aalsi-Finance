import SwiftUI
import Charts
import AalsiFinanceKit

struct HomeView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppTheme.self) private var theme
    @State private var model = HomeViewModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    AppHeader(title: "Kshitij", subtitle: "Here's your financial overview", greeting: true)

                    switch model.state {
                    case .idle, .loading:
                        VStack(spacing: 14) {
                            LoadingCard(height: 190)
                            LoadingCard(height: 104)
                            LoadingCard(height: 160)
                        }
                        .padding(.horizontal, 20)
                    case .failed(let message):
                        ErrorStateView(message: message) {
                            Task { await model.load(api: session.api, force: true) }
                        }
                        .padding(.top, 40)
                    case .loaded(let snapshot):
                        content(snapshot)
                    }
                }
            }
            .background(Color(.systemGroupedBackground))
            .scrollEdgeEffectStyle(.soft, for: .top)
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await model.load(api: session.api, force: true) }
        }
        .task { await model.load(api: session.api) }
    }

    @ViewBuilder
    private func content(_ snapshot: HomeViewModel.Snapshot) -> some View {
        VStack(spacing: 18) {
            ForecastHeroCard(forecast: snapshot.forecast, cashflow: snapshot.cashflow)
                .padding(.horizontal, 20)

            healthTiles(snapshot)
                .padding(.horizontal, 20)

            if !snapshot.upcoming.isEmpty {
                VStack(spacing: 10) {
                    SectionHeaderLink(title: "Upcoming")
                    VStack(spacing: 0) {
                        ForEach(snapshot.upcoming.prefix(3)) { item in
                            UpcomingRowView(item: item)
                            if item.id != snapshot.upcoming.prefix(3).last?.id {
                                Divider().padding(.leading, 54)
                            }
                        }
                    }
                    .card()
                }
                .padding(.horizontal, 20)
            }

            if !snapshot.insights.isEmpty {
                VStack(spacing: 10) {
                    SectionHeaderLink(title: "AI insights")
                        .padding(.horizontal, 20)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(snapshot.insights.prefix(4)) { alert in
                                InsightCardView(alert: alert)
                            }
                        }
                        .padding(.horizontal, 20)
                    }
                    .scrollClipDisabled()
                }
            }

            if !snapshot.recent.isEmpty {
                VStack(spacing: 10) {
                    SectionHeaderLink(title: "Recent activity")
                    VStack(spacing: 0) {
                        ForEach(snapshot.recent) { txn in
                            TransactionRow(transaction: txn, categoryName: txn.categoryId.flatMap { snapshot.categoryNames[$0] })
                            if txn.id != snapshot.recent.last?.id {
                                Divider().padding(.leading, 52)
                            }
                        }
                    }
                    .card()
                }
                .padding(.horizontal, 20)
            }
        }
        .padding(.bottom, 24)
    }

    /// Zero-value metrics are noise, not information: tiles only render when
    /// they have something to say, capped at three so none get crushed.
    private func healthTiles(_ snapshot: HomeViewModel.Snapshot) -> some View {
        var tiles: [(id: String, view: AnyView)] = [("spent", AnyView(spentTile(snapshot)))]
        if snapshot.netWorth.netWorth.value != 0 {
            tiles.append(("networth", AnyView(netWorthTile(snapshot))))
        }
        if snapshot.netWorth.liabilities.value != 0 {
            tiles.append(("debt", AnyView(debtTile(snapshot))))
        }
        if tiles.count < 3 && !snapshot.budgets.isEmpty {
            tiles.append(("budgets", AnyView(budgetsTile(snapshot))))
        }
        return HStack(spacing: 10) {
            ForEach(tiles, id: \.id) { $0.view }
        }
    }

    private func spentTile(_ snapshot: HomeViewModel.Snapshot) -> some View {
        StatTile(
            title: "Spent so far",
            value: snapshot.cashflow.discretionaryMonthly.compact(code: snapshot.cashflow.currency),
            caption: "everyday spend"
        ) {
            BarSparkline(
                values: Array(snapshot.dailySpend.suffix(14)),
                color: theme.accentColor
            )
            .frame(height: 20)
        }
    }

    private func netWorthTile(_ snapshot: HomeViewModel.Snapshot) -> some View {
        StatTile(
            title: "Net worth",
            value: snapshot.netWorth.netWorth.compact(code: snapshot.netWorth.currency),
            caption: netWorthDelta(snapshot.netWorth),
            captionColor: .green
        ) {
            LineSparkline(
                values: snapshot.netWorth.points.map { $0.netWorth.doubleValue },
                color: .green
            )
            .frame(height: 20)
        }
    }

    private func debtTile(_ snapshot: HomeViewModel.Snapshot) -> some View {
        StatTile(
            title: "Debt left",
            value: snapshot.netWorth.liabilities.compact(code: snapshot.netWorth.currency),
            caption: nil
        ) {
            ProgressView(value: debtProgress(snapshot.netWorth))
                .tint(theme.accentColor)
        }
    }

    private func budgetsTile(_ snapshot: HomeViewModel.Snapshot) -> some View {
        let total = snapshot.budgets.count
        let onTrack = snapshot.budgets.filter { !$0.overspent }.count
        let budgeted = snapshot.budgets.reduce(Decimal.zero) { $0 + $1.amount.value }
        let spent = snapshot.budgets.reduce(Decimal.zero) { $0 + $1.spent.value }
        let usage = budgeted > 0 ? min(max(NSDecimalNumber(decimal: spent / budgeted).doubleValue, 0), 1) : 0
        return StatTile(
            title: "Budgets",
            value: "\(onTrack) of \(total)",
            caption: "on track",
            captionColor: onTrack == total ? .secondary : .orange
        ) {
            ProgressView(value: usage)
                .tint(onTrack == total ? theme.accentColor : .orange)
        }
    }

    private func netWorthDelta(_ netWorth: NetWorth) -> String? {
        guard netWorth.points.count >= 2 else { return nil }
        let last = netWorth.points[netWorth.points.count - 1].netWorth.doubleValue
        let previous = netWorth.points[netWorth.points.count - 2].netWorth.doubleValue
        guard previous != 0 else { return nil }
        let pct = (last - previous) / abs(previous) * 100
        return String(format: "%@%.1f%% vs last period", pct >= 0 ? "↑ " : "↓ ", abs(pct))
    }

    private func debtProgress(_ netWorth: NetWorth) -> Double {
        let assets = netWorth.assets.doubleValue
        let debts = netWorth.liabilities.doubleValue
        guard assets + debts > 0 else { return 0 }
        return min(max(assets / (assets + debts), 0), 1)
    }
}

// MARK: - Forecast hero

private struct ForecastHeroCard: View {
    @Environment(AppTheme.self) private var theme
    let forecast: Forecast
    let cashflow: CashflowSummary
    @State private var showsBreakdown = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("You'll end \(monthName) with")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        MoneyText(
                            amount: Money(forecast.projectedLeftover).magnitude,
                            code: cashflow.currency,
                            font: .system(size: 34, weight: .bold)
                        )
                        Text(forecast.projectedLeftover < 0 ? "short" : "left")
                            .font(.subheadline)
                            .foregroundStyle(forecast.projectedLeftover < 0 ? .orange : .secondary)
                    }
                    Text(statusLine)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(forecast.isOnTrack ? .teal : .orange)
                    Button {
                        showsBreakdown = true
                    } label: {
                        HStack(spacing: 3) {
                            Text("See why")
                            Image(systemName: "chevron.right").font(.caption2.weight(.semibold))
                        }
                        .font(.caption.weight(.medium))
                    }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .controlSize(.small)
                    .padding(.top, 2)
                }

                forecastChart
                    .frame(width: 120, height: 84)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular.tint(theme.accentColor.opacity(0.2)).interactive(), in: .rect(cornerRadius: 28))
        .sheet(isPresented: $showsBreakdown) { BreakdownSheet(cashflow: cashflow) }
    }

    private var monthName: String {
        Date.now.formatted(.dateTime.month(.wide))
    }

    /// One line carries both state and magnitude — the old design spent a
    /// headline and a caption saying the same thing twice.
    private var statusLine: String {
        guard forecast.deltaVsPlan != 0 else {
            return forecast.isOnTrack ? "On track with your plan" : "Over plan"
        }
        let delta = Money(forecast.deltaVsPlan).magnitude.compact(code: cashflow.currency)
        return forecast.isOnTrack ? "On track · \(delta) ahead of plan" : "Over plan · \(delta) behind"
    }

    private var forecastChart: some View {
        Chart(forecast.points, id: \.day) { point in
            LineMark(
                x: .value("Day", point.day),
                y: .value("Leftover", NSDecimalNumber(decimal: point.value).doubleValue)
            )
            .foregroundStyle(theme.accentColor)
            .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round, dash: point.isProjected ? [3, 4] : []))

            if point.day == forecast.points.last?.day {
                PointMark(
                    x: .value("Day", point.day),
                    y: .value("Leftover", NSDecimalNumber(decimal: point.value).doubleValue)
                )
                .symbolSize(50)
                .foregroundStyle(theme.accentColor)
            }
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartYScale(domain: .automatic(includesZero: false))
    }
}

/// Income − recurring − EMIs − card minimums − discretionary; the old
/// SafeToSpendCard content relocated behind "See why".
private struct BreakdownSheet: View {
    let cashflow: CashflowSummary

    var body: some View {
        NavigationStack {
            List {
                row("Income", cashflow.incomeMonthly, .green)
                row("Recurring", cashflow.recurringMonthly, .orange)
                row("EMIs", cashflow.debtEmiMonthly, .red)
                row("Card minimums", cashflow.cardMinMonthly, .pink)
                row("Discretionary so far", cashflow.discretionaryMonthly, .blue)
                row("Left over", cashflow.leftoverMonthly, .primary)
            }
            .navigationTitle("How this is calculated")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium])
    }

    private func row(_ label: String, _ amount: Money, _ color: Color) -> some View {
        HStack {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label)
            Spacer()
            MoneyText(amount: amount, code: cashflow.currency, font: .subheadline.weight(.semibold))
        }
    }
}

// MARK: - Upcoming + insights rows

struct UpcomingRowView: View {
    let item: UpcomingItem

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: iconName)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(item.isUrgent ? Color.pink : Color.secondary)
                .frame(width: 38, height: 38)
                .background(
                    (item.isUrgent ? Color.pink.opacity(0.15) : Color(.tertiarySystemFill)),
                    in: RoundedRectangle(cornerRadius: 11, style: .continuous)
                )

            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).font(.subheadline.weight(.medium)).lineLimit(1)
                Text(dueLabel)
                    .font(.caption)
                    .foregroundStyle(item.isUrgent ? .pink : .secondary)
            }

            Spacer(minLength: 8)

            if let amount = item.amount {
                MoneyText(amount: Money(amount), code: item.currency, font: .subheadline.weight(.semibold))
            }
        }
        .padding(.vertical, 8)
    }

    private var iconName: String {
        switch item.kind {
        case .emi: "house.fill"
        case .cardMinimum: "creditcard.fill"
        case .subscription: "play.tv.fill"
        case .bill: "doc.text.fill"
        case .income: "arrow.down.left.circle.fill"
        case .other: "calendar"
        }
    }

    private var dueLabel: String {
        if item.isUrgent { return "Today" }
        let days = Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: .now), to: item.dueDate).day ?? 0
        return days == 1 ? "Tomorrow" : "In \(days) days"
    }
}

struct InsightCardView: View {
    let alert: PersistentAlert

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: alert.tone == "positive" ? "chart.line.uptrend.xyaxis" : "exclamationmark.bubble.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(alert.tone == "positive" ? Color.green : Color.orange)
                .frame(width: 32, height: 32)
                .background(
                    (alert.tone == "positive" ? Color.green : Color.orange).opacity(0.15),
                    in: RoundedRectangle(cornerRadius: 9, style: .continuous)
                )
            VStack(alignment: .leading, spacing: 2) {
                Text(alert.title).font(.caption.weight(.semibold)).lineLimit(1)
                Text(alert.detail).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .padding(12)
        .frame(width: 230, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}
