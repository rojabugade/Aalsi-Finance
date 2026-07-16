import SwiftUI
import AalsiFinanceKit

/// Threaded conversation with the analyst (`ios-advisor` thread).
struct ChatPane: View {
    @Environment(AppSession.self) private var session
    @Environment(AppTheme.self) private var theme
    @Bindable var model: AdvisorViewModel
    @State private var composerText = ""
    @FocusState private var composerFocused: Bool

    private enum ScrollTarget: Hashable {
        case message(UUID)
        case typing
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 10) {
                    if model.isChatHistoryLoading && model.messages.isEmpty {
                        ProgressView()
                            .padding(.top, 60)
                    } else if model.messages.isEmpty && !model.isReplying {
                        emptyState
                    } else {
                        transcript
                    }

                    if model.isReplying {
                        TypingIndicator()
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 20)
                            .id(ScrollTarget.typing)
                    }
                }
                .padding(.vertical, 8)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: model.messages.count) {
                guard let last = model.messages.last else { return }
                withAnimation(.snappy) { proxy.scrollTo(ScrollTarget.message(last.id), anchor: .bottom) }
            }
            .onChange(of: model.isReplying) {
                if model.isReplying {
                    withAnimation(.snappy) { proxy.scrollTo(ScrollTarget.typing, anchor: .bottom) }
                }
            }
        }
        .safeAreaInset(edge: .bottom) { composer }
        .sensoryFeedback(.impact(weight: .light), trigger: model.messages.count)
        .task {
            await model.loadChatHistoryIfNeeded(api: session.api)
            await model.consumePendingQuestion(api: session.api)
        }
        .onChange(of: model.pendingQuestion?.text) {
            // Chips fired while already on the chat pill.
            Task { await model.consumePendingQuestion(api: session.api) }
        }
    }

    private var transcript: some View {
        ForEach(model.messages) { message in
            ChatBubble(message: message) {
                Task { await model.retryLastQuestion(api: session.api) }
            }
            .id(ScrollTarget.message(message.id))
            .padding(.horizontal, 20)
        }
    }

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "sparkles")
                .font(.system(size: 40, weight: .medium))
                .foregroundStyle(theme.accentColor.gradient)
                .symbolEffect(.pulse)
                .padding(.top, 48)

            VStack(spacing: 4) {
                Text("Ask me anything about your money")
                    .font(.headline)
                Text("I know your transactions, budgets, loans, and more.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 8) {
                ForEach(model.suggestedQuestions, id: \.self) { question in
                    Button {
                        Task { await model.send(question, api: session.api) }
                    } label: {
                        Text(question)
                            .font(.subheadline)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .frame(maxWidth: .infinity)
                            .background(Color(.secondarySystemGroupedBackground), in: .capsule)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Composer

    private var composer: some View {
        HStack(spacing: 10) {
            TextField("Ask anything about your money…", text: $composerText, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...4)
                .focused($composerFocused)
                .onSubmit(sendComposerText)

            Button(action: sendComposerText) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.title2)
                    .foregroundStyle(canSend ? theme.accentColor : Color.secondary.opacity(0.5))
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
            .accessibilityLabel("Send")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 24))
        .padding(.horizontal, 20)
        .padding(.bottom, 6)
    }

    private var canSend: Bool {
        !composerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.isReplying
    }

    private func sendComposerText() {
        guard canSend else { return }
        let question = composerText
        composerText = ""
        Task { await model.send(question, api: session.api) }
    }
}

// MARK: - Bubbles

private struct ChatBubble: View {
    @Environment(AppTheme.self) private var theme
    let message: AdvisorViewModel.ChatMessage
    let onRetry: () -> Void

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if message.isUser {
                Spacer(minLength: 48)
                Text(message.text)
                    .font(.subheadline)
                    .foregroundStyle(Color(.systemBackground))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(theme.accentColor, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            } else {
                Image(systemName: "sparkles")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(theme.accentColor)
                    .frame(width: 26, height: 26)
                    .background(theme.accentColor.opacity(0.12), in: .circle)

                if message.isError {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(message.text)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Button("Try again", action: onRetry)
                            .font(.caption.weight(.semibold))
                            .buttonStyle(.bordered)
                            .buttonBorderShape(.capsule)
                            .controlSize(.small)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                } else {
                    Text(message.text)
                        .font(.subheadline)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                }
                Spacer(minLength: 48)
            }
        }
        .frame(maxWidth: .infinity, alignment: message.isUser ? .trailing : .leading)
    }
}

private struct TypingIndicator: View {
    @Environment(AppTheme.self) private var theme
    @State private var phase = 0

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            Image(systemName: "sparkles")
                .font(.caption.weight(.semibold))
                .foregroundStyle(theme.accentColor)
                .frame(width: 26, height: 26)
                .background(theme.accentColor.opacity(0.12), in: .circle)

            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(Color.secondary)
                        .frame(width: 6, height: 6)
                        .opacity(phase == index ? 1 : 0.35)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 13)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(320))
                withAnimation(.easeInOut(duration: 0.25)) { phase = (phase + 1) % 3 }
            }
        }
        .accessibilityLabel("Advisor is thinking")
    }
}
