import SwiftUI
import AalsiFinanceKit

// MARK: - Cards

/// Standard content card. Content stays on a solid grouped surface — Liquid
/// Glass is reserved for the hero + control layer, per the HIG.
struct CardBackground: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color(.secondarySystemGroupedBackground),
                in: RoundedRectangle(cornerRadius: 24, style: .continuous)
            )
    }
}

extension View {
    func card() -> some View { modifier(CardBackground()) }
}

struct SectionHeader: View {
    let title: String
    var systemImage: String?

    var body: some View {
        HStack(spacing: 6) {
            if let systemImage {
                Image(systemName: systemImage)
                    .foregroundStyle(.secondary)
                    .font(.subheadline.weight(.semibold))
            }
            Text(title)
                .font(.title3.weight(.semibold))
            Spacer()
        }
        .padding(.horizontal, 4)
    }
}

// MARK: - Money

struct MoneyText: View {
    let amount: Money
    let code: String
    var font: Font = .body
    /// Explicit "+"/"-" prefix; keeps money-in and money-out readable without
    /// relying on color alone.
    var signed = false

    var body: some View {
        Text(signed ? amount.signedFormatted(code: code) : amount.formatted(code: code))
            .font(font)
            .fontDesign(.rounded)
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.5)
    }
}

// MARK: - Status

struct StatusBadge: View {
    let status: String

    private var tint: Color {
        switch status {
        case "draft": .orange
        case "confirmed", "posted": .green
        case "excluded": .secondary.opacity(0.8)
        default: .blue
        }
    }

    var body: some View {
        Text(status.capitalized)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(tint.opacity(0.15), in: .capsule)
            .foregroundStyle(tint)
    }
}

/// Small typed chip for money-flow direction ("Refund", "Transfer").
struct FlowBadge: View {
    let label: String
    let tint: Color

    var body: some View {
        Text(label)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(tint.opacity(0.15), in: .capsule)
            .foregroundStyle(tint)
    }
}

// MARK: - Load/error states

struct ErrorStateView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("Something went wrong", systemImage: "wifi.exclamationmark")
        } description: {
            Text(message)
        } actions: {
            Button("Try Again", action: retry)
                .buttonStyle(.glassProminent)
        }
    }
}

struct LoadingCard: View {
    var height: CGFloat = 120

    var body: some View {
        RoundedRectangle(cornerRadius: 24, style: .continuous)
            .fill(Color(.secondarySystemGroupedBackground))
            .frame(height: height)
            .overlay(ProgressView())
    }
}
