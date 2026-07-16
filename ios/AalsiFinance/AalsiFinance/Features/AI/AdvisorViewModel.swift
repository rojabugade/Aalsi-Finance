import Foundation
import Observation
import AalsiFinanceKit

@MainActor
@Observable
final class AdvisorViewModel {
    enum Pill: Int, CaseIterable {
        case forYou, plan, crossBorder, chat

        var title: String {
            switch self {
            case .forYou: "For you"
            case .plan: "Plan"
            case .crossBorder: "Cross-border"
            case .chat: "Chat"
            }
        }
    }

    struct ForYouSnapshot: Sendable {
        var alerts: [PersistentAlert]
        let cashflow: CashflowSummary?
        let memory: MemoryStatus?
    }

    struct CrossBorderSnapshot: Sendable {
        let limits: CrossBorderLimits
        let transfers: [CrossBorderTransfer]
        let checklist: CrossBorderChecklist
    }

    /// The daily brief is never an error state: when the analyst can't be
    /// reached it degrades to a deterministic summary (`isLive == false`).
    enum Brief: Sendable {
        case loading
        case ready(text: String, isLive: Bool)
    }

    struct ChatMessage: Identifiable, Hashable, Sendable {
        let id = UUID()
        let isUser: Bool
        var text: String
        var isError = false
    }

    static let threadKey = "ios-advisor"

    var selectedPill = Pill.forYou.rawValue
    private(set) var forYou: Loadable<ForYouSnapshot> = .idle
    private(set) var brief: Brief = .loading
    private(set) var plan: Loadable<[GuidancePlanItem]> = .idle
    /// Optimistic plan-item status while a PATCH is in flight, keyed by item id.
    private(set) var planStatusOverrides: [UUID: String] = [:]
    private(set) var crossBorder: Loadable<CrossBorderSnapshot> = .idle

    private(set) var messages: [ChatMessage] = []
    private(set) var isChatHistoryLoading = false
    private(set) var isReplying = false
    /// Question queued from another pane (chips / docked ask bar); the chat
    /// pane consumes it when it appears.
    private(set) var pendingQuestion: (text: String, mode: String)?
    private var lastQuestion: (text: String, mode: String)?

    // MARK: - For you

    func loadForYou(api: APIClient, force: Bool = false) async {
        if case .loaded = forYou, !force { return }
        if case .idle = forYou { forYou = .loading }
        do {
            let now = Date()
            let from = Calendar.current.date(byAdding: .day, value: -30, to: now) ?? now
            async let monitor = api.monitorAlerts(from: from, to: now)
            async let cashflow = api.cashflowSummary()
            async let memory = api.memoryStatus()
            let alerts = try await monitor.alerts
                .filter { $0.state == "active" }
                .sorted { $0.severity > $1.severity }
            let snapshot = ForYouSnapshot(alerts: alerts, cashflow: try? await cashflow, memory: try? await memory)
            forYou = .loaded(snapshot)
            await loadBrief(api: api, cashflow: snapshot.cashflow, force: force)
        } catch {
            if forYou.value == nil { forYou = .failed(error.localizedDescription) }
        }
    }

    func acknowledge(_ alert: PersistentAlert, api: APIClient) async {
        guard case .loaded(var snapshot) = forYou else { return }
        snapshot.alerts.removeAll { $0.id == alert.id }
        forYou = .loaded(snapshot)
        do {
            _ = try await api.acknowledgeAlert(id: alert.id)
        } catch {
            if case .loaded(var current) = forYou {
                current.alerts.append(alert)
                current.alerts.sort { $0.severity > $1.severity }
                forYou = .loaded(current)
            }
        }
    }

    /// One data-aware question first, evergreen ones after.
    var suggestedQuestions: [String] {
        var chips: [String] = []
        if let cashflow = forYou.value?.cashflow {
            chips.append(
                cashflow.leftoverMonthly.isNegative
                    ? "Where can I cut back this month?"
                    : "Can I save more this month?"
            )
        }
        chips += [
            "Where did my money go this week?",
            "How do I pay off my loans faster?",
            "Am I overspending on subscriptions?",
        ]
        return Array(chips.prefix(4))
    }

    // MARK: - Daily brief

    private static let briefDateKey = "advisor.brief.date"
    private static let briefTextKey = "advisor.brief.text"
    private static let briefPrompt = """
    Write today's brief for me in 60-80 words: how my spending this month is \
    pacing against my plan and budgets, and the single most useful action I \
    can take today. Be specific with numbers. No greeting, no preamble.
    """

    private func loadBrief(api: APIClient, cashflow: CashflowSummary?, force: Bool) async {
        let today = APIDateParser.dateString(Date())
        if !force,
           UserDefaults.standard.string(forKey: Self.briefDateKey) == today,
           let cached = UserDefaults.standard.string(forKey: Self.briefTextKey),
           !cached.isEmpty {
            brief = .ready(text: cached, isLive: true)
            return
        }
        brief = .loading
        do {
            let out = try await api.analystAsk(AnalystAskRequest(question: Self.briefPrompt, page: "advisor"))
            if out.available, !out.answer.isEmpty {
                UserDefaults.standard.set(today, forKey: Self.briefDateKey)
                UserDefaults.standard.set(out.answer, forKey: Self.briefTextKey)
                brief = .ready(text: out.answer, isLive: true)
            } else {
                brief = .ready(text: Self.fallbackBrief(cashflow), isLive: false)
            }
        } catch {
            brief = .ready(text: Self.fallbackBrief(cashflow), isLive: false)
        }
    }

