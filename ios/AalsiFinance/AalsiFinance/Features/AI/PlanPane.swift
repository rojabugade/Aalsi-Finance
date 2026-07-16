import SwiftUI
import AalsiFinanceKit

/// Guidance plan items as a check-off list: open steps first, completed ones
/// tucked into a collapsed section.
struct PlanPane: View {
    @Environment(AppSession.self) private var session
    @Environment(AppTheme.self) private var theme
    @Bindable var model: AdvisorViewModel
    @State private var showsCompleted = false

    private static let planPrompt = "Build me a step-by-step financial plan for the next 3 months based on my spending, budgets, and debts."

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                switch model.plan {
                case .idle, .loading:
                    VStack(spacing: 14) {
                        LoadingCard(height: 90)
                        LoadingCard(height: 90)
                        LoadingCard(height: 90)
                    }
                    .padding(.horizontal, 20)
                case .failed(let message):
                    ErrorStateView(message: message) {
                        Task { await model.loadPlan(api: session.api, force: true) }
                    }
                    .padding(.top, 40)
                case .loaded(let items):
                    loaded(items)
                }
            }
            .padding(.bottom, 24)
        }
        .refreshable { await model.loadPlan(api: session.api, force: true) }
        .task { await model.loadPlan(api: session.api) }
        .sensoryFeedback(.success, trigger: completedCount)
    }

    private var completedCount: Int {
        (model.plan.value ?? []).count { model.displayStatus(for: $0) == "completed" }
    }

    @ViewBuilder
    private func loaded(_ items: [GuidancePlanItem]) -> some View {
        let open = items.filter { model.displayStatus(for: $0) == "open" }
        let completed = items.filter { model.displayStatus(for: $0) == "completed" }

        if items.isEmpty {
            emptyState
        } else {
            VStack(spacing: 10) {
                SectionHeader(title: "Your plan")
                if open.isEmpty {
                    HStack(spacing: 12) {
                        Image(systemName: "party.popper.fill")
                            .foregroundStyle(.teal)
                        Text("Every step is done. Ask your advisor what's next.")
                            .font(.subheadline)
                        Spacer()
                    }
                    .card()
                } else {
                    ForEach(open) { item in
                        PlanRow(item: item, isCompleted: false) { completed in
                            Task { await model.setPlanItem(item, completed: completed, api: session.api) }
                        }
                    }
                }
            }
            .padding(.horizontal, 20)

            if !completed.isEmpty {
                VStack(spacing: 10) {
                    Button {
                        withAnimation(.snappy) { showsCompleted.toggle() }
                    } label: {
                        HStack {
                            Text("Done (\(completed.count))")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.secondary)
                            Spacer()
                            Image(systemName: "chevron.down")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                                .rotationEffect(.degrees(showsCompleted ? 180 : 0))
                        }
                        .padding(.horizontal, 4)
                    }
                    .buttonStyle(.plain)

                    if showsCompleted {
                        ForEach(completed) { item in
                            PlanRow(item: item, isCompleted: true) { completed in
                                Task { await model.setPlanItem(item, completed: completed, api: session.api) }
                            }
                        }
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "map.fill")
                .font(.system(size: 36, weight: .medium))
                .foregroundStyle(theme.accentColor.gradient)
                .padding(.top, 48)
            VStack(spacing: 4) {
                Text("No plan yet")
                    .font(.headline)
                Text("Ask your advisor to turn your finances into concrete steps.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                model.startChat(with: Self.planPrompt, mode: "plan")
            } label: {
                Label("Build my plan", systemImage: "sparkles")
                    .font(.subheadline.weight(.semibold))
            }
            .buttonStyle(.glassProminent)
            .tint(theme.accentColor)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 32)
    }
}

// MARK: - Row

private struct PlanRow: View {
    @Environment(AppTheme.self) private var theme
    let item: GuidancePlanItem
    let isCompleted: Bool
    let onToggle: (Bool) -> Void
    @State private var showsRationale = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button {
                onToggle(!isCompleted)
            } label: {
                Image(systemName: isCompleted ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(isCompleted ? theme.accentColor : .secondary)
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isCompleted ? "Reopen step" : "Complete step")

            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.subheadline.weight(.medium))
                    .strikethrough(isCompleted)
                    .foregroundStyle(isCompleted ? .secondary : .primary)

                HStack(spacing: 6) {
                    if let due = item.dueDate {
                        Text("Due \(due.formatted(.dateTime.day().month()))")
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background((isOverdue ? Color.pink : Color(.tertiarySystemFill)).opacity(isOverdue ? 0.15 : 1), in: .capsule)
                            .foregroundStyle(isOverdue ? .pink : .secondary)
                    }
                    if item.domain != "general" {
                        Text(item.domain.replacingOccurrences(of: "_", with: "-"))
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(theme.accentColor.opacity(0.12), in: .capsule)
                            .foregroundStyle(theme.accentColor)
                    }
                }

                if let rationale = item.rationale, !rationale.isEmpty {
                    Text(rationale)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(showsRationale ? nil : 2)
                        .fixedSize(horizontal: false, vertical: true)
                        .onTapGesture { withAnimation(.snappy) { showsRationale.toggle() } }
                }
            }
            Spacer(minLength: 0)
        }
        .card()
    }

    private var isOverdue: Bool {
        guard !isCompleted, let due = item.dueDate else { return false }
        return due < Calendar.current.startOfDay(for: .now)
    }
}
