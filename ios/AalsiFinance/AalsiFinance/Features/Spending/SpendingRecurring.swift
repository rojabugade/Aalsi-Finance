import AalsiFinanceKit
import SwiftUI

struct SpendingRecurring: View {
    let rows: [RecurringSpendRow]
    let monthlyTotal: Money
    var currency: String = "USD"
    var isLoading = false
    var canonicalError: String?
    let onRetry: () -> Void
    let onRoute: (SpendingRoute) -> Void
    var onEdit: ((RecurringSpendRow) -> Void)?
    var onDelete: ((RecurringSpendRow) -> Void)?
    var onTrack: ((RecurringSpendRow) -> Void)?

    @State private var pendingDelete: RecurringSpendRow?

    var body: some View {
        LazyVStack(spacing: 14) {
            commitmentCard

            if let canonicalError, !canonicalError.isEmpty {
                canonicalErrorCard(canonicalError)
            }

            section(
                title: "Subscriptions & bills",
                systemImage: "arrow.triangle.2.circlepath",
                rows: canonicalRows,
                emptyText: canonicalError == nil
                    ? "No tracked recurring series yet. Series you confirm appear here with their next charge."
                    : nil
            )

            section(
                title: "Looks recurring",
                systemImage: "wand.and.stars",
                rows: inferredRows,
                emptyText: "No repeating merchant patterns detected in your recent activity."
            )
        }
        .padding(.horizontal, 20)
    }

    private var canonicalRows: [RecurringSpendRow] {
        rows.filter { $0.source == .canonical }
    }

    private var inferredRows: [RecurringSpendRow] {
        rows.filter { $0.source == .inferred }
    }

    private var commitmentCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Monthly commitment")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
            if isLoading, rows.isEmpty {
                ProgressView()
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                MoneyText(
                    amount: monthlyTotal,
                    code: currency,
                    font: .system(size: 30, weight: .bold)
                )
                Text("\(rows.count) recurring \(rows.count == 1 ? "charge" : "charges") tracked")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func canonicalErrorCard(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Couldn't load tracked series", systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.orange)
            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
            Button("Retry", action: onRetry)
                .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    @ViewBuilder
    private func section(
        title: String,
        systemImage: String,
        rows: [RecurringSpendRow],
        emptyText: String?
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: title, systemImage: systemImage)

            if rows.isEmpty {
                if let emptyText {
                    Text(emptyText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .card()
                }
            } else {
                VStack(spacing: 0) {
                    ForEach(rows) { row in
                        if row.id != rows.first?.id {
                            Divider()
                        }
                        recurringRow(row)
                    }
                }
                .card()
            }
        }
    }

    @ViewBuilder
    private func recurringRow(_ row: RecurringSpendRow) -> some View {
        let content = HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(row.name)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text(row.cadence.capitalized)
                    if let nextDueDate = row.nextDueDate {
                        Text("·")
                        Text("Next \(nextDueDate.formatted(dueFormat))")
                    }
                    Text("·")
                    Text(row.source == .canonical ? "Tracked" : "Detected")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            Spacer(minLength: 8)

            MoneyText(
                amount: row.amount.magnitude,
                code: row.currency,
                font: .subheadline.weight(.semibold)
            )

            rowActions(row)
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())

        Group {
            if let merchantKey = row.merchantKey {
                Button {
                    onRoute(.merchant(merchantKey))
                } label: {
                    content
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(row.name), \(row.cadence), open merchant detail")
            } else {
                content
            }
        }
        .contextMenu { menuItems(row) }
        .confirmationDialog(
            "Stop tracking \(pendingDelete?.name ?? row.name)?",
            isPresented: Binding(
                get: { pendingDelete?.id == row.id },
                set: { if !$0 { pendingDelete = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete Series", role: .destructive) {
                if let pendingDelete { onDelete?(pendingDelete) }
                pendingDelete = nil
            }
        } message: {
            Text("Past transactions stay; the series just stops being tracked and leaves your monthly commitment.")
        }
    }

    /// Inline affordance so editability is discoverable without knowing about
    /// long-press: a small menu for tracked rows, a Track button for detected.
    @ViewBuilder
    private func rowActions(_ row: RecurringSpendRow) -> some View {
        if row.source == .canonical, onEdit != nil || onDelete != nil {
            Menu {
                menuItems(row)
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(width: 36, height: 44)
            }
            .accessibilityLabel("Actions for \(row.name)")
        } else if row.source == .inferred, let onTrack {
            Button("Track") {
                onTrack(row)
            }
            .font(.subheadline.weight(.medium))
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .controlSize(.small)
            .accessibilityLabel("Track \(row.name) as recurring")
        } else if row.merchantKey != nil {
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
    }

    @ViewBuilder
    private func menuItems(_ row: RecurringSpendRow) -> some View {
        if row.source == .canonical {
            if let onEdit {
                Button {
                    onEdit(row)
                } label: {
                    Label("Edit", systemImage: "pencil")
                }
            }
            if onDelete != nil {
                Button(role: .destructive) {
                    pendingDelete = row
                } label: {
                    Label("Delete", systemImage: "trash")
                }
            }
        } else if let onTrack {
            Button {
                onTrack(row)
            } label: {
                Label("Track as recurring", systemImage: "plus.circle")
            }
        }
    }

    private var dueFormat: Date.FormatStyle {
        var format = Date.FormatStyle().month(.abbreviated).day()
        format.timeZone = TimeZone(secondsFromGMT: 0)!
        return format
    }
}

private enum SpendingRecurringPreviewFixtures {
    static let rows = [
        RecurringSpendRow(
            id: "canonical-netflix",
            name: "Netflix",
            amount: Money(15.49),
            currency: "USD",
            cadence: "monthly",
            nextDueDate: APIDateParser.parse("2026-08-10"),
            merchantKey: "netflix",
            source: .canonical
        ),
        RecurringSpendRow(
            id: "canonical-rent",
            name: "Rent",
            amount: Money(2200),
            currency: "USD",
            cadence: "monthly",
            nextDueDate: APIDateParser.parse("2026-08-01"),
            merchantKey: nil,
            source: .canonical
        ),
        RecurringSpendRow(
            id: "inferred-gym",
            name: "City Gym",
            amount: Money(42),
            currency: "USD",
            cadence: "monthly",
            nextDueDate: nil,
            merchantKey: "city gym",
            source: .inferred
        ),
    ]
}

#Preview("Recurring Dark") {
    ScrollView {
        SpendingRecurring(
            rows: SpendingRecurringPreviewFixtures.rows,
            monthlyTotal: Money(2257.49),
            onRetry: {},
            onRoute: { _ in }
        )
        .padding(.vertical, 20)
    }
    .background(Color(.systemGroupedBackground))
    .environment(AppTheme())
    .preferredColorScheme(.dark)
}

#Preview("Recurring Empty + Error") {
    ScrollView {
        SpendingRecurring(
            rows: [],
            monthlyTotal: Money(),
            canonicalError: "The request timed out.",
            onRetry: {},
            onRoute: { _ in }
        )
        .padding(.vertical, 20)
    }
    .background(Color(.systemGroupedBackground))
    .environment(AppTheme())
    .preferredColorScheme(.light)
}
