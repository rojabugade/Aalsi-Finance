import Foundation

struct DashboardMetric: Identifiable {
    let id = UUID()
    let title: String
    let value: String
    let footnote: String

    static func from(_ snap: FinanceSnapshot) -> [DashboardMetric] {
        [
            DashboardMetric(
                title: "Safe to spend",
                value: FinanceFormatter.currency(snap.cashflow?.leftoverMonthly.decimal, currency: snap.currency),
                footnote: "Income minus recurring, EMIs, card minimums, and discretionary spend"),
            DashboardMetric(
                title: "Needs review",
                value: snap.pendingReviewCount == 0 && !snap.hasLiveData ? "—" : "\(snap.pendingReviewCount)",
                footnote: "Documents and draft transactions pending confirmation"),
            DashboardMetric(
                title: "Net worth",
                value: FinanceFormatter.currency(snap.netWorth?.netWorth.decimal, currency: snap.currency),
                footnote: "Latest backend account balance rollup")
        ]
    }
}
