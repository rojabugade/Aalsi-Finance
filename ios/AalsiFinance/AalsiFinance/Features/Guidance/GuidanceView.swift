import SwiftUI

/// Placeholder — the AI analyst (Monitor / Explain / Plan / Action) ships in a
/// later iteration. For now this sets the visual tone and points to the web app.
struct GuidanceView: View {
    private struct ModeInfo: Identifiable {
        let id = UUID()
        let name: String
        let icon: String
        let detail: String
    }

    private let modes: [ModeInfo] = [
        .init(name: "Monitor", icon: "eye.fill", detail: "Proactive alerts on overspending, upcoming bills, and cross-domain patterns."),
        .init(name: "Explain", icon: "text.magnifyingglass", detail: "Ask anything about your money in plain language, with cited sources."),
        .init(name: "Plan", icon: "map.fill", detail: "Payoff strategies, budget scenarios, and cross-border guidance."),
        .init(name: "Action", icon: "bolt.fill", detail: "One-tap fixes: recategorize, confirm drafts, adjust budgets."),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    VStack(spacing: 14) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 40, weight: .medium))
                            .foregroundStyle(.indigo.gradient)
                            .padding(24)
                            .glassEffect(.regular.tint(.indigo.opacity(0.2)).interactive(), in: .circle)

                        Text("Your analyst is on its way")
                            .font(.title2.weight(.bold))
                            .fontDesign(.rounded)

                        Text("The AI analyst that already knows your finances on the web app is coming to iOS. Until then, guidance lives on the web.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 32)

                    VStack(spacing: 12) {
                        ForEach(modes) { mode in
                            HStack(alignment: .top, spacing: 14) {
                                Image(systemName: mode.icon)
                                    .font(.system(size: 17, weight: .semibold))
                                    .foregroundStyle(.indigo)
                                    .frame(width: 42, height: 42)
                                    .background(.indigo.opacity(0.12), in: .rect(cornerRadius: 12))

                                VStack(alignment: .leading, spacing: 3) {
                                    Text(mode.name)
                                        .font(.subheadline.weight(.semibold))
                                    Text(mode.detail)
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                Spacer(minLength: 0)
                            }
                            .card()
                        }
                    }
                }
                .padding(20)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Guidance")
            .scrollEdgeEffectStyle(.soft, for: .top)
        }
    }
}
