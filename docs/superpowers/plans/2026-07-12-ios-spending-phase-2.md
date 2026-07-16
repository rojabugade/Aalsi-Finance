# iOS Spending Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the basic iOS Activity screen with an Overview · Activity · Recurring Spending experience that has mobile-native functional parity with the web Spend workflow.

**Architecture:** Typed transaction contracts and pure spend derivations live in `AalsiFinanceKit`; the app's `APIClient` owns HTTP verbs and endpoint calls; one `SpendingViewModel` owns the shared snapshot and retained UI state. Focused SwiftUI views render Overview, the unified Activity scroll and drills, transaction lifecycle sheets, bulk merge/export, and Recurring, then `MainTabView` switches to the new root only after every slice builds.

**Tech Stack:** Swift 6, SwiftUI, Swift Charts, Observation, swift-testing (`import Testing`), `AalsiFinanceKit`, FastAPI JSON contracts, iOS share sheet.

## Global Constraints

- Design source: `docs/superpowers/specs/2026-07-12-ios-spending-phase-2-design.md`.
- Deployment target is iOS 26.0 and `SWIFT_VERSION = 6.0`.
- `ios/AalsiFinance/AalsiFinance.xcodeproj` uses `PBXFileSystemSynchronizedRootGroup`; new Swift files under `ios/AalsiFinance/AalsiFinance/` are discovered automatically. Do not add source-file references to the pbxproj.
- Keep all pure, deterministic spend logic in `ios/AalsiFinanceKit`; SwiftUI files consume view models and do not reimplement sign, category, period, or filter rules.
- Backend `Decimal` values encode as JSON strings; datetimes can be naive; dates are `yyyy-MM-dd`; keys are snake_case through `JSONEncoder.api()` / `JSONDecoder.api()`.
- Negative categorized outflows count as positive spend; positive income/transfers do not; refund-flagged inflows reduce category spend.
- No payment or transfer execution actions are added. This feature records and analyzes transactions only.
- All accent colors come from `AppTheme`; semantic positive/negative/warning colors remain fixed.
- All money output uses `MoneyText`, `Money.formatted`, or `Money.compact` with monospaced digits.
- Preserve unrelated user changes in the dirty worktree. Stage only files named by the current task.
- Demo credentials: `ios.demo@example.com` / `ios-demo-pass-1`.
- Simulator: iPhone 17 Pro, UDID `349C5D38-C407-47AA-81CF-CF6688BD4B30`.
- Package test command: `swift test --package-path ios/AalsiFinanceKit`.
- App build command: `xcodebuild -project ios/AalsiFinance/AalsiFinance.xcodeproj -scheme AalsiFinance -destination 'platform=iOS Simulator,id=349C5D38-C407-47AA-81CF-CF6688BD4B30' build`.
- Every implementation task follows red → green → full package/build verification → focused Conventional Commit.

---

## File map

### `AalsiFinanceKit`

- `Models.swift`: widen transaction and line-item response contracts.
- `TransactionRequests.swift`: create, patch, split, and merge request payloads.
- `SpendTypes.swift`: periods, filters, rows, insights, recurring rows, and feature state.
- `SpendDerivation.swift`: sign classification, ranges, hierarchy, filters, summaries, items, recurring, and validation.
- `SpendingState.swift`: reducer-style retained state used by the app view model.
- Matching test files under `Tests/AalsiFinanceKitTests/`.

### iOS app

- `Networking/APIClient.swift`: PATCH/DELETE support and transaction lifecycle endpoints.
- `Features/Spending/SpendingViewModel.swift`: shared loading/mutation adapter.
- `Features/Spending/SpendingView.swift`: feature root, pills, typed navigation, sheets.
- `Features/Spending/SpendingOverview.swift`: month pulse and deterministic insight.
- `Features/Spending/SpendingActivity.swift`: unified summaries, filters, and ledger.
- `Features/Spending/SpendDrillViews.swift`: category/subcategory and merchant detail.
- `Features/Spending/SpendFilterSheet.swift`: native filter editing.
- `Features/Spending/TransactionEditorView.swift`: create/edit/detail fields.
- `Features/Spending/TransactionSplitView.swift`: balanced parts editor.
- `Features/Spending/SpendingRecurring.swift`: canonical and inferred recurring rows.
- `Features/Spending/SpendExport.swift`: deterministic CSV and share-sheet item.
- `Features/Activity/TransactionRow.swift`: theme-aware signed row reused by Home and Spending.
- `App/MainTabView.swift`: final switch from `ActivityView` to `SpendingView`.

---

### Task 1: Complete transaction response and request contracts

**Files:**
- Modify: `ios/AalsiFinanceKit/Sources/AalsiFinanceKit/Models.swift`
- Modify: `ios/AalsiFinanceKit/Sources/AalsiFinanceKit/JSONCoding.swift`
- Create: `ios/AalsiFinanceKit/Sources/AalsiFinanceKit/TransactionRequests.swift`
- Modify: `ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/DecodingTests.swift`
- Create: `ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/TransactionRequestTests.swift`

**Interfaces:**
- Consumes: `Money`, `JSONEncoder.api()`, `JSONDecoder.api()`.
- Produces: `JSONValue`, widened `Transaction` / `LineItem`, public `Category` initializer, `APIDateParser.dateString`, `TransactionDirection`, `TransactionCreateRequest`, `TransactionPatchRequest`, `SplitPartRequest`, `SplitRequest`, `MergeRequest`.

- [ ] **Step 1: Add failing response-decoding tests**

Append tests that decode all parity fields and a refund flag:

```swift
@Test func decodesSpendParityFields() throws {
    let data = Data(#"{"id":"11111111-1111-1111-1111-111111111111","household_id":"22222222-2222-2222-2222-222222222222","account_id":null,"payment_method_id":"33333333-3333-3333-3333-333333333333","recurring_series_id":"44444444-4444-4444-4444-444444444444","owner_user_id":null,"merchant_id":null,"merchant":"Market","amount":"12.00","currency":"USD","base_amount":null,"fx_rate":null,"txn_date":"2026-07-12","category_id":null,"status":"confirmed","source_document_id":null,"source_channel":"manual","is_shared":false,"flags":{"refund":true},"notes":null,"confidence":null,"external_id":null,"created_at":"2026-07-12T10:00:00","line_items":[{"id":"55555555-5555-5555-5555-555555555555","transaction_id":"11111111-1111-1111-1111-111111111111","name":"Milk","amount":"4.00","quantity":"1","item_type_category_id":"66666666-6666-6666-6666-666666666666","confidence":0.9}]}"#.utf8)
    let value = try JSONDecoder.api().decode(Transaction.self, from: data)
    #expect(value.paymentMethodId != nil)
    #expect(value.recurringSeriesId != nil)
    #expect(value.flags?["refund"]?.boolValue == true)
    #expect(value.lineItems.first?.itemTypeCategoryId != nil)
}
```

