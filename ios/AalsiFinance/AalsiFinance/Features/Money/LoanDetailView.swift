import SwiftUI
import AalsiFinanceKit

struct LoanDetailView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppTheme.self) private var theme
    let loan: Loan

    @State private var schedule: Loadable<[PaymentScheduleEntry]> = .idle

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                summaryCard

                VStack(spacing: 10) {
                    SectionHeaderLink(title: "Payment schedule")
                    switch schedule {
                    case .idle, .loading:
                        LoadingCard(height: 200)
                    case .failed(let message):
                        ErrorStateView(message: message) { Task { await loadSchedule() } }
                    case .loaded(let entries):
                        if entries.isEmpty {
                            ContentUnavailableView("No schedule", systemImage: "calendar")
                                .card()
                        } else {
                            VStack(spacing: 0) {
                                ForEach(upcomingEntries(entries)) { entry in
                                    scheduleRow(entry)
                                    if entry.id != upcomingEntries(entries).last?.id {
                                        Divider()
                                    }
                                }
                            }
                            .card()
                        }
                    }
                }
            }
            .padding(20)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(loan.name)
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadSchedule() }
    }

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Outstanding").font(.caption).foregroundStyle(.secondary)
                    MoneyText(
                        amount: loan.outstandingBalance ?? loan.principal,
                        code: loan.currency,
                        font: .system(size: 28, weight: .bold)
                    )
                }
                Spacer()
                if let pct = loan.progressPct {
                    VStack(alignment: .trailing, spacing: 4) {
                        Text("\(Int(pct.rounded()))%").font(.title3.bold()).foregroundStyle(theme.accentColor)
                        Text("paid off").font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
            ProgressView(value: (loan.progressPct ?? 0) / 100).tint(theme.accentColor)
            HStack(spacing: 16) {
                if let emi = loan.minOrEmiAmount {
                    detail("EMI", emi.compact(code: loan.currency))
                }
                if let rate = loan.interestRate {
                    detail("Rate", "\(rate.value.formatted(.number.precision(.fractionLength(0...2))))%")
                }
                if let paid = loan.totalInterestPaid {
                    detail("Interest paid", paid.compact(code: loan.currency))
                }
            }
            if let warning = loan.penaltyWarning {
                Label(warning, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
        .card()
    }

    private func detail(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.caption.weight(.semibold)).monospacedDigit()
        }
    }

    private func upcomingEntries(_ entries: [PaymentScheduleEntry]) -> [PaymentScheduleEntry] {
        let pending = entries.filter { $0.status != "paid" }.sorted { $0.dueDate < $1.dueDate }
        return Array(pending.prefix(12))
    }

    private func scheduleRow(_ entry: PaymentScheduleEntry) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("#\(entry.installmentNo) · \(entry.dueDate, format: .dateTime.month(.abbreviated).day().year())")
                    .font(.caption.weight(.medium))
                if let principal = entry.principalComponent, let interest = entry.interestComponent {
                    Text("\(principal.compact(code: loan.currency)) principal · \(interest.compact(code: loan.currency)) interest")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            if let balance = entry.balanceAfter {
                Text(balance.compact(code: loan.currency))
                    .font(.caption.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 8)
    }

    private func loadSchedule() async {
        schedule = .loading
        do {
            schedule = .loaded(try await session.api.loanSchedule(loanId: loan.id))
        } catch {
            schedule = .failed(error.localizedDescription)
        }
    }
}
