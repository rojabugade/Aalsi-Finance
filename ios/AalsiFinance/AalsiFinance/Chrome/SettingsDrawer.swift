import SwiftUI

/// Full-height panel that slides in from a horizontal edge over a scrim.
/// Settings enters from the leading edge, notifications from the trailing —
/// mirrored gestures: tap the scrim or drag the panel back out to dismiss.
struct SidePanel<Content: View>: View {
    let edge: HorizontalEdge
    @Binding var isOpen: Bool
    @ViewBuilder let content: Content

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @GestureState private var dragOffset: CGFloat = 0

    var body: some View {
        GeometryReader { geo in
            let width = min(geo.size.width * 0.86, 360)
            let leading = edge == .leading

            ZStack(alignment: leading ? .leading : .trailing) {
                Color.black.opacity(isOpen ? 0.45 : 0)
                    .ignoresSafeArea()
                    .onTapGesture { isOpen = false }
                    .accessibilityLabel("Dismiss panel")
                    .accessibilityAddTraits(.isButton)
                    .allowsHitTesting(isOpen)

                content
                    .frame(width: width)
                    .background(Color(.systemBackground))
                    .clipShape(
                        leading
                            ? .rect(bottomTrailingRadius: 28, topTrailingRadius: 28)
                            : .rect(topLeadingRadius: 28, bottomLeadingRadius: 28)
                    )
                    .shadow(color: .black.opacity(isOpen ? 0.35 : 0), radius: 24, x: leading ? 8 : -8, y: 0)
                    .offset(x: panelOffset(width: width))
                    .gesture(closeDrag)
                    .ignoresSafeArea(edges: .vertical)
            }
            .animation(
                reduceMotion ? .easeOut(duration: 0.18) : .spring(response: 0.38, dampingFraction: 0.86),
                value: isOpen
            )
        }
        .allowsHitTesting(isOpen)
    }

    private func panelOffset(width: CGFloat) -> CGFloat {
        let hidden = width + 40
        if edge == .leading {
            return isOpen ? min(dragOffset, 0) : -hidden
        }
        return isOpen ? max(dragOffset, 0) : hidden
    }

    private var closeDrag: some Gesture {
        DragGesture(minimumDistance: 15)
            .updating($dragOffset) { value, state, _ in
                state = edge == .leading
                    ? min(value.translation.width, 0)
                    : max(value.translation.width, 0)
            }
            .onEnded { value in
                let travel = value.translation.width
                let predicted = value.predictedEndTranslation.width
                let dismissing = edge == .leading
                    ? (travel < -80 || predicted < -160)
                    : (travel > 80 || predicted > 160)
                if dismissing { isOpen = false }
            }
    }
}

/// Settings drawer: avatar tap anywhere, or edge swipe on Home.
struct SettingsDrawer: View {
    @Binding var isOpen: Bool

    var body: some View {
        SidePanel(edge: .leading, isOpen: $isOpen) {
            SettingsView()
        }
    }
}

/// Notifications panel, mirrored on the trailing edge.
struct NotificationsPanel: View {
    @Binding var isOpen: Bool

    var body: some View {
        SidePanel(edge: .trailing, isOpen: $isOpen) {
            VStack(spacing: 0) {
                HStack {
                    Text("Notifications")
                        .font(.title3.weight(.semibold))
                    Spacer()
                    Button {
                        isOpen = false
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title3)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityLabel("Close notifications")
                }
                .padding(.horizontal, 20)
                .padding(.top, 68)
                .padding(.bottom, 8)

                NotificationsView()
            }
            .background(Color(.systemGroupedBackground))
        }
    }
}