- [ ] **Step 2: Add failing request-coding tests**

Create `TransactionRequestTests.swift` with exact wire-key assertions:

```swift
import Foundation
import Testing
@testable import AalsiFinanceKit

@Suite struct TransactionRequestTests {
    @Test func createUsesSignedAmountAndSnakeCase() throws {
        let body = TransactionCreateRequest(
            amount: Money(42), direction: .spend, merchant: "Market",
            currency: "USD", txnDate: Date(timeIntervalSince1970: 1_783_814_400),
            categoryId: nil, status: "draft", notes: nil
        )
        let object = try #require(JSONSerialization.jsonObject(with: JSONEncoder.api().encode(body)) as? [String: Any])
        #expect(object["amount"] as? String == "-42")
        #expect(object["source_channel"] as? String == "manual")
        #expect(object["txn_date"] as? String == "2026-07-12")
    }

    @Test func patchEmitsNullForClearedFields() throws {
        let body = TransactionPatchRequest(
            merchant: nil, amount: Money(10), direction: .income, currency: "USD",
            txnDate: Date(timeIntervalSince1970: 1_783_814_400), categoryId: nil,
            status: "confirmed", notes: nil
        )
        let object = try #require(JSONSerialization.jsonObject(with: JSONEncoder.api().encode(body)) as? [String: Any])
        #expect(object["merchant"] is NSNull)
        #expect(object["category_id"] is NSNull)
        #expect(object["notes"] is NSNull)
        #expect(object["amount"] as? String == "10")
    }

    @Test func splitAndMergeUseBackendKeys() throws {
        let category = UUID(uuidString: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")!
        let id1 = UUID(uuidString: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")!
        let id2 = UUID(uuidString: "cccccccc-cccc-cccc-cccc-cccccccccccc")!
        let split = SplitRequest(parts: [.init(amount: Money(-6), categoryId: category), .init(amount: Money(-4), categoryId: nil)])
        let merge = MergeRequest(transactionIds: [id1, id2], notes: nil)
        let splitObject = try #require(JSONSerialization.jsonObject(with: JSONEncoder.api().encode(split)) as? [String: Any])
        let mergeObject = try #require(JSONSerialization.jsonObject(with: JSONEncoder.api().encode(merge)) as? [String: Any])
        #expect((splitObject["parts"] as? [[String: Any]])?.count == 2)
        #expect((mergeObject["transaction_ids"] as? [String])?.count == 2)
    }
}
```

- [ ] **Step 3: Run the focused tests and confirm red**

Run: `swift test --package-path ios/AalsiFinanceKit --filter 'DecodingTests|TransactionRequestTests'`

Expected: FAIL because parity properties and request types do not exist.

- [ ] **Step 4: Implement the response fields and request payloads**

Add `JSONValue` and the optional response fields to `Models.swift`; add explicit `CodingKeys` / `encode(to:)` in `TransactionRequests.swift` so nil patch fields encode as JSON null:

```swift
public enum JSONValue: Codable, Hashable, Sendable {
    case bool(Bool), string(String), number(Decimal), array([JSONValue]), object([String: JSONValue]), null
    public var boolValue: Bool? { if case .bool(let value) = self { value } else { nil } }
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let value = try? c.decode(Bool.self) { self = .bool(value) }
        else if let value = try? c.decode(String.self) { self = .string(value) }
        else if let value = try? c.decode(Decimal.self) { self = .number(value) }
        else if let value = try? c.decode([JSONValue].self) { self = .array(value) }
        else if let value = try? c.decode([String: JSONValue].self) { self = .object(value) }
        else { throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unsupported JSON primitive") }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self { case .bool(let value): try c.encode(value); case .string(let value): try c.encode(value); case .number(let value): try c.encode(value); case .array(let value): try c.encode(value); case .object(let value): try c.encode(value); case .null: try c.encodeNil() }
    }
}

public enum TransactionDirection: String, Codable, CaseIterable, Sendable {
    case spend, income
    public func signed(_ amount: Money) -> Money {
        Money(self == .spend ? -abs(amount.value) : abs(amount.value))
    }
}

public struct TransactionCreateRequest: Encodable, Sendable {
    public let amount: Money
    public let direction: TransactionDirection
    public let merchant: String?
    public let currency: String
    public let txnDate: Date
    public let categoryId: UUID?
    public let status: String
    public let notes: String?
    public init(amount: Money, direction: TransactionDirection, merchant: String?, currency: String, txnDate: Date, categoryId: UUID?, status: String = "draft", notes: String?) {
        self.amount = amount; self.direction = direction; self.merchant = merchant
        self.currency = currency; self.txnDate = txnDate; self.categoryId = categoryId
        self.status = status; self.notes = notes
    }
    enum CodingKeys: String, CodingKey { case amount, merchant, currency, txnDate, categoryId, status, notes, sourceChannel, isShared }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(direction.signed(amount), forKey: .amount)
        try c.encodeIfPresent(merchant, forKey: .merchant)
        try c.encode(currency, forKey: .currency); try c.encode(APIDateParser.dateString(txnDate), forKey: .txnDate)
        try c.encodeIfPresent(categoryId, forKey: .categoryId); try c.encode(status, forKey: .status)
        try c.encodeIfPresent(notes, forKey: .notes); try c.encode("manual", forKey: .sourceChannel)
        try c.encode(false, forKey: .isShared)
    }
}
```

Add `APIDateParser.dateString(_:)` using an `en_US_POSIX`, UTC `DateFormatter` with `yyyy-MM-dd`; both create and patch payloads encode that string rather than Foundation's default numeric `Date`. Implement `TransactionPatchRequest` with the same editable fields and `c.encode(merchant, forKey:)`, `c.encode(categoryId, forKey:)`, and `c.encode(notes, forKey:)` so clearing sends `null`. Implement `SplitPartRequest(amount:categoryId:notes:)`, `SplitRequest(parts:)`, and `MergeRequest(transactionIds:notes:)` as public `Encodable & Sendable` structs. Add an explicit public `Category.init(id:parentId:name:kind:isSystem:)` for package tests and app previews.

- [ ] **Step 5: Run package tests**

