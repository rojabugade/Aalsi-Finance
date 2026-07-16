import SwiftUI
import AalsiFinanceKit

struct NotificationsView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppTheme.self) private var theme
    @State private var alerts: [PersistentAlert] = []
    @State private var state: Loadable<Bool> = .idle

    // Hosted inside NotificationsPanel (trailing side panel) — bare content,
    // no navigation chrome of its own.
    var body: some View {
        Group {
            switch state {
            case .idle, .loading: ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(let message): ErrorStateView(message: message) { Task { await load() } }
            case .loaded:
                if alerts.isEmpty {
                    ContentUnavailableView("You're all caught up", systemImage: "bell", description: Text("Alerts about spending, dues, and budgets show up here."))
                } else {
                    List {
                        ForEach(alerts) { alert in
                            HStack(alignment: .top, spacing: 12) {
                                Image(systemName: icon(for: alert.tone)).foregroundStyle(color(for: alert.tone))
                                VStack(alignment: .leading, spacing: 3) { Text(alert.title).font(.subheadline.weight(.medium)); Text(alert.detail).font(.caption).foregroundStyle(.secondary) }
                            }
                            .swipeActions { Button("Acknowledge") { Task { await acknowledge(alert) } }.tint(.green) }
                        }
                    }.listStyle(.insetGrouped)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .task { await load() }
    }
    private func load() async {
        state = .loading
        do {
            let to = Date(); let from = Calendar.current.date(byAdding: .day, value: -30, to: to) ?? to
            alerts = try await session.api.monitorAlerts(from: from, to: to).alerts.filter { $0.state == "active" }.sorted { $0.severity > $1.severity }
            state = .loaded(true)
        } catch { state = .failed(error.localizedDescription) }
    }
    private func acknowledge(_ alert: PersistentAlert) async {
        struct Empty: Decodable {}
        _ = try? await session.api.post("/analyst/alerts/\(alert.id)/acknowledge") as Empty
        alerts.removeAll { $0.id == alert.id }
    }
    private func icon(for tone: String) -> String { switch tone { case "warning", "negative": "exclamationmark.triangle.fill"; case "positive": "checkmark.circle.fill"; default: "info.circle.fill" } }
    private func color(for tone: String) -> Color { switch tone { case "warning", "negative": .orange; case "positive": .green; default: theme.accentColor } }
}
