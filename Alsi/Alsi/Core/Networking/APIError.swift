import Foundation

enum FinanceAPIError: LocalizedError, Equatable {
    case invalidBaseURL
    case unauthorized
    case badStatus(Int)
    case emptyResponse

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL: "Invalid API URL"
        case .unauthorized: "Session required"
        case .badStatus(let s): "Backend returned \(s)"
        case .emptyResponse: "Backend returned an empty response"
        }
    }
}