Run: `swift test --package-path ios/AalsiFinanceKit`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add ios/AalsiFinanceKit/Sources/AalsiFinanceKit/Models.swift ios/AalsiFinanceKit/Sources/AalsiFinanceKit/JSONCoding.swift ios/AalsiFinanceKit/Sources/AalsiFinanceKit/TransactionRequests.swift ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/DecodingTests.swift ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/TransactionRequestTests.swift
git commit -m "feat(ios): add Spending transaction contracts"
```

---

### Task 2: Add canonical spend classification, periods, hierarchy, and filters

**Files:**
- Create: `ios/AalsiFinanceKit/Sources/AalsiFinanceKit/SpendTypes.swift`
- Create: `ios/AalsiFinanceKit/Sources/AalsiFinanceKit/SpendDerivation.swift`
- Create: `ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/SpendTestFixtures.swift`
- Create: `ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/SpendDerivationTests.swift`

**Interfaces:**
- Consumes: `Transaction`, `Category`, `Money`, `JSONValue`.
- Produces: `SpendPeriod`, `SpendDirectionFilter`, `SpendAmountBand`, `SpendFilter`, `CategoryPath`, `SpendDerivation.classify`, `.period`, `.categoryPath`, `.filter`.

- [ ] **Step 1: Write failing classifier, period, hierarchy, and filter tests**

Create `SpendTestFixtures.swift` first so every spend test exercises real response decoding. Define fixed IDs for `food`, `groceries`, `income`, and `transfer`; expose `categories`; and expose this exact factory (the `lineItemsJSON` argument defaults to `[]` and is inserted as raw JSON):

```swift
import Foundation
@testable import AalsiFinanceKit

enum SpendTestFixtures {
  static let foodID = UUID(uuidString: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")!
  static let groceriesID = UUID(uuidString: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")!
  static let incomeID = UUID(uuidString: "cccccccc-cccc-cccc-cccc-cccccccccccc")!
  static let transferID = UUID(uuidString: "dddddddd-dddd-dddd-dddd-dddddddddddd")!
  static let categories = [
    Category(id: foodID, parentId: nil, name: "Food", kind: "category", isSystem: true),
    Category(id: groceriesID, parentId: foodID, name: "Groceries", kind: "category", isSystem: true),
    Category(id: incomeID, parentId: nil, name: "Income", kind: "income", isSystem: true),
    Category(id: transferID, parentId: nil, name: "Transfers", kind: "transfer", isSystem: true),
  ]
  static var july2026: SpendPeriod {
    let start = APIDateParser.parse("2026-07-01")!
    let end = APIDateParser.parse("2026-07-31T23:59:59")!
    let previousStart = APIDateParser.parse("2026-06-01")!
    let previousEnd = APIDateParser.parse("2026-06-30T23:59:59")!
    return SpendPeriod(monthStart: start, current: .init(start: start, end: end), previous: .init(start: previousStart, end: previousEnd), isCurrentMonth: false)
  }

  static func transaction(_ amount: String, date: String, category: UUID?, merchant: String = "Store", flags: String = "null", notes: String? = nil, lineItemsJSON: String = "[]") throws -> Transaction {
    let categoryJSON = category.map { "\"\($0.uuidString)\"" } ?? "null"
    let notesJSON = notes.map { "\"\($0.replacingOccurrences(of: "\"", with: "\\\""))\"" } ?? "null"
    let json = """
    {"id":"\(UUID())","household_id":"11111111-1111-1111-1111-111111111111","account_id":null,"payment_method_id":null,"recurring_series_id":null,"owner_user_id":null,"merchant_id":null,"merchant":"\(merchant)","amount":"\(amount)","currency":"USD","base_amount":null,"fx_rate":null,"txn_date":"\(date)","category_id":\(categoryJSON),"status":"confirmed","source_document_id":null,"source_channel":"manual","is_shared":false,"flags":\(flags),"notes":\(notesJSON),"confidence":null,"external_id":null,"created_at":"\(date)T12:00:00","line_items":\(lineItemsJSON)}
    """
    return try JSONDecoder.api().decode(Transaction.self, from: Data(json.utf8))
  }
}

@Test func classifiesSpendIncomeTransferAndRefund() throws {
    let f = SpendTestFixtures.self
    #expect(SpendDerivation.classify(try f.transaction("-20", date: "2026-07-10", category: f.groceriesID), categories: f.categories) == .spend(Money(20)))
    #expect(SpendDerivation.classify(try f.transaction("100", date: "2026-07-10", category: f.incomeID), categories: f.categories) == .income(Money(100)))
    #expect(SpendDerivation.classify(try f.transaction("8", date: "2026-07-10", category: f.groceriesID, flags: "{\"refund\":true}"), categories: f.categories) == .refund(Money(8)))
}

@Test func currentMonthUsesComparableElapsedPriorWindow() {
    let now = ISO8601DateFormatter().date(from: "2026-07-12T12:00:00Z")!
    var utcCalendar = Calendar(identifier: .gregorian); utcCalendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let period = SpendDerivation.period(containing: now, now: now, calendar: utcCalendar)
    #expect(utcCalendar.component(.day, from: period.current.end) == 12)
    #expect(utcCalendar.component(.day, from: period.previous.end) == 12)
}

@Test func parentFilterIncludesDescendants() throws {
    let filter = SpendFilter(categoryId: SpendTestFixtures.foodID)
    let childTxn = try SpendTestFixtures.transaction("-20", date: "2026-07-10", category: SpendTestFixtures.groceriesID)
    #expect(SpendDerivation.filter([childTxn], categories: SpendTestFixtures.categories, period: SpendTestFixtures.july2026, filter: filter) == [childTxn])
}
```

- [ ] **Step 2: Run tests and confirm red**

Run: `swift test --package-path ios/AalsiFinanceKit --filter SpendDerivationTests`

Expected: FAIL because spend types and derivations do not exist.

- [ ] **Step 3: Implement the canonical types**

Define exact value types in `SpendTypes.swift`:

```swift
public struct DateWindow: Hashable, Sendable { public let start: Date; public let end: Date }
public struct SpendPeriod: Hashable, Sendable { public let monthStart: Date; public let current: DateWindow; public let previous: DateWindow; public let isCurrentMonth: Bool }
public enum SpendClassification: Hashable, Sendable { case spend(Money), income(Money), transfer(Money), refund(Money), ignored }
public enum SpendDirectionFilter: String, CaseIterable, Sendable { case all, spend, income }
public enum SpendAmountBand: String, CaseIterable, Sendable { case any, under25, from25To100, from100To500, over500 }
public struct SpendFilter: Hashable, Sendable {
    public var query = ""; public var categoryId: UUID?; public var direction: SpendDirectionFilter = .all
    public var amountBand: SpendAmountBand = .any; public var recurringOnly = false; public var status: String?
    public init(query: String = "", categoryId: UUID? = nil, direction: SpendDirectionFilter = .all, amountBand: SpendAmountBand = .any, recurringOnly: Bool = false, status: String? = nil) { self.query = query; self.categoryId = categoryId; self.direction = direction; self.amountBand = amountBand; self.recurringOnly = recurringOnly; self.status = status }
}
public struct CategoryPath: Hashable, Sendable { public let parent: Category?; public let leaf: Category?; public var displayName: String { [parent?.name, leaf?.name].compactMap { $0 }.joined(separator: " › ") } }
```

Every public value type in this file defines an explicit public initializer for all stored properties; do not rely on Swift's internal synthesized memberwise initializer because the app target must construct these values.

- [ ] **Step 4: Implement pure classification, period, hierarchy, and filtering**

Create a stateless `public enum SpendDerivation`. Resolve every category to its top ancestor; treat top categories named/kinded Income and Transfer as non-spend; apply refund before ordinary positive-amount handling. Implement inclusive date filtering, descendant lookup, recurring merchant membership, case-insensitive merchant/notes search, amount bands, direction, and status in one predicate used everywhere.

```swift
public static func filter(_ transactions: [Transaction], categories: [Category], period: SpendPeriod, filter: SpendFilter, recurringMerchantKeys: Set<String> = []) -> [Transaction] {
    transactions.filter { transaction in
        guard period.current.start...period.current.end ~= transaction.txnDate else { return false }
        guard matchesDirection(transaction, categories: categories, direction: filter.direction) else { return false }
        guard matchesCategory(transaction.categoryId, selected: filter.categoryId, categories: categories) else { return false }
        guard matchesAmount(transaction.amount.magnitude.value, band: filter.amountBand) else { return false }
        guard filter.status == nil || transaction.status == filter.status else { return false }
        guard !filter.recurringOnly || recurringMerchantKeys.contains(merchantKey(transaction.merchant)) else { return false }
        let query = filter.query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return query.isEmpty || [transaction.merchant, transaction.notes].compactMap { $0?.lowercased() }.contains { $0.contains(query) }
    }.sorted { ($0.txnDate, $0.createdAt) > ($1.txnDate, $1.createdAt) }
}
```

- [ ] **Step 5: Run all package tests**

Run: `swift test --package-path ios/AalsiFinanceKit`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add ios/AalsiFinanceKit/Sources/AalsiFinanceKit/SpendTypes.swift ios/AalsiFinanceKit/Sources/AalsiFinanceKit/SpendDerivation.swift ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/SpendTestFixtures.swift ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/SpendDerivationTests.swift
git commit -m "feat(ios): add canonical Spending derivations"
```

