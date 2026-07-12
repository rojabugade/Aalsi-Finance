import Foundation

public enum SpendingPill: Int, CaseIterable, Hashable, Sendable {
    case overview
    case activity
    case recurring
}

public enum SpendingRoute: Hashable, Sendable {
    case category(UUID)
    /// The normalized merchant key produced by `SpendDerivation` rows.
    case merchant(String)
    case transaction(UUID)
}

public struct TransactionEditorDraft: Hashable, Sendable {
    public var amount: String
    public var direction: TransactionDirection
    public var merchant: String
    public var currency: String
    public var date: Date
    public var categoryId: UUID?
    public var status: String
    public var notes: String

    public init(
        amount: String,
        direction: TransactionDirection,
        merchant: String,
        currency: String = "USD",
        date: Date = .now,
        categoryId: UUID? = nil,
        status: String = "draft",
        notes: String = ""
    ) {
        self.amount = amount
        self.direction = direction
        self.merchant = merchant
        self.currency = currency
        self.date = date
        self.categoryId = categoryId
        self.status = status
        self.notes = notes
    }
}

/// Immutable raw data from Spending's three server resources.
///
/// Totals, rows, and filters stay computed so every consumer uses the same
/// `SpendDerivation` rules rather than retaining parallel derived copies.
public struct SpendingSnapshot: Hashable, Sendable {
    public let transactions: [Transaction]
    public let categories: [Category]
    public let canonicalRecurring: [RecurringSeries]

    public init(
        transactions: [Transaction],
        categories: [Category],
        canonicalRecurring: [RecurringSeries]
    ) {
        self.transactions = transactions
        self.categories = categories
        self.canonicalRecurring = canonicalRecurring
    }

    public func categoryPath(for categoryID: UUID?) -> CategoryPath {
        SpendDerivation.categoryPath(for: categoryID, categories: categories)
    }

    public func filteredTransactions(
        period: SpendPeriod,
        filter: SpendFilter
    ) -> [Transaction] {
        SpendDerivation.filter(
            transactions,
            categories: categories,
            period: period,
            filter: filter,
            recurringMerchantKeys: recurringMerchantKeys
        )
    }

    public func overview(period: SpendPeriod) -> SpendOverview {
        SpendDerivation.overview(
            transactions: transactions,
            categories: categories,
            period: period
        )
    }

    public func categoryRows(period: SpendPeriod) -> [CategorySpendRow] {
        SpendDerivation.categoryRows(
            transactions: transactions,
            categories: categories,
            period: period
        )
    }

    public func merchantRows(period: SpendPeriod) -> [MerchantSpendRow] {
        SpendDerivation.merchantRows(
            transactions: transactions,
            categories: categories,
            period: period,
            recurringMerchantKeys: recurringMerchantKeys
        )
    }

    public func itemRows(period: SpendPeriod) -> [ItemSpendRow] {
        SpendDerivation.itemRows(
            transactions: transactions,
            categories: categories,
            period: period
        )
    }

    public var recurringRows: [RecurringSpendRow] {
        SpendDerivation.recurringRows(
            transactions: transactions,
            categories: categories,
            canonical: canonicalRecurring
        )
    }

    public func recurringMonthlyTotal(currency: String) -> Money {
        SpendDerivation.recurringMonthlyTotal(recurringRows, currency: currency)
    }

    private var recurringMerchantKeys: Set<String> {
        Set(recurringRows.compactMap(\.merchantKey))
    }
}

public struct SpendingRefreshToken: Hashable, Sendable {
    public let generation: UInt64

    fileprivate init(generation: UInt64) {
        self.generation = generation
    }
}

public struct SpendingState: Sendable {
    public var selectedPill: SpendingPill
    public var monthStart: Date
    public var filter: SpendFilter
    public var navigationPath: [SpendingRoute]
    public var isSelecting: Bool
    public var selectedTransactionIDs: Set<UUID>
    public var editorDraft: TransactionEditorDraft?
    public var splitDraft: [SplitPartRequest]?

    public private(set) var coreSnapshot: SpendingSnapshot?
    public private(set) var isCoreLoading = false
    public private(set) var coreError: String?
    public private(set) var isRecurringLoading = false
    public private(set) var recurringError: String?
    public private(set) var isMutating = false
    public private(set) var mutationError: String?

    private var pendingCanonicalRecurring: [RecurringSeries]?
    private var nextRefreshGeneration: UInt64 = 0
    private var activeCoreRefresh: SpendingRefreshToken?
    private var activeRecurringRefresh: SpendingRefreshToken?

    public init(
        selectedPill: SpendingPill = .overview,
        monthStart: Date = SpendDerivation.period(containing: .now).monthStart,
        filter: SpendFilter = SpendFilter(),
        navigationPath: [SpendingRoute] = [],
        isSelecting: Bool = false,
        selectedTransactionIDs: Set<UUID> = [],
        editorDraft: TransactionEditorDraft? = nil,
        splitDraft: [SplitPartRequest]? = nil
    ) {
        self.selectedPill = selectedPill
        self.monthStart = monthStart
        self.filter = filter
        self.navigationPath = navigationPath
        self.isSelecting = isSelecting
        self.selectedTransactionIDs = selectedTransactionIDs
        self.editorDraft = editorDraft
        self.splitDraft = splitDraft
    }

    public var selectedPillIndex: Int {
        get { selectedPill.rawValue }
        set {
            if let pill = SpendingPill(rawValue: newValue) {
                selectedPill = pill
            }
        }
    }

