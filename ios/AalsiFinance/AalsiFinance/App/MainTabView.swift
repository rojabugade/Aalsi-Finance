import SwiftUI

struct MainTabView: View {
    enum AppTab: String {
        case home, spending, ai, budgets, money
    }

    @State private var selection: AppTab = {
        #if DEBUG
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
            Tab("Spending", systemImage: "wallet.bifold.fill", value: .spending) {
                SpendingView()
            }
            Tab("AI", systemImage: "sparkles", value: .ai) {
                AdvisorView()
            }
            Tab("Budgets", systemImage: "chart.pie.fill", value: .budgets) {
                BudgetsView()
            }
            Tab("Money", systemImage: "banknote.fill", value: .money) {
                MoneyView()
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
    }
}
