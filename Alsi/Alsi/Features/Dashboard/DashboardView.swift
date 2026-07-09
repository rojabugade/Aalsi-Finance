import SwiftUI

struct DashboardView: View {
    @Environment(FinanceStore.self) private var store
    let onSignIn: () -> Void
    @Namespace private var glassNamespace

    var body: some View {
        ScrollView {
            VStack(spacing: Space.lg) {
                switch store.phase {
                case .idle, .loading:
                    LoadingCard()
                case .signedOut:
                    EmptyCard(title: "Sign in to Alsi", message: "Connect to your backend to see cash flow and net worth.")
                    Button("Sign in", action: onSignIn).buttonStyle(.glassProminent).tint(Caesar.wineLit)
                case .failed(let message):
                    ErrorCard(message: message) { Task { await store.refresh() } }
                case .loaded:
                    content
                }
            }
            .padding(Space.md)
        }
        .scrollEdgeEffectStyle(.automatic, for: .top)
        .refreshable { await store.refresh() }
    }

    private var content: some View {
        let snap = store.snapshot
        return GlassEffectContainer(spacing: Space.lg) {
            VStack(spacing: Space.lg) {
                heroCard(snap)
                    .glassEffectID("hero", in: glassNamespace)

                ForEach(DashboardMetric.from(snap)) { metric in
                    metricRow(metric)
                }
            }
        }
    }

    private func heroCard(_ snap: FinanceSnapshot) -> some View {
        let leftover = snap.cashflow?.leftoverMonthly.decimal
        return VStack(alignment: .leading, spacing: Space.sm) {
            Text("Net worth").font(.caption).foregroundStyle(Caesar.boneDim)
            Text(FinanceFormatter.currency(snap.netWorth?.netWorth.decimal, currency: snap.currency))
                .font(.system(size: 44, weight: .bold, design: .rounded))
                .foregroundStyle(Caesar.bone)
            if let leftover {
                Label(
                    "\(FinanceFormatter.currency(leftover, currency: snap.currency, signed: true)) leftover / month",
                    systemImage: Metric(sign: leftover).symbol
                )
                .font(.subheadline)
                .foregroundStyle(Metric(sign: leftover).color)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .heroGlass()
    }

    private func metricRow(_ metric: DashboardMetric) -> some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Text(metric.title).font(.subheadline).foregroundStyle(Caesar.boneDim)
            Text(metric.value).font(.title2.weight(.semibold)).foregroundStyle(Caesar.bone)
            Text(metric.footnote).font(.caption).foregroundStyle(Caesar.boneFaint)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Space.md)
        .background(Caesar.inkRaised, in: .rect(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Caesar.wine.opacity(0.35), lineWidth: 1))
    }
}
