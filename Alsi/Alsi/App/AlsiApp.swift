import SwiftUI

@main
struct AlsiApp: App {
    @State private var store = FinanceStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .preferredColorScheme(.dark)
                .tint(Caesar.wineGlow)
        }
    }
}