---

### Task 3: Add overview, drill, item, and recurring intelligence

**Files:**
- Modify: `ios/AalsiFinanceKit/Sources/AalsiFinanceKit/SpendTypes.swift`
- Modify: `ios/AalsiFinanceKit/Sources/AalsiFinanceKit/SpendDerivation.swift`
- Create: `ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/SpendIntelligenceTests.swift`

**Interfaces:**
- Consumes: Task 2 classifier, period, hierarchy, and filters; `RecurringSeries`.
- Produces: `SpendOverview`, `SpendInsight`, `CategorySpendRow`, `MerchantSpendRow`, `ItemSpendRow`, `RecurringSpendRow`, `.overview`, `.categoryRows`, `.merchantRows`, `.itemRows`, `.recurringRows`, `.splitIsBalanced`, `.mergeIsEligible`.

- [ ] **Step 1: Write failing intelligence tests**

Cover partial-month deltas, insight priority, case-insensitive merchant grouping, item aggregation, recurring deduplication, split balance, and merge eligibility:

```swift
@Test func insightPrefersLargestCategoryIncrease() throws {
    let transactions = [
        try SpendTestFixtures.transaction("-100", date: "2026-07-10", category: SpendTestFixtures.groceriesID),
        try SpendTestFixtures.transaction("-60", date: "2026-06-10", category: SpendTestFixtures.groceriesID),
    ]
    let snapshot = SpendDerivation.overview(transactions: transactions, categories: SpendTestFixtures.categories, period: SpendTestFixtures.july2026)
    #expect(snapshot.insight?.kind == .category(SpendTestFixtures.foodID))
    #expect(snapshot.insight?.delta == Money(40))
}

@Test func merchantGroupingIsCaseInsensitive() throws {
    let amazon = try SpendTestFixtures.transaction("-20", date: "2026-07-10", category: SpendTestFixtures.groceriesID, merchant: "Amazon")
    let AMAZON = try SpendTestFixtures.transaction("-30", date: "2026-07-11", category: SpendTestFixtures.groceriesID, merchant: "AMAZON")
    let rows = SpendDerivation.merchantRows(transactions: [amazon, AMAZON], categories: SpendTestFixtures.categories, period: SpendTestFixtures.july2026)
    #expect(rows.count == 1)
    #expect(rows[0].count == 2)
}

@Test func canonicalRecurringSuppressesInferredDuplicate() throws {
    let threeMonthNetflix = try ["2026-05-10", "2026-06-10", "2026-07-10"].map { try SpendTestFixtures.transaction("-15", date: $0, category: SpendTestFixtures.foodID, merchant: "Netflix") }
    let json = #"{"id":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","name":"Netflix","amount":"15","currency":"USD","cadence":"monthly","type":"subscription","status":"active","next_due_date":"2026-08-10","merchant_name":"Netflix","category_name":"Entertainment"}"#
    let netflixSeries = try JSONDecoder.api().decode(RecurringSeries.self, from: Data(json.utf8))
    let rows = SpendDerivation.recurringRows(transactions: threeMonthNetflix, categories: SpendTestFixtures.categories, canonical: [netflixSeries])
    #expect(rows.filter { $0.merchantKey == "netflix" }.count == 1)
    #expect(rows.first?.source == .canonical)
}

@Test func validatesSplitAndMerge() {
    let id1 = UUID(uuidString: "11111111-1111-1111-1111-111111111111")!
    let id2 = UUID(uuidString: "22222222-2222-2222-2222-222222222222")!
    #expect(SpendDerivation.splitIsBalanced(source: Money(-10), parts: [Money(-6), Money(-4)]))
    #expect(!SpendDerivation.splitIsBalanced(source: Money(-10), parts: [Money(-6), Money(-3)]))
    #expect(SpendDerivation.mergeIsEligible([id1, id2]))
    #expect(!SpendDerivation.mergeIsEligible([id1]))
}
```

- [ ] **Step 2: Run tests and confirm red**

Run: `swift test --package-path ios/AalsiFinanceKit --filter SpendIntelligenceTests`

Expected: FAIL because intelligence types and functions do not exist.

- [ ] **Step 3: Implement stable view-model types**

Add public `Hashable & Sendable` structs with nonoptional identifiers and money values. Every struct below must include an explicit public initializer containing every stored property so app previews and later tasks can construct values across the package boundary:

