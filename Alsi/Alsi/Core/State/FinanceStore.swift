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

    private static let defaultAPIBaseURL: String = {
        #if targetEnvironment(simulator)
        "http://localhost:8000"
        #else
        ""
        #endif
    }()

    var apiBaseURL: String {
        get { defaults.string(forKey: baseURLKey) ?? Self.defaultAPIBaseURL }
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

    private func service(baseURL: String? = nil) throws -> FinanceService {
        let url = try APIClient.validatedBaseURL(baseURL ?? apiBaseURL)
        return FinanceService(client: APIClient(baseURL: url))
    }

    func refreshIfNeeded() async {
        if case .idle = phase { await refresh() }
    }

    func refresh() async {
        authError = nil
        guard !apiBaseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            snapshot = .empty
            phase = .signedOut
            return
        }

        let financeService: FinanceService
        do {
            financeService = try service()
        } catch {
            snapshot = .empty
            phase = .signedOut
            authError = error.localizedDescription
            return
        }

        if !isSignedIn {
            do {
                accessToken = try await financeService.refreshAccessToken()
            } catch FinanceAPIError.unauthorized {
                snapshot = .empty
                phase = .signedOut
                return
            } catch {
                snapshot = .empty
                phase = .failed(error.localizedDescription)
                return
            }
        }

        phase = .loading
        do {
            snapshot = try await financeService.fetchSnapshot(accessToken: accessToken)
            phase = .loaded
        } catch FinanceAPIError.unauthorized {
            do {
                accessToken = try await financeService.refreshAccessToken()
                snapshot = try await financeService.fetchSnapshot(accessToken: accessToken)
                phase = .loaded
            } catch FinanceAPIError.unauthorized {
                snapshot = .empty
                accessToken = ""
                phase = .signedOut
            } catch {
                snapshot = .empty
                phase = .failed(error.localizedDescription)
            }
        } catch {
            snapshot = .empty; phase = .failed(error.localizedDescription)
        }
    }

    func signIn(email: String, password: String, totpCode: String?, baseURL: String) async {
        authError = nil
        phase = .loading
        do {
            let financeService = try service(baseURL: baseURL)
            apiBaseURL = financeService.client.baseURL.absoluteString
            accessToken = try await financeService.login(email: email, password: password, totpCode: totpCode)
            await refresh()
        } catch {
            accessToken = ""; snapshot = .empty
            authError = error.localizedDescription; phase = .signedOut
        }
    }

    func signup(
        email: String,
        password: String,
        displayName: String?,
        householdName: String?,
        baseURL: String
    ) async {
        authError = nil
        phase = .loading
        do {
            let financeService = try service(baseURL: baseURL)
            apiBaseURL = financeService.client.baseURL.absoluteString
            accessToken = try await financeService.signup(
                email: email,
                password: password,
                displayName: displayName,
                householdName: householdName
            )
            await refresh()
        } catch {
            accessToken = ""
            snapshot = .empty
            authError = error.localizedDescription
            phase = .signedOut
        }
    }

    func signOut() {
        let financeService = try? service()
        accessToken = ""; snapshot = .empty; phase = .signedOut
        if let financeService {
            Task { await financeService.logout() }
        }
    }
}
