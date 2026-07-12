import SwiftUI
import AalsiFinanceKit

struct SettingsView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppTheme.self) private var theme

    @State private var household: Household?
    @State private var householdError: String?
    @State private var serverURL = ServerConfig.urlString
    @State private var isSigningOut = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Household") {
                    if let household {
                        LabeledContent("Name", value: household.name)
                        LabeledContent("Base currency", value: household.baseCurrency)
                        LabeledContent("Sharing", value: household.sharingEnabled ? "Enabled" : "Off")
                    } else if let householdError {
                        Label(householdError, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        HStack {
                            Text("Loading…").foregroundStyle(.secondary)
                            Spacer()
                            ProgressView()
                        }
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
                        }
                    }
                    .padding(.vertical, 4)
                }

                Section {
                    NavigationLink("Capture & Documents") { PlaceholderPane(title: "Capture", icon: "doc.text.viewfinder") }
                    NavigationLink("Connections") { PlaceholderPane(title: "Connections", icon: "building.columns") }
                    NavigationLink("Notifications") { PlaceholderPane(title: "Notifications", icon: "bell.badge") }
                } header: {
                    Text("Coming soon")
                }

                Section {
                    Button(role: .destructive) {
                        signOut()
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

private struct PlaceholderPane: View {
    let title: String
    let icon: String

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: icon)
        } description: {
            Text("This lives on the web app for now and is coming to iOS soon.")
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

private extension Bundle {
    var shortVersion: String {
        let version = infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }
}
