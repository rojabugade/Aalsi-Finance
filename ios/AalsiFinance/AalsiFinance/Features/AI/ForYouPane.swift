import SwiftUI
import AalsiFinanceKit

/// The Advisor's daily-habit surface: today's brief, question chips, the
/// insight queue, and a docked ask bar that drops into chat.
struct ForYouPane: View {
    @Environment(AppSession.self) private var session
    @Environment(AppTheme.self) private var theme
    @Bindable var model: AdvisorViewModel
    @State private var askText = ""
    @State private var showsMemorySheet = false

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                switch model.forYou {
                case .idle, .loading:
                    VStack(spacing: 14) {
                        LoadingCard(height: 180)
                        LoadingCard(height: 44)
                        LoadingCard(height: 160)
                    }
                    .padding(.horizontal, 20)
                case .failed(let message):
                    ErrorStateView(message: message) {
                        Task { await model.loadForYou(api: session.api, force: true) }
                    }
                    .padding(.top, 40)
                case .loaded(let snapshot):
                    loaded(snapshot)
                }
            }
            .padding(.bottom, 16)
        }
        .refreshable { await model.loadForYou(api: session.api, force: true) }
        .safeAreaInset(edge: .bottom) { askBar }
        .sheet(isPresented: $showsMemorySheet) {
            MemoryStatusSheet(memory: model.forYou.value?.memory)
        }
    }

    @ViewBuilder
    private func loaded(_ snapshot: AdvisorViewModel.ForYouSnapshot) -> some View {
        BriefHeroCard(brief: model.brief)
            .padding(.horizontal, 20)

        questionChips
            .padding(.top, -6)

        insights(snapshot)
            .padding(.horizontal, 20)

        if let memory = snapshot.memory, !memory.sources.isEmpty {
            trustRow(memory)
                .padding(.horizontal, 20)
        }
    }

    // MARK: - Question chips

    private var questionChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(model.suggestedQuestions, id: \.self) { question in
                    Button {
                        model.startChat(with: question)
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "sparkle")
                                .font(.caption2)
                            Text(question)
                                .font(.caption.weight(.medium))
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(theme.accentColor.opacity(0.12), in: .capsule)
                        .foregroundStyle(theme.accentColor)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20)
        }
        .scrollClipDisabled()
    }

    // MARK: - Insights

    @ViewBuilder
    private func insights(_ snapshot: AdvisorViewModel.ForYouSnapshot) -> some View {
        VStack(spacing: 10) {
            SectionHeader(title: "Needs your attention")
            if snapshot.alerts.isEmpty {
                allClearCard
            } else {
                ForEach(snapshot.alerts) { alert in
                    AdvisorInsightRow(alert: alert) {
                        Task { await model.acknowledge(alert, api: session.api) }
                    }
                }
            }
        }
        .animation(.spring(duration: 0.35), value: snapshot.alerts)
    }

    private var allClearCard: some View {
        HStack(spacing: 12) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.teal)
                .frame(width: 38, height: 38)
                .background(Color.teal.opacity(0.15), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text("All clear").font(.subheadline.weight(.semibold))
                Text("Nothing needs your attention right now.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .card()
    }

    // MARK: - Trust row

    private func trustRow(_ memory: MemoryStatus) -> some View {
        Button {
            showsMemorySheet = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "brain.head.profile")
                    .font(.caption)
                Text(trustLine(memory))
                    .font(.caption)
                    .lineLimit(1)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
            }
            .foregroundStyle(.secondary)
            .padding(.horizontal, 4)
        }
        .buttonStyle(.plain)
    }

    private func trustLine(_ memory: MemoryStatus) -> String {
        let parts = memory.sources
            .filter { $0.count > 0 }
            .sorted { $0.count > $1.count }
            .prefix(3)
            .map { "\($0.count) \(Self.sourceLabel($0.sourceType, count: $0.count))" }
        guard !parts.isEmpty else { return "Grounded in your data" }
        return "Grounded in your data — " + parts.joined(separator: " · ")
    }

    static func sourceLabel(_ sourceType: String, count: Int) -> String {
        let base = sourceType.replacingOccurrences(of: "_", with: " ")
        if count == 1 { return base }
        if base.hasSuffix("y") { return String(base.dropLast()) + "ies" }
        return base + "s"
    }

    // MARK: - Ask bar

    private var askBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "sparkles")
                .foregroundStyle(theme.accentColor)
            TextField("Ask anything about your money…", text: $askText)
                .textFieldStyle(.plain)
                .submitLabel(.send)
                .onSubmit(sendAsk)
            if !askText.trimmingCharacters(in: .whitespaces).isEmpty {
                Button(action: sendAsk) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title3)
                        .foregroundStyle(theme.accentColor)
                }
                .buttonStyle(.plain)
                .transition(.scale.combined(with: .opacity))
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .glassEffect(.regular.interactive(), in: .capsule)
        .padding(.horizontal, 20)
        .padding(.bottom, 6)
        .animation(.snappy, value: askText.isEmpty)
    }

    private func sendAsk() {
        let question = askText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty else { return }
        askText = ""
        model.startChat(with: question)
    }
}

