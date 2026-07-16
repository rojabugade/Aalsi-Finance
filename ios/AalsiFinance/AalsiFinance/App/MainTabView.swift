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

    @State private var chrome = {
        let chrome = ChromeState()
        #if DEBUG
        // Test hooks: let simulator automation open the side panels directly.
        if ProcessInfo.processInfo.environment["AALSI_OPEN_DRAWER"] == "1" {
            chrome.drawerOpen = true
        }
        if ProcessInfo.processInfo.environment["AALSI_OPEN_NOTIFICATIONS"] == "1" {
            chrome.notificationsOpen = true
        }
        #endif
        return chrome
    }()

    var body: some View {
        @Bindable var chrome = chrome
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
        .simultaneousGesture(edgeOpenGesture)
        .sensoryFeedback(.impact(weight: .light), trigger: chrome.drawerOpen) { !$0 && $1 }
        .overlay {
            SettingsDrawer(isOpen: $chrome.drawerOpen)
        }
        .overlay {
            NotificationsPanel(isOpen: $chrome.notificationsOpen)
        }
        .environment(chrome)
    }

    /// On Home a rightward swipe from the leading edge reveals the settings
    /// drawer. Thresholds are deliberately forgiving — a flick (predicted
    /// travel) counts even when the finger lifted early, and the start zone
    /// spans a thumb-width from the edge.
    private var edgeOpenGesture: some Gesture {
        DragGesture(minimumDistance: 10)
            .onEnded { value in
                guard selection == .home, !chrome.drawerOpen else { return }
                let horizontal = value.translation.width
                let predicted = value.predictedEndTranslation.width
                if value.startLocation.x < 90,
                   horizontal > 40 || predicted > 120,
                   abs(value.translation.height) < abs(horizontal) {
                    chrome.drawerOpen = true
                }
            }
    }
}
