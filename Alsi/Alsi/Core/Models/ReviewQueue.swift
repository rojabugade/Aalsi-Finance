import Foundation

struct ReviewItem: Decodable, Identifiable {
    var id: String { documentId }
    let documentId: String
    let type: String
    let status: String
    let confidence: Double?
    let reasons: [String]
    let batchId: String?

    enum CodingKeys: String, CodingKey {
        case documentId = "document_id"
        case type, status, confidence, reasons
        case batchId = "batch_id"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        documentId = try c.decode(String.self, forKey: .documentId)
        type = try c.decode(String.self, forKey: .type)
        status = try c.decode(String.self, forKey: .status)
        confidence = try c.decodeIfPresent(Double.self, forKey: .confidence)
        reasons = (try? c.decode([String].self, forKey: .reasons)) ?? []
        batchId = try c.decodeIfPresent(String.self, forKey: .batchId)
    }
}

struct ReviewGroup: Decodable, Identifiable {
    var id: String { memberDocumentIds.joined(separator: ":") }
    let memberDocumentIds: [String]
    let suggested: ReviewItem
    let members: [ReviewItem]

    enum CodingKeys: String, CodingKey {
        case memberDocumentIds = "member_document_ids"
        case suggested, members
    }
}

struct ReviewQueue: Decodable {
    static let empty = ReviewQueue(groups: [], items: [])
    let groups: [ReviewGroup]
    let items: [ReviewItem]

    var pendingCount: Int {
        groups.reduce(0) { $0 + max(1, $1.memberDocumentIds.count) } + items.count
    }
}
