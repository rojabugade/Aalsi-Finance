import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            Tab("Home", systemImage: "house.fill") {
                HomeView()
            }
            Tab("Activity", systemImage: "list.bullet.rectangle.fill") {
                ActivityView()
            }
            Tab("Insights", systemImage: "chart.pie.fill") {
                InsightsView()
            }
            Tab("Guidance", systemImage: "sparkles") {
                GuidanceView()
            }
            Tab("Settings", systemImage: "gearshape.fill") {
                SettingsView()
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .tint(.indigo)
    }
}