    public var canonicalRecurring: [RecurringSeries] {
        coreSnapshot?.canonicalRecurring ?? pendingCanonicalRecurring ?? []
    }

    public func period(
        now: Date = .now,
        calendar: Calendar = .current
    ) -> SpendPeriod {
        SpendDerivation.period(containing: monthStart, now: now, calendar: calendar)
    }

    @discardableResult
    public mutating func beginRefresh() -> SpendingRefreshToken {
        let token = nextRefreshToken()
        activeCoreRefresh = token
        activeRecurringRefresh = token
        isCoreLoading = true
        isRecurringLoading = true
        return token
    }

    @discardableResult
    public mutating func beginRecurringRefresh() -> SpendingRefreshToken {
        let token = nextRefreshToken()
        activeRecurringRefresh = token
        isRecurringLoading = true
        return token
    }

    public mutating func receiveCore(
        _ snapshot: SpendingSnapshot,
        token: SpendingRefreshToken
    ) {
        guard activeCoreRefresh == token else { return }
        let recurring = pendingCanonicalRecurring
            ?? coreSnapshot?.canonicalRecurring
            ?? snapshot.canonicalRecurring
        coreSnapshot = SpendingSnapshot(
            transactions: snapshot.transactions,
            categories: snapshot.categories,
            canonicalRecurring: recurring
        )
        pendingCanonicalRecurring = nil
        activeCoreRefresh = nil
        isCoreLoading = false
        coreError = nil
    }

    public mutating func receiveCoreFailure(
        _ message: String,
        token: SpendingRefreshToken
    ) {
        guard activeCoreRefresh == token else { return }
        activeCoreRefresh = nil
        isCoreLoading = false
        coreError = message
    }

    public mutating func receiveRecurring(
        _ recurring: [RecurringSeries],
        token: SpendingRefreshToken
    ) {
        guard activeRecurringRefresh == token else { return }
        if let snapshot = coreSnapshot {
            coreSnapshot = SpendingSnapshot(
                transactions: snapshot.transactions,
                categories: snapshot.categories,
                canonicalRecurring: recurring
            )
            pendingCanonicalRecurring = nil
        } else {
            pendingCanonicalRecurring = recurring
        }
        activeRecurringRefresh = nil
        isRecurringLoading = false
        recurringError = nil
    }

    public mutating func receiveRecurringFailure(
        _ message: String,
        token: SpendingRefreshToken
    ) {
        guard activeRecurringRefresh == token else { return }
        activeRecurringRefresh = nil
        isRecurringLoading = false
        recurringError = message
    }

    public mutating func cancelRefresh(token: SpendingRefreshToken) {
        cancelCoreRefresh(token: token)
        cancelRecurringRefresh(token: token)
    }

    public mutating func cancelCoreRefresh(token: SpendingRefreshToken) {
        guard activeCoreRefresh == token else { return }
        activeCoreRefresh = nil
        isCoreLoading = false
    }

    public mutating func cancelRecurringRefresh(token: SpendingRefreshToken) {
        guard activeRecurringRefresh == token else { return }
        activeRecurringRefresh = nil
        isRecurringLoading = false
    }

    public mutating func beginMutation(
        editorDraft: TransactionEditorDraft? = nil,
        splitDraft: [SplitPartRequest]? = nil
    ) {
        if let editorDraft {
            self.editorDraft = editorDraft
        }
        if let splitDraft {
            self.splitDraft = splitDraft
        }
        isMutating = true
        mutationError = nil
    }

    public mutating func receiveCreatedTransaction(_ transaction: Transaction) {
        let snapshot = coreSnapshot ?? SpendingSnapshot(
            transactions: [],
            categories: [],
            canonicalRecurring: canonicalRecurring
        )
        let existing = snapshot.transactions.filter { $0.id != transaction.id }
        coreSnapshot = SpendingSnapshot(
            transactions: [transaction] + existing,
            categories: snapshot.categories,
            canonicalRecurring: snapshot.canonicalRecurring
        )
        pendingCanonicalRecurring = nil
    }

    public mutating func receiveMutationSuccess() {
        isMutating = false
        mutationError = nil
    }

    public mutating func receiveEditorMutationSuccess() {
        receiveMutationSuccess()
        editorDraft = nil
    }

    public mutating func receiveSplitMutationSuccess() {
        receiveMutationSuccess()
        splitDraft = nil
    }

    @discardableResult
    public mutating func beginMerge(ids: [UUID]) -> Bool {
        guard SpendDerivation.mergeIsEligible(ids) else {
            isMutating = false
            mutationError = "Select at least two transactions to merge."
            return false
        }
        beginMutation()
        return true
    }

    @discardableResult
    public mutating func beginSplit(
        source: Money,
        parts: [SplitPartRequest]
    ) -> Bool {
        guard SpendDerivation.splitIsBalanced(
            source: source,
            parts: parts.map(\.amount)
        ) else {
            receiveMutationFailure(
                "Split amounts must equal the source transaction.",
                splitDraft: parts
            )
            return false
        }
        beginMutation(splitDraft: parts)
        return true
    }

    public mutating func receiveMutationFailure(
        _ message: String,
        editorDraft: TransactionEditorDraft? = nil,
        splitDraft: [SplitPartRequest]? = nil
    ) {
        if let editorDraft {
            self.editorDraft = editorDraft
        }
        if let splitDraft {
            self.splitDraft = splitDraft
        }
        isMutating = false
        mutationError = message
    }

    private mutating func nextRefreshToken() -> SpendingRefreshToken {
        nextRefreshGeneration += 1
        return SpendingRefreshToken(generation: nextRefreshGeneration)
    }
}
