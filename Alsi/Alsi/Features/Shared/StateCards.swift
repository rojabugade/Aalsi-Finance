import SwiftUI

struct LoadingCard: View {
    var body: some View {
        HStack(spacing: Space.md) {
            ProgressView().tint(Caesar.bone)
            Text("Loading…").foregroundStyle(Caesar.boneDim)
        }
        .frame(maxWidth: .infinity)
        .heroGlass()
    }
}

struct ErrorCard: View {
    let message: String
    let retry: () -> Void
    var body: some View {
        VStack(spacing: Space.md) {
            Text(message).foregroundStyle(Caesar.bone).multilineTextAlignment(.center)
            Button("Retry", action: retry).buttonStyle(.glassProminent).tint(Caesar.wineLit)
        }
        .frame(maxWidth: .infinity)
        .heroGlass()
    }
}

struct EmptyCard: View {
    let title: String
    let message: String
    var body: some View {
        VStack(spacing: Space.xs) {
            Text(title).font(.headline).foregroundStyle(Caesar.bone)
            Text(message).font(.subheadline).foregroundStyle(Caesar.boneDim)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .heroGlass()
    }
}