```swift
public struct CategorySpendRow: Identifiable, Hashable, Sendable { public let id: UUID; public let name: String; public let total: Money; public let previous: Money; public let delta: Money; public let share: Double; public let count: Int }
public struct MerchantSpendRow: Identifiable, Hashable, Sendable { public let id: String; public let name: String; public let total: Money; public let previous: Money; public let delta: Money; public let count: Int; public let topCategory: String?; public let isRecurring: Bool }
public struct ItemSpendRow: Identifiable, Hashable, Sendable { public var id: String { name.lowercased() }; public let name: String; public let total: Money; public let quantity: Money? }
public enum SpendInsightKind: Hashable, Sendable { case category(UUID), merchant(String), transaction(UUID), pace }
public struct SpendInsight: Hashable, Sendable { public let kind: SpendInsightKind; public let title: String; public let detail: String; public let delta: Money }
public struct SpendOverview: Hashable, Sendable { public let total: Money; public let previousTotal: Money; public let transactionCount: Int; public let dailyPace: Money; public let cumulativeDaily: [Money]; public let categories: [CategorySpendRow]; public let merchants: [MerchantSpendRow]; public let insight: SpendInsight? }
public enum RecurringSpendSource: Hashable, Sendable { case canonical, inferred }
public struct RecurringSpendRow: Identifiable, Hashable, Sendable { public let id: String; public let name: String; public let amount: Money; public let currency: String; public let cadence: String; public let nextDueDate: Date?; public let merchantKey: String?; public let source: RecurringSpendSource }
```

- [ ] **Step 4: Implement the intelligence functions**

Use `SpendTestFixtures` for transactions and categories; decode canonical `RecurringSeries` fixtures from JSON so no internal memberwise initializer is assumed. Use the Task 2 classifier for every total. Current-period category delta drives insight first, then merchant delta, then largest purchase, then pace. Normalize monthly recurring amounts with exact cadence multipliers: weekly `52/12`, biweekly `26/12`, monthly `1`, quarterly `1/3`, yearly `1/12`; unknown cadence remains displayed but is excluded from the total. Deduplicate canonical and inferred rows by lowercased trimmed merchant key.

- [ ] **Step 5: Run all package tests**

Run: `swift test --package-path ios/AalsiFinanceKit`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add ios/AalsiFinanceKit/Sources/AalsiFinanceKit/SpendTypes.swift ios/AalsiFinanceKit/Sources/AalsiFinanceKit/SpendDerivation.swift ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/SpendIntelligenceTests.swift
git commit -m "feat(ios): add Spending intelligence models"
```

---

### Task 4: Add transaction lifecycle HTTP support

**Files:**
- Modify: `ios/AalsiFinance/AalsiFinance/Networking/APIClient.swift`

**Interfaces:**
- Consumes: Task 1 request/response contracts.
- Produces: generic `patch`, `delete`, and typed `createTransaction`, `patchTransaction`, `splitTransaction`, `mergeTransactions`, `deleteTransaction` methods.

- [ ] **Step 1: Add generic PATCH and no-content request helpers**

Refactor the existing retry logic through a `requestData` helper, then implement:

```swift
func patch<T: Decodable>(_ path: String, body: some Encodable) async throws -> T {
    try await send(path: path, method: "PATCH", query: [], body: encoder.encode(body))
}

func delete(_ path: String) async throws {
    _ = try await requestData(path: path, method: "DELETE", query: [], body: nil)
}
```

`requestData` must perform the same single refresh-and-retry on HTTP 401 as `send`; `send<T>` becomes decode-only around `requestData`. This avoids decoding an empty 204 body.

- [ ] **Step 2: Add typed transaction endpoint methods**

Add exact endpoint helpers and remove the second duplicated `try await get("/recurring-series", ...)` line currently inside `recurringSeries()`:

```swift
func createTransaction(_ body: TransactionCreateRequest) async throws -> AalsiFinanceKit.Transaction { try await post("/transactions", body: body) }
func patchTransaction(id: UUID, body: TransactionPatchRequest) async throws -> AalsiFinanceKit.Transaction { try await patch("/transactions/\(id.uuidString.lowercased())", body: body) }
func splitTransaction(id: UUID, body: SplitRequest) async throws -> [AalsiFinanceKit.Transaction] { try await post("/transactions/\(id.uuidString.lowercased())/split", body: body) }
func mergeTransactions(_ body: MergeRequest) async throws -> AalsiFinanceKit.Transaction { try await post("/transactions/merge", body: body) }
func deleteTransaction(id: UUID) async throws { try await delete("/transactions/\(id.uuidString.lowercased())") }
```

- [ ] **Step 3: Build the app**

Run: `xcodebuild -project ios/AalsiFinance/AalsiFinance.xcodeproj -scheme AalsiFinance -destination 'platform=iOS Simulator,id=349C5D38-C407-47AA-81CF-CF6688BD4B30' build`

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 4: Run package tests**

Run: `swift test --package-path ios/AalsiFinanceKit`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add ios/AalsiFinance/AalsiFinance/Networking/APIClient.swift
git commit -m "feat(ios): add transaction lifecycle API calls"
```

---

### Task 5: Add retained Spending state and the shared view model

**Files:**
- Create: `ios/AalsiFinanceKit/Sources/AalsiFinanceKit/SpendingState.swift`
- Create: `ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/SpendingStateTests.swift`
- Create: `ios/AalsiFinance/AalsiFinance/Features/Spending/SpendingViewModel.swift`

**Interfaces:**
- Consumes: Tasks 1–4 contracts, derivations, and API methods.
- Produces: `SpendingState`, `SpendingSnapshot`, `SpendingViewModel.load`, `.refresh`, create/patch/confirm/split/delete/merge methods, selected pill/month/filter/selection state.

- [ ] **Step 1: Write failing reducer/state tests**

Test that refresh and failures do not erase retained interaction state:

```swift
@Test func refreshPreservesNavigationAndFilters() {
    var state = SpendingState(selectedPill: .activity, monthStart: july, filter: .init(query: "uber"))
    state.navigationPath = [.merchant("Uber")]
    state.beginRefresh()
    state.receiveCore(snapshot)
    #expect(state.selectedPill == .activity)
    #expect(state.filter.query == "uber")
    #expect(state.navigationPath == [.merchant("Uber")])
}

@Test func recurringFailureDoesNotFailCore() {
    var state = SpendingState()
    state.receiveCore(snapshot)
    state.receiveRecurringFailure("offline")
    #expect(state.coreSnapshot != nil)
    #expect(state.recurringError == "offline")
}

@Test func mutationFailureKeepsDraft() {
    var state = SpendingState()
    state.editorDraft = .init(amount: "42", direction: .spend, merchant: "Market")
    state.receiveMutationFailure("offline")
    #expect(state.editorDraft?.merchant == "Market")
}
```

- [ ] **Step 2: Run focused tests and confirm red**

Run: `swift test --package-path ios/AalsiFinanceKit --filter SpendingStateTests`

Expected: FAIL because `SpendingState` does not exist.

- [ ] **Step 3: Implement reducer-style state**

Define `SpendingPill`, typed `SpendingRoute`, `TransactionEditorDraft`, and `SpendingState`. Give `SpendingState` a read/write `selectedPillIndex` computed property mapping `0...2` to the enum so `PillNav` can bind without duplicating selection state. `beginRefresh` sets loading flags only; `receiveCore`, `receiveRecurring`, and failure methods replace data/errors without resetting pill, month, filter, selection, draft, or path. Add `SpendingSnapshot(transactions:categories:canonicalRecurring:)` with derived helpers delegating to `SpendDerivation`.

