import SwiftUI

extension View {
    /// Hero surface — the one big custom-glass card per screen. Tinted oxblood.
    func heroGlass(cornerRadius: CGFloat = 28) -> some View {
        self
            .padding(Space.lg)
            .glassEffect(
                .regular.tint(Caesar.wine.opacity(0.55)).interactive(),
                in: .rect(cornerRadius: cornerRadius)
            )
    }

    /// Floating pill — filters / small actions.
    func pillGlass() -> some View {
        self
            .padding(.horizontal, Space.md)
            .padding(.vertical, Space.sm)
            .glassEffect(
                .regular.tint(Caesar.wineLit.opacity(0.40)).interactive(),
                in: .capsule
            )
    }
}
