import SwiftUI

struct RootView: View {
    @Environment(FinanceStore.self) private var store
    @State private var showingSignIn = false

    var body: some View {
        TabView {
            Tab("Home", systemImage: "square.grid.2x2") {
                dashboardTab
            }
            Tab("Spend", systemImage: "list.bullet.rectangle") {
                spendTab
            }
            Tab("Insights", systemImage: "chart.pie") {
                placeholderTab(title: "Insights",
                               message: "Trends, categories, and recurring analysis are coming next.")
            }
            Tab("Plan", systemImage: "target") {
                placeholderTab(title: "Plan",
                               message: "Budgets, debt, and payoff planning are coming next.")
            }
        }
        .sheet(isPresented: $showingSignIn) { SignInSheet(store: store) }
        .task { await store.refreshIfNeeded() }
    }

    private var dashboardTab: some View {
        NavigationStack {
            DashboardView(onSignIn: { showingSignIn = true })
                .navigationTitle("Home")
                .toolbar { signInToolbar }
                .caesarBackdrop()
        }
    }

    private var spendTab: some View {
        NavigationStack {
            SpendView(onSignIn: { showingSignIn = true })
                .navigationTitle("Spend")
                .toolbar { signInToolbar }
                .caesarBackdrop()
        }
    }

    private func placeholderTab(title: String, message: String) -> some View {
        NavigationStack {
            ComingSoonView(title: title, message: message)
                .navigationTitle(title)
                .caesarBackdrop()
        }
    }

    @ToolbarContentBuilder
    private var signInToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            if store.isSignedIn {
                Button("Sign out") { store.signOut() }
            } else {
                Button("Sign in") { showingSignIn = true }
            }
        }
    }
}
