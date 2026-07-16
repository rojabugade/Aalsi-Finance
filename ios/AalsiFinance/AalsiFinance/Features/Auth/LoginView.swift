import SwiftUI
import AalsiFinanceKit

/// Signed-out experience: a welcome tour on first launch, then dedicated
/// sign-in / create-account screens pushed on one stack. No sheets, no
/// bottom popups — everything is a full navigation destination.
struct AuthFlowView: View {
    private enum AuthRoute: Hashable {
        case signIn
        case signUp
        case server
    }

    @AppStorage("onboarding.hasSeenWelcome") private var hasSeenWelcome = false
    @State private var path: [AuthRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if hasSeenWelcome {
                    SignInScreen(
                        onCreateAccount: { path.append(.signUp) },
                        onServer: { path.append(.server) },
                        onShowTour: { hasSeenWelcome = false }
                    )
                } else {
                    WelcomeScreen(
                        onSignIn: {
                            hasSeenWelcome = true
                            path.append(.signIn)
                        },
                        onCreateAccount: {
                            hasSeenWelcome = true
                            path.append(.signUp)
                        }
                    )
                }
            }
            .navigationDestination(for: AuthRoute.self) { route in
                switch route {
                case .signIn:
                    SignInScreen(
                        onCreateAccount: { path.append(.signUp) },
                        onServer: { path.append(.server) },
                        onShowTour: nil
                    )
                case .signUp:
                    SignUpScreen(onServer: { path.append(.server) })
                case .server:
                    ServerSetupScreen()
                }
            }
        }
    }
}

// MARK: - Welcome tour

private struct WelcomeScreen: View {
    let onSignIn: () -> Void
    let onCreateAccount: () -> Void

    @Environment(AppTheme.self) private var theme
    @State private var page = 0

    private struct Slide {
        let icon: String
        let title: String
        let detail: String
    }

    private static let slides = [
        Slide(
            icon: "chart.pie.fill",
            title: "All your money,\none place",
            detail: "Spending, budgets, debt payoff, cards, and investments — synced from your bank or added by hand."
        ),
        Slide(
            icon: "lock.shield.fill",
            title: "Yours.\nActually yours.",
            detail: "Aalsi runs on your own server. Your transactions never touch anyone else's cloud."
        ),
        Slide(
            icon: "sparkles",
            title: "An advisor that\nknows the numbers",
            detail: "Daily briefs, payoff plans, and answers grounded in your real data — not generic tips."
        ),
    ]

    var body: some View {
        VStack(spacing: 0) {
            TabView(selection: $page) {
                ForEach(Array(Self.slides.enumerated()), id: \.offset) { index, slide in
                    VStack(spacing: 24) {
                        Image(systemName: slide.icon)
                            .font(.system(size: 44, weight: .medium))
                            .foregroundStyle(theme.accentColor.gradient)
                            .frame(width: 108, height: 108)
                            .glassEffect(.regular.tint(theme.accentColor.opacity(0.15)), in: .rect(cornerRadius: 32))

                        Text(slide.title)
                            .font(.system(size: 34, weight: .bold))
                            .fontDesign(.rounded)
                            .multilineTextAlignment(.center)

                        Text(slide.detail)
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 36)
                    }
                    .tag(index)
                    .padding(.bottom, 40)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .always))
            .indexViewStyle(.page(backgroundDisplayMode: .never))

            VStack(spacing: 12) {
                Button {
                    onSignIn()
                } label: {
                    Text("Sign In")
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)

                Button("Create an account", action: onCreateAccount)
                    .buttonStyle(.glass)
                    .controlSize(.large)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 16)
        }
        .background(AuthBackdrop())
    }
}

// MARK: - Sign in

private struct SignInScreen: View {
    let onCreateAccount: () -> Void
    let onServer: () -> Void
    let onShowTour: (() -> Void)?

    @Environment(AppSession.self) private var session
    @Environment(AppTheme.self) private var theme

    @State private var email = ""
    @State private var password = ""
    @State private var totpCode = ""
    @State private var needsTotp = false
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @FocusState private var focusedField: Field?

    private enum Field { case email, password, totp }

    private var canSubmit: Bool {
        !email.isEmpty && !password.isEmpty && !isSubmitting && (!needsTotp || !totpCode.isEmpty)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Welcome back")
                        .font(.largeTitle.weight(.bold))
                        .fontDesign(.rounded)
                    Text("Sign in to your household.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 24)

                VStack(spacing: 12) {
                    AuthField(
                        "Email",
                        text: $email,
                        error: errorMessage != nil && email.isEmpty
                    )
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focusedField, equals: .email)
                    .submitLabel(.next)
                    .onSubmit { focusedField = .password }

                    AuthSecureField("Password", text: $password)
                        .textContentType(.password)
                        .focused($focusedField, equals: .password)
                        .submitLabel(needsTotp ? .next : .go)
                        .onSubmit {
                            if needsTotp {
                                focusedField = .totp
                            } else if canSubmit {
                                submit()
                            }
                        }

                    if needsTotp {
                        AuthField("6-digit authenticator code", text: $totpCode)
                            .keyboardType(.numberPad)
                            .textContentType(.oneTimeCode)
                            .focused($focusedField, equals: .totp)
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }
                }

                if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button(action: submit) {
                    Group {
                        if isSubmitting {
                            ProgressView().tint(.white)
                        } else {
                            Text("Sign In").fontWeight(.semibold)
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .disabled(!canSubmit)

                HStack {
                    Button("Create an account", action: onCreateAccount)
                    Spacer()
                    if let onShowTour {
                        Button("Take the tour", action: onShowTour)
                    }
                }
                .font(.subheadline.weight(.medium))
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: 440)
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(AuthBackdrop())
        .navigationTitle("Sign In")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    onServer()
                } label: {
                    Image(systemName: "server.rack")
                }
                .accessibilityLabel("Server settings")
            }
        }
    }

    private func submit() {
        errorMessage = nil
        isSubmitting = true
        Task {
            do {
                try await session.signIn(
                    email: email.trimmingCharacters(in: .whitespaces),
                    password: password,
                    totpCode: totpCode.isEmpty ? nil : totpCode
                )
            } catch {
                let message = error.localizedDescription
                // The backend rejects password-only logins on MFA accounts;
                // surface the code field instead of a dead-end error.
                if !needsTotp, message.localizedCaseInsensitiveContains("totp")
                    || message.localizedCaseInsensitiveContains("mfa")
                    || message.localizedCaseInsensitiveContains("two-factor") {
                    withAnimation(.snappy) { needsTotp = true }
                    focusedField = .totp
                    errorMessage = "Enter the 6-digit code from your authenticator app."
                } else {
                    errorMessage = message
                }
            }
            isSubmitting = false
        }
    }
}

