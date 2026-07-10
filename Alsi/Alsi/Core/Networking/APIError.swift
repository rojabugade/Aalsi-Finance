import Foundation

enum FinanceAPIError: LocalizedError, Equatable {
    case invalidBaseURL
    case unauthorized
    case badStatus(Int, String?)
    case emptyResponse
    case requestFailed(URLError.Code)

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL:
            "Enter a complete API URL, such as https://api.example.com."
        case .unauthorized: "Session required"
        case .badStatus(let status, let message):
            message ?? "Backend returned \(status)"
        case .emptyResponse: "Backend returned an empty response"
        case .requestFailed(let code):
            switch code {
            case .cannotFindHost, .cannotConnectToHost, .networkConnectionLost, .notConnectedToInternet:
                "Couldn’t reach the backend. On a physical device, localhost is the phone—not your Mac. Use your deployed HTTPS URL or your Mac’s LAN address in a debug build."
            case .appTransportSecurityRequiresSecureConnection:
                "iOS blocked this HTTP connection. Use HTTPS, or run a debug build when connecting to a local development backend."
            default:
                "Couldn’t reach the backend (\(code.rawValue))."
            }
        }
    }
}
