import SwiftUI
import AalsiFinanceKit

struct MoneyView: View {
    private enum MoneySheet: Identifiable {
        case editLoan(Loan)
        case editCard(CreditCardSummary)
        case editIncome(IncomeSource)
        case editHolding(Holding)

        var id: String {
            switch self {
            case .editLoan(let loan): "loan-\(loan.id)"
            case .editCard(let card): "card-\(card.id)"
            case .editIncome(let source): "income-\(source.id)"
            case .editHolding(let holding): "holding-\(holding.id)"
            }
        }
    }

    @Environment(AppSession.self) private var session
    @Environment(AppTheme.self) private var theme
    @State private var model = MoneyViewModel()
    @State private var pill = 0
    @State private var path = NavigationPath()
    @State private var sheet: MoneySheet?
    @State private var actionError: String?

    private static let pills = ["Overview", "Debt", "Cards", "Income"]

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(spacing: 16) {
                    AppHeader(title: "Money")
                    PillNav(items: Self.pills, selection: $pill)

                    switch model.state {
                    case .idle, .loading:
                        VStack(spacing: 14) {
                            LoadingCard(height: 150)
                            LoadingCard(height: 130)
                        }
                        .padding(.horizontal, 20)
                    case .failed(let message):
                        ErrorStateView(message: message) {
                            Task { await model.load(api: session.api, force: true) }
                        }
                        .padding(.top, 40)
                    case .loaded(let snapshot):
                        Group {
                            switch pill {
                            case 0: OverviewPane(snapshot: snapshot, openPill: { pill = $0 })
                            case 1: DebtPane(
                                loans: snapshot.loans,
                                onEdit: { sheet = .editLoan($0) },
                                onDelete: { loan in
                                    Task {
                                        actionError = await model.deleteLoan(id: loan.id, api: session.api)
                                    }
                                }
                            )
                            case 2: CardsPane(
                                cards: snapshot.cards,
                                onEdit: { sheet = .editCard($0) }
                            )
                            default: IncomePane(
                                sources: snapshot.incomeSources,
                                holdings: snapshot.holdings,
                                onEditIncome: { sheet = .editIncome($0) },
                                onEditHolding: { sheet = .editHolding($0) },
                                onDeleteHolding: { holding in
                                    Task {
                                        actionError = await model.deleteHolding(id: holding.id, api: session.api)
                                    }
                                }
                            )
                            }
                        }
                        .padding(.horizontal, 20)
                    }
                }
                .padding(.bottom, 24)
            }
            .background(Color(.systemGroupedBackground))
            .scrollEdgeEffectStyle(.soft, for: .top)
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await model.load(api: session.api, force: true) }
        }
        .task { await model.load(api: session.api) }
        .sheet(item: $sheet) { sheet in
            sheetContent(sheet)
        }
        .alert(
            "Couldn't save",
            isPresented: Binding(
                get: { actionError != nil },
                set: { if !$0 { actionError = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
    }

    @ViewBuilder
    private func sheetContent(_ sheet: MoneySheet) -> some View {
        switch sheet {
        case .editLoan(let loan):
            LoanEditorView(loan: loan) { body in
                await model.patchLoan(id: loan.id, api: session.api, body: body)
            }
        case .editCard(let card):
            CardDetailEditorView(card: card) { body in
                await model.putCardDetail(loanId: card.loan.id, api: session.api, body: body)
            }
        case .editIncome(let source):
            IncomeSourceEditorView(source: source) { body in
                await model.patchIncomeSource(id: source.id, api: session.api, body: body)
            }
        case .editHolding(let holding):
            HoldingEditorView(holding: holding) { body in
                await model.patchHolding(id: holding.id, api: session.api, body: body)
            }
        }
    }
}

// MARK: - Overview

private struct OverviewPane: View {
    @Environment(AppTheme.self) private var theme
    let snapshot: MoneyViewModel.Snapshot
    let openPill: (Int) -> Void

    private var totalDebt: Money { snapshot.netWorth.liabilities }

    var body: some View {
        VStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 10) {
                Text("Net worth")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                HStack(alignment: .center, spacing: 12) {
                    MoneyText(amount: snapshot.netWorth.netWorth, code: snapshot.netWorth.currency, font: .system(size: 30, weight: .bold))
                    Spacer()
                    // A sparkline over all-zero history is decoration, not data.
                    if snapshot.netWorth.points.count > 1,
                       snapshot.netWorth.points.contains(where: { $0.netWorth.value != 0 }) {
                        LineSparkline(values: snapshot.netWorth.points.map { $0.netWorth.doubleValue }, color: .green)
                            .frame(width: 100, height: 34)
                    }
                }
                if snapshot.netWorth.assets.value == 0 && snapshot.netWorth.liabilities.value == 0 {
                    Text("Connect accounts on the web app to start tracking net worth.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    HStack(spacing: 16) {
                        labelledAmount("Assets", snapshot.netWorth.assets, .green)
                        labelledAmount("Debts", snapshot.netWorth.liabilities, .red)
                    }
                }
            }
            .card()

            Button { openPill(1) } label: {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Debt payoff").font(.subheadline.weight(.semibold))
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                    }
                    ForEach(snapshot.loans.prefix(3)) { loan in
                        HStack {
                            Text(loan.name).font(.caption).lineLimit(1)
                            Spacer()
                            if let balance = loan.outstandingBalance {
                                Text("\(balance.compact(code: loan.currency)) left")
                                    .font(.caption.weight(.semibold))
                                    .monospacedDigit()
                            }
                        }
                        ProgressView(value: (loan.progressPct ?? 0) / 100)
                            .tint(theme.accentColor)
                    }
                    if snapshot.loans.isEmpty {
                        Text("No loans tracked").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .card()
            }
            .buttonStyle(.plain)

            Button { openPill(2) } label: {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Cards").font(.subheadline.weight(.semibold))
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                    }
                    if snapshot.cards.isEmpty {
                        Text("No credit cards tracked").font(.caption).foregroundStyle(.secondary)
                    } else {
                        HStack(spacing: 8) {
                            ForEach(snapshot.cards.prefix(3)) { card in
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(card.loan.name).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                                    Text((card.statementBalance ?? card.loan.outstandingBalance ?? Money()).compact(code: card.loan.currency))
                                        .font(.caption.weight(.semibold))
                                        .monospacedDigit()
                                    if let utilization = card.utilization {
                                        Text("\(Int(utilization.doubleValue.rounded()))% util")
                                            .font(.caption2)
                                            .foregroundStyle(utilization.doubleValue > 50 ? .orange : .secondary)
                                    }
                                }
                                .padding(10)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            }
                        }
                    }
                }
                .card()
            }
            .buttonStyle(.plain)

            Button { openPill(3) } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Income & investments").font(.subheadline.weight(.semibold))
                        HStack(spacing: 14) {
                            if let source = snapshot.incomeSources.first, let gross = source.gross {
                                Text("\(source.employer ?? "Income") \(gross.compact(code: source.currency))/\(source.frequency.prefix(2))")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Text("\(snapshot.holdings.count) holdings")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                }
                .card()
            }
            .buttonStyle(.plain)
        }
    }

    private func labelledAmount(_ label: String, _ amount: Money, _ color: Color) -> some View {
        HStack(spacing: 5) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(amount.compact(code: snapshot.netWorth.currency))
                .font(.caption.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(color)
        }
    }
}
