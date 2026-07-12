public enum ThemeMode: String, CaseIterable, Codable, Sendable {
    case system, dark, light

    public var label: String {
        switch self {
        case .system: "System"
        case .dark: "Dark"
        case .light: "Light"
        }
    }
}

public enum AccentChoice: String, CaseIterable, Codable, Sendable {
    case indigo, teal, coral, pink, amber, green

    public var label: String { rawValue.prefix(1).uppercased() + rawValue.dropFirst() }
}
