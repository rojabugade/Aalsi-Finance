import SwiftUI

struct RootView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        Group {
            switch session.phase {
            case .restoring:
                ProgressView()
                    .controlSize(.large)
            case .signedOut:
                LoginView()
                    .transition(.opacity)
            case .active:
                MainTabView()
                    .transition(.opacity)
            }
        }
        .animation(.smooth, value: session.phase)
        .task { await session.bootstrap() }
    }
}

extension AppSession.Phase: Equatable {}