- [ ] **Step 4: Implement the thin observable adapter**

`SpendingViewModel` owns `var state = SpendingState()` and the app `APIClient`. Its load performs transactions/categories concurrently; recurring loads in a separate `Task` so its failure is isolated:

```swift
@MainActor @Observable final class SpendingViewModel {
    var state = SpendingState()

    func load(api: APIClient, force: Bool = false) async {
        guard force || state.coreSnapshot == nil else { return }
        state.beginRefresh()
        do {
            async let transactions = api.transactions()
            async let categories = api.categories()
            let (loadedTransactions, loadedCategories) = try await (transactions, categories)
            state.receiveCore(.init(transactions: loadedTransactions, categories: loadedCategories, canonicalRecurring: state.canonicalRecurring))
        } catch { state.receiveCoreFailure(error.localizedDescription) }
        do { state.receiveRecurring(try await api.recurringSeries()) }
        catch { state.receiveRecurringFailure(error.localizedDescription) }
    }
}
```

Mutation methods call Task 4 endpoints, insert a successful create response immediately, retain failed drafts, and call `load(api:force:true)` after success.

- [ ] **Step 5: Run tests and build**

Run: `swift test --package-path ios/AalsiFinanceKit`

Expected: all tests pass.

Run: `xcodebuild -project ios/AalsiFinance/AalsiFinance.xcodeproj -scheme AalsiFinance -destination 'platform=iOS Simulator,id=349C5D38-C407-47AA-81CF-CF6688BD4B30' build`

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 6: Commit**

```bash
git add ios/AalsiFinanceKit/Sources/AalsiFinanceKit/SpendingState.swift ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/SpendingStateTests.swift ios/AalsiFinance/AalsiFinance/Features/Spending/SpendingViewModel.swift
git commit -m "feat(ios): add retained Spending state"
```

---

### Task 6: Build the Overview surface

**Files:**
- Create: `ios/AalsiFinance/AalsiFinance/Features/Spending/SpendingOverview.swift`
- Create: `ios/AalsiFinance/AalsiFinance/Features/Spending/SpendSummaryCard.swift`

**Interfaces:**
- Consumes: `SpendOverview`, `SpendPeriod`, `AppTheme`, `SparklineChart`, `MoneyText`.
- Produces: `SpendingOverview(period:overview:onPrevious:onNext:onRoute:)` and reusable summary rows/cards.

- [ ] **Step 1: Create the month selector and pulse card**

Implement a `MonthSelector` with chevrons, month/year label, and disabled future navigation. Implement `SpendPulseCard` with total, count, delta text, daily pace, and a cumulative Swift Charts line using `overview.cumulativeDaily`. It must derive all text from `SpendOverview` and use `theme.accentColor` only for accent styling.

```swift
struct SpendingOverview: View {
    let period: SpendPeriod
    let overview: SpendOverview
    let onPrevious: () -> Void
    let onNext: () -> Void
    let onRoute: (SpendingRoute) -> Void

    var body: some View {
        LazyVStack(spacing: 14) {
            MonthSelector(monthStart: period.monthStart, canGoForward: !period.isCurrentMonth, onPrevious: onPrevious, onNext: onNext)
            SpendPulseCard(overview: overview)
            if let insight = overview.insight {
                let destination = route(for: insight.kind)
                SpendInsightCard(insight: insight, action: destination.map { route in { onRoute(route) } })
            }
            SpendRankedPreview(title: "Categories", categories: Array(overview.categories.prefix(3)), onSelect: { onRoute(.category($0)) })
            SpendRankedPreview(title: "Merchants", merchants: Array(overview.merchants.prefix(3)), onSelect: { onRoute(.merchant($0)) })
        }
        .padding(.horizontal, 20)
    }
}
```

Add a private `route(for:) -> SpendingRoute?` switch in `SpendingOverview`: category → `.category(id)`, merchant → `.merchant(key)`, transaction → `.transaction(id)`, and pace → `nil`. `SpendInsightCard` accepts an optional action and renders no disclosure affordance or tap target when the action is nil.

- [ ] **Step 2: Add light/dark and empty previews**

Provide `#Preview("Overview Dark")`, `#Preview("Overview Light")`, and `#Preview("Overview Empty")` using fixed `SpendOverview` values. Set `.environment(AppTheme())` and explicit `.preferredColorScheme` so previews do not depend on API data.

- [ ] **Step 3: Build and inspect previews**

Run the app build command.

Expected: `** BUILD SUCCEEDED **`; previews compile, pulse + insight fit before the first viewport break at default Dynamic Type.

- [ ] **Step 4: Commit**

```bash
git add ios/AalsiFinance/AalsiFinance/Features/Spending/SpendingOverview.swift ios/AalsiFinance/AalsiFinance/Features/Spending/SpendSummaryCard.swift
git commit -m "feat(ios): build Spending overview"
```

---

### Task 7: Build unified Activity, filters, and drill destinations

**Files:**
- Create: `ios/AalsiFinance/AalsiFinance/Features/Spending/SpendingActivity.swift`
- Create: `ios/AalsiFinance/AalsiFinance/Features/Spending/SpendFilterSheet.swift`
- Create: `ios/AalsiFinance/AalsiFinance/Features/Spending/SpendDrillViews.swift`
- Modify: `ios/AalsiFinance/AalsiFinance/Features/Activity/TransactionRow.swift`

**Interfaces:**
- Consumes: Task 2 filters/hierarchy, Task 3 rows/items, existing `TransactionRow`.
- Produces: one-scroll `SpendingActivity`, filter sheet/chips, `CategoryDrillView`, `MerchantDrillView`.

- [ ] **Step 1: Make `TransactionRow` signed and theme-aware**

Replace hardcoded indigo and the inverted `isCredit` name. Negative amounts render as spend with a leading minus and primary/negative styling; positive values render as income with positive styling. Add `categoryPath` and `showsSelection` inputs without changing Home's default call site.

- [ ] **Step 2: Implement the filter sheet and chips**

`SpendFilterSheet` edits a local copy and commits only on Apply. Include search, parent category picker, direction, amount band, recurring toggle, and status. Add Clear All. `ActiveSpendFilters` renders one removable chip per nondefault value and calls back with the updated `SpendFilter`.

- [ ] **Step 3: Implement the one-scroll Activity order**

Use a single `LazyVStack`: month summary, filter button, active chips, category preview, merchant preview, then day-grouped transactions. Do not add an internal segmented control.

