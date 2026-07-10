import SwiftUI

struct SignInSheet: View {
    private enum Mode: String, CaseIterable, Identifiable {
        case signIn = "Sign in"
        case signUp = "Create account"

        var id: Self { self }
    }

    let store: FinanceStore
    @Environment(\.dismiss) private var dismiss

    @State private var mode: Mode = .signIn
    @State private var email = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var totpCode = ""
    @State private var displayName = ""
    @State private var householdName = ""
    @State private var baseURL = ""
    @State private var submitting = false
    @State private var formError: String?

    var body: some View {
        NavigationStack {
            Form {
                Picker("Account action", selection: $mode) {
                    ForEach(Mode.allCases) { mode in
                        Text(mode.rawValue).tag(mode)
                    }
                }
                .pickerStyle(.segmented)

                Section("Account") {
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                    if mode == .signIn {
                        TextField("Authenticator code (if enabled)", text: $totpCode)
                            .textContentType(.oneTimeCode)
                            .keyboardType(.numberPad)
                    } else {
                        SecureField("Confirm password", text: $confirmPassword)
                            .textContentType(.newPassword)
                        TextField("Your name (optional)", text: $displayName)
                            .textContentType(.name)
                        TextField("Household name (optional)", text: $householdName)
                    }
                }
                Section("Backend") {
                    TextField("API base URL", text: $baseURL, prompt: Text("https://api.example.com"))
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Text("Use your deployed HTTPS API. In a debug build, a physical device can use your Mac’s LAN address; localhost refers to the device itself.")
                        .font(.footnote)
                }
                if let error = formError ?? store.authError {
                    Section { Text(error).foregroundStyle(Caesar.wineGlow) }
                }
            }
            .navigationTitle(mode.rawValue)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(mode.rawValue) { submit() }
                        .disabled(email.isEmpty || password.isEmpty || submitting)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .onAppear { if baseURL.isEmpty { baseURL = store.apiBaseURL } }
    }

    private func submit() {
        formError = nil
        guard mode == .signIn || password == confirmPassword else {
            formError = "Passwords do not match."
            return
        }
        submitting = true
        Task {
            if mode == .signIn {
                await store.signIn(
                    email: email,
                    password: password,
                    totpCode: totpCode.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
                    baseURL: baseURL
                )
            } else {
                await store.signup(
                    email: email,
                    password: password,
                    displayName: displayName.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
                    householdName: householdName.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
                    baseURL: baseURL
                )
            }
            submitting = false
            if store.isSignedIn { dismiss() }
        }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
