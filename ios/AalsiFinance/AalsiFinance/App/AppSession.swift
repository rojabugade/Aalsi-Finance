import Foundation
import Observation

/// Top-level auth/session state. Owns the shared `APIClient` and gates the UI
/// between the login screen and the main tab experience.
@MainActor
@Observable
final class AppSession {
    enum Phase {
        case restoring
        case signedOut
        case active
    }

    private(set) var phase: Phase = .restoring
    let api = APIClient()

    /// Set once at launch: try to resume from the Keychain refresh token.
    func bootstrap() async {
        await api.setOnSessionExpired { [weak self] in
            Task { @MainActor in self?.phase = .signedOut }
        }
        do {
            try await api.restoreSession()
            phase = .active
        } catch {
            phase = .signedOut
        }
    }

    func signIn(email: String, password: String, totpCode: String?) async throws {
        try await api.login(email: email, password: password, totpCode: totpCode)
        phase = .active
    }

    func signUp(email: String, password: String, displayName: String?, householdName: String?, baseCurrency: String) async throws {
        try await api.signup(
            email: email,
            password: password,
            displayName: displayName,
            householdName: householdName,
            baseCurrency: baseCurrency
        )
        phase = .active
    }

    func signOut() async {
        await api.logout()
        phase = .signedOut
    }
}