// MARK: - Today's brief hero

private struct BriefHeroCard: View {
    @Environment(AppTheme.self) private var theme
    let brief: AdvisorViewModel.Brief

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Today's brief", systemImage: "sparkles")
                    .font(.caption.weight(.semibold))
                    .textCase(.uppercase)
                    .foregroundStyle(theme.accentColor)
                    .symbolEffect(.pulse, options: .repeat(2))
                Spacer()
                Text(Date.now, format: .dateTime.weekday(.wide).day().month())
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Text(greetingLine)
                .font(.subheadline.weight(.semibold))

            switch brief {
            case .loading:
                placeholderLines
            case .ready(let text, let isLive):
                Text(text)
                    .font(.callout)
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                    .contentTransition(.opacity)
                if !isLive {
                    Label("Live analysis unavailable — showing the basics", systemImage: "wifi.slash")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular.tint(theme.accentColor.opacity(0.2)).interactive(), in: .rect(cornerRadius: 28))
    }

    private var placeholderLines: some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(0..<3, id: \.self) { index in
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.primary.opacity(0.09))
                    .frame(height: 12)
                    .frame(maxWidth: index == 2 ? 180 : .infinity, alignment: .leading)
            }
        }
        .phaseAnimator([0.5, 1.0]) { view, phase in
            view.opacity(phase)
        } animation: { _ in .easeInOut(duration: 0.8) }
        .accessibilityLabel("Preparing today's brief")
    }

    private var greetingLine: String {
        switch Calendar.current.component(.hour, from: .now) {
        case 5..<12: "Good morning — here's where you stand."
        case 12..<17: "Good afternoon — here's where you stand."
        default: "Good evening — here's where you stand."
        }
    }
}

// MARK: - Insight row

private struct AdvisorInsightRow: View {
    @Environment(AppTheme.self) private var theme
    let alert: PersistentAlert
    let onAcknowledge: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(color)
                .frame(width: 38, height: 38)
                .background(color.opacity(0.15), in: RoundedRectangle(cornerRadius: 11, style: .continuous))

            VStack(alignment: .leading, spacing: 3) {
                Text(alert.title)
                    .font(.subheadline.weight(.semibold))
                Text(alert.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 8)

            Button(action: onAcknowledge) {
                Text("Got it")
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color(.tertiarySystemFill), in: .capsule)
                    .foregroundStyle(.primary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Acknowledge \(alert.title)")
        }
        .card()
    }

    private var color: Color {
        switch alert.tone {
        case "positive": .teal
        case "warning": .orange
        case "danger": .pink
        default: theme.accentColor
        }
    }

    private var icon: String {
        switch alert.tone {
        case "positive": "chart.line.uptrend.xyaxis"
        case "warning": "exclamationmark.triangle.fill"
        case "danger": "flame.fill"
        default: "lightbulb.fill"
        }
    }
}

// MARK: - Memory sheet

private struct MemoryStatusSheet: View {
    let memory: MemoryStatus?

    var body: some View {
        NavigationStack {
            List {
                if let memory {
                    Section {
                        ForEach(memory.sources.sorted { $0.count > $1.count }, id: \.self) { source in
                            HStack {
                                Text(ForYouPane.sourceLabel(source.sourceType, count: source.count).capitalized)
                                Spacer()
                                Text("\(source.count)")
                                    .foregroundStyle(.secondary)
                                    .monospacedDigit()
                            }
                        }
                    } footer: {
                        if let synced = memory.lastSynced {
                            Text("Last synced \(synced.formatted(.relative(presentation: .named)))")
                        }
                    }
                } else {
                    ContentUnavailableView("Nothing indexed yet", systemImage: "brain.head.profile")
                }
            }
            .navigationTitle("What your advisor knows")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium])
    }
}
