import SwiftUI
import AalsiFinanceKit

/// Read-first cross-border surface: transfer totals vs corpus limits,
/// transfer history, and the compliance checklist.
struct CrossBorderPane: View {
    @Environment(AppSession.self) private var session
    @Bindable var model: AdvisorViewModel

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                switch model.crossBorder {
                case .idle, .loading:
                    VStack(spacing: 14) {
                        LoadingCard(height: 130)
                        LoadingCard(height: 130)
                        LoadingCard(height: 180)
                    }
                    .padding(.horizontal, 20)
                case .failed(let message):
                    ErrorStateView(message: message) {
                        Task { await model.loadCrossBorder(api: session.api, force: true) }
                    }
                    .padding(.top, 40)
                case .loaded(let snapshot):
                    loaded(snapshot)
                }
            }
            .padding(.bottom, 24)
        }
        .refreshable { await model.loadCrossBorder(api: session.api, force: true) }
        .task { await model.loadCrossBorder(api: session.api) }
    }

    @ViewBuilder
    private func loaded(_ snapshot: AdvisorViewModel.CrossBorderSnapshot) -> some View {
        VStack(spacing: 18) {
            ForEach(snapshot.limits.warnings, id: \.self) { warning in
                WarningCard(warning: warning)
            }

            limitsSection(snapshot.limits)
            transfersSection(snapshot.transfers)
            checklistSection(snapshot.checklist)

            Text(snapshot.checklist.disclaimer)
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 4)
        }
        .padding(.horizontal, 20)
    }

    // MARK: - Limits

    @ViewBuilder
    private func limitsSection(_ limits: CrossBorderLimits) -> some View {
        VStack(spacing: 10) {
            SectionHeader(title: "Transfer totals", systemImage: "arrow.left.arrow.right")
            if limits.totals.isEmpty {
                emptyCard("No transfers recorded yet.")
            } else {
                VStack(spacing: 0) {
                    ForEach(limits.totals, id: \.self) { total in
                        HStack {
                            Text("\(total.fromCurrency) → \(total.toCurrency)")
                                .font(.subheadline.weight(.medium))
                            Spacer()
                            MoneyText(amount: total.amount, code: total.fromCurrency, font: .subheadline.weight(.semibold))
                        }
                        .padding(.vertical, 8)
                        if total != limits.totals.last {
                            Divider()
                        }
                    }
                    ForEach(limits.limits, id: \.self) { limit in
                        if let title = limit.title, let amount = limit.amount {
                            HStack(spacing: 6) {
                                Image(systemName: "gauge.with.needle")
                                    .font(.caption2)
                                Text(title)
                                    .lineLimit(1)
                                Spacer()
                                Text(amount.compact(code: limit.currency ?? ""))
                                    .monospacedDigit()
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.top, 6)
                        }
                    }
                }
                .card()
            }
        }
    }

    // MARK: - Transfers

    @ViewBuilder
    private func transfersSection(_ transfers: [CrossBorderTransfer]) -> some View {
        VStack(spacing: 10) {
            SectionHeader(title: "Transfers", systemImage: "paperplane")
            if transfers.isEmpty {
                emptyCard("Transfers you log will show up here.")
            } else {
                VStack(spacing: 0) {
                    ForEach(transfers) { transfer in
                        TransferRow(transfer: transfer)
                        if transfer.id != transfers.last?.id {
                            Divider().padding(.leading, 50)
                        }
                    }
                }
                .card()
            }
        }
    }

    // MARK: - Checklist

    @ViewBuilder
    private func checklistSection(_ checklist: CrossBorderChecklist) -> some View {
        VStack(spacing: 10) {
            SectionHeader(title: "Checklist", systemImage: "checklist")
            if checklist.checklist.isEmpty {
                emptyCard("No checklist items in the guidance corpus yet.")
            } else {
                VStack(spacing: 0) {
                    ForEach(checklist.checklist, id: \.self) { doc in
                        ChecklistRow(doc: doc)
                        if doc != checklist.checklist.last {
                            Divider()
                        }
                    }
                }
                .card()
            }
        }
    }

    private func emptyCard(_ text: String) -> some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
    }
}

// MARK: - Rows

private struct WarningCard: View {
    let warning: CrossBorderLimitWarning

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.orange)
                .frame(width: 38, height: 38)
                .background(Color.orange.opacity(0.15), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                if let title = warning.limitTitle {
                    Text(title).font(.subheadline.weight(.semibold))
                }
                Text(warning.message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let ratio = warning.ratio {
                    ProgressView(value: min(ratio.doubleValue, 1))
                        .tint(.orange)
                }
            }
        }
        .card()
    }
}

private struct TransferRow: View {
    let transfer: CrossBorderTransfer

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: transfer.direction == "inbound" ? "arrow.down.left" : "arrow.up.right")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(transfer.direction == "inbound" ? Color.teal : Color.secondary)
                .frame(width: 38, height: 38)
                .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 11, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text("\(transfer.fromCurrency) → \(transfer.toCurrency)")
                    .font(.subheadline.weight(.medium))
                HStack(spacing: 4) {
                    if let date = transfer.transferDate {
                        Text(date.formatted(.dateTime.day().month().year()))
                    }
                    if let purpose = transfer.purpose, !purpose.isEmpty {
                        Text("· \(purpose)")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }

            Spacer(minLength: 8)

            MoneyText(amount: transfer.amount, code: transfer.fromCurrency, font: .subheadline.weight(.semibold))
        }
        .padding(.vertical, 8)
    }
}

private struct ChecklistRow: View {
    let doc: GuidanceChecklistDoc

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "doc.text")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                Text(doc.title)
                    .font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 4) {
                    if let country = doc.country { Text(country) }
                    if let topic = doc.topic { Text(doc.country == nil ? topic : "· \(topic)") }
                    if let effective = doc.effectiveDate {
                        Text("· from \(effective.formatted(.dateTime.month().year()))")
                    }
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            if let raw = doc.sourceUrl, let url = URL(string: raw) {
                Link(destination: url) {
                    Image(systemName: "arrow.up.right.square")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .accessibilityLabel("Open source for \(doc.title)")
            }
        }
        .padding(.vertical, 8)
    }
}