```swift
LazyVStack(spacing: 14) {
    ActivityMonthSummary(period: period, count: rows.count, net: ledgerTotal)
    SpendFilterBar(filter: filter, onOpen: { showsFilters = true }, onRemove: onFilterChange)
    SpendRankedPreview(title: "Categories", categories: categoryRows, onSelect: { onRoute(.category($0)) })
    SpendRankedPreview(title: "Merchants", merchants: merchantRows, onSelect: { onRoute(.merchant($0)) })
    ForEach(daySections) { section in
        DayTransactionSection(section: section, categoryPath: categoryPath, selection: selection, onSelect: onSelect, onRoute: onRoute)
    }
}
```

If the core snapshot is empty, show the data empty state. If unfiltered data exists but rows are empty, show “No matches” and Clear Filters.

- [ ] **Step 4: Implement category and merchant drills**

`CategoryDrillView` receives a category ID, the shared snapshot, and period. It renders total/delta, child categories, top merchants, and matching transactions. Selecting a child pushes `.category(child.id)`.

`MerchantDrillView` receives the normalized merchant key, snapshot, and period. It renders total, visit count, average, delta, category mix, recurring status, aggregated line items, and matching transactions. Empty products render the receipt-capture invitation.

- [ ] **Step 5: Add previews and build**

Add dark/light previews for Activity and each drill plus no-match and no-item previews. Run the app build command.

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 6: Run package tests**

