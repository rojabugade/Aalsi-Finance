import SwiftUI
import AalsiFinanceKit

struct SettingsView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppTheme.self) private var theme

    @State private var household: Household?
    @State private var householdError: String?
    @State private var serverURL = ServerConfig.urlString
    @State private var isSigningOut = false
    @State private var showsSignOutConfirm = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 14) {
                        Text(String((household?.name ?? "A").prefix(1)))
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(theme.accentColor)
                            .frame(width: 52, height: 52)
                            .background(theme.accentColor.opacity(0.18), in: .circle)
                        VStack(alignment: .leading, spacing: 3) {
                            if let household {
                                Text(household.name)
                                    .font(.headline)
                                Text("Base currency \(household.baseCurrency)\(household.sharingEnabled ? " · Shared" : "")")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            } else if let householdError {
                                Text("Household unavailable").font(.headline)
                                Text(householdError)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            } else {
                                Text("Loading…").font(.headline).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .padding(.vertical, 4)

                    NavigationLink("Household members") {
                        HouseholdMembersPane()
                    }
                }

                Section("Appearance") {
                    @Bindable var theme = theme
                    Picker("Theme", selection: $theme.mode) {
                        ForEach(ThemeMode.allCases, id: \.self) { mode in
                            Text(mode.label).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)

                    HStack(spacing: 12) {
                        ForEach(AccentChoice.allCases, id: \.self) { accent in
                            Button {
                                theme.accent = accent
                            } label: {
                                Circle()
                                    .fill(AppTheme.color(for: accent))
                                    .frame(width: 30, height: 30)
                                    .overlay {
                                        if theme.accent == accent {
                                            Image(systemName: "checkmark")
                                                .font(.caption.bold())
                                                .foregroundStyle(.white)
                                        }
                                    }
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(accent.label)
                            .accessibilityAddTraits(theme.accent == accent ? [.isSelected] : [])
                        }
                    }
                    .padding(.vertical, 4)
                }

                Section("Security") {
                    NavigationLink {
                        MfaSetupPane()
                    } label: {
                        Label("Two-factor authentication", systemImage: "lock.shield")
                    }
                }

                Section("Data") {
                    NavigationLink {
                        ExportPane()
                    } label: {
                        Label("Export transactions", systemImage: "square.and.arrow.up")
                    }
                }

                Section {
                    TextField("http://localhost:8000", text: $serverURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit(saveServerURL)
                } header: {
                    Text("Server")
                } footer: {
                    Text("Your self-hosted backend. Changing this signs you out.")
                }

                Section {
                    Button(role: .destructive) {
                        showsSignOutConfirm = true
                    } label: {
                        if isSigningOut {
                            ProgressView()
                        } else {
                            Text("Sign Out")
                        }
                    }
                    .disabled(isSigningOut)
                }

                Section {
                    LabeledContent("Version", value: Bundle.main.shortVersion)
                } footer: {
                    Text("Aalsi Finance for iOS · privacy-first, self-hosted")
                }
            }
            .navigationTitle("Settings")
            .confirmationDialog(
                "Sign out of Aalsi Finance?",
                isPresented: $showsSignOutConfirm,
                titleVisibility: .visible
            ) {
                Button("Sign Out", role: .destructive) { signOut() }
            }
        }
        .task {
            do {
                household = try await session.api.household()
            } catch {
                householdError = error.localizedDescription
            }
        }
    }

    private func saveServerURL() {
        let previous = ServerConfig.urlString
        ServerConfig.urlString = serverURL
        serverURL = ServerConfig.urlString
        if serverURL != previous {
            signOut()
        }
    }

    private func signOut() {
        isSigningOut = true
        Task {
            await session.signOut()
            isSigningOut = false
        }
    }
}

// MARK: - Household members

private struct HouseholdMembersPane: View {
    @Environment(AppSession.self) private var session
    @State private var members: Loadable<[HouseholdMember]> = .idle

    var body: some View {
        List {
            switch members {
            case .idle, .loading:
                HStack {
                    Text("Loading…").foregroundStyle(.secondary)
                    Spacer()
                    ProgressView()
                }
            case .failed(let message):
                Label(message, systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            case .loaded(let members):
                ForEach(members) { member in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text(member.displayName ?? member.email)
                                .font(.subheadline.weight(.medium))
                            if member.mfaEnabled {
                                Image(systemName: "lock.shield.fill")
                                    .font(.caption2)
                                    .foregroundStyle(.green)
                                    .accessibilityLabel("Two-factor enabled")
                            }
                        }
                        Text("\(member.email) · \(member.role.capitalized)\(member.isActive ? "" : " · Inactive")")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .navigationTitle("Members")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard members.value == nil else { return }
            members = .loading
            do {
                members = .loaded(try await session.api.householdMembers())
            } catch {
                members = .failed(error.localizedDescription)
            }
        }
    }
}

// MARK: - Two-factor setup

private struct MfaSetupPane: View {
    @Environment(AppSession.self) private var session

    @State private var enrollment: MfaEnrollment?
    @State private var code = ""
    @State private var isWorking = false
    @State private var errorMessage: String?
    @State private var isVerified = false

    var body: some View {
        Form {
            if isVerified {
                Section {
                    Label("Two-factor authentication is on", systemImage: "checkmark.seal.fill")
                        .foregroundStyle(.green)
                } footer: {
                    Text("You'll be asked for a 6-digit code from your authenticator app at sign-in.")
                }
            } else if let enrollment {
                Section {
                    if let url = URL(string: enrollment.otpauthUri) {
                        Link(destination: url) {
                            Label("Open in authenticator app", systemImage: "arrow.up.forward.app")
                        }
                    }
                    LabeledContent("Secret") {
                        Text(enrollment.secret)
                            .font(.footnote.monospaced())
                            .textSelection(.enabled)
                            .lineLimit(2)
                    }
                } header: {
                    Text("Step 1 · Add to your authenticator")
                } footer: {
                    Text("Open the link on this device, or type the secret into any TOTP app (1Password, Google Authenticator, …).")
                }

                Section {
                    TextField("6-digit code", text: $code)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                        .font(.title3.monospacedDigit())

                    Button {
                        verify()
                    } label: {
                        if isWorking {
                            ProgressView()
                        } else {
                            Text("Verify and enable")
                        }
                    }
                    .disabled(code.trimmingCharacters(in: .whitespaces).count < 6 || isWorking)
                } header: {
                    Text("Step 2 · Confirm a code")
                }
            } else {
                Section {
                    Button {
                        enroll()
                    } label: {
                        if isWorking {
                            ProgressView()
                        } else {
                            Label("Set up two-factor authentication", systemImage: "lock.shield")
                        }
                    }
                    .disabled(isWorking)
                } footer: {
                    Text("Adds a 6-digit authenticator code on top of your password. You can set this up again any time to rotate the secret.")
                }
            }

            if let errorMessage {
                Section {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
        }
        .navigationTitle("Two-Factor")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func enroll() {
        errorMessage = nil
        isWorking = true
        Task {
            do {
                enrollment = try await session.api.mfaEnroll()
            } catch {
                errorMessage = error.localizedDescription
            }
            isWorking = false
        }
    }

    private func verify() {
        errorMessage = nil
        isWorking = true
        Task {
            do {
                try await session.api.mfaVerify(code: code.trimmingCharacters(in: .whitespaces))
                isVerified = true
            } catch {
                errorMessage = error.localizedDescription
            }
            isWorking = false
        }
    }
}

// MARK: - Export

private struct ExportPane: View {
    @Environment(AppSession.self) private var session

    @State private var payload: Loadable<SpendCSVExport> = .idle

    var body: some View {
        Form {
            switch payload {
            case .idle, .loading:
                HStack {
                    Text("Preparing your transactions…").foregroundStyle(.secondary)
                    Spacer()
                    ProgressView()
                }
            case .failed(let message):
                Label(message, systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button("Try Again") {
                    payload = .idle
                    Task { await load() }
                }
            case .loaded(let export):
                Section {
                    ShareLink(item: export, preview: SharePreview(export.fileName)) {
                        Label("Share CSV", systemImage: "square.and.arrow.up")
                    }
                } footer: {
                    Text("Every transaction on your server, as a spreadsheet-ready CSV.")
                }
            }
        }
        .navigationTitle("Export")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        guard payload.value == nil else { return }
        payload = .loading
        do {
            async let transactions = session.api.transactions()
            async let categories = session.api.categories()
            let (loadedTransactions, loadedCategories) = try await (transactions, categories)
            let dates = loadedTransactions.map(\.txnDate)
            let window = DateWindow(
                start: dates.min() ?? .now,
                end: dates.max() ?? .now
            )
            payload = .loaded(SpendCSVExport(
                transactions: loadedTransactions,
                categories: loadedCategories,
                period: SpendPeriod(
                    monthStart: window.start,
                    current: window,
                    previous: window,
                    isCurrentMonth: false
                )
            ))
        } catch {
            payload = .failed(error.localizedDescription)
        }
    }
}

private extension Bundle {
    var shortVersion: String {
        let version = infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }
}
