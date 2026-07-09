import SwiftUI

extension View {
    /// Paints the oxblood bloom behind a tab page's content. The native `TabView`
    /// draws an opaque page background over a `TabView`-level `.background`, so the
    /// backdrop must live inside each page, behind its (transparent) scroll content.
    func caesarBackdrop() -> some View {
        self
            .scrollContentBackground(.hidden)
            .background(CaesarBackground())
    }
}

struct CaesarBackground: View {
    var body: some View {
        ZStack {
            Caesar.ink

            RadialGradient(
                colors: [Caesar.wine.opacity(0.55), Caesar.wineDeep.opacity(0.30), .clear],
                center: .init(x: 0.5, y: -0.05),
                startRadius: 8,
                endRadius: 520
            )

            RadialGradient(
                colors: [Caesar.wineLit.opacity(0.16), .clear],
                center: .init(x: 0.9, y: 0.9),
                startRadius: 8,
                endRadius: 420
            )

            Canvas { context, size in
                var path = Path()
                let spacing: CGFloat = 40
                var x: CGFloat = -size.height
                while x < size.width + size.height {
                    path.move(to: CGPoint(x: x, y: 0))
                    path.addLine(to: CGPoint(x: x + size.height, y: size.height))
                    x += spacing
                }
                context.stroke(path, with: .color(.white.opacity(0.03)), lineWidth: 0.6)
            }
            .blendMode(.plusLighter)
        }
        .ignoresSafeArea()
    }
}
