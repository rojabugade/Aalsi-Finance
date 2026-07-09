import SwiftUI

struct SignInSheet: View {
    let store: FinanceStore
    @Environment(\.dismiss) private var dismiss

    @State private var email = ""
    @State private var password = ""
    @State private var baseURL = ""
    @State private var submitting = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Account") {
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                }
                Section("Backend") {
                    TextField("API base URL", text: $baseURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                if let error = store.authError {
                    Section { Text(error).foregroundStyle(Caesar.wineGlow) }
                }
            }
            .navigationTitle("Sign in")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Sign in") { submit() }
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
        submitting = true
        Task {
            await store.signIn(email: email, password: password, baseURL: baseURL)
            submitting = false
            if store.isSignedIn { dismiss() }
        }
    }
}