    static func fallbackBrief(_ cashflow: CashflowSummary?) -> String {
        guard let cashflow else {
            return "I couldn't reach your data just now. Pull to refresh, or ask me anything below."
        }
        let calendar = Calendar.current
        let day = calendar.component(.day, from: .now)
        let daysInMonth = calendar.range(of: .day, in: .month, for: .now)?.count ?? 30
        let daysLeft = max(daysInMonth - day, 0)
        let leftover = cashflow.leftoverMonthly
        if leftover.isNegative {
            return "This month is running \(leftover.magnitude.compact(code: cashflow.currency)) past what's coming in, with \(daysLeft) days to go. Check your insights below for the biggest lever."
        }
        return "Bills and EMIs are covered. About \(leftover.compact(code: cashflow.currency)) of this month's cash is still unspoken for, with \(daysLeft) days to go. Check your insights below for what needs attention."
    }

    // MARK: - Plan

    func loadPlan(api: APIClient, force: Bool = false) async {
        if case .loaded = plan, !force { return }
        if case .idle = plan { plan = .loading }
        do {
            let items = try await api.planItems()
            planStatusOverrides = [:]
            plan = .loaded(Self.sortedPlan(items))
        } catch {
            if plan.value == nil { plan = .failed(error.localizedDescription) }
        }
    }

    func displayStatus(for item: GuidancePlanItem) -> String {
        planStatusOverrides[item.id] ?? item.status
    }

    func setPlanItem(_ item: GuidancePlanItem, completed: Bool, api: APIClient) async {
        let newStatus = completed ? "completed" : "open"
        planStatusOverrides[item.id] = newStatus
        do {
            let updated = try await api.updatePlanItemStatus(id: item.id, status: newStatus)
            if case .loaded(var items) = plan, let index = items.firstIndex(where: { $0.id == item.id }) {
                items[index] = updated
                plan = .loaded(Self.sortedPlan(items))
            }
        } catch {
            // Roll back the optimistic flip.
        }
        planStatusOverrides[item.id] = nil
    }

    private static func sortedPlan(_ items: [GuidancePlanItem]) -> [GuidancePlanItem] {
        items.sorted {
            if $0.isOpen != $1.isOpen { return $0.isOpen }
            let lhs = $0.dueDate ?? .distantFuture
            let rhs = $1.dueDate ?? .distantFuture
            if lhs != rhs { return lhs < rhs }
            return $0.createdAt < $1.createdAt
        }
    }

    // MARK: - Cross-border

    func loadCrossBorder(api: APIClient, force: Bool = false) async {
        if case .loaded = crossBorder, !force { return }
        if case .idle = crossBorder { crossBorder = .loading }
        do {
            async let limits = api.crossBorderLimits()
            async let transfers = api.crossBorderTransfers()
            async let checklist = api.crossBorderChecklist()
            crossBorder = .loaded(CrossBorderSnapshot(
                limits: try await limits,
                transfers: try await transfers,
                checklist: try await checklist
            ))
        } catch {
            if crossBorder.value == nil { crossBorder = .failed(error.localizedDescription) }
        }
    }

    // MARK: - Chat

    /// Queue a question from another pane and jump to the chat pill.
    func startChat(with question: String, mode: String = "explain") {
        pendingQuestion = (question, mode)
        selectedPill = Pill.chat.rawValue
    }

    func loadChatHistoryIfNeeded(api: APIClient) async {
        guard messages.isEmpty, !isChatHistoryLoading else { return }
        isChatHistoryLoading = true
        defer { isChatHistoryLoading = false }
        if let history = try? await api.analystThread(key: Self.threadKey) {
            messages = history.messages.map { ChatMessage(isUser: $0.isUser, text: $0.text) }
        }
    }

    func consumePendingQuestion(api: APIClient) async {
        guard let pending = pendingQuestion else { return }
        pendingQuestion = nil
        await send(pending.text, mode: pending.mode, api: api)
    }

    func send(_ question: String, mode: String = "explain", api: APIClient) async {
        let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isReplying else { return }
        lastQuestion = (trimmed, mode)
        messages.append(ChatMessage(isUser: true, text: trimmed))
        isReplying = true
        defer { isReplying = false }
        do {
            let out = try await api.analystAsk(
                AnalystAskRequest(mode: mode, question: trimmed, threadId: Self.threadKey, page: "advisor")
            )
            messages.append(ChatMessage(isUser: false, text: out.answer))
        } catch {
            messages.append(ChatMessage(isUser: false, text: "I couldn't reach your advisor just now.", isError: true))
        }
    }

    /// Retry the last question after an error row; the failed exchange is
    /// removed so the transcript doesn't accumulate dead turns.
    func retryLastQuestion(api: APIClient) async {
        guard let last = lastQuestion, !isReplying else { return }
        if let errorIndex = messages.lastIndex(where: { $0.isError }) {
            messages.remove(at: errorIndex)
            if errorIndex > 0, messages[errorIndex - 1].isUser {
                messages.remove(at: errorIndex - 1)
            }
        }
        await send(last.text, mode: last.mode, api: api)
    }
}
