import SwiftUI

struct RootView: View {
    @Environment(AppSession.self) private var session
    @AppStorage("onboarding.postLoginDone") private var postLoginDone = false

    var body: some View {
        Group {
            switch session.phase {
            case .restoring:
                ProgressView()
                    .controlSize(.large)
            case .signedOut:
                AuthFlowView()
                    .transition(.opacity)
            case .active:
                MainTabView()
                    .transition(.opacity)
                    .fullScreenCover(isPresented: needsPostLoginOnboarding) {
                        PostLoginOnboardingView { postLoginDone = true }
                    }
            }
        }
        .animation(.smooth, value: session.phase)
        .task { await session.bootstrap() }
    }

    private var needsPostLoginOnboarding: Binding<Bool> {
        #if DEBUG
        // Test hook: simulator automation lands straight on the tabs.
        if ProcessInfo.processInfo.environment["AALSI_SKIP_ONBOARDING"] == "1" {
            return .constant(false)
        }
        #endif
        return Binding(
            get: { !postLoginDone },
            set: { if !$0 { postLoginDone = true } }
        )
    }
}

extension AppSession.Phase: Equatable {}
