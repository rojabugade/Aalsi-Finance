import SwiftUI
import AalsiFinanceKit

struct AdvisorView: View {
    @Environment(AppSession.self) private var session
    @State private var model: AdvisorViewModel

    init() {
        let model = AdvisorViewModel()
        #if DEBUG
        // Test hook: lets simulator automation open a specific pill directly.
        if let raw = ProcessInfo.processInfo.environment["AALSI_INITIAL_AI_PILL"],
           let value = Int(raw),
           AdvisorViewModel.Pill(rawValue: value) != nil {
            model.selectedPill = value
        }
        #endif
        _model = State(initialValue: model)
    }

    private static let pills = AdvisorViewModel.Pill.allCases.map(\.title)

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            VStack(spacing: 14) {
                AppHeader(title: "Advisor")
                PillNav(items: Self.pills, selection: $model.selectedPill)
                content
            }
            .background(Color(.systemGroupedBackground))
            .scrollEdgeEffectStyle(.soft, for: .top)
            .toolbar(.hidden, for: .navigationBar)
        }
        .task { await model.loadForYou(api: session.api) }
    }

    @ViewBuilder
    private var content: some View {
        switch AdvisorViewModel.Pill(rawValue: model.selectedPill) ?? .forYou {
        case .forYou:
            ForYouPane(model: model)
        case .plan:
            PlanPane(model: model)
        case .crossBorder:
            CrossBorderPane(model: model)
        case .chat:
            ChatPane(model: model)
        }
    }
}
