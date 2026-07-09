import SwiftUI

struct SpendView: View {
    @Environment(FinanceStore.self) private var store
    let onSignIn: () -> Void
    @State private var showDraftsOnly = false

    var body: some View {
        ScrollView {
            VStack(spacing: Space.md) {
                switch store.phase {
                case .idle, .loading:
                    LoadingCard()
                case .signedOut:
                    EmptyCard(title: "Sign in to Alsi", message: "Connect to your backend to see transactions.")
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
        .safeAreaBar(edge: .top) { filterBar }
    }

    private var filterBar: some View {
        HStack {
            Button {
                showDraftsOnly.toggle()
            } label: {
                Label(showDraftsOnly ? "Drafts only" : "All transactions",
                      systemImage: showDraftsOnly ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                    .foregroundStyle(Caesar.bone)
            }
            .pillGlass()
            Spacer()
        }
        .padding(.horizontal, Space.md)
    }

    private var rows: [Transaction] {
        showDraftsOnly ? store.snapshot.transactions.filter(\.isDraft) : store.snapshot.transactions
    }

    private var content: some View {
        Group {
            if rows.isEmpty {
                EmptyCard(title: "No transactions", message: showDraftsOnly ? "No drafts pending review." : "Nothing here yet.")
            } else {
                VStack(spacing: Space.sm) {
                    ForEach(rows) { txn in transactionRow(txn) }
                }
            }
        }
    }

    private func transactionRow(_ txn: Transaction) -> some View {
        let sign = Metric(sign: txn.amount.decimal)
        return HStack(spacing: Space.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(txn.displayName).font(.body.weight(.medium)).foregroundStyle(Caesar.bone)
                Text(FinanceFormatter.shortDate(txn.txnDate)).font(.caption).foregroundStyle(Caesar.boneFaint)
            }
            Spacer()
            if txn.isDraft {
                Text("DRAFT").font(.caption2.weight(.bold)).foregroundStyle(Caesar.wineGlow)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Caesar.wine.opacity(0.35), in: .capsule)
            }
            Text(FinanceFormatter.currency(txn.amount.decimal, currency: txn.currency, signed: true))
                .font(.body.weight(.semibold).monospacedDigit())
                .foregroundStyle(sign.color)
        }
        .padding(Space.md)
        .background(Caesar.inkRaised, in: .rect(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Caesar.wine.opacity(0.30), lineWidth: 1))
    }
}
