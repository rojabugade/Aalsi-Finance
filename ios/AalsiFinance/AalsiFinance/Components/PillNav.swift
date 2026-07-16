import SwiftUI

/// Page-specific sub-navigation. First pill is the page's main (99%) view;
/// the rest are niche value-adds.
struct PillNav: View {
    @Environment(AppTheme.self) private var theme
    let items: [String]
    @Binding var selection: Int

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 8) {
                    ForEach(items.indices, id: \.self) { index in
                        Button {
                            withAnimation(.snappy) { selection = index }
                        } label: {
                            Text(items[index])
                                .font(.subheadline.weight(selection == index ? .semibold : .regular))
                                .padding(.horizontal, 14)
                                .padding(.vertical, 7)
                                .foregroundStyle(selection == index ? Color(.systemBackground) : .primary)
                        }
                        .buttonStyle(.plain)
                        .glassEffect(
                            selection == index
                                ? .regular.tint(theme.accentColor).interactive()
                                : .regular.interactive(),
                            in: .capsule
                        )
                        .accessibilityAddTraits(selection == index ? [.isSelected] : [])
                    }
                }
            }
            .padding(.horizontal, 20)
        }
        .scrollClipDisabled()
    }
}
