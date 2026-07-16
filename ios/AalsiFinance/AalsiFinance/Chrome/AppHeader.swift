import SwiftUI

/// Persistent chrome for every tab: avatar (slides in the settings drawer)
/// on the left, notifications on the right (pushed onto the tab's stack).
/// `greeting` renders Home's two-line form.
struct AppHeader: View {
    @Environment(AppTheme.self) private var theme
    @Environment(ChromeState.self) private var chrome
    let title: String
    var subtitle: String?
    var greeting = false

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Button {
                chrome.drawerOpen = true
            } label: {
                Text(String(title.prefix(1)))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(theme.accentColor)
                    .frame(width: 38, height: 38)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.tint(theme.accentColor.opacity(0.22)).interactive(), in: .circle)
            .accessibilityLabel("Profile and settings")

            VStack(alignment: .leading, spacing: 0) {
                if greeting { Text(greetingLine).font(.caption).foregroundStyle(.secondary) }
                Text(title).font(greeting ? .title3.weight(.semibold) : .title2.weight(.semibold))
                if let subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
            }

            Spacer()

            Button {
                chrome.notificationsOpen = true
            } label: {
                Image(systemName: "bell")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(.primary)
                    .frame(width: 38, height: 38)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .circle)
            .accessibilityLabel("Notifications")
        }
        .padding(.horizontal, 20).padding(.top, 8)
    }

    private var greetingLine: String {
        switch Calendar.current.component(.hour, from: .now) { case 5..<12: "Good morning,"; case 12..<17: "Good afternoon,"; default: "Good evening," }
    }
}