// MARK: - Sign up

private struct SignUpScreen: View {
    let onServer: () -> Void

    @Environment(AppSession.self) private var session

    @State private var email = ""
    @State private var password = ""
    @State private var displayName = ""
    @State private var householdName = ""
    @State private var baseCurrency = "USD"
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private static let currencies = ["USD", "EUR", "GBP", "INR", "CAD", "AUD", "JPY", "SGD", "AED"]

    private var canSubmit: Bool {
        !email.isEmpty && password.count >= 8 && !isSubmitting
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Create your household")
                        .font(.largeTitle.weight(.bold))
                        .fontDesign(.rounded)
                    Text("One account runs the whole household — invite others later.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 24)

                VStack(spacing: 12) {
                    AuthField("Email", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                    AuthSecureField("Password (8+ characters)", text: $password)
                        .textContentType(.newPassword)

                    AuthField("Your name (optional)", text: $displayName)
                        .textContentType(.name)

                    AuthField("Household name (optional)", text: $householdName)

                    HStack {
                        Text("Base currency")
                            .foregroundStyle(.secondary)
                        Spacer()
                        Picker("Base currency", selection: $baseCurrency) {
                            ForEach(Self.currencies, id: \.self) { Text($0).tag($0) }
                        }
                        .pickerStyle(.menu)
                    }
                    .padding(14)
                    .background(Color(.systemBackground).opacity(0.6), in: .rect(cornerRadius: 14))
                }

                if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button(action: submit) {
                    Group {
                        if isSubmitting {
                            ProgressView().tint(.white)
                        } else {
                            Text("Create Account").fontWeight(.semibold)
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .disabled(!canSubmit)
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: 440)
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(AuthBackdrop())
        .navigationTitle("Create Account")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    onServer()
                } label: {
                    Image(systemName: "server.rack")
                }
                .accessibilityLabel("Server settings")
            }
        }
    }

    private func submit() {
        errorMessage = nil
        isSubmitting = true
        Task {
            do {
                try await session.signUp(
                    email: email.trimmingCharacters(in: .whitespaces),
                    password: password,
                    displayName: displayName.isEmpty ? nil : displayName,
                    householdName: householdName.isEmpty ? nil : householdName,
                    baseCurrency: baseCurrency
                )
            } catch {
                errorMessage = error.localizedDescription
            }
            isSubmitting = false
        }
    }
}

// MARK: - Server setup

private struct ServerSetupScreen: View {
    @State private var serverURL = ServerConfig.urlString
    @State private var savedConfirmation = false

    var body: some View {
        Form {
            Section {
                TextField("http://localhost:8000", text: $serverURL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } header: {
                Text("Backend URL")
            } footer: {
                Text("The address of your self-hosted Aalsi server. Sign-in and all data go here — nowhere else.")
            }

            Section {
                Button("Save") {
                    ServerConfig.urlString = serverURL
                    serverURL = ServerConfig.urlString
                    savedConfirmation = true
                }
            }

            if savedConfirmation {
                Section {
                    Label("Server saved", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                }
            }
        }
        .navigationTitle("Server")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Shared bits

private struct AuthBackdrop: View {
    @Environment(AppTheme.self) private var theme

    var body: some View {
        LinearGradient(
            colors: [
                theme.accentColor.opacity(0.30),
                Color(.systemBackground),
                Color(.systemBackground),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .ignoresSafeArea()
    }
}

private struct AuthField: View {
    let placeholder: String
    @Binding var text: String
    var error = false

    init(_ placeholder: String, text: Binding<String>, error: Bool = false) {
        self.placeholder = placeholder
        _text = text
        self.error = error
    }

    var body: some View {
        TextField(placeholder, text: $text)
            .padding(14)
            .background(Color(.systemBackground).opacity(0.6), in: .rect(cornerRadius: 14))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(error ? Color.red.opacity(0.6) : .clear, lineWidth: 1)
            )
    }
}

private struct AuthSecureField: View {
    let placeholder: String
    @Binding var text: String
    @State private var isRevealed = false

    init(_ placeholder: String, text: Binding<String>) {
        self.placeholder = placeholder
        _text = text
    }

    var body: some View {
        HStack {
            Group {
                if isRevealed {
                    TextField(placeholder, text: $text)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } else {
                    SecureField(placeholder, text: $text)
                }
            }
            Button {
                isRevealed.toggle()
            } label: {
                Image(systemName: isRevealed ? "eye.slash" : "eye")
                    .foregroundStyle(.secondary)
            }
            .accessibilityLabel(isRevealed ? "Hide password" : "Show password")
        }
        .padding(14)
        .background(Color(.systemBackground).opacity(0.6), in: .rect(cornerRadius: 14))
    }
}
