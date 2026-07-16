import SwiftUI
import AalsiFinanceKit

/// One-time first-run setup after sign-in: pick a look, understand where the
/// data lives, learn the layout. Three steps, skippable at any point.
struct PostLoginOnboardingView: View {
    let onDone: () -> Void

    @Environment(AppTheme.self) private var theme
    @State private var step = 0

    private static let stepCount = 3

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                ProgressView(value: Double(step + 1), total: Double(Self.stepCount))
                    .tint(theme.accentColor)
                    .frame(maxWidth: 160)
                Spacer()
                Button("Skip", action: onDone)
                    .font(.subheadline.weight(.medium))
            }
            .padding(.horizontal, 24)
            .padding(.top, 20)

            TabView(selection: $step) {
                appearanceStep.tag(0)
                privacyStep.tag(1)
                layoutStep.tag(2)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .animation(.snappy, value: step)

            Button {
                if step < Self.stepCount - 1 {
                    withAnimation(.snappy) { step += 1 }
                } else {
                    onDone()
                }
            } label: {
                Text(step < Self.stepCount - 1 ? "Continue" : "Start exploring")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .padding(.horizontal, 24)
            .padding(.bottom, 16)
        }
        .background(Color(.systemGroupedBackground))
        .interactiveDismissDisabled()
    }

    // MARK: Steps

    private var appearanceStep: some View {
        @Bindable var theme = theme
        return stepScaffold(
            icon: "paintpalette.fill",
            title: "Make it yours",
            detail: "Theme and accent apply everywhere, instantly. Change them any time in Settings."
        ) {
            VStack(spacing: 18) {
                Picker("Theme", selection: $theme.mode) {
                    ForEach(ThemeMode.allCases, id: \.self) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
                .pickerStyle(.segmented)

                HStack(spacing: 14) {
                    ForEach(AccentChoice.allCases, id: \.self) { accent in
                        Button {
                            theme.accent = accent
                        } label: {
                            Circle()
                                .fill(AppTheme.color(for: accent))
                                .frame(width: 38, height: 38)
                                .overlay {
                                    if theme.accent == accent {
                                        Image(systemName: "checkmark")
                                            .font(.subheadline.bold())
                                            .foregroundStyle(.white)
                                    }
                                }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(accent.label)
                        .accessibilityAddTraits(theme.accent == accent ? [.isSelected] : [])
                    }
                }
            }
            .padding(20)
            .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 24))
        }
    }

    private var privacyStep: some View {
        stepScaffold(
            icon: "lock.shield.fill",
            title: "Your data stays home",
            detail: "Everything you see is served from your own backend."
        ) {
            VStack(alignment: .leading, spacing: 14) {
                bullet("building.columns.fill", "Bank sync via Plaid lands directly on your server")
                bullet("doc.text.viewfinder", "Receipts and statements are parsed there too")
                bullet("sparkles", "The AI advisor reads your numbers only when you ask")
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 24))
        }
    }

    private var layoutStep: some View {
        stepScaffold(
            icon: "square.grid.2x2.fill",
            title: "Five tabs, no maze",
            detail: "Swipe between tabs, or swipe from the left edge of Home for Settings."
        ) {
            VStack(alignment: .leading, spacing: 14) {
                bullet("house.fill", "Home — forecast and what needs attention")
                bullet("wallet.bifold.fill", "Spending — activity, recurring, breakdowns")
                bullet("sparkles", "AI — briefs, plans, and chat")
                bullet("chart.pie.fill", "Budgets — set them, watch them hold")
                bullet("banknote.fill", "Money — net worth, debt, cards, income")
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 24))
        }
    }

    // MARK: Pieces

    private func stepScaffold(
        icon: String,
        title: String,
        detail: String,
        @ViewBuilder content: () -> some View
    ) -> some View {
        ScrollView {
            VStack(spacing: 20) {
                Image(systemName: icon)
                    .font(.system(size: 34, weight: .medium))
                    .foregroundStyle(theme.accentColor.gradient)
                    .frame(width: 84, height: 84)
                    .glassEffect(.regular.tint(theme.accentColor.opacity(0.15)), in: .rect(cornerRadius: 26))
                    .padding(.top, 32)

                Text(title)
                    .font(.title.weight(.bold))
                    .fontDesign(.rounded)
                    .multilineTextAlignment(.center)

                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16)

                content()
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: 440)
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
    }

    private func bullet(_ icon: String, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: icon)
                .font(.subheadline)
                .foregroundStyle(theme.accentColor)
                .frame(width: 24)
            Text(text)
                .font(.subheadline)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
