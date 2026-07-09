import Foundation
import Observation

enum FinanceDataPhase: Equatable {
    case idle, loading, loaded, signedOut
    case failed(String)
    var isRefreshing: Bool { if case .loading = self { true } else { false } }
}

@Observable
@MainActor
final class FinanceStore {
    private(set) var phase: FinanceDataPhase = .idle
    private(set) var snapshot: FinanceSnapshot = .empty
    var authError: String?

    private let keychain = KeychainStore(service: "com.alsi.app")
    private let defaults = UserDefaults.standard
    private let tokenKey = "alsi.accessToken"
    private let baseURLKey = "alsi.apiBaseURL"

    var apiBaseURL: String {
        get { defaults.string(forKey: baseURLKey) ?? "http://localhost:8000" }
        set { defaults.set(newValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: baseURLKey) }
    }

    private var accessToken: String {
        get { keychain.read(tokenKey) ?? "" }
        set {
            let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { keychain.delete(tokenKey) }
            else { keychain.write(trimmed, key: tokenKey) }
        }
    }

    var isSignedIn: Bool { !accessToken.isEmpty }

    private func service() -> FinanceService {
        let url = URL(string: apiBaseURL) ?? URL(string: "http://localhost:8000")!
        return FinanceService(client: APIClient(baseURL: url))
    }

    func refreshIfNeeded() async {
        if case .idle = phase { await refresh() }
    }

    func refresh() async {
        authError = nil
        guard isSignedIn else { snapshot = .empty; phase = .signedOut; return }
        phase = .loading
        do {
            snapshot = try await service().fetchSnapshot(accessToken: accessToken)
            phase = .loaded
        } catch FinanceAPIError.unauthorized {
            snapshot = .empty; accessToken = ""; phase = .signedOut
        } catch {
            snapshot = .empty; phase = .failed(error.localizedDescription)
        }
    }

    func signIn(email: String, password: String, baseURL: String) async {
        authError = nil
        apiBaseURL = baseURL
        phase = .loading
        do {
            accessToken = try await service().login(email: email, password: password)
            await refresh()
        } catch {
            accessToken = ""; snapshot = .empty
            authError = error.localizedDescription; phase = .signedOut
        }
    }

    func signOut() {
        accessToken = ""; snapshot = .empty; phase = .signedOut
    }
}
