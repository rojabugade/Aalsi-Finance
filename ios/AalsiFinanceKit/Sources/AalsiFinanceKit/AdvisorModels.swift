import Foundation

// MARK: - Analyst chat

public struct AnalystAskRequest: Encodable, Sendable {
    public let mode: String
    public let question: String
    public let threadId: String?
    public let page: String?

    public init(mode: String = "explain", question: String, threadId: String? = nil, page: String? = nil) {
        self.mode = mode
        self.question = question
        self.threadId = threadId
        self.page = page
    }
}

public struct AnalystAction: Decodable, Hashable, Sendable {
    public let type: String
    public let label: String
}

public struct AnalystAskResponse: Decodable, Sendable {
    public let answer: String
    public let suggestions: [AnalystAction]
    public let available: Bool
    public let threadId: String?
}

public struct AnalystThreadMessage: Decodable, Hashable, Sendable {
    public let role: String
    public let text: String

    public init(role: String, text: String) {
        self.role = role
        self.text = text
    }

    public var isUser: Bool { role == "user" }
}

public struct AnalystThreadOut: Decodable, Sendable {
    public let messages: [AnalystThreadMessage]
}

// MARK: - Guidance plan

public struct GuidancePlanItem: Decodable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public let domain: String
    public let title: String
    public let rationale: String?
    public let status: String
    public let dueDate: Date?
    public let createdAt: Date
    public let updatedAt: Date

    public var isOpen: Bool { status == "open" }
    public var isCompleted: Bool { status == "completed" }
}

public struct PlanItemStatusPatch: Encodable, Sendable {
    public let status: String

    public init(status: String) {
        self.status = status
    }
}

// MARK: - Cross-border

public struct CrossBorderTransfer: Decodable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public let direction: String
    public let fromCurrency: String
    public let toCurrency: String
    public let amount: Money
    public let fxRate: Money
    public let purpose: String?
    public let channel: String?
    public let transferDate: Date?
}

public struct CrossBorderCorridorTotal: Decodable, Hashable, Sendable {
    public let fromCurrency: String
    public let toCurrency: String
    public let amount: Money
}

/// A limit parsed out of the guidance corpus; loosely shaped upstream, so
/// everything beyond the display essentials is optional.
public struct CrossBorderLimit: Decodable, Hashable, Sendable {
    public let title: String?
    public let currency: String?
    public let amount: Money?
}

public struct CrossBorderLimitWarning: Decodable, Hashable, Sendable {
    public let message: String
    public let ratio: Money?
    public let limitTitle: String?
}

public struct CrossBorderLimits: Decodable, Sendable {
    public let totals: [CrossBorderCorridorTotal]
    public let limits: [CrossBorderLimit]
    public let warnings: [CrossBorderLimitWarning]
}

public struct GuidanceChecklistDoc: Decodable, Hashable, Sendable {
    public let title: String
    public let country: String?
    public let topic: String?
    public let sourceType: String?
    public let sourceUrl: String?
    public let effectiveDate: Date?
}

public struct CrossBorderChecklist: Decodable, Sendable {
    public let checklist: [GuidanceChecklistDoc]
    public let disclaimer: String
}

// MARK: - Analyst memory

public struct MemorySourceStatus: Decodable, Hashable, Sendable {
    public let sourceType: String
    public let count: Int
    public let lastIndexed: Date?
}

public struct MemoryStatus: Decodable, Sendable {
    public let sources: [MemorySourceStatus]
    public let lastSynced: Date?
}
