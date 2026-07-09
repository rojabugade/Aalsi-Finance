import SwiftUI

struct ComingSoonView: View {
    let title: String
    let message: String

    var body: some View {
        VStack {
            Spacer()
            VStack(spacing: Space.sm) {
                Image(systemName: "hourglass")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(Caesar.wineGlow)
                Text(title).font(.title2.weight(.semibold)).foregroundStyle(Caesar.bone)
                Text(message).font(.subheadline).foregroundStyle(Caesar.boneDim)
                    .multilineTextAlignment(.center)
            }
            .heroGlass()
            .padding(Space.lg)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
