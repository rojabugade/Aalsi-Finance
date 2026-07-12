import SwiftUI
import AalsiFinanceKit

struct LoginView: View {
    private enum Mode: String, CaseIterable, Identifiable {
        case signIn = "Sign In"
        case signUp = "Create Account"
        var id: String { rawValue }
    }

    @Environment(AppSession.self) private var session

    @State private var mode: Mode = .signIn
    @State private var email = ""
    @State private var password = ""
    @State private var totpCode = ""
    @State private var displayName = ""
    @State private var householdName = ""
    @State private var baseCurrency = "USD"
    @State private var serverURL = ServerConfig.urlString
    @State private var showServerField = false
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            backdrop

            ScrollView {
                VStack(spacing: 24) {
                    header

                    GlassEffectContainer(spacing: 20) {
                        VStack(spacing: 16) {
                            Picker("Mode", selection: $mode) {
                                ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
                            }
                            .pickerStyle(.segmented)

                            fields

                            if let errorMessage {
                                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                                    .font(.footnote)
                                    .foregroundStyle(.red)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }

                            Button(action: submit) {
                                if isSubmitting {
                                    ProgressView().tint(.white)
                                } else {
                                    Text(mode == .signIn ? "Sign In" : "Create Account")
                                        .fontWeight(.semibold)
                                        .frame(maxWidth: .infinity)
                                }
                            }
                            .buttonStyle(.glassProminent)
                            .controlSize(.large)
                            .tint(.indigo)
                            .disabled(isSubmitting || email.isEmpty || password.isEmpty)
                        }
                        .padding(24)
                        .glassEffect(.regular, in: .rect(cornerRadius: 32))
                    }

                    serverSection
                }
                .padding(20)
                .frame(maxWidth: 440)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
    }

    private var header: some View {
        VStack(spacing: 10) {
            Image(systemName: "creditcard.fill")
                .font(.system(size: 44, weight: .medium))
                .foregroundStyle(.indigo.gradient)
                .padding(22)
                .glassEffect(.regular.interactive(), in: .circle)

            Text("Aalsi Finance")
                .font(.largeTitle.weight(.bold))
                .fontDesign(.rounded)

            Text("Private, AI-assisted money — on your own server.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 48)
    }

    @ViewBuilder
    private var fields: some View {
        VStack(spacing: 12) {
            TextField("Email", text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .authFieldStyle()

            SecureField("Password", text: $password)
                .textContentType(mode == .signIn ? .password : .newPassword)
                .authFieldStyle()

            if mode == .signIn {
                TextField("2FA code (if enabled)", text: $totpCode)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .authFieldStyle()
            } else {
                TextField("Display name (optional)", text: $displayName)
                    .textContentType(.name)
                    .authFieldStyle()
                TextField("Household name (optional)", text: $householdName)
                    .authFieldStyle()
                TextField("Base currency", text: $baseCurrency)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .authFieldStyle()
            }
        }
    }

    private var serverSection: some View {
        VStack(spacing: 10) {
            Button {
                withAnimation(.smooth) { showServerField.toggle() }
            } label: {
                Label(showServerField ? serverURL : "Server: \(serverURL)", systemImage: "server.rack")
                    .font(.footnote)
                    .lineLimit(1)
            }
            .buttonStyle(.glass)

            if showServerField {
                TextField("http://localhost:8000", text: $serverURL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .authFieldStyle()
                    .onSubmit { ServerConfig.urlString = serverURL; serverURL = ServerConfig.urlString }
            }
        }
        .padding(.bottom, 32)
    }

    private var backdrop: some View {
        LinearGradient(
            colors: [Color.indigo.opacity(0.35), Color(.systemBackground), Color.teal.opacity(0.25)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .ignoresSafeArea()
    }

    private func submit() {
        ServerConfig.urlString = serverURL
        errorMessage = nil
        isSubmitting = true
        let mode = mode
        Task {
            defer { isSubmitting = false }
            do {
                switch mode {
                case .signIn:
                    try await session.signIn(
                        email: email.trimmingCharacters(in: .whitespaces),
                        password: password,
                        totpCode: totpCode.isEmpty ? nil : totpCode
                    )
                case .signUp:
                    try await session.signUp(
                        email: email.trimmingCharacters(in: .whitespaces),
                        password: password,
                        displayName: displayName.isEmpty ? nil : displayName,
                        householdName: householdName.isEmpty ? nil : householdName,
                        baseCurrency: baseCurrency.isEmpty ? "USD" : baseCurrency.uppercased()
                    )
                }
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

private struct AuthFieldStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(14)
            .background(Color(.systemBackground).opacity(0.6), in: .rect(cornerRadius: 14))
    }
}

private extension View {
    func authFieldStyle() -> some View { modifier(AuthFieldStyle()) }
}
