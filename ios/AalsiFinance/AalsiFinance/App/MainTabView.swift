import SwiftUI

struct MainTabView: View {
    enum AppTab: String {
        case home, activity, insights, guidance, settings
    }

    @State private var selection: AppTab = {
        #if DEBUG
        // Test hook: lets simulator automation open a specific tab directly.
        if let raw = ProcessInfo.processInfo.environment["AALSI_INITIAL_TAB"],
           let tab = AppTab(rawValue: raw) {
            return tab
        }
        #endif
        return .home
    }()

    var body: some View {
        TabView(selection: $selection) {
            Tab("Home", systemImage: "house.fill", value: .home) {
                HomeView()
            }
            Tab("Activity", systemImage: "list.bullet.rectangle.fill", value: .activity) {
                ActivityView()
            }
            Tab("Insights", systemImage: "chart.pie.fill", value: .insights) {
                InsightsView()
            }
            Tab("Guidance", systemImage: "sparkles", value: .guidance) {
                GuidanceView()
            }
            Tab("Settings", systemImage: "gearshape.fill", value: .settings) {
                SettingsView()
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .tint(.indigo)
    }
}
