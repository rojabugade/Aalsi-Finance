import SwiftUI
import Observation
import AalsiFinanceKit

/// User-selected appearance: color scheme + accent. Persisted in UserDefaults;
/// injected at the root so every screen tints consistently.
@MainActor
@Observable
final class AppTheme {
    var mode: ThemeMode {
        didSet { UserDefaults.standard.set(mode.rawValue, forKey: Self.modeKey) }
    }
    var accent: AccentChoice {
        didSet { UserDefaults.standard.set(accent.rawValue, forKey: Self.accentKey) }
    }

    private static let modeKey = "theme.mode"
    private static let accentKey = "theme.accent"

    init() {
        mode = UserDefaults.standard.string(forKey: Self.modeKey).flatMap(ThemeMode.init) ?? .system
        accent = UserDefaults.standard.string(forKey: Self.accentKey).flatMap(AccentChoice.init) ?? .indigo
    }

    var colorScheme: ColorScheme? {
        switch mode {
        case .system: nil
        case .dark: .dark
        case .light: .light
        }
    }

    var accentColor: Color { Self.color(for: accent) }

    static func color(for accent: AccentChoice) -> Color {
        switch accent {
        case .indigo: .indigo
        case .teal: .teal
        case .coral: .orange
        case .pink: .pink
        case .amber: .yellow
        case .green: .green
        }
    }
}
