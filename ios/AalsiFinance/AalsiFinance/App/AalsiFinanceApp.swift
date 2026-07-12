import SwiftUI

@main
struct AalsiFinanceApp: App {
    @State private var session = AppSession()
    @State private var theme = AppTheme()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(theme)
                .tint(theme.accentColor)
                .preferredColorScheme(theme.colorScheme)
        }
    }
}