Run: `swift test --package-path ios/AalsiFinanceKit`

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add ios/AalsiFinance/AalsiFinance/Features/Spending/SpendingActivity.swift ios/AalsiFinance/AalsiFinance/Features/Spending/SpendFilterSheet.swift ios/AalsiFinance/AalsiFinance/Features/Spending/SpendDrillViews.swift ios/AalsiFinance/AalsiFinance/Features/Activity/TransactionRow.swift
git commit -m "feat(ios): build unified Spending activity"
```

---

### Task 8: Build transaction create, edit, confirm, split, and delete flows

**Files:**
- Create: `ios/AalsiFinance/AalsiFinance/Features/Spending/TransactionEditorView.swift`
- Create: `ios/AalsiFinance/AalsiFinance/Features/Spending/TransactionSplitView.swift`
- Modify: `ios/AalsiFinance/AalsiFinance/Features/Activity/TransactionDetailView.swift`
- Modify: `ios/AalsiFinance/AalsiFinance/Features/Spending/SpendingViewModel.swift`

**Interfaces:**
- Consumes: Tasks 1, 4, 5 mutation contracts and state.
- Produces: create/edit sheet, full transaction detail lifecycle, balanced split sheet, destructive delete confirmation.

- [ ] **Step 1: Implement a shared editor form**

`TransactionEditorView` accepts `mode: .create | .edit(Transaction)`, categories, currency, an optional retained draft, and async submit closure. Fields are amount, direction, merchant, currency, date, hierarchical category/subcategory, status, and notes. Validation requires amount greater than zero, nonempty currency, and a valid date; invalid fields show inline messages.

- [ ] **Step 2: Implement balanced split editing**

Initialize two parts whose signed amounts sum exactly to the source. Each part edits magnitude, category, and optional notes. Add/remove part controls keep at least two rows. Submit remains disabled until `SpendDerivation.splitIsBalanced` returns true; show the signed remainder beside the button.

```swift
private var remainder: Money { Money(transaction.amount.value - parts.reduce(Decimal.zero) { $0 + direction.signed(Money($1.magnitude)).value }) }
private var canSubmit: Bool { parts.count >= 2 && SpendDerivation.splitIsBalanced(source: transaction.amount, parts: parts.map { direction.signed(Money($0.magnitude)) }) }
```

- [ ] **Step 3: Extend transaction detail**

Keep line items and provenance, replace the Activity-specific model dependency with closures, and add toolbar/menu actions for Edit, Split, Confirm (draft only), and Delete. Delete uses `.confirmationDialog` with a destructive button. Do not optimistically dismiss until the server succeeds.

- [ ] **Step 4: Wire retained failures through the view model**

On failed create/edit/split/delete, set `state.mutationError`, retain the editor/split values, and keep the sheet open. On success, close the sheet, insert a returned create immediately, refresh authoritative data, and preserve pill/month/filter/path.

- [ ] **Step 5: Build and smoke the forms**

Run the app build command.

Expected: `** BUILD SUCCEEDED **`.

In the simulator, create a draft, edit and confirm it, split a test transaction into balanced parts, and delete only the newly created test transaction. Expected: each successful action refreshes the ledger without resetting the selected month or filters; a deliberately invalid split never enables Submit.

- [ ] **Step 6: Commit**

```bash
git add ios/AalsiFinance/AalsiFinance/Features/Spending/TransactionEditorView.swift ios/AalsiFinance/AalsiFinance/Features/Spending/TransactionSplitView.swift ios/AalsiFinance/AalsiFinance/Features/Activity/TransactionDetailView.swift ios/AalsiFinance/AalsiFinance/Features/Spending/SpendingViewModel.swift
git commit -m "feat(ios): add Spending transaction lifecycle"
```

---

### Task 9: Add multi-select merge and filtered CSV export

**Files:**
- Create: `ios/AalsiFinanceKit/Sources/AalsiFinanceKit/SpendCSV.swift`
- Create: `ios/AalsiFinance/AalsiFinance/Features/Spending/SpendExport.swift`
- Create: `ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/SpendExportTests.swift`
- Modify: `ios/AalsiFinance/AalsiFinance/Features/Spending/SpendingActivity.swift`
- Modify: `ios/AalsiFinance/AalsiFinance/Features/Spending/SpendingViewModel.swift`

**Interfaces:**
- Consumes: filtered Activity rows, `MergeRequest`, Task 3 merge validation.
- Produces: deterministic RFC-4180-style CSV, iOS `ShareLink`/share-sheet item, Select/Cancel/Merge behavior.

- [ ] **Step 1: Put deterministic CSV generation in the package and test escaping**

Add `SpendCSV.export(transactions:categoryName:) -> String` to the new focused `SpendCSV.swift`. Test header order, filtered row order, commas, quotes, and newlines:

```swift
@Test func csvEscapesMerchantAndNotes() throws {
    let json = #"{"id":"11111111-1111-1111-1111-111111111111","household_id":"22222222-2222-2222-2222-222222222222","account_id":null,"payment_method_id":null,"recurring_series_id":null,"owner_user_id":null,"merchant_id":null,"merchant":"Store, Inc.","amount":"-12","currency":"USD","base_amount":null,"fx_rate":null,"txn_date":"2026-07-12","category_id":null,"status":"confirmed","source_document_id":null,"source_channel":"manual","is_shared":false,"flags":null,"notes":"said \\"hi\\"\\nnext","confidence":null,"external_id":null,"created_at":"2026-07-12T10:00:00","line_items":[]}"#
    let transaction = try JSONDecoder.api().decode(Transaction.self, from: Data(json.utf8))
    let csv = SpendCSV.export(transactions: [transaction], categoryName: { _ in "Food" })
    #expect(csv.hasPrefix("date,merchant,category,amount,currency,status,notes\r\n"))
    #expect(csv.contains("\"Store, Inc.\""))
    #expect(csv.contains("\"said \"\"hi\"\" next\""))
}
```

- [ ] **Step 2: Run the focused test and confirm red**

Run: `swift test --package-path ios/AalsiFinanceKit --filter SpendExportTests`

Expected: FAIL because `SpendCSV` does not exist.

- [ ] **Step 3: Implement CSV and share transfer**

CSV uses CRLF row endings, quotes every field, doubles embedded quotes, and replaces embedded line breaks with spaces. `SpendExport.swift` writes the string to a temporary `transactions_YYYY-MM-DD_YYYY-MM-DD.csv` file using `Data.write(options:.atomic)` and exposes it through `ShareLink(item:)`. Remove the previous temp file before creating a replacement.

- [ ] **Step 4: Implement selection and merge UI**

Activity toolbar exposes Select. In selection mode, transaction rows toggle IDs and show checkmarks; navigation is disabled. The bottom safe-area bar shows Cancel and `Merge N`, enabled only when `SpendDerivation.mergeIsEligible` is true. Confirm merge before submitting. Success exits selection mode and refreshes; failure retains selection for retry.

- [ ] **Step 5: Run tests, build, and smoke**

Run package tests, then the app build command.

Expected: all package tests pass and `** BUILD SUCCEEDED **`.

Simulator: apply a merchant filter, export, and inspect the shared CSV preview; then merge two disposable demo transactions. Expected: export contains only visible rows and merge preserves month/filter context.

- [ ] **Step 6: Commit**

```bash
git add ios/AalsiFinanceKit/Sources/AalsiFinanceKit/SpendCSV.swift ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/SpendExportTests.swift ios/AalsiFinance/AalsiFinance/Features/Spending/SpendExport.swift ios/AalsiFinance/AalsiFinance/Features/Spending/SpendingActivity.swift ios/AalsiFinance/AalsiFinance/Features/Spending/SpendingViewModel.swift
git commit -m "feat(ios): add Spending merge and export"
```

---

### Task 10: Build Recurring, assemble the feature root, and switch the tab

**Files:**
- Create: `ios/AalsiFinance/AalsiFinance/Features/Spending/SpendingRecurring.swift`
- Create: `ios/AalsiFinance/AalsiFinance/Features/Spending/SpendingView.swift`
- Modify: `ios/AalsiFinance/AalsiFinance/App/MainTabView.swift`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: final `SpendingView` root and `MainTabView` integration.

- [ ] **Step 1: Implement the Recurring surface**

Render monthly commitment total, canonical rows first, inferred rows second, cadence, next charge, and source label. Canonical and inferred empty states are distinct. Canonical load failure renders inline Retry without affecting the other pills. Merchant-backed rows route to `.merchant(key)`.

- [ ] **Step 2: Assemble `SpendingView`**

The root creates one `SpendingViewModel`, uses `AppHeader(title:"Spending")`, page-specific add and filter/select/export actions, `PillNav(items:["Overview", "Activity", "Recurring"])`, and a `NavigationStack(path:)`. Render shaped skeletons for core loading and an inline retry for core failure. Route typed destinations to category, merchant, and transaction views.

```swift
struct SpendingView: View {
    @Environment(AppSession.self) private var session
    @State private var model = SpendingViewModel()

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.state.navigationPath) {
            ScrollView {
                VStack(spacing: 14) {
                    AppHeader(title: "Spending")
                    PillNav(items: ["Overview", "Activity", "Recurring"], selection: $model.state.selectedPillIndex)
                    content
                }
                .padding(.bottom, 24)
            }
            .background(Color(.systemGroupedBackground))
            .refreshable { await model.load(api: session.api, force: true) }
            .navigationDestination(for: SpendingRoute.self, destination: destination)
            .toolbar(.hidden, for: .navigationBar)
        }
        .task { await model.load(api: session.api) }
    }
}
```

Place add/filter/select/export buttons in a Spending-owned toolbar/header row rather than modifying global `AppHeader` behavior for other tabs.

- [ ] **Step 3: Switch `MainTabView` only after the root builds**

Change the Spending tab body from `ActivityView()` to `SpendingView()`. Keep `AALSI_INITIAL_TAB=spending` unchanged.

- [ ] **Step 4: Run complete automated verification**

Run: `swift test --package-path ios/AalsiFinanceKit`

Expected: all tests pass.

Run: `xcodebuild -project ios/AalsiFinance/AalsiFinance.xcodeproj -scheme AalsiFinance -destination 'platform=iOS Simulator,id=349C5D38-C407-47AA-81CF-CF6688BD4B30' build`

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 5: Run the complete simulator smoke**

Launch with:

```bash
SIMCTL_CHILD_AALSI_DEMO_EMAIL=ios.demo@example.com SIMCTL_CHILD_AALSI_DEMO_PASSWORD=ios-demo-pass-1 SIMCTL_CHILD_AALSI_INITIAL_TAB=spending xcrun simctl launch --terminate-running-process 349C5D38-C407-47AA-81CF-CF6688BD4B30 com.aalsi.finance
```

Verify:

1. Overview is default; previous/current month movement, pulse, insight, and drills work.
2. Activity retains month across pills; filters/chips, category → subcategory, merchant, items, and transaction detail work.
3. Create/edit/confirm/split/delete retains entered values on failure and context on success.
4. Select/merge and filtered export work.
5. Recurring shows canonical/inferred separation and merchant navigation.
6. Core failure blocks Overview/Activity; recurring failure stays isolated.
7. Light/dark appearance, VoiceOver row labels, and an accessibility Dynamic Type size remain usable.

- [ ] **Step 6: Commit the final integration**

```bash
git add ios/AalsiFinance/AalsiFinance/Features/Spending/SpendingRecurring.swift ios/AalsiFinance/AalsiFinance/Features/Spending/SpendingView.swift ios/AalsiFinance/AalsiFinance/App/MainTabView.swift
git commit -m "feat(ios): ship Spending phase 2"
```

---

## Spec coverage map

| Design requirement | Plan task |
|---|---|
| Overview · Activity · Recurring architecture | 6, 7, 10 |
| Hybrid pulse + deterministic insight | 3, 6 |
| Unified Activity scroll | 7 |
| Category → subcategory and merchant drills | 2, 3, 7 |
| Item/receipt-line intelligence | 1, 3, 7, 8 |
| Canonical + inferred recurring with deduplication | 3, 10 |
| Shared month/filter/navigation state | 5, 10 |
| Create/edit/confirm/split/delete | 1, 4, 5, 8 |
| Multi-select merge | 3, 4, 9 |
| Filtered CSV share | 2, 9 |
| Loading/error/empty states | 5, 6, 7, 10 |
| Theme, money, accessibility rules | 6–10 |
| Package tests, build, and simulator smoke | every task; final gate in 10 |
