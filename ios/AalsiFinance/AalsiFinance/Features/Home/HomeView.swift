import SwiftUI
import Charts

struct HomeView: View {
    @Environment(AppSession.self) private var session
    @State private var model = HomeViewModel()

    var body: some View {
        NavigationStack {
            Group {
                switch model.state {
                case .idle, .loading:
                    loadingState
                case .failed(let message):
                    ErrorStateView(message: message) {
                        Task { await model.load(api: session.api, force: true) }
                    }
                case .loaded(let snapshot):
                    content(snapshot)
                }
            }
            .navigationTitle("Home")
            .background(Color(.systemGroupedBackground))
            .scrollEdgeEffectStyle(.soft, for: .top)
        }
        .task { await model.load(api: session.api) }
    }

    private var loadingState: some View {
        ScrollView {
            VStack(spacing: 16) {
                LoadingCard(height: 190)
                LoadingCard(height: 150)
                LoadingCard(height: 130)
            }
            .padding(20)
        }
    }

    private func content(_ snapshot: HomeViewModel.Snapshot) -> some View {
        ScrollView {
            VStack(spacing: 22) {
                SafeToSpendCard(cashflow: snapshot.cashflow)

                NetWorthCard(netWorth: snapshot.netWorth)

                if !snapshot.budgets.isEmpty {
                    VStack(spacing: 12) {
                        SectionHeader(title: "Budgets", systemImage: "chart.bar.horizontal.page")
                        VStack(spacing: 14) {
                            ForEach(snapshot.budgets) { budget in
                                BudgetRow(budget: budget, categoryNames: snapshot.categoryNames)
                            }
                        }
                        .card()
                    }
                }

                VStack(spacing: 12) {
                    SectionHeader(title: "Recent Activity", systemImage: "clock")
                    if snapshot.recent.isEmpty {
                        ContentUnavailableView(
                            "No transactions yet",
                            systemImage: "tray",
                            description: Text("Add transactions on the web app or link a bank — they'll show up here.")
                        )
                        .card()
                    } else {
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
                }
            }
            .padding(20)
        }
        .refreshable { await model.load(api: session.api, force: true) }
    }
}

// MARK: - Safe to spend hero

private struct SafeToSpendCard: View {
    let cashflow: CashflowSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Safe to spend this month", systemImage: "checkmark.seal.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)

            MoneyText(amount: cashflow.leftoverMonthly, code: cashflow.currency, font: .system(size: 44, weight: .bold))
                .foregroundStyle(cashflow.leftoverMonthly.isNegative ? Color.red : Color.primary)
                .contentTransition(.numericText())

            Text("Income − recurring − EMIs − card minimums − discretionary spend")
                .font(.caption)
                .foregroundStyle(.tertiary)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    chip("Income", cashflow.incomeMonthly, .green)
                    chip("Recurring", cashflow.recurringMonthly, .orange)
                    chip("EMIs", cashflow.debtEmiMonthly, .red)
                    chip("Cards", cashflow.cardMinMonthly, .pink)
                    chip("Discretionary", cashflow.discretionaryMonthly, .blue)
                }
            }
            .scrollClipDisabled()
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular.tint(.indigo.opacity(0.2)).interactive(), in: .rect(cornerRadius: 32))
    }

    private func chip(_ label: String, _ amount: Money, _ color: Color) -> some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(label).font(.caption.weight(.medium))
            Text(amount.compact(code: cashflow.currency))
                .font(.caption.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.fill.tertiary, in: .capsule)
    }
}

// MARK: - Net worth

private struct NetWorthCard: View {
    let netWorth: NetWorth

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Net Worth")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                    MoneyText(amount: netWorth.netWorth, code: netWorth.currency, font: .title.bold())
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    detail("Assets", netWorth.assets, .green)
                    detail("Debts", netWorth.liabilities, .red)
                }
            }

            if netWorth.points.count > 1 {
                Chart(netWorth.points, id: \.period) { point in
                    LineMark(
                        x: .value("Period", point.period),
                        y: .value("Net worth", point.netWorth.doubleValue)
                    )
                    .foregroundStyle(.indigo)
                    .interpolationMethod(.catmullRom)
                    .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round))

                    PointMark(
                        x: .value("Period", point.period),
                        y: .value("Net worth", point.netWorth.doubleValue)
                    )
                    .symbolSize(point.period == netWorth.points.last?.period ? 42 : 0)
                    .foregroundStyle(.indigo)
                }
                .chartXAxis(.hidden)
                .chartYAxis(.hidden)
                .chartYScale(domain: .automatic(includesZero: false))
                .frame(height: 70)
            }
        }
        .card()
    }

    private func detail(_ label: String, _ amount: Money, _ color: Color) -> some View {
        HStack(spacing: 5) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(amount.compact(code: netWorth.currency))
                .font(.caption.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(color)
        }
    }
}

// MARK: - Budgets

private struct BudgetRow: View {
    let budget: Budget
    let categoryNames: [UUID: String]

    private var name: String {
        budget.categoryId.flatMap { categoryNames[$0] } ?? "Overall"
    }

    private var progress: Double {
        min(max(budget.progressPct.doubleValue / 100, 0), 1)
    }

    var body: some View {
        VStack(spacing: 6) {
            HStack {
                Text(name).font(.subheadline.weight(.medium))
                Spacer()
                Text("\(budget.spent.compact(code: budget.currency)) of \(budget.amount.compact(code: budget.currency))")
                    .font(.subheadline)
                    .monospacedDigit()
            }
            ProgressView(value: progress)
                .tint(budget.overspent ? .red : progress > 0.85 ? .orange : .indigo)
        }
    }
}
