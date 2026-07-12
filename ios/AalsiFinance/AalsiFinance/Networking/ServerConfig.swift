import Foundation

/// Where the backend lives. Defaults to the local docker-compose API; editable
/// from Settings (and from the login screen) for LAN/self-hosted deployments.
enum ServerConfig {
    static let defaultURLString = "http://localhost:8000"
    private static let key = "serverURL"

    static var urlString: String {
        get { UserDefaults.standard.string(forKey: key) ?? defaultURLString }
        set {
            let trimmed = newValue
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            if trimmed.isEmpty || URL(string: trimmed) == nil {
                UserDefaults.standard.removeObject(forKey: key)
            } else {
                UserDefaults.standard.set(trimmed, forKey: key)
            }
        }
    }

    static var baseURL: URL {
        URL(string: urlString) ?? URL(string: defaultURLString)!
    }
}
