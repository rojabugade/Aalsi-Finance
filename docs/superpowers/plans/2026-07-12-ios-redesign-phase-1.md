# iOS Redesign Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the iOS app's navigation shell (5-tab bar with centered AI tab), persistent chrome (avatar settings sheet with appearance controls, notifications bell), the Home dashboard (forecast hero, health tiles, upcoming feed, insights rail), and the Money tab (overview / debt / cards / income), per `docs/superpowers/specs/2026-07-12-ios-app-ux-redesign-design.md`.

**Architecture:** Pure logic (models, JSON coding, forecast math, upcoming-feed derivation, theme enums) moves into a new local Swift package `ios/AalsiFinanceKit` tested via `swift test` (the Xcode project has no test target). The app target consumes the package; SwiftUI views and view models stay in the app and are verified by building + simulator smoke runs.

**Tech Stack:** Swift 6, SwiftUI, Swift Charts, Observation framework, swift-testing (`import Testing`), Xcode 27 beta 2 / iOS 27 SDK, deployment target iOS 26.0, backend FastAPI at `localhost:8000` (docker).

## Global Constraints

- Deployment target: iOS 26.0; `SWIFT_VERSION = 6.0`.
- pbxproj uses `PBXFileSystemSynchronizedRootGroup`: new Swift files under `ios/AalsiFinance/AalsiFinance/` are picked up automatically — never add file references to the pbxproj for source files. `Info.plist` must stay OUTSIDE that synced folder.
- Backend contract: pydantic v2 serializes `Decimal` as JSON **string**; datetimes may be naive (no tz); dates are `yyyy-MM-dd`; keys are snake_case (decoder converts).
- No payment/transfer actions anywhere in the app. No invented numbers: if a value isn't derivable from the API, omit the element.
- Semantic colors fixed (green/teal = positive, red/coral = negative, orange/amber = warning); accent color is user-selectable and must come from `AppTheme` — never hardcode `.indigo` in new code.
- All money rendering goes through `MoneyText` / `Money.formatted` / `Money.compact` with monospaced digits.
- Demo account for simulator: `ios.demo@example.com` / `ios-demo-pass-1`. DEBUG env hooks: `AALSI_DEMO_EMAIL`, `AALSI_DEMO_PASSWORD`, `AALSI_INITIAL_TAB` (set via `SIMCTL_CHILD_*` when launching with `simctl`).
- Booted simulator: iPhone 17 Pro, UDID `349C5D38-C407-47AA-81CF-CF6688BD4B30`.
- All shell commands below run from the repo root `/Users/kshtj/Stuff/Projects/Alsi/Aalsi-Finance` unless stated otherwise.
- Build check command (used by many tasks):
  `xcodebuild -project ios/AalsiFinance/AalsiFinance.xcodeproj -scheme AalsiFinance -destination 'platform=iOS Simulator,id=349C5D38-C407-47AA-81CF-CF6688BD4B30' build 2>&1 | tail -5` — expected to end with `** BUILD SUCCEEDED **`.
- Package test command: `swift test --package-path ios/AalsiFinanceKit` — expected `Test run with N tests passed`.
- Commit after every task (steps say when). Conventional Commits. End commit bodies with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: AalsiFinanceKit package with Money, JSONCoding, Models (public) + tests

Creates the package with **copies** of the app's `Money.swift`, `JSONCoding.swift`, `Models.swift` made `public`. The app is not touched yet (it keeps its own copies until Task 2 wires the package in), so every commit stays green.

**Files:**
- Create: `ios/AalsiFinanceKit/Package.swift`
- Create: `ios/AalsiFinanceKit/Sources/AalsiFinanceKit/Money.swift`
- Create: `ios/AalsiFinanceKit/Sources/AalsiFinanceKit/JSONCoding.swift`
- Create: `ios/AalsiFinanceKit/Sources/AalsiFinanceKit/Models.swift`
- Test: `ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/MoneyTests.swift`
- Test: `ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/DecodingTests.swift`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `public struct Money` (`value: Decimal`, `isNegative`, `doubleValue`, `magnitude`, `formatted(code:)`, `compact(code:)`), `public extension JSONDecoder { static func api() -> JSONDecoder }`, `public extension JSONEncoder { static func api() -> JSONEncoder }`, `public enum APIDateParser { static func parse(_:) -> Date? }`, and public model structs `AccessToken`, `Household`, `Transaction`, `LineItem`, `Category`, `CashflowSummary`, `CashflowLine`, `AnalyticsRow`, `Breakdown`, `TimeSeries`, `TimeSeriesPoint`, `NetWorth`, `NetWorthPoint`, `Budget` with the exact property names the app already uses.

- [ ] **Step 1: Create the package manifest**

`ios/AalsiFinanceKit/Package.swift`:

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "AalsiFinanceKit",
    platforms: [.iOS(.v18), .macOS(.v14)],
    products: [
        .library(name: "AalsiFinanceKit", targets: ["AalsiFinanceKit"])
    ],
    targets: [
        .target(name: "AalsiFinanceKit"),
        .testTarget(name: "AalsiFinanceKitTests", dependencies: ["AalsiFinanceKit"]),
    ]
)
```

- [ ] **Step 2: Write the failing tests**

`ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/MoneyTests.swift`:

```swift
import Foundation
import Testing
@testable import AalsiFinanceKit

@Suite struct MoneyTests {
    @Test func decodesDecimalString() throws {
        let money = try JSONDecoder.api().decode(Money.self, from: Data(#""1234.56""#.utf8))
        #expect(money.value == Decimal(string: "1234.56", locale: Locale(identifier: "en_US_POSIX")))
    }

    @Test func decodesPlainNumber() throws {
        let money = try JSONDecoder.api().decode(Money.self, from: Data("42.5".utf8))
        #expect(money.doubleValue == 42.5)
    }

    @Test func negativeAndMagnitude() {
        let money = Money(Decimal(-300))
        #expect(money.isNegative)
        #expect(money.magnitude.value == Decimal(300))
    }

    @Test func compactUsesKAboveTenThousand() {
        let money = Money(Decimal(12_500))
        #expect(money.compact(code: "USD") == "$12.5K")
    }

    @Test func encodesAsString() throws {
        let data = try JSONEncoder.api().encode(Money(Decimal(7)))
        #expect(String(data: data, encoding: .utf8) == #""7""#)
    }
}
```

`ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/DecodingTests.swift`:

```swift
import Foundation
import Testing
@testable import AalsiFinanceKit

@Suite struct DecodingTests {
    @Test func parsesAllBackendDateShapes() {
        #expect(APIDateParser.parse("2026-07-12T10:30:00Z") != nil)
        #expect(APIDateParser.parse("2026-07-12T10:30:00.123456") != nil) // naive fractional
        #expect(APIDateParser.parse("2026-07-12T10:30:00") != nil)        // naive
        #expect(APIDateParser.parse("2026-07-12") != nil)                 // plain date
        #expect(APIDateParser.parse("July 12") == nil)
    }

    @Test func decodesTransactionFromSnakeCase() throws {
        let json = """
        {
          "id": "11111111-1111-1111-1111-111111111111",
          "household_id": "22222222-2222-2222-2222-222222222222",
          "account_id": null, "merchant_id": null,
          "merchant": "BigBasket",
          "amount": "2140.00", "currency": "INR", "base_amount": null,
          "txn_date": "2026-07-10",
          "category_id": null, "status": "confirmed", "source_channel": null,
          "is_shared": false, "notes": null, "confidence": null,
          "created_at": "2026-07-10T09:14:00",
          "line_items": []
        }
        """
        let txn = try JSONDecoder.api().decode(Transaction.self, from: Data(json.utf8))
        #expect(txn.displayMerchant == "BigBasket")
        #expect(txn.amount.value == Decimal(string: "2140.00", locale: Locale(identifier: "en_US_POSIX")))
        #expect(!txn.isDraft)
    }

    @Test func decodesCashflowSummary() throws {
        let json = """
        {
          "currency": "INR",
          "income_monthly": "110000", "recurring_monthly": "20000",
          "debt_emi_monthly": "18400", "card_min_monthly": "3200",
          "discretionary_monthly": "42300", "leftover_monthly": "26100",
          "breakdown": [{"label": "Salary", "amount": "110000", "kind": "income"}]
        }
        """
        let summary = try JSONDecoder.api().decode(CashflowSummary.self, from: Data(json.utf8))
        #expect(summary.leftoverMonthly.value == Decimal(26100))
        #expect(summary.breakdown.count == 1)
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `swift test --package-path ios/AalsiFinanceKit`
Expected: FAIL — compile errors, `Money`/`APIDateParser`/`Transaction` not found.

- [ ] **Step 4: Add the source files**

`ios/AalsiFinanceKit/Sources/AalsiFinanceKit/Money.swift` — copy of `ios/AalsiFinance/AalsiFinance/Models/Money.swift` with `public` access. Full content:

```swift
import Foundation

/// A monetary amount. pydantic v2 serializes `Decimal` as a JSON string, but be
/// tolerant of plain numbers too.
public struct Money: Hashable, Sendable {
    public var value: Decimal

    public init(_ value: Decimal = .zero) {
        self.value = value
    }

    public var isNegative: Bool { value < 0 }
    public var doubleValue: Double { NSDecimalNumber(decimal: value).doubleValue }
    public var magnitude: Money { Money(abs(value)) }

    public func formatted(code: String) -> String {
        value.formatted(.currency(code: code))
    }

    /// Compact form for chart axes and dense rows: "$1.2K", "$3.4M".
    public func compact(code: String) -> String {
        let amount = abs(doubleValue)
        let sign = isNegative ? "-" : ""
        let symbol = Self.symbol(for: code)
        switch amount {
        case 1_000_000...:
            return "\(sign)\(symbol)\((amount / 1_000_000).formatted(.number.precision(.fractionLength(0...1))))M"
        case 10_000...:
            return "\(sign)\(symbol)\((amount / 1_000).formatted(.number.precision(.fractionLength(0...1))))K"
        case 100...:
            return value.formatted(.currency(code: code).precision(.fractionLength(0)))
        default:
            return formatted(code: code)
        }
    }

    /// Currency symbol as the user's locale renders it ("$", "₹", "€"), pulled
    /// from an actual formatted amount so it never falls back to "US$".
    private static func symbol(for code: String) -> String {
        let zero = Decimal.zero.formatted(.currency(code: code).precision(.fractionLength(0)))
        let symbol = zero.filter { !$0.isNumber && !$0.isWhitespace }
        return symbol.isEmpty ? code : symbol
    }
}

extension Money: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let string = try? container.decode(String.self), let decimal = Decimal(string: string, locale: Locale(identifier: "en_US_POSIX")) {
            value = decimal
        } else if let double = try? container.decode(Double.self) {
            value = Decimal(double)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Expected a decimal string or number"
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode("\(value)")
    }
}
```

`ios/AalsiFinanceKit/Sources/AalsiFinanceKit/JSONCoding.swift` — copy of the app's `JSONCoding.swift`; the two `static func api()` extensions and `enum APIDateParser` become `public` (`public static func api()`, `public enum APIDateParser`, `public static func parse`). Body identical to the original otherwise.

`ios/AalsiFinanceKit/Sources/AalsiFinanceKit/Models.swift` — copy of the app's `Models.swift` with every struct, property, and computed property marked `public`. Pattern (apply to ALL types in the file — `AccessToken`, `Household`, `Transaction`, `LineItem`, `Category`, `CashflowSummary`, `CashflowLine`, `AnalyticsRow`, `Breakdown`, `TimeSeries`, `TimeSeriesPoint`, `NetWorth`, `NetWorthPoint`, `Budget`):

```swift
public struct Transaction: Decodable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public let householdId: UUID
    public let accountId: UUID?
    public let merchantId: UUID?
    public let merchant: String?
    public let amount: Money
    public let currency: String
    public let baseAmount: Money?
    public let txnDate: Date
    public let categoryId: UUID?
    public let status: String
    public let sourceChannel: String?
    public let isShared: Bool
    public let notes: String?
    public let confidence: Double?
    public let createdAt: Date
    public let lineItems: [LineItem]

    public var isDraft: Bool { status == "draft" }
    public var displayMerchant: String { merchant?.isEmpty == false ? merchant! : "Unknown merchant" }
}
```

(`AnalyticsRow.dimension(_:)` also becomes `public func`.) Property names, types, and order must match the app's current `Models.swift` exactly — the app code compiles against them unchanged in Task 2.

- [ ] **Step 5: Run tests to verify they pass**

Run: `swift test --package-path ios/AalsiFinanceKit`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add ios/AalsiFinanceKit
git commit -m "feat(ios): add AalsiFinanceKit package with models and money coding

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Wire AalsiFinanceKit into the app, delete duplicated sources

**Files:**
- Modify: `ios/AalsiFinance/AalsiFinance.xcodeproj/project.pbxproj`
- Delete: `ios/AalsiFinance/AalsiFinance/Models/Money.swift`
- Delete: `ios/AalsiFinance/AalsiFinance/Models/Models.swift`
- Delete: `ios/AalsiFinance/AalsiFinance/Networking/JSONCoding.swift`
- Modify: every app file that references models — add `import AalsiFinanceKit` to: `Networking/APIClient.swift`, `Components/SharedViews.swift`, `Components/Loadable.swift` (only if it names model types; check), `App/AppSession.swift`, `Features/Home/HomeView.swift`, `Features/Home/HomeViewModel.swift`, `Features/Insights/InsightsView.swift`, `Features/Insights/InsightsViewModel.swift`, `Features/Activity/ActivityView.swift`, `Features/Activity/ActivityViewModel.swift`, `Features/Activity/TransactionRow.swift`, `Features/Activity/TransactionDetailView.swift`, `Features/Settings/SettingsView.swift`, `Features/Auth/LoginView.swift`

**Interfaces:**
- Consumes: the `AalsiFinanceKit` library product from Task 1.
- Produces: app target linked against `AalsiFinanceKit`; single source of truth for models.

- [ ] **Step 1: Add the local package reference to the pbxproj**

Apply these 5 edits to `ios/AalsiFinance/AalsiFinance.xcodeproj/project.pbxproj` (the project uses hand-rolled `AA…` object IDs; continue the scheme):

1. After the `/* End PBXFileReference section */` line, insert:

```
/* Begin PBXBuildFile section */
		AA0000000000000000000203 /* AalsiFinanceKit in Frameworks */ = {isa = PBXBuildFile; productRef = AA0000000000000000000202 /* AalsiFinanceKit */; };
/* End PBXBuildFile section */
```

2. In the `PBXFrameworksBuildPhase` section, change `files = (` `);` to:

```
				files = (
					AA0000000000000000000203 /* AalsiFinanceKit in Frameworks */,
				);
```

3. In the `PBXNativeTarget` section, change `packageProductDependencies = (` `);` to:

```
				packageProductDependencies = (
					AA0000000000000000000202 /* AalsiFinanceKit */,
				);
```

4. In the `PBXProject` section, after the `projectRoot = "";` line, insert:

```
			packageReferences = (
				AA0000000000000000000201 /* XCLocalSwiftPackageReference "../AalsiFinanceKit" */,
			);
```

5. Before the final `};` + `rootObject` lines (after `/* End XCConfigurationList section */`), insert:

```
/* Begin XCLocalSwiftPackageReference section */
		AA0000000000000000000201 /* XCLocalSwiftPackageReference "../AalsiFinanceKit" */ = {
			isa = XCLocalSwiftPackageReference;
			relativePath = ../AalsiFinanceKit;
		};
/* End XCLocalSwiftPackageReference section */

/* Begin XCSwiftPackageProductDependency section */
		AA0000000000000000000202 /* AalsiFinanceKit */ = {
			isa = XCSwiftPackageProductDependency;
			productName = AalsiFinanceKit;
		};
/* End XCSwiftPackageProductDependency section */
```

(Note: the package path is relative to the `.xcodeproj`'s parent directory `ios/AalsiFinance/`, so `../AalsiFinanceKit` resolves to `ios/AalsiFinanceKit`.)

- [ ] **Step 2: Delete the duplicated app sources**

```bash
rm ios/AalsiFinance/AalsiFinance/Models/Money.swift \
   ios/AalsiFinance/AalsiFinance/Models/Models.swift \
   ios/AalsiFinance/AalsiFinance/Networking/JSONCoding.swift
```

- [ ] **Step 3: Add imports**

Add `import AalsiFinanceKit` below `import Foundation`/`import SwiftUI` in each file listed above that fails to compile without it. Fastest loop: run the build, add the import to each file the errors name, repeat.

- [ ] **Step 4: Build to verify**

Run the Global Constraints build command.
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 5: Commit**

```bash
git add -A ios/
git commit -m "refactor(ios): move models into AalsiFinanceKit package

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Domain models for Money surfaces (loans, cards, recurring, income, alerts)

**Files:**
- Create: `ios/AalsiFinanceKit/Sources/AalsiFinanceKit/MoneyModels.swift`
- Test: `ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/MoneyModelsDecodingTests.swift`

**Interfaces:**
- Consumes: `Money`, `JSONDecoder.api()` from Task 1.
- Produces (all `public`, all `Decodable, Hashable, Sendable`, `Identifiable` where noted):
  - `Loan` (Identifiable): `id: UUID`, `name: String`, `type: String`, `scheduleKind: String`, `principal: Money`, `currency: String`, `interestRate: Money?`, `minOrEmiAmount: Money?`, `dueDay: Int?`, `startDate: Date?`, `endDate: Date?`, `nextDueDate: Date?`, `penaltyWarning: String?`, `outstandingBalance: Money?`, `totalPaid: Money?`, `totalPrincipalPaid: Money?`, `totalInterestPaid: Money?`, `progressPct: Double?`, `creditCardDetail: CreditCardDetail?` + `public var isCreditCard: Bool { type == "credit_card" || creditCardDetail != nil }`
  - `CreditCardDetail`: `creditLimit: Money?`, `statementBalance: Money?`, `availableCredit: Money?`, `statementDay: Int?`, `utilization: Money?`
  - `CreditCardSummary` (Identifiable, `public var id: UUID { loan.id }`): `loan: Loan`, `creditLimit: Money?`, `statementBalance: Money?`, `availableCredit: Money?`, `statementDay: Int?`, `utilization: Money?`, `detailComplete: Bool`
  - `RecurringSeries` (Identifiable): `id: UUID`, `name: String`, `amount: Money?`, `currency: String`, `cadence: String`, `type: String`, `status: String`, `nextDueDate: Date?`, `merchantName: String?`, `categoryName: String?`
  - `IncomeSource` (Identifiable): `id: UUID`, `employer: String?`, `country: String?`, `currency: String`, `frequency: String`, `gross: Money?`, `net: Money?`
  - `PaymentScheduleEntry` (Identifiable): `id: UUID`, `loanId: UUID`, `installmentNo: Int`, `dueDate: Date`, `principalComponent: Money?`, `interestComponent: Money?`, `balanceAfter: Money?`, `status: String`
  - `PersistentAlert` (Identifiable): `id: String`, `kind: String`, `severity: Int`, `tone: String`, `state: String`, `title: String`, `detail: String`
  - `MonitorOut`: `alerts: [PersistentAlert]`
  - `Holding` (Identifiable): `id: UUID`, `assetType: String`, `symbol: String?`, `name: String`, `quantity: Money`, `avgBuyPrice: Money?`, `currency: String`

- [ ] **Step 1: Write failing decoding tests**

`ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/MoneyModelsDecodingTests.swift`:

```swift
import Foundation
import Testing
@testable import AalsiFinanceKit

@Suite struct MoneyModelsDecodingTests {
    @Test func decodesLoanWithCardDetail() throws {
        let json = """
        {
          "id": "33333333-3333-3333-3333-333333333333",
          "household_id": "22222222-2222-2222-2222-222222222222",
          "name": "Amex", "type": "credit_card", "schedule_kind": "revolving",
          "principal": "0", "currency": "INR",
          "interest_rate": "42.0", "min_or_emi_amount": "3200",
          "due_day": 12, "next_due_date": "2026-07-12",
          "penalty_warning": null,
          "outstanding_balance": "42100", "total_paid": "12000",
          "total_principal_paid": null, "total_interest_paid": null,
          "progress_pct": 34.0,
          "credit_card_detail": {
            "credit_limit": "68000", "statement_balance": "42100",
            "available_credit": "25900", "statement_day": 28, "utilization": 0.62
          }
        }
        """
        let loan = try JSONDecoder.api().decode(Loan.self, from: Data(json.utf8))
        #expect(loan.isCreditCard)
        #expect(loan.creditCardDetail?.utilization?.doubleValue == 0.62)
        #expect(loan.nextDueDate != nil)
    }

    @Test func decodesCreditCardSummary() throws {
        let json = """
        {
          "loan": {
            "id": "33333333-3333-3333-3333-333333333333",
            "household_id": "22222222-2222-2222-2222-222222222222",
            "name": "Amex", "type": "credit_card", "schedule_kind": "revolving",
            "principal": "0", "currency": "INR"
          },
          "credit_limit": "68000", "statement_balance": "42100",
          "available_credit": null, "statement_day": 28,
          "utilization": "0.62", "detail_complete": true
        }
        """
        let card = try JSONDecoder.api().decode(CreditCardSummary.self, from: Data(json.utf8))
        #expect(card.id == card.loan.id)
        #expect(card.detailComplete)
    }

    @Test func decodesRecurringSeries() throws {
        let json = """
        {
          "id": "44444444-4444-4444-4444-444444444444",
          "household_id": "22222222-2222-2222-2222-222222222222",
          "name": "Netflix", "amount": "649", "currency": "INR",
          "cadence": "monthly", "type": "subscription", "status": "active",
          "next_due_date": "2026-07-20",
          "merchant_name": "Netflix", "category_name": "Entertainment"
        }
        """
        let series = try JSONDecoder.api().decode(RecurringSeries.self, from: Data(json.utf8))
        #expect(series.name == "Netflix")
        #expect(series.nextDueDate != nil)
    }

    @Test func decodesMonitorAlerts() throws {
        let json = """
        {"alerts": [{"id": "a1", "kind": "overspend", "severity": 6, "tone": "warning",
                     "state": "active", "title": "Eating out is up 32%",
                     "detail": "You spent Rs 4,860 across 14 transactions this month."}]}
        """
        let monitor = try JSONDecoder.api().decode(MonitorOut.self, from: Data(json.utf8))
        #expect(monitor.alerts.first?.title.hasPrefix("Eating out") == true)
    }

    @Test func decodesScheduleEntryAndIncomeSourceAndHolding() throws {
        let schedule = """
        {"id": "55555555-5555-5555-5555-555555555555",
         "loan_id": "33333333-3333-3333-3333-333333333333",
         "installment_no": 14, "due_date": "2026-07-18",
         "principal_component": "12000", "interest_component": "6400",
         "balance_after": "398000", "status": "upcoming"}
        """
        let entry = try JSONDecoder.api().decode(PaymentScheduleEntry.self, from: Data(schedule.utf8))
        #expect(entry.installmentNo == 14)

        let income = """
        {"id": "66666666-6666-6666-6666-666666666666",
         "household_id": "22222222-2222-2222-2222-222222222222",
         "employer": "Acme", "country": "IN", "currency": "INR",
         "frequency": "monthly", "gross": "110000", "net": null, "withholding": null}
        """
        let source = try JSONDecoder.api().decode(IncomeSource.self, from: Data(income.utf8))
        #expect(source.employer == "Acme")

        let holding = """
        {"id": "77777777-7777-7777-7777-777777777777",
         "household_id": "22222222-2222-2222-2222-222222222222",
         "account_id": "88888888-8888-8888-8888-888888888888",
         "asset_type": "etf", "symbol": "NIFTYBEES", "name": "Nifty 50 ETF",
         "quantity": "120", "avg_buy_price": "220.5", "currency": "INR"}
        """
        let h = try JSONDecoder.api().decode(Holding.self, from: Data(holding.utf8))
        #expect(h.symbol == "NIFTYBEES")
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path ios/AalsiFinanceKit`
Expected: FAIL — `Loan` etc. not found.

- [ ] **Step 3: Implement the models**

`ios/AalsiFinanceKit/Sources/AalsiFinanceKit/MoneyModels.swift` — implement exactly the shapes from the Interfaces block. All optional wire fields are optional properties so partial backend rows decode (note the second test's loan omits most keys — every property except `id`, `name`, `type`, `scheduleKind`, `principal`, `currency` must be `Optional`). Example for one type; repeat the pattern:

```swift
import Foundation

public struct Loan: Decodable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public let name: String
    public let type: String
    public let scheduleKind: String
    public let principal: Money
    public let currency: String
    public let interestRate: Money?
    public let minOrEmiAmount: Money?
    public let dueDay: Int?
    public let startDate: Date?
    public let endDate: Date?
    public let nextDueDate: Date?
    public let penaltyWarning: String?
    public let outstandingBalance: Money?
    public let totalPaid: Money?
    public let totalPrincipalPaid: Money?
    public let totalInterestPaid: Money?
    public let progressPct: Double?
    public let creditCardDetail: CreditCardDetail?

    public var isCreditCard: Bool { type == "credit_card" || creditCardDetail != nil }
}
```

Note on optionals + `convertFromSnakeCase`: missing keys decode to `nil` automatically for `let x: T?` only when using `decodeIfPresent`, which synthesized Decodable does. No custom `init(from:)` needed anywhere in this file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path ios/AalsiFinanceKit`
Expected: PASS (13 tests total).

- [ ] **Step 5: Commit**

```bash
git add ios/AalsiFinanceKit
git commit -m "feat(ios): add loan, card, recurring, income, alert models to kit

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: UpcomingFeed derivation (TDD)

Merges loan/EMI dues, card minimum dues, and recurring subscriptions into the Home "Upcoming" list.

**Files:**
- Create: `ios/AalsiFinanceKit/Sources/AalsiFinanceKit/UpcomingFeed.swift`
- Test: `ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/UpcomingFeedTests.swift`

**Interfaces:**
- Consumes: `Loan`, `RecurringSeries` from Task 3.
- Produces:

```swift
public struct UpcomingItem: Equatable, Identifiable, Sendable {
    public enum Kind: String, Sendable { case emi, cardMinimum, subscription, bill, income, other }
    public let id: String
    public let title: String
    public let amount: Decimal?
    public let currency: String
    public let dueDate: Date
    public let kind: Kind
    public let isUrgent: Bool
}

public enum UpcomingFeed {
    public static func build(loans: [Loan], recurring: [RecurringSeries], today: Date, windowDays: Int = 14) -> [UpcomingItem]
}
```

Rules: skip entries with no due date; skip recurring whose `status != "active"` and whose `type == "transfer"`; include due dates in `[startOfDay(today), startOfDay(today) + windowDays]` (UTC gregorian calendar); `isUrgent` = due date is the same UTC day as `today`; loan kind = `.cardMinimum` if `isCreditCard` else `.emi` with `amount = minOrEmiAmount?.value`; recurring kind maps its `type` string (`subscription`/`bill`/`income`, anything else `.other`); sort ascending by due date, ties by descending amount (nil amounts last); `id` = `"loan-\(uuid)"` / `"recurring-\(uuid)"`.

- [ ] **Step 1: Write failing tests**

`ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/UpcomingFeedTests.swift`:

```swift
import Foundation
import Testing
@testable import AalsiFinanceKit

private func utcDate(_ y: Int, _ m: Int, _ d: Int) -> Date {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "UTC")!
    return cal.date(from: DateComponents(year: y, month: m, day: d))!
}

private func makeLoan(id: String, name: String, type: String, emi: String?, due: Date?) throws -> Loan {
    var fields = """
    "id": "\(id)", "name": "\(name)", "type": "\(type)",
    "schedule_kind": "amortizing", "principal": "100000", "currency": "INR"
    """
    if let emi { fields += #", "min_or_emi_amount": "\#(emi)""# }
    if let due {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        fields += #", "next_due_date": "\#(f.string(from: due))""#
    }
    return try JSONDecoder.api().decode(Loan.self, from: Data("{\(fields)}".utf8))
}

private func makeRecurring(id: String, name: String, type: String, status: String, amount: String?, due: Date?) throws -> RecurringSeries {
    var fields = """
    "id": "\(id)", "name": "\(name)", "currency": "INR",
    "cadence": "monthly", "type": "\(type)", "status": "\(status)"
    """
    if let amount { fields += #", "amount": "\#(amount)""# }
    if let due {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        fields += #", "next_due_date": "\#(f.string(from: due))""#
    }
    return try JSONDecoder.api().decode(RecurringSeries.self, from: Data("{\(fields)}".utf8))
}

@Suite struct UpcomingFeedTests {
    let today = utcDate(2026, 7, 12)

    @Test func mergesSortsAndFlagsUrgent() throws {
        let card = try makeLoan(id: "33333333-3333-3333-3333-333333333333", name: "Amex", type: "credit_card", emi: "3200", due: utcDate(2026, 7, 12))
        let home = try makeLoan(id: "13333333-3333-3333-3333-333333333333", name: "HDFC Home Loan", type: "home", emi: "18400", due: utcDate(2026, 7, 18))
        let netflix = try makeRecurring(id: "44444444-4444-4444-4444-444444444444", name: "Netflix", type: "subscription", status: "active", amount: "649", due: utcDate(2026, 7, 20))

        let items = UpcomingFeed.build(loans: [home, card], recurring: [netflix], today: today)
        #expect(items.map(\.title) == ["Amex", "HDFC Home Loan", "Netflix"])
        #expect(items[0].isUrgent && items[0].kind == .cardMinimum)
        #expect(!items[1].isUrgent && items[1].kind == .emi)
        #expect(items[2].kind == .subscription)
    }

    @Test func dropsOutOfWindowInactiveAndDateless() throws {
        let farAway = try makeLoan(id: "23333333-3333-3333-3333-333333333333", name: "Car", type: "auto", emi: "9000", due: utcDate(2026, 8, 15))
        let dateless = try makeLoan(id: "33333333-3333-3333-3333-333333333333", name: "Personal", type: "personal", emi: "5000", due: nil)
        let paused = try makeRecurring(id: "54444444-4444-4444-4444-444444444444", name: "Gym", type: "bill", status: "paused", amount: "1500", due: utcDate(2026, 7, 14))
        let transfer = try makeRecurring(id: "64444444-4444-4444-4444-444444444444", name: "To savings", type: "transfer", status: "active", amount: "10000", due: utcDate(2026, 7, 14))

        let items = UpcomingFeed.build(loans: [farAway, dateless], recurring: [paused, transfer], today: today)
        #expect(items.isEmpty)
    }

    @Test func tieBreaksByAmountDescending() throws {
        let a = try makeRecurring(id: "74444444-4444-4444-4444-444444444444", name: "Small", type: "bill", status: "active", amount: "100", due: utcDate(2026, 7, 15))
        let b = try makeRecurring(id: "84444444-4444-4444-4444-444444444444", name: "Big", type: "bill", status: "active", amount: "900", due: utcDate(2026, 7, 15))
        let items = UpcomingFeed.build(loans: [], recurring: [a, b], today: today)
        #expect(items.map(\.title) == ["Big", "Small"])
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path ios/AalsiFinanceKit`
Expected: FAIL — `UpcomingFeed` not found.

- [ ] **Step 3: Implement**

`ios/AalsiFinanceKit/Sources/AalsiFinanceKit/UpcomingFeed.swift`:

```swift
import Foundation

public struct UpcomingItem: Equatable, Identifiable, Sendable {
    public enum Kind: String, Sendable { case emi, cardMinimum, subscription, bill, income, other }
    public let id: String
    public let title: String
    public let amount: Decimal?
    public let currency: String
    public let dueDate: Date
    public let kind: Kind
    public let isUrgent: Bool
}

public enum UpcomingFeed {
    private static var utcCalendar: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }

    public static func build(loans: [Loan], recurring: [RecurringSeries], today: Date, windowDays: Int = 14) -> [UpcomingItem] {
        let cal = utcCalendar
        let windowStart = cal.startOfDay(for: today)
        guard let windowEnd = cal.date(byAdding: .day, value: windowDays, to: windowStart) else { return [] }

        func inWindow(_ date: Date) -> Bool { date >= windowStart && date <= windowEnd }
        func urgent(_ date: Date) -> Bool { cal.isDate(date, inSameDayAs: today) }

        var items: [UpcomingItem] = []

        for loan in loans {
            guard let due = loan.nextDueDate, inWindow(due) else { continue }
            items.append(UpcomingItem(
                id: "loan-\(loan.id.uuidString.lowercased())",
                title: loan.name,
                amount: loan.minOrEmiAmount?.value,
                currency: loan.currency,
                dueDate: due,
                kind: loan.isCreditCard ? .cardMinimum : .emi,
                isUrgent: urgent(due)
            ))
        }

        for series in recurring {
            guard series.status == "active", series.type != "transfer",
                  let due = series.nextDueDate, inWindow(due) else { continue }
            let kind: UpcomingItem.Kind = switch series.type {
            case "subscription": .subscription
            case "bill": .bill
            case "income": .income
            default: .other
            }
            items.append(UpcomingItem(
                id: "recurring-\(series.id.uuidString.lowercased())",
                title: series.name,
                amount: series.amount?.value,
                currency: series.currency,
                dueDate: due,
                kind: kind,
                isUrgent: urgent(due)
            ))
        }

        return items.sorted { lhs, rhs in
            if lhs.dueDate != rhs.dueDate { return lhs.dueDate < rhs.dueDate }
            return (lhs.amount ?? -1) > (rhs.amount ?? -1)
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path ios/AalsiFinanceKit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ios/AalsiFinanceKit
git commit -m "feat(ios): add upcoming payments feed derivation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: ForecastMath (TDD)

Powers the Home hero: projected month-end leftover, delta vs plan, and the history+projection curve.

**Files:**
- Create: `ios/AalsiFinanceKit/Sources/AalsiFinanceKit/ForecastMath.swift`
- Test: `ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/ForecastMathTests.swift`

**Interfaces:**
- Consumes: nothing model-specific (pure `Decimal` math; VM adapts API models in Task 9).
- Produces:

```swift
public struct ForecastInput: Sendable {
    public let incomeMonthly: Decimal
    public let recurringMonthly: Decimal
    public let debtEmiMonthly: Decimal
    public let cardMinMonthly: Decimal
    public let dailyDiscretionary: [Decimal] // one entry per elapsed day, index 0 = day 1
    public let plannedDiscretionaryMonthly: Decimal?
    public let daysInMonth: Int
    public init(incomeMonthly: Decimal, recurringMonthly: Decimal, debtEmiMonthly: Decimal,
                cardMinMonthly: Decimal, dailyDiscretionary: [Decimal],
                plannedDiscretionaryMonthly: Decimal?, daysInMonth: Int)
}

public struct ForecastPoint: Equatable, Sendable {
    public let day: Int          // 1-based day of month
    public let value: Decimal
    public let isProjected: Bool
}

public struct Forecast: Equatable, Sendable {
    public let projectedLeftover: Decimal
    public let deltaVsPlan: Decimal
    public let isOnTrack: Bool
    public let points: [ForecastPoint]
}

public enum ForecastMath {
    public static func forecast(_ input: ForecastInput) -> Forecast
}
```

Semantics (deterministic; tests pin these):
- `dayOfMonth = dailyDiscretionary.count` (≥ 1 expected; if 0, treat spentToDate = 0 and dayOfMonth = 1)
- `fixedAvailable = income − recurring − emi − cardMin`
- `spentToDate = Σ dailyDiscretionary`
- `projectedDiscretionary = spentToDate / dayOfMonth × daysInMonth`
- `projectedLeftover = fixedAvailable − projectedDiscretionary`
- `planLeftover = fixedAvailable − (plannedDiscretionaryMonthly ?? projectedDiscretionary)`
- `deltaVsPlan = projectedLeftover − planLeftover` (zero when no plan)
- `isOnTrack = deltaVsPlan >= 0`
- History points for d in 1...dayOfMonth: `value = fixedAvailable × d/daysInMonth − cumulativeDiscretionary(d)`, `isProjected = false`
- Projection points for d in (dayOfMonth+1)...daysInMonth: linear interpolation from the last history value to `projectedLeftover` at `daysInMonth`, `isProjected = true`
- `points.count == daysInMonth`; `points.last!.value == projectedLeftover` (when dayOfMonth < daysInMonth)

- [ ] **Step 1: Write failing tests**

`ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/ForecastMathTests.swift`:

```swift
import Foundation
import Testing
@testable import AalsiFinanceKit

@Suite struct ForecastMathTests {
    // income 110000, recurring 20000, emi 18400, cardMin 3200 → fixedAvailable 68400
    private func input(daily: [Decimal], planned: Decimal?, daysInMonth: Int = 30) -> ForecastInput {
        ForecastInput(
            incomeMonthly: 110_000, recurringMonthly: 20_000,
            debtEmiMonthly: 18_400, cardMinMonthly: 3_200,
            dailyDiscretionary: daily,
            plannedDiscretionaryMonthly: planned,
            daysInMonth: daysInMonth
        )
    }

    @Test func projectsLeftoverProRata() {
        // 10 days elapsed, 15000 spent → projected 45000 → leftover 23400
        let f = ForecastMath.forecast(input(daily: Array(repeating: 1_500, count: 10), planned: nil))
        #expect(f.projectedLeftover == 23_400)
        #expect(f.deltaVsPlan == 0)
        #expect(f.isOnTrack)
    }

    @Test func deltaAgainstPlannedBudget() {
        // planned discretionary 30000 → planLeftover 38400; projected 45000 → leftover 23400 → delta -15000
        let f = ForecastMath.forecast(input(daily: Array(repeating: 1_500, count: 10), planned: 30_000))
        #expect(f.deltaVsPlan == -15_000)
        #expect(!f.isOnTrack)

        // spending slower than plan → positive delta
        let g = ForecastMath.forecast(input(daily: Array(repeating: 500, count: 10), planned: 30_000))
        #expect(g.deltaVsPlan == 15_000)
        #expect(g.isOnTrack)
    }

    @Test func curveShape() {
        let f = ForecastMath.forecast(input(daily: Array(repeating: 1_500, count: 10), planned: nil))
        #expect(f.points.count == 30)
        #expect(f.points.prefix(10).allSatisfy { !$0.isProjected })
        #expect(f.points.dropFirst(10).allSatisfy { $0.isProjected })
        #expect(f.points.last?.value == f.projectedLeftover)
        // day 10 history value: 68400 * 10/30 - 15000 = 7800
        #expect(f.points[9].value == 7_800)
    }

    @Test func emptyDaysDoesNotCrash() {
        let f = ForecastMath.forecast(input(daily: [], planned: nil))
        #expect(f.projectedLeftover == 68_400)
        #expect(f.points.count == 30)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path ios/AalsiFinanceKit`
Expected: FAIL — `ForecastMath` not found.

- [ ] **Step 3: Implement**

`ios/AalsiFinanceKit/Sources/AalsiFinanceKit/ForecastMath.swift`:

```swift
import Foundation

public struct ForecastInput: Sendable {
    public let incomeMonthly: Decimal
    public let recurringMonthly: Decimal
    public let debtEmiMonthly: Decimal
    public let cardMinMonthly: Decimal
    public let dailyDiscretionary: [Decimal]
    public let plannedDiscretionaryMonthly: Decimal?
    public let daysInMonth: Int

    public init(incomeMonthly: Decimal, recurringMonthly: Decimal, debtEmiMonthly: Decimal,
                cardMinMonthly: Decimal, dailyDiscretionary: [Decimal],
                plannedDiscretionaryMonthly: Decimal?, daysInMonth: Int) {
        self.incomeMonthly = incomeMonthly
        self.recurringMonthly = recurringMonthly
        self.debtEmiMonthly = debtEmiMonthly
        self.cardMinMonthly = cardMinMonthly
        self.dailyDiscretionary = dailyDiscretionary
        self.plannedDiscretionaryMonthly = plannedDiscretionaryMonthly
        self.daysInMonth = daysInMonth
    }
}

public struct ForecastPoint: Equatable, Sendable {
    public let day: Int
    public let value: Decimal
    public let isProjected: Bool
}

public struct Forecast: Equatable, Sendable {
    public let projectedLeftover: Decimal
    public let deltaVsPlan: Decimal
    public let isOnTrack: Bool
    public let points: [ForecastPoint]
}

public enum ForecastMath {
    public static func forecast(_ input: ForecastInput) -> Forecast {
        let fixedAvailable = input.incomeMonthly - input.recurringMonthly
            - input.debtEmiMonthly - input.cardMinMonthly
        let dayOfMonth = max(input.dailyDiscretionary.count, 1)
        let daysInMonth = max(input.daysInMonth, dayOfMonth)
        let spentToDate = input.dailyDiscretionary.reduce(Decimal.zero, +)
        let projectedDiscretionary = spentToDate / Decimal(dayOfMonth) * Decimal(daysInMonth)
        let projectedLeftover = fixedAvailable - projectedDiscretionary
        let planLeftover = fixedAvailable - (input.plannedDiscretionaryMonthly ?? projectedDiscretionary)
        let deltaVsPlan = projectedLeftover - planLeftover

        var points: [ForecastPoint] = []
        var cumulative = Decimal.zero
        for day in 1...dayOfMonth {
            if day <= input.dailyDiscretionary.count {
                cumulative += input.dailyDiscretionary[day - 1]
            }
            let value = fixedAvailable * Decimal(day) / Decimal(daysInMonth) - cumulative
            points.append(ForecastPoint(day: day, value: value, isProjected: false))
        }
        if dayOfMonth < daysInMonth, let lastHistory = points.last {
            let remaining = daysInMonth - dayOfMonth
            let step = (projectedLeftover - lastHistory.value) / Decimal(remaining)
            for offset in 1...remaining {
                let value = offset == remaining
                    ? projectedLeftover
                    : lastHistory.value + step * Decimal(offset)
                points.append(ForecastPoint(day: dayOfMonth + offset, value: value, isProjected: true))
            }
        }

        return Forecast(
            projectedLeftover: projectedLeftover,
            deltaVsPlan: deltaVsPlan,
            isOnTrack: deltaVsPlan >= 0,
            points: points
        )
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path ios/AalsiFinanceKit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ios/AalsiFinanceKit
git commit -m "feat(ios): add month-end forecast math

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Theme — Kit enums + AppTheme + Appearance settings + root application

**Files:**
- Create: `ios/AalsiFinanceKit/Sources/AalsiFinanceKit/Theme.swift`
- Test: `ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/ThemeTests.swift`
- Create: `ios/AalsiFinance/AalsiFinance/App/AppTheme.swift`
- Modify: `ios/AalsiFinance/AalsiFinance/App/AalsiFinanceApp.swift`
- Modify: `ios/AalsiFinance/AalsiFinance/Features/Settings/SettingsView.swift`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Kit: `public enum ThemeMode: String, CaseIterable, Codable, Sendable { case system, dark, light }` with `public var label: String` ("System"/"Dark"/"Light"); `public enum AccentChoice: String, CaseIterable, Codable, Sendable { case indigo, teal, coral, pink, amber, green }` with `public var label: String`.
  - App: `@MainActor @Observable final class AppTheme` with `var mode: ThemeMode`, `var accent: AccentChoice` (both persisted to `UserDefaults` under keys `"theme.mode"` / `"theme.accent"` on didSet, read back in `init()`), `var accentColor: Color` (indigo/teal/orange… mapping below), `var colorScheme: ColorScheme?` (`nil` for `.system`, `.dark`, `.light`).
  - Environment: `AppTheme` injected via `.environment(theme)` at the root; every view reads `@Environment(AppTheme.self)`.

- [ ] **Step 1: Write failing Kit tests**

`ios/AalsiFinanceKit/Tests/AalsiFinanceKitTests/ThemeTests.swift`:

```swift
import Testing
@testable import AalsiFinanceKit

@Suite struct ThemeTests {
    @Test func rawValuesRoundTrip() {
        for mode in ThemeMode.allCases {
            #expect(ThemeMode(rawValue: mode.rawValue) == mode)
        }
        for accent in AccentChoice.allCases {
            #expect(AccentChoice(rawValue: accent.rawValue) == accent)
        }
    }

    @Test func defaultsAndLabels() {
        #expect(ThemeMode.system.label == "System")
        #expect(AccentChoice.indigo.label == "Indigo")
        #expect(AccentChoice.allCases.count == 6)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path ios/AalsiFinanceKit`
Expected: FAIL.

- [ ] **Step 3: Implement Kit enums**

`ios/AalsiFinanceKit/Sources/AalsiFinanceKit/Theme.swift`:

```swift
public enum ThemeMode: String, CaseIterable, Codable, Sendable {
    case system, dark, light

    public var label: String {
        switch self {
        case .system: "System"
        case .dark: "Dark"
        case .light: "Light"
        }
    }
}

public enum AccentChoice: String, CaseIterable, Codable, Sendable {
    case indigo, teal, coral, pink, amber, green

    public var label: String { rawValue.prefix(1).uppercased() + rawValue.dropFirst() }
}
```

- [ ] **Step 4: Run Kit tests to verify they pass**

Run: `swift test --package-path ios/AalsiFinanceKit`
Expected: PASS.

- [ ] **Step 5: Add AppTheme in the app**

`ios/AalsiFinance/AalsiFinance/App/AppTheme.swift`:

```swift
import SwiftUI
import Observation
import AalsiFinanceKit

/// User-selected appearance: color scheme + accent. Persisted in UserDefaults;
/// injected at the root so every screen tints consistently.
@MainActor
@Observable
final class AppTheme {
    var mode: ThemeMode {
        didSet { UserDefaults.standard.set(mode.rawValue, forKey: Self.modeKey) }
    }
    var accent: AccentChoice {
        didSet { UserDefaults.standard.set(accent.rawValue, forKey: Self.accentKey) }
    }

    private static let modeKey = "theme.mode"
    private static let accentKey = "theme.accent"

    init() {
        mode = UserDefaults.standard.string(forKey: Self.modeKey).flatMap(ThemeMode.init) ?? .system
        accent = UserDefaults.standard.string(forKey: Self.accentKey).flatMap(AccentChoice.init) ?? .indigo
    }

    var colorScheme: ColorScheme? {
        switch mode {
        case .system: nil
        case .dark: .dark
        case .light: .light
        }
    }

    var accentColor: Color {
        Self.color(for: accent)
    }

    static func color(for accent: AccentChoice) -> Color {
        switch accent {
        case .indigo: .indigo
        case .teal: .teal
        case .coral: .orange
        case .pink: .pink
        case .amber: .yellow
        case .green: .green
        }
    }
}
```

- [ ] **Step 6: Apply at the root**

In `ios/AalsiFinance/AalsiFinance/App/AalsiFinanceApp.swift`, add a `@State private var theme = AppTheme()` and chain onto the existing root view (keep whatever is already there):

```swift
RootView()
    .environment(theme)
    .tint(theme.accentColor)
    .preferredColorScheme(theme.colorScheme)
```

- [ ] **Step 7: Add the Appearance section to Settings**

In `SettingsView.swift`, add `@Environment(AppTheme.self) private var theme` and insert this section between the "Server" section and the "Coming soon" section:

```swift
Section("Appearance") {
    @Bindable var theme = theme
    Picker("Theme", selection: $theme.mode) {
        ForEach(ThemeMode.allCases, id: \.self) { mode in
            Text(mode.label).tag(mode)
        }
    }
    .pickerStyle(.segmented)

    HStack(spacing: 12) {
        ForEach(AccentChoice.allCases, id: \.self) { accent in
            Button {
                theme.accent = accent
            } label: {
                Circle()
                    .fill(AppTheme.color(for: accent))
                    .frame(width: 30, height: 30)
                    .overlay {
                        if theme.accent == accent {
                            Image(systemName: "checkmark")
                                .font(.caption.bold())
                                .foregroundStyle(.white)
                        }
                    }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(accent.label)
        }
    }
    .padding(.vertical, 4)
}
```

Also add `import AalsiFinanceKit` to `SettingsView.swift` if Task 2 didn't already.

- [ ] **Step 8: Build to verify**

Run the Global Constraints build command.
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 9: Commit**

```bash
git add ios/
git commit -m "feat(ios): add theme mode and accent personalization

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: APIClient endpoints for phase-1 surfaces

**Files:**
- Modify: `ios/AalsiFinance/AalsiFinance/Networking/APIClient.swift` (extend the endpoint-helpers extension at the bottom)

**Interfaces:**
- Consumes: models from Task 3.
- Produces (exact signatures later tasks call):

```swift
func loans() async throws -> [Loan]
func creditCards() async throws -> [CreditCardSummary]
func recurringSeries() async throws -> [RecurringSeries]
func incomeSources() async throws -> [IncomeSource]
func holdings() async throws -> [Holding]
func loanSchedule(loanId: UUID) async throws -> [PaymentScheduleEntry]
func monitorAlerts(from: Date, to: Date) async throws -> MonitorOut
```

- [ ] **Step 1: Add the endpoint helpers**

Append inside the existing `extension APIClient { ... }` block:

```swift
func loans() async throws -> [Loan] {
    try await get("/loans")
}

func creditCards() async throws -> [CreditCardSummary] {
    try await get("/credit-cards")
}

func recurringSeries() async throws -> [RecurringSeries] {
    try await get("/recurring-series", query: [URLQueryItem(name: "status", value: "active")])
}

func incomeSources() async throws -> [IncomeSource] {
    try await get("/income-sources")
}

func holdings() async throws -> [Holding] {
    try await get("/holdings")
}

func loanSchedule(loanId: UUID) async throws -> [PaymentScheduleEntry] {
    try await get("/loans/\(loanId.uuidString.lowercased())/schedule")
}

func monitorAlerts(from: Date, to: Date) async throws -> MonitorOut {
    try await get("/analyst/monitor", query: [
        URLQueryItem(name: "from", value: Self.dateParam(from)),
        URLQueryItem(name: "to", value: Self.dateParam(to)),
    ])
}
```

- [ ] **Step 2: Build to verify**

Run the Global Constraints build command.
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 3: Live check against the backend (backend must be up via docker)**

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"ios.demo@example.com","password":"ios-demo-pass-1"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
for p in /loans /credit-cards '/recurring-series?status=active' /income-sources /holdings '/analyst/monitor?from=2026-06-12&to=2026-07-12'; do
  echo "== $p: $(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "http://localhost:8000$p")"
done
```

Expected: `200` for every path. If any 4xx/5xx, stop and investigate before continuing.

- [ ] **Step 4: Commit**

```bash
git add ios/AalsiFinance/AalsiFinance/Networking/APIClient.swift
git commit -m "feat(ios): add loans, cards, recurring, income, monitor endpoints

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Reusable components + persistent chrome (header, settings sheet, notifications)

**Files:**
- Create: `ios/AalsiFinance/AalsiFinance/Components/PillNav.swift`
- Create: `ios/AalsiFinance/AalsiFinance/Components/StatTile.swift`
- Create: `ios/AalsiFinance/AalsiFinance/Components/Sparklines.swift`
- Create: `ios/AalsiFinance/AalsiFinance/Components/SectionHeaderLink.swift`
- Create: `ios/AalsiFinance/AalsiFinance/Chrome/AppHeader.swift`
- Create: `ios/AalsiFinance/AalsiFinance/Chrome/NotificationsView.swift`

**Interfaces:**
- Consumes: `AppTheme` (Task 6), `APIClient.monitorAlerts` (Task 7), existing `card()` modifier, `ErrorStateView`, `LoadingCard`.
- Produces:
  - `struct PillNav: View` — `init(items: [String], selection: Binding<Int>)`; horizontal scrollable pill row; selected pill filled with `theme.accentColor`, others `Color(.secondarySystemGroupedBackground)`.
  - `struct StatTile<Accessory: View>: View` — `init(title: String, value: String, caption: String? = nil, captionColor: Color = .secondary, @ViewBuilder accessory: () -> Accessory)`; fixed-height (≈96pt content) card tile.
  - `struct LineSparkline: View` — `init(values: [Double], color: Color)`; axis-less Charts `LineMark`, `catmullRom` interpolation, height set by the caller via `.frame`.
  - `struct BarSparkline: View` — `init(values: [Double], color: Color)`; axis-less `BarMark`.
  - `struct SectionHeaderLink: View` — `init(title: String, action: (() -> Void)? = nil)`; left title (`.headline`), right "View all ›" button when `action != nil`.
  - `struct AppHeader: View` — `init(title: String, subtitle: String? = nil, greeting: Bool = false)`; leading avatar circle button (initial letter, accent-tinted) presenting `SettingsView` in a `.sheet`; trailing bell button presenting `NotificationsView` in a `.sheet`. When `greeting == true`, renders the two-line "Good morning," + name form (name from `/household` is not fetched here — show the title passed in).
  - `struct NotificationsView: View` — loads `monitorAlerts(from: today−30d, to: today)`, lists alerts (icon by `tone`: "warning" → `exclamationmark.triangle.fill` orange, "positive" → `checkmark.circle.fill` green, else `info.circle.fill` accent), `title` + `detail` rows; swipe action "Acknowledge" POSTs `/analyst/alerts/{id}/acknowledge` via a small inline `api.post` call and removes the row.

- [ ] **Step 1: Implement PillNav**

`ios/AalsiFinance/AalsiFinance/Components/PillNav.swift`:

```swift
import SwiftUI

/// Page-specific sub-navigation. First pill is the page's main (99%) view;
/// the rest are niche value-adds.
struct PillNav: View {
    @Environment(AppTheme.self) private var theme
    let items: [String]
    @Binding var selection: Int

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(items.indices, id: \.self) { index in
                    Button {
                        withAnimation(.snappy) { selection = index }
                    } label: {
                        Text(items[index])
                            .font(.subheadline.weight(selection == index ? .semibold : .regular))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 7)
                            .background(
                                selection == index ? theme.accentColor : Color(.secondarySystemGroupedBackground),
                                in: .capsule
                            )
                            .foregroundStyle(selection == index ? Color(.systemBackground) : .primary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20)
        }
        .scrollClipDisabled()
    }
}
```

- [ ] **Step 2: Implement StatTile, Sparklines, SectionHeaderLink**

`ios/AalsiFinance/AalsiFinance/Components/StatTile.swift`:

```swift
import SwiftUI

struct StatTile<Accessory: View>: View {
    let title: String
    let value: String
    var caption: String?
    var captionColor: Color = .secondary
    @ViewBuilder var accessory: Accessory

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.headline)
                .fontDesign(.rounded)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let caption {
                Text(caption)
                    .font(.caption2)
                    .foregroundStyle(captionColor)
                    .lineLimit(1)
            }
            Spacer(minLength: 2)
            accessory
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 104, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}
```

`ios/AalsiFinance/AalsiFinance/Components/Sparklines.swift`:

```swift
import SwiftUI
import Charts

struct LineSparkline: View {
    let values: [Double]
    let color: Color

    var body: some View {
        Chart(Array(values.enumerated()), id: \.offset) { index, value in
            LineMark(x: .value("Index", index), y: .value("Value", value))
                .foregroundStyle(color)
                .interpolationMethod(.catmullRom)
                .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartYScale(domain: .automatic(includesZero: false))
    }
}

struct BarSparkline: View {
    let values: [Double]
    let color: Color

    var body: some View {
        Chart(Array(values.enumerated()), id: \.offset) { index, value in
            BarMark(x: .value("Index", index), y: .value("Value", value), width: .ratio(0.55))
                .foregroundStyle(color)
                .cornerRadius(1.5)
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
    }
}
```

`ios/AalsiFinance/AalsiFinance/Components/SectionHeaderLink.swift`:

```swift
import SwiftUI

struct SectionHeaderLink: View {
    let title: String
    var action: (() -> Void)?

    var body: some View {
        HStack {
            Text(title).font(.headline)
            Spacer()
            if let action {
                Button(action: action) {
                    HStack(spacing: 2) {
                        Text("View all")
                        Image(systemName: "chevron.right")
                            .font(.caption2.weight(.semibold))
                    }
                    .font(.subheadline)
                }
            }
        }
        .padding(.horizontal, 4)
    }
}
```

- [ ] **Step 3: Implement AppHeader**

`ios/AalsiFinance/AalsiFinance/Chrome/AppHeader.swift`:

```swift
import SwiftUI

/// Persistent chrome for every tab: avatar (settings sheet) on the left,
/// notifications bell on the right. `greeting` renders Home's two-line form.
struct AppHeader: View {
    @Environment(AppTheme.self) private var theme
    let title: String
    var subtitle: String?
    var greeting = false

    @State private var showsSettings = false
    @State private var showsNotifications = false

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Button {
                showsSettings = true
            } label: {
                Circle()
                    .fill(theme.accentColor.opacity(0.25))
                    .frame(width: 36, height: 36)
                    .overlay {
                        Text(String(title.prefix(1)))
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(theme.accentColor)
                    }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Profile and settings")

            VStack(alignment: .leading, spacing: 0) {
                if greeting {
                    Text(greetingLine)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(title)
                    .font(greeting ? .title3.weight(.semibold) : .title2.weight(.semibold))
                if let subtitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            Button {
                showsNotifications = true
            } label: {
                Image(systemName: "bell")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(.secondary)
            }
            .accessibilityLabel("Notifications")
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .sheet(isPresented: $showsSettings) { SettingsView() }
        .sheet(isPresented: $showsNotifications) { NotificationsView() }
    }

    private var greetingLine: String {
        let hour = Calendar.current.component(.hour, from: .now)
        switch hour {
        case 5..<12: return "Good morning,"
        case 12..<17: return "Good afternoon,"
        default: return "Good evening,"
        }
    }
}
```

- [ ] **Step 4: Implement NotificationsView**

`ios/AalsiFinance/AalsiFinance/Chrome/NotificationsView.swift`:

```swift
import SwiftUI
import AalsiFinanceKit

struct NotificationsView: View {
    @Environment(AppSession.self) private var session
    @State private var alerts: [PersistentAlert] = []
    @State private var state: Loadable<Bool> = .idle

    var body: some View {
        NavigationStack {
            Group {
                switch state {
                case .idle, .loading:
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                case .failed(let message):
                    ErrorStateView(message: message) { Task { await load() } }
                case .loaded:
                    if alerts.isEmpty {
                        ContentUnavailableView(
                            "You're all caught up",
                            systemImage: "bell",
                            description: Text("Alerts about spending, dues, and budgets show up here.")
                        )
                    } else {
                        List {
                            ForEach(alerts) { alert in
                                HStack(alignment: .top, spacing: 12) {
                                    Image(systemName: icon(for: alert.tone))
                                        .foregroundStyle(color(for: alert.tone))
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(alert.title).font(.subheadline.weight(.medium))
                                        Text(alert.detail).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                                .swipeActions {
                                    Button("Acknowledge") { Task { await acknowledge(alert) } }
                                        .tint(.green)
                                }
                            }
                        }
                        .listStyle(.insetGrouped)
                    }
                }
            }
            .navigationTitle("Notifications")
            .navigationBarTitleDisplayMode(.inline)
        }
        .task { await load() }
    }

    private func load() async {
        state = .loading
        do {
            let to = Date()
            let from = Calendar.current.date(byAdding: .day, value: -30, to: to) ?? to
            alerts = try await session.api.monitorAlerts(from: from, to: to)
                .alerts
                .filter { $0.state == "active" }
                .sorted { $0.severity > $1.severity }
            state = .loaded(true)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    private func acknowledge(_ alert: PersistentAlert) async {
        struct Empty: Decodable {}
        _ = try? await session.api.post("/analyst/alerts/\(alert.id)/acknowledge") as Empty
        alerts.removeAll { $0.id == alert.id }
    }

    private func icon(for tone: String) -> String {
        switch tone {
        case "warning", "negative": "exclamationmark.triangle.fill"
        case "positive": "checkmark.circle.fill"
        default: "info.circle.fill"
        }
    }

    private func color(for tone: String) -> Color {
        switch tone {
        case "warning", "negative": .orange
        case "positive": .green
        default: .blue
        }
    }
}
```

Note: if the acknowledge response isn't decodable as an object, adjust to ignore the body — the row removal is optimistic either way.

- [ ] **Step 5: Build to verify**

Run the Global Constraints build command.
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 6: Commit**

```bash
git add ios/AalsiFinance/AalsiFinance/Components ios/AalsiFinance/AalsiFinance/Chrome
git commit -m "feat(ios): add pill nav, stat tiles, sparklines, persistent chrome

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: HomeViewModel rewrite

**Files:**
- Modify: `ios/AalsiFinance/AalsiFinance/Features/Home/HomeViewModel.swift` (full rewrite)

**Interfaces:**
- Consumes: `APIClient` endpoints (Tasks 7 + existing), `ForecastMath`, `UpcomingFeed` (Tasks 4–5).
- Produces:

```swift
@MainActor @Observable final class HomeViewModel {
    struct Snapshot: Sendable {
        let cashflow: CashflowSummary
        let netWorth: NetWorth
        let forecast: Forecast
        let upcoming: [UpcomingItem]
        let insights: [PersistentAlert]
        let recent: [Transaction]
        let categoryNames: [UUID: String]
    }
    private(set) var state: Loadable<Snapshot>
    func load(api: APIClient, force: Bool = false) async
}
```

- [ ] **Step 1: Rewrite the view model**

Full new content of `HomeViewModel.swift`:

```swift
import Foundation
import Observation
import AalsiFinanceKit

@MainActor
@Observable
final class HomeViewModel {
    struct Snapshot: Sendable {
        let cashflow: CashflowSummary
        let netWorth: NetWorth
        let forecast: Forecast
        let upcoming: [UpcomingItem]
        let insights: [PersistentAlert]
        let recent: [Transaction]
        let categoryNames: [UUID: String]
    }

    private(set) var state: Loadable<Snapshot> = .idle

    func load(api: APIClient, force: Bool = false) async {
        if case .loaded = state, !force { return }
        if case .idle = state { state = .loading }
        do {
            let now = Date()
            var cal = Calendar(identifier: .gregorian)
            cal.timeZone = TimeZone(identifier: "UTC")!
            let monthStart = cal.date(from: cal.dateComponents([.year, .month], from: now))!
            let monthFrom = cal.date(byAdding: .day, value: -30, to: now)!

            async let cashflow = api.cashflowSummary()
            async let netWorth = api.netWorth()
            async let budgets = api.budgets()
            async let transactions = api.transactions()
            async let categories = api.categories()
            async let loans = api.loans()
            async let recurring = api.recurringSeries()
            async let monitor = api.monitorAlerts(from: monthFrom, to: now)

            let cats = try await categories
            let names = Dictionary(uniqueKeysWithValues: cats.map { ($0.id, $0.name) })
            let txns = try await transactions
            let flow = try await cashflow

            let forecast = ForecastMath.forecast(Self.forecastInput(
                cashflow: flow,
                budgets: try await budgets,
                transactions: txns,
                categories: cats,
                monthStart: monthStart,
                now: now,
                calendar: cal
            ))
            let upcoming = UpcomingFeed.build(
                loans: try await loans,
                recurring: try await recurring,
                today: now
            )
            let insights = (try? await monitor)?.alerts
                .filter { $0.state == "active" }
                .sorted { $0.severity > $1.severity } ?? []

            state = .loaded(Snapshot(
                cashflow: flow,
                netWorth: try await netWorth,
                forecast: forecast,
                upcoming: upcoming,
                insights: insights,
                recent: Array(txns.prefix(4)),
                categoryNames: names
            ))
        } catch {
            if state.value == nil {
                state = .failed(error.localizedDescription)
            }
        }
    }

    /// Maps API data onto the pure forecast input. Discretionary spend =
    /// confirmed positive-amount transactions this month whose category is not
    /// an income kind (sign convention: negative amount = credit).
    static func forecastInput(
        cashflow: CashflowSummary,
        budgets: [Budget],
        transactions: [Transaction],
        categories: [Category],
        monthStart: Date,
        now: Date,
        calendar: Calendar
    ) -> ForecastInput {
        let incomeCategoryIds = Set(categories.filter { $0.kind == "income" }.map(\.id))
        let dayOfMonth = calendar.component(.day, from: now)
        let daysInMonth = calendar.range(of: .day, in: .month, for: now)?.count ?? 30

        var daily = [Decimal](repeating: .zero, count: dayOfMonth)
        for txn in transactions where !txn.isDraft && txn.txnDate >= monthStart && txn.txnDate <= now {
            guard !txn.amount.isNegative else { continue }
            if let categoryId = txn.categoryId, incomeCategoryIds.contains(categoryId) { continue }
            let day = calendar.component(.day, from: txn.txnDate)
            if day >= 1 && day <= dayOfMonth {
                daily[day - 1] += txn.amount.value
            }
        }

        let monthlyBudgetTotal = budgets
            .filter { $0.period == "monthly" }
            .reduce(Decimal.zero) { $0 + $1.amount.value }

        return ForecastInput(
            incomeMonthly: cashflow.incomeMonthly.value,
            recurringMonthly: cashflow.recurringMonthly.value,
            debtEmiMonthly: cashflow.debtEmiMonthly.value,
            cardMinMonthly: cashflow.cardMinMonthly.value,
            dailyDiscretionary: daily,
            plannedDiscretionaryMonthly: monthlyBudgetTotal > 0 ? monthlyBudgetTotal : nil,
            daysInMonth: daysInMonth
        )
    }
}
```

- [ ] **Step 2: Build to verify** (HomeView still uses old snapshot fields — expect failures ONLY in `HomeView.swift`; if so, proceed to Task 10 before committing, or temporarily keep the old fields compiling by doing Tasks 9+10 as one commit)

Run the Global Constraints build command.
Expected: errors only in `HomeView.swift` (missing `budgets` member). That is the Task 10 rewrite; do NOT commit yet — continue directly into Task 10 and commit both together.

---

### Task 10: HomeView rebuild (hero, strip, tiles, upcoming, insights)

**Files:**
- Modify: `ios/AalsiFinance/AalsiFinance/Features/Home/HomeView.swift` (full rewrite)

**Interfaces:**
- Consumes: `HomeViewModel.Snapshot` (Task 9), `AppHeader`, `StatTile`, `LineSparkline`, `BarSparkline`, `SectionHeaderLink` (Task 8), `AppTheme`, `MoneyText`, `TransactionRow`, `UpcomingItem`, `Forecast`.
- Produces: the new Home screen. Layout top-to-bottom: `AppHeader(greeting)`, forecast hero card, financial-health tile row (3 tiles), Upcoming card (max 3 rows), AI insights horizontal rail, recent-activity mini card.

- [ ] **Step 1: Rewrite HomeView**

Full new content of `HomeView.swift`:

```swift
import SwiftUI
import Charts
import AalsiFinanceKit

struct HomeView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppTheme.self) private var theme
    @State private var model = HomeViewModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    AppHeader(title: "Kshitij", subtitle: "Here's your financial overview", greeting: true)

                    switch model.state {
                    case .idle, .loading:
                        VStack(spacing: 14) {
                            LoadingCard(height: 190)
                            LoadingCard(height: 104)
                            LoadingCard(height: 160)
                        }
                        .padding(.horizontal, 20)
                    case .failed(let message):
                        ErrorStateView(message: message) {
                            Task { await model.load(api: session.api, force: true) }
                        }
                        .padding(.top, 40)
                    case .loaded(let snapshot):
                        content(snapshot)
                    }
                }
            }
            .background(Color(.systemGroupedBackground))
            .scrollEdgeEffectStyle(.soft, for: .top)
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await model.load(api: session.api, force: true) }
        }
        .task { await model.load(api: session.api) }
    }

    @ViewBuilder
    private func content(_ snapshot: HomeViewModel.Snapshot) -> some View {
        VStack(spacing: 18) {
            ForecastHeroCard(forecast: snapshot.forecast, cashflow: snapshot.cashflow)
                .padding(.horizontal, 20)

            healthTiles(snapshot)
                .padding(.horizontal, 20)

            if !snapshot.upcoming.isEmpty {
                VStack(spacing: 10) {
                    SectionHeaderLink(title: "Upcoming")
                    VStack(spacing: 0) {
                        ForEach(snapshot.upcoming.prefix(3)) { item in
                            UpcomingRowView(item: item)
                            if item.id != snapshot.upcoming.prefix(3).last?.id {
                                Divider().padding(.leading, 54)
                            }
                        }
                    }
                    .card()
                }
                .padding(.horizontal, 20)
            }

            if !snapshot.insights.isEmpty {
                VStack(spacing: 10) {
                    SectionHeaderLink(title: "AI insights")
                        .padding(.horizontal, 20)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(snapshot.insights.prefix(4)) { alert in
                                InsightCardView(alert: alert)
                            }
                        }
                        .padding(.horizontal, 20)
                    }
                    .scrollClipDisabled()
                }
            }

            if !snapshot.recent.isEmpty {
                VStack(spacing: 10) {
                    SectionHeaderLink(title: "Recent activity")
                    VStack(spacing: 0) {
                        ForEach(snapshot.recent) { txn in
                            TransactionRow(transaction: txn, categoryName: txn.categoryId.flatMap { snapshot.categoryNames[$0] })
                            if txn.id != snapshot.recent.last?.id {
                                Divider().padding(.leading, 52)
                            }
                        }
                    }
                    .card()
                }
                .padding(.horizontal, 20)
            }
        }
        .padding(.bottom, 24)
    }

    private func healthTiles(_ snapshot: HomeViewModel.Snapshot) -> some View {
        HStack(spacing: 10) {
            StatTile(
                title: "Cash flow",
                value: Money(snapshot.cashflow.leftoverMonthly.value).compact(code: snapshot.cashflow.currency),
                caption: "left this month"
            ) {
                BarSparkline(
                    values: snapshot.forecast.points.filter { !$0.isProjected }.suffix(10).map { NSDecimalNumber(decimal: $0.value).doubleValue },
                    color: theme.accentColor
                )
                .frame(height: 20)
            }

            StatTile(
                title: "Net worth",
                value: snapshot.netWorth.netWorth.compact(code: snapshot.netWorth.currency),
                caption: netWorthDelta(snapshot.netWorth),
                captionColor: .green
            ) {
                LineSparkline(
                    values: snapshot.netWorth.points.map { $0.netWorth.doubleValue },
                    color: .green
                )
                .frame(height: 20)
            }

            StatTile(
                title: "Debt left",
                value: snapshot.netWorth.liabilities.compact(code: snapshot.netWorth.currency),
                caption: nil
            ) {
                ProgressView(value: debtProgress(snapshot.netWorth))
                    .tint(theme.accentColor)
            }
        }
    }

    private func netWorthDelta(_ netWorth: NetWorth) -> String? {
        guard netWorth.points.count >= 2 else { return nil }
        let last = netWorth.points[netWorth.points.count - 1].netWorth.doubleValue
        let previous = netWorth.points[netWorth.points.count - 2].netWorth.doubleValue
        guard previous != 0 else { return nil }
        let pct = (last - previous) / abs(previous) * 100
        return String(format: "%@%.1f%% vs last period", pct >= 0 ? "↑ " : "↓ ", abs(pct))
    }

    private func debtProgress(_ netWorth: NetWorth) -> Double {
        let assets = netWorth.assets.doubleValue
        let debts = netWorth.liabilities.doubleValue
        guard assets + debts > 0 else { return 0 }
        return min(max(assets / (assets + debts), 0), 1)
    }
}

// MARK: - Forecast hero

private struct ForecastHeroCard: View {
    @Environment(AppTheme.self) private var theme
    let forecast: Forecast
    let cashflow: CashflowSummary
    @State private var showsBreakdown = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("AI forecast", systemImage: "sparkles")
                .font(.caption.weight(.semibold))
                .textCase(.uppercase)
                .foregroundStyle(theme.accentColor)

            Text(forecast.isOnTrack ? "You're on track" : "Heads up — over plan")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(forecast.isOnTrack ? .teal : .orange)

            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("You'll end this month with")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        MoneyText(
                            amount: Money(forecast.projectedLeftover),
                            code: cashflow.currency,
                            font: .system(size: 34, weight: .bold)
                        )
                        Text("left").font(.subheadline).foregroundStyle(.secondary)
                    }
                    if forecast.deltaVsPlan != 0 {
                        Text("\(Money(forecast.deltaVsPlan).magnitude.compact(code: cashflow.currency)) \(forecast.isOnTrack ? "ahead of" : "behind") your plan")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(forecast.isOnTrack ? .teal : .orange)
                    }
                    Button {
                        showsBreakdown = true
                    } label: {
                        HStack(spacing: 3) {
                            Text("See why")
                            Image(systemName: "chevron.right").font(.caption2.weight(.semibold))
                        }
                        .font(.caption.weight(.medium))
                    }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .controlSize(.small)
                }

                forecastChart
                    .frame(width: 120, height: 84)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular.tint(theme.accentColor.opacity(0.2)).interactive(), in: .rect(cornerRadius: 28))
        .sheet(isPresented: $showsBreakdown) { BreakdownSheet(cashflow: cashflow) }
    }

    private var forecastChart: some View {
        Chart(forecast.points, id: \.day) { point in
            LineMark(
                x: .value("Day", point.day),
                y: .value("Leftover", NSDecimalNumber(decimal: point.value).doubleValue)
            )
            .foregroundStyle(theme.accentColor)
            .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round, dash: point.isProjected ? [3, 4] : []))

            if point.day == forecast.points.last?.day {
                PointMark(
                    x: .value("Day", point.day),
                    y: .value("Leftover", NSDecimalNumber(decimal: point.value).doubleValue)
                )
                .symbolSize(50)
                .foregroundStyle(theme.accentColor)
            }
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartYScale(domain: .automatic(includesZero: false))
    }
}

/// Income − recurring − EMIs − card minimums − discretionary; the old
/// SafeToSpendCard content relocated behind "See why".
private struct BreakdownSheet: View {
    let cashflow: CashflowSummary

    var body: some View {
        NavigationStack {
            List {
                row("Income", cashflow.incomeMonthly, .green)
                row("Recurring", cashflow.recurringMonthly, .orange)
                row("EMIs", cashflow.debtEmiMonthly, .red)
                row("Card minimums", cashflow.cardMinMonthly, .pink)
                row("Discretionary so far", cashflow.discretionaryMonthly, .blue)
                row("Left over", cashflow.leftoverMonthly, .primary)
            }
            .navigationTitle("How this is calculated")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium])
    }

    private func row(_ label: String, _ amount: Money, _ color: Color) -> some View {
        HStack {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label)
            Spacer()
            MoneyText(amount: amount, code: cashflow.currency, font: .subheadline.weight(.semibold))
        }
    }
}

// MARK: - Upcoming + insights rows

struct UpcomingRowView: View {
    let item: UpcomingItem

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: iconName)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(item.isUrgent ? Color.pink : Color.secondary)
                .frame(width: 38, height: 38)
                .background(
                    (item.isUrgent ? Color.pink.opacity(0.15) : Color(.tertiarySystemFill)),
                    in: RoundedRectangle(cornerRadius: 11, style: .continuous)
                )

            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).font(.subheadline.weight(.medium)).lineLimit(1)
                Text(dueLabel)
                    .font(.caption)
                    .foregroundStyle(item.isUrgent ? .pink : .secondary)
            }

            Spacer(minLength: 8)

            if let amount = item.amount {
                MoneyText(amount: Money(amount), code: item.currency, font: .subheadline.weight(.semibold))
            }
        }
        .padding(.vertical, 8)
    }

    private var iconName: String {
        switch item.kind {
        case .emi: "house.fill"
        case .cardMinimum: "creditcard.fill"
        case .subscription: "play.tv.fill"
        case .bill: "doc.text.fill"
        case .income: "arrow.down.left.circle.fill"
        case .other: "calendar"
        }
    }

    private var dueLabel: String {
        if item.isUrgent { return "Today" }
        let days = Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: .now), to: item.dueDate).day ?? 0
        return days == 1 ? "Tomorrow" : "In \(days) days"
    }
}

struct InsightCardView: View {
    let alert: PersistentAlert

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: alert.tone == "positive" ? "chart.line.uptrend.xyaxis" : "exclamationmark.bubble.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(alert.tone == "positive" ? Color.green : Color.orange)
                .frame(width: 32, height: 32)
                .background(
                    (alert.tone == "positive" ? Color.green : Color.orange).opacity(0.15),
                    in: RoundedRectangle(cornerRadius: 9, style: .continuous)
                )
            VStack(alignment: .leading, spacing: 2) {
                Text(alert.title).font(.caption.weight(.semibold)).lineLimit(1)
                Text(alert.detail).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .padding(12)
        .frame(width: 230, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}
```

Note: the header shows a hardcoded first name until a profile endpoint exists; use the household name from `/household` if available in a later polish pass — do not block on it.

- [ ] **Step 2: Build to verify**

Run the Global Constraints build command.
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 3: Commit (Tasks 9 + 10 together)**

```bash
git add ios/AalsiFinance/AalsiFinance/Features/Home
git commit -m "feat(ios): rebuild home dashboard with forecast hero and upcoming feed

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Money tab — view model + Overview pill

**Files:**
- Create: `ios/AalsiFinance/AalsiFinance/Features/Money/MoneyViewModel.swift`
- Create: `ios/AalsiFinance/AalsiFinance/Features/Money/MoneyView.swift`

**Interfaces:**
- Consumes: `APIClient.loans/creditCards/incomeSources/holdings/netWorth`, `PillNav`, `AppHeader`, `SectionHeaderLink`, `LineSparkline`, `AppTheme`.
- Produces:

```swift
@MainActor @Observable final class MoneyViewModel {
    struct Snapshot: Sendable {
        let netWorth: NetWorth
        let loans: [Loan]        // non-card loans
        let cards: [CreditCardSummary]
        let incomeSources: [IncomeSource]
        let holdings: [Holding]
    }
    private(set) var state: Loadable<Snapshot>
    func load(api: APIClient, force: Bool = false) async
}
struct MoneyView: View // pills: Overview | Debt | Cards | Income
```

- [ ] **Step 1: Implement MoneyViewModel**

`ios/AalsiFinance/AalsiFinance/Features/Money/MoneyViewModel.swift`:

```swift
import Foundation
import Observation
import AalsiFinanceKit

@MainActor
@Observable
final class MoneyViewModel {
    struct Snapshot: Sendable {
        let netWorth: NetWorth
        let loans: [Loan]
        let cards: [CreditCardSummary]
        let incomeSources: [IncomeSource]
        let holdings: [Holding]
    }

    private(set) var state: Loadable<Snapshot> = .idle

    func load(api: APIClient, force: Bool = false) async {
        if case .loaded = state, !force { return }
        if case .idle = state { state = .loading }
        do {
            async let netWorth = api.netWorth()
            async let loans = api.loans()
            async let cards = api.creditCards()
            async let income = api.incomeSources()
            async let holdings = api.holdings()

            let allLoans = try await loans
            state = .loaded(Snapshot(
                netWorth: try await netWorth,
                loans: allLoans.filter { !$0.isCreditCard },
                cards: try await cards,
                incomeSources: try await income,
                holdings: (try? await holdings) ?? []
            ))
        } catch {
            if state.value == nil {
                state = .failed(error.localizedDescription)
            }
        }
    }
}
```

- [ ] **Step 2: Implement MoneyView with the Overview pill**

`ios/AalsiFinance/AalsiFinance/Features/Money/MoneyView.swift`:

```swift
import SwiftUI
import AalsiFinanceKit

struct MoneyView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppTheme.self) private var theme
    @State private var model = MoneyViewModel()
    @State private var pill = 0

    private static let pills = ["Overview", "Debt", "Cards", "Income"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    AppHeader(title: "Money")
                    PillNav(items: Self.pills, selection: $pill)

                    switch model.state {
                    case .idle, .loading:
                        VStack(spacing: 14) {
                            LoadingCard(height: 150)
                            LoadingCard(height: 130)
                        }
                        .padding(.horizontal, 20)
                    case .failed(let message):
                        ErrorStateView(message: message) {
                            Task { await model.load(api: session.api, force: true) }
                        }
                        .padding(.top, 40)
                    case .loaded(let snapshot):
                        Group {
                            switch pill {
                            case 0: OverviewPane(snapshot: snapshot, openPill: { pill = $0 })
                            case 1: DebtPane(loans: snapshot.loans)
                            case 2: CardsPane(cards: snapshot.cards)
                            default: IncomePane(sources: snapshot.incomeSources, holdings: snapshot.holdings)
                            }
                        }
                        .padding(.horizontal, 20)
                    }
                }
                .padding(.bottom, 24)
            }
            .background(Color(.systemGroupedBackground))
            .scrollEdgeEffectStyle(.soft, for: .top)
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await model.load(api: session.api, force: true) }
        }
        .task { await model.load(api: session.api) }
    }
}

// MARK: - Overview

private struct OverviewPane: View {
    @Environment(AppTheme.self) private var theme
    let snapshot: MoneyViewModel.Snapshot
    let openPill: (Int) -> Void

    private var totalDebt: Money { snapshot.netWorth.liabilities }

    var body: some View {
        VStack(spacing: 14) {
            // Net worth hero
            VStack(alignment: .leading, spacing: 10) {
                Text("Net worth")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                HStack(alignment: .center, spacing: 12) {
                    MoneyText(amount: snapshot.netWorth.netWorth, code: snapshot.netWorth.currency, font: .system(size: 30, weight: .bold))
                    Spacer()
                    if snapshot.netWorth.points.count > 1 {
                        LineSparkline(values: snapshot.netWorth.points.map { $0.netWorth.doubleValue }, color: .green)
                            .frame(width: 100, height: 34)
                    }
                }
                HStack(spacing: 16) {
                    labelledAmount("Assets", snapshot.netWorth.assets, .green)
                    labelledAmount("Debts", snapshot.netWorth.liabilities, .red)
                }
            }
            .card()

            // Debt summary → Debt pill
            Button { openPill(1) } label: {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Debt payoff").font(.subheadline.weight(.semibold))
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                    }
                    ForEach(snapshot.loans.prefix(3)) { loan in
                        HStack {
                            Text(loan.name).font(.caption).lineLimit(1)
                            Spacer()
                            if let balance = loan.outstandingBalance {
                                Text("\(balance.compact(code: loan.currency)) left")
                                    .font(.caption.weight(.semibold))
                                    .monospacedDigit()
                            }
                        }
                        ProgressView(value: (loan.progressPct ?? 0) / 100)
                            .tint(theme.accentColor)
                    }
                    if snapshot.loans.isEmpty {
                        Text("No loans tracked").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .card()
            }
            .buttonStyle(.plain)

            // Cards row → Cards pill
            Button { openPill(2) } label: {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Cards").font(.subheadline.weight(.semibold))
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                    }
                    if snapshot.cards.isEmpty {
                        Text("No credit cards tracked").font(.caption).foregroundStyle(.secondary)
                    } else {
                        HStack(spacing: 8) {
                            ForEach(snapshot.cards.prefix(3)) { card in
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(card.loan.name).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                                    Text((card.statementBalance ?? card.loan.outstandingBalance ?? Money()).compact(code: card.loan.currency))
                                        .font(.caption.weight(.semibold))
                                        .monospacedDigit()
                                    if let utilization = card.utilization {
                                        Text("\(Int((utilization.doubleValue * 100).rounded()))% util")
                                            .font(.caption2)
                                            .foregroundStyle(utilization.doubleValue > 0.5 ? .orange : .secondary)
                                    }
                                }
                                .padding(10)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            }
                        }
                    }
                }
                .card()
            }
            .buttonStyle(.plain)

            // Income & investments → Income pill
            Button { openPill(3) } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Income & investments").font(.subheadline.weight(.semibold))
                        HStack(spacing: 14) {
                            if let source = snapshot.incomeSources.first, let gross = source.gross {
                                Text("\(source.employer ?? "Income") \(gross.compact(code: source.currency))/\(source.frequency.prefix(2))")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Text("\(snapshot.holdings.count) holdings")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                }
                .card()
            }
            .buttonStyle(.plain)
        }
    }

    private func labelledAmount(_ label: String, _ amount: Money, _ color: Color) -> some View {
        HStack(spacing: 5) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(amount.compact(code: snapshot.netWorth.currency))
                .font(.caption.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(color)
        }
    }
}
```

(`DebtPane`, `CardsPane`, `IncomePane` are created in Tasks 12–13; for THIS task's build, add three temporary stubs at the bottom of `MoneyView.swift` so it compiles — each will be replaced:)

```swift
struct DebtPane: View {
    let loans: [Loan]
    var body: some View { ContentUnavailableView("Debt", systemImage: "building.columns") }
}

struct CardsPane: View {
    let cards: [CreditCardSummary]
    var body: some View { ContentUnavailableView("Cards", systemImage: "creditcard") }
}

struct IncomePane: View {
    let sources: [IncomeSource]
    let holdings: [Holding]
    var body: some View { ContentUnavailableView("Income", systemImage: "banknote") }
}
```

- [ ] **Step 3: Build to verify**

Run the Global Constraints build command.
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 4: Commit**

```bash
git add ios/AalsiFinance/AalsiFinance/Features/Money
git commit -m "feat(ios): add money tab with overview pane

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Money — Debt pane + loan detail

**Files:**
- Create: `ios/AalsiFinance/AalsiFinance/Features/Money/DebtPane.swift` (replaces the stub — DELETE the `DebtPane` stub from `MoneyView.swift`)
- Create: `ios/AalsiFinance/AalsiFinance/Features/Money/LoanDetailView.swift`

**Interfaces:**
- Consumes: `Loan`, `PaymentScheduleEntry`, `APIClient.loanSchedule(loanId:)`, `AppTheme`, `card()`.
- Produces: `struct DebtPane: View { let loans: [Loan] }` — loan rows (name, rate, outstanding, progress bar, next due) each `NavigationLink` → `LoanDetailView(loan:)`; `struct LoanDetailView: View { let loan: Loan }` — summary card + amortization schedule list (next 12 entries).

- [ ] **Step 1: Implement DebtPane**

`ios/AalsiFinance/AalsiFinance/Features/Money/DebtPane.swift`:

```swift
import SwiftUI
import AalsiFinanceKit

struct DebtPane: View {
    @Environment(AppTheme.self) private var theme
    let loans: [Loan]

    var body: some View {
        VStack(spacing: 12) {
            if loans.isEmpty {
                ContentUnavailableView(
                    "No loans tracked",
                    systemImage: "building.columns",
                    description: Text("Add loans on the web app to see payoff progress here.")
                )
                .card()
            }
            ForEach(loans) { loan in
                NavigationLink(value: loan) {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(loan.name).font(.subheadline.weight(.semibold))
                                if let rate = loan.interestRate {
                                    Text("\(rate.value.formatted(.number.precision(.fractionLength(0...2))))% · \(loan.type.replacingOccurrences(of: "_", with: " "))")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                if let balance = loan.outstandingBalance {
                                    MoneyText(amount: balance, code: loan.currency, font: .subheadline.weight(.semibold))
                                }
                                Text("left").font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                        ProgressView(value: (loan.progressPct ?? 0) / 100)
                            .tint(theme.accentColor)
                        HStack {
                            if let pct = loan.progressPct {
                                Text("\(Int(pct.rounded()))% paid").font(.caption2).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if let due = loan.nextDueDate {
                                Text("Next due \(due, format: .dateTime.month(.abbreviated).day())")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .card()
                }
                .buttonStyle(.plain)
            }
        }
        .navigationDestination(for: Loan.self) { loan in
            LoanDetailView(loan: loan)
        }
    }
}
```

- [ ] **Step 2: Implement LoanDetailView**

`ios/AalsiFinance/AalsiFinance/Features/Money/LoanDetailView.swift`:

```swift
import SwiftUI
import AalsiFinanceKit

struct LoanDetailView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppTheme.self) private var theme
    let loan: Loan

    @State private var schedule: Loadable<[PaymentScheduleEntry]> = .idle

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                summaryCard

                VStack(spacing: 10) {
                    SectionHeaderLink(title: "Payment schedule")
                    switch schedule {
                    case .idle, .loading:
                        LoadingCard(height: 200)
                    case .failed(let message):
                        ErrorStateView(message: message) { Task { await loadSchedule() } }
                    case .loaded(let entries):
                        if entries.isEmpty {
                            ContentUnavailableView("No schedule", systemImage: "calendar")
                                .card()
                        } else {
                            VStack(spacing: 0) {
                                ForEach(upcomingEntries(entries)) { entry in
                                    scheduleRow(entry)
                                    if entry.id != upcomingEntries(entries).last?.id {
                                        Divider()
                                    }
                                }
                            }
                            .card()
                        }
                    }
                }
            }
            .padding(20)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(loan.name)
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadSchedule() }
    }

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Outstanding").font(.caption).foregroundStyle(.secondary)
                    MoneyText(
                        amount: loan.outstandingBalance ?? loan.principal,
                        code: loan.currency,
                        font: .system(size: 28, weight: .bold)
                    )
                }
                Spacer()
                if let pct = loan.progressPct {
                    VStack(alignment: .trailing, spacing: 4) {
                        Text("\(Int(pct.rounded()))%").font(.title3.bold()).foregroundStyle(theme.accentColor)
                        Text("paid off").font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
            ProgressView(value: (loan.progressPct ?? 0) / 100).tint(theme.accentColor)
            HStack(spacing: 16) {
                if let emi = loan.minOrEmiAmount {
                    detail("EMI", emi.compact(code: loan.currency))
                }
                if let rate = loan.interestRate {
                    detail("Rate", "\(rate.value.formatted(.number.precision(.fractionLength(0...2))))%")
                }
                if let paid = loan.totalInterestPaid {
                    detail("Interest paid", paid.compact(code: loan.currency))
                }
            }
            if let warning = loan.penaltyWarning {
                Label(warning, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
        .card()
    }

    private func detail(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.caption.weight(.semibold)).monospacedDigit()
        }
    }

    private func upcomingEntries(_ entries: [PaymentScheduleEntry]) -> [PaymentScheduleEntry] {
        let pending = entries.filter { $0.status != "paid" }.sorted { $0.dueDate < $1.dueDate }
        return Array(pending.prefix(12))
    }

    private func scheduleRow(_ entry: PaymentScheduleEntry) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("#\(entry.installmentNo) · \(entry.dueDate, format: .dateTime.month(.abbreviated).day().year())")
                    .font(.caption.weight(.medium))
                if let principal = entry.principalComponent, let interest = entry.interestComponent {
                    Text("\(principal.compact(code: loan.currency)) principal · \(interest.compact(code: loan.currency)) interest")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            if let balance = entry.balanceAfter {
                Text(balance.compact(code: loan.currency))
                    .font(.caption.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 8)
    }

    private func loadSchedule() async {
        schedule = .loading
        do {
            schedule = .loaded(try await session.api.loanSchedule(loanId: loan.id))
        } catch {
            schedule = .failed(error.localizedDescription)
        }
    }
}
```

- [ ] **Step 3: Delete the `DebtPane` stub from `MoneyView.swift`**

- [ ] **Step 4: Build to verify**

Run the Global Constraints build command.
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 5: Commit**

```bash
git add ios/AalsiFinance/AalsiFinance/Features/Money
git commit -m "feat(ios): add debt pane and loan detail with schedule

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Money — Cards pane + Income pane

**Files:**
- Create: `ios/AalsiFinance/AalsiFinance/Features/Money/CardsPane.swift` (delete stub from `MoneyView.swift`)
- Create: `ios/AalsiFinance/AalsiFinance/Features/Money/IncomePane.swift` (delete stub from `MoneyView.swift`)

**Interfaces:**
- Consumes: `CreditCardSummary`, `IncomeSource`, `Holding`, `AppTheme`, `card()`.
- Produces: `struct CardsPane: View { let cards: [CreditCardSummary] }`, `struct IncomePane: View { let sources: [IncomeSource]; let holdings: [Holding] }`.

- [ ] **Step 1: Implement CardsPane**

`ios/AalsiFinance/AalsiFinance/Features/Money/CardsPane.swift`:

```swift
import SwiftUI
import AalsiFinanceKit

struct CardsPane: View {
    @Environment(AppTheme.self) private var theme
    let cards: [CreditCardSummary]

    var body: some View {
        VStack(spacing: 12) {
            if cards.isEmpty {
                ContentUnavailableView(
                    "No credit cards tracked",
                    systemImage: "creditcard",
                    description: Text("Add cards on the web app to track dues and utilization here.")
                )
                .card()
            }
            ForEach(cards) { card in
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text(card.loan.name).font(.subheadline.weight(.semibold))
                        Spacer()
                        if let due = card.loan.nextDueDate {
                            let urgent = Calendar.current.isDateInToday(due)
                            Text(urgent ? "Due today" : "Due \(due, format: .dateTime.month(.abbreviated).day())")
                                .font(.caption.weight(urgent ? .semibold : .regular))
                                .foregroundStyle(urgent ? .pink : .secondary)
                        }
                    }

                    HStack(spacing: 20) {
                        amount("Balance", card.statementBalance ?? card.loan.outstandingBalance, card.loan.currency)
                        amount("Min due", card.loan.minOrEmiAmount, card.loan.currency)
                        amount("Available", card.availableCredit, card.loan.currency)
                    }

                    if let utilization = card.utilization {
                        let fraction = min(max(utilization.doubleValue, 0), 1)
                        VStack(alignment: .leading, spacing: 3) {
                            ProgressView(value: fraction)
                                .tint(fraction > 0.5 ? .orange : theme.accentColor)
                            Text("\(Int((fraction * 100).rounded()))% of limit used")
                                .font(.caption2)
                                .foregroundStyle(fraction > 0.5 ? .orange : .secondary)
                        }
                    }
                }
                .card()
            }
        }
    }

    private func amount(_ label: String, _ value: Money?, _ code: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            if let value {
                Text(value.compact(code: code)).font(.caption.weight(.semibold)).monospacedDigit()
            } else {
                Text("—").font(.caption).foregroundStyle(.tertiary)
            }
        }
    }
}
```

- [ ] **Step 2: Implement IncomePane**

`ios/AalsiFinance/AalsiFinance/Features/Money/IncomePane.swift`:

```swift
import SwiftUI
import AalsiFinanceKit

struct IncomePane: View {
    let sources: [IncomeSource]
    let holdings: [Holding]

    var body: some View {
        VStack(spacing: 12) {
            if sources.isEmpty && holdings.isEmpty {
                ContentUnavailableView(
                    "No income or investments yet",
                    systemImage: "banknote",
                    description: Text("Add income sources and holdings on the web app.")
                )
                .card()
            }

            if !sources.isEmpty {
                VStack(spacing: 10) {
                    SectionHeaderLink(title: "Income")
                    VStack(spacing: 0) {
                        ForEach(sources) { source in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(source.employer ?? "Income source").font(.subheadline.weight(.medium))
                                    Text("\(source.frequency.capitalized)\(source.country.map { " · \($0)" } ?? "")")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if let gross = source.gross {
                                    VStack(alignment: .trailing, spacing: 2) {
                                        MoneyText(amount: gross, code: source.currency, font: .subheadline.weight(.semibold))
                                        Text("gross").font(.caption2).foregroundStyle(.secondary)
                                    }
                                }
                            }
                            .padding(.vertical, 8)
                            if source.id != sources.last?.id { Divider() }
                        }
                    }
                    .card()
                }
            }

            if !holdings.isEmpty {
                VStack(spacing: 10) {
                    SectionHeaderLink(title: "Investments")
                    VStack(spacing: 0) {
                        ForEach(holdings) { holding in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(holding.name).font(.subheadline.weight(.medium)).lineLimit(1)
                                    Text("\(holding.symbol ?? holding.assetType.capitalized) · qty \(holding.quantity.value.formatted(.number.precision(.fractionLength(0...2))))")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if let avg = holding.avgBuyPrice {
                                    VStack(alignment: .trailing, spacing: 2) {
                                        MoneyText(amount: avg, code: holding.currency, font: .caption.weight(.semibold))
                                        Text("avg buy").font(.caption2).foregroundStyle(.secondary)
                                    }
                                }
                            }
                            .padding(.vertical, 8)
                            if holding.id != holdings.last?.id { Divider() }
                        }
                    }
                    .card()
                }
            }
        }
    }
}
```

- [ ] **Step 3: Delete the `CardsPane` and `IncomePane` stubs from `MoneyView.swift`**

- [ ] **Step 4: Build to verify**

Run the Global Constraints build command.
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 5: Commit**

```bash
git add ios/AalsiFinance/AalsiFinance/Features/Money ios/AalsiFinance/AalsiFinance/Features/Money/MoneyView.swift
git commit -m "feat(ios): add cards and income panes to money tab

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: MainTabView restructure — 5 tabs, centered AI, placeholders

**Files:**
- Modify: `ios/AalsiFinance/AalsiFinance/App/MainTabView.swift` (full rewrite)
- Create: `ios/AalsiFinance/AalsiFinance/Features/AI/AIPlaceholderView.swift`
- Create: `ios/AalsiFinance/AalsiFinance/Features/Budgets/BudgetsView.swift`
- Modify: `ios/AalsiFinance/AalsiFinance/Features/Activity/ActivityView.swift` (title only)
- Delete: `ios/AalsiFinance/AalsiFinance/Features/Guidance/GuidanceView.swift`

**Interfaces:**
- Consumes: `HomeView`, `ActivityView`, `MoneyView`, `AppHeader`, `PillNav`, existing `BudgetRow` logic (recreated in `BudgetsView`), `AALSI_INITIAL_TAB` debug hook.
- Produces: `MainTabView.AppTab` enum with cases `home, spending, ai, budgets, money` (raw `String`); tab order Home · Spending · AI · Budgets · Money; AI tab uses `sparkles` icon. Old `insights`/`guidance`/`settings` tabs removed (Settings now lives in the avatar sheet; Insights content returns in phase 2's Spending pills).

- [ ] **Step 1: Rewrite MainTabView**

```swift
import SwiftUI

struct MainTabView: View {
    enum AppTab: String {
        case home, spending, ai, budgets, money
    }

    @State private var selection: AppTab = {
        #if DEBUG
        // Test hook: lets simulator automation open a specific tab directly.
        if let raw = ProcessInfo.processInfo.environment["AALSI_INITIAL_TAB"],
           let tab = AppTab(rawValue: raw) {
            return tab
        }
        #endif
        return .home
    }()

    var body: some View {
        TabView(selection: $selection) {
            Tab("Home", systemImage: "house.fill", value: .home) {
                HomeView()
            }
            Tab("Spending", systemImage: "wallet.bifold.fill", value: .spending) {
                ActivityView()
            }
            Tab("AI", systemImage: "sparkles", value: .ai) {
                AIPlaceholderView()
            }
            Tab("Budgets", systemImage: "chart.pie.fill", value: .budgets) {
                BudgetsView()
            }
            Tab("Money", systemImage: "banknote.fill", value: .money) {
                MoneyView()
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
    }
}
```

(Note: the root `.tint(theme.accentColor)` from Task 6 tints the selected tab — the hardcoded `.tint(.indigo)` is gone. The raised-circle treatment for the AI tab is intentionally NOT custom-built in phase 1: a custom tab bar would lose the native Liquid Glass minimize-on-scroll behavior. The AI tab sits center with the sparkles icon; revisit the raised button when phase 3 fills the tab.)

- [ ] **Step 2: Create AIPlaceholderView**

`ios/AalsiFinance/AalsiFinance/Features/AI/AIPlaceholderView.swift`:

```swift
import SwiftUI

struct AIPlaceholderView: View {
    @Environment(AppTheme.self) private var theme

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                AppHeader(title: "Advisor")
                Spacer()
                ContentUnavailableView {
                    Label("Your AI advisor", systemImage: "sparkles")
                } description: {
                    Text("Daily brief, plan steps, and chat about your money are coming here next.")
                }
                Spacer()
            }
            .background(Color(.systemGroupedBackground))
            .toolbar(.hidden, for: .navigationBar)
        }
    }
}
```

- [ ] **Step 3: Create BudgetsView (interim: budget rows relocated from the old Home)**

`ios/AalsiFinance/AalsiFinance/Features/Budgets/BudgetsView.swift`:

```swift
import SwiftUI
import AalsiFinanceKit

/// Interim budgets tab: read-only progress rows (create/edit lands in phase 2).
struct BudgetsView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppTheme.self) private var theme
    @State private var budgets: [Budget] = []
    @State private var categoryNames: [UUID: String] = [:]
    @State private var state: Loadable<Bool> = .idle

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    AppHeader(title: "Budgets")

                    switch state {
                    case .idle, .loading:
                        LoadingCard(height: 200).padding(.horizontal, 20)
                    case .failed(let message):
                        ErrorStateView(message: message) { Task { await load(force: true) } }
                            .padding(.top, 40)
                    case .loaded:
                        if budgets.isEmpty {
                            ContentUnavailableView(
                                "No budgets yet",
                                systemImage: "chart.pie",
                                description: Text("Create budgets on the web app — editing arrives here in the next phase.")
                            )
                            .padding(.top, 40)
                        } else {
                            VStack(spacing: 14) {
                                ForEach(budgets) { budget in
                                    row(budget)
                                }
                            }
                            .card()
                            .padding(.horizontal, 20)
                        }
                    }
                }
                .padding(.bottom, 24)
            }
            .background(Color(.systemGroupedBackground))
            .scrollEdgeEffectStyle(.soft, for: .top)
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await load(force: true) }
        }
        .task { await load() }
    }

    private func row(_ budget: Budget) -> some View {
        let name = budget.categoryId.flatMap { categoryNames[$0] } ?? "Overall"
        let progress = min(max(budget.progressPct.doubleValue / 100, 0), 1)
        return VStack(spacing: 6) {
            HStack {
                Text(name).font(.subheadline.weight(.medium))
                Spacer()
                Text("\(budget.spent.compact(code: budget.currency)) of \(budget.amount.compact(code: budget.currency))")
                    .font(.subheadline)
                    .monospacedDigit()
            }
            ProgressView(value: progress)
                .tint(budget.overspent ? .red : progress > 0.85 ? .orange : theme.accentColor)
        }
    }

    private func load(force: Bool = false) async {
        if case .loaded = state, !force { return }
        state = .loading
        do {
            async let budgetList = session.api.budgets()
            async let categories = session.api.categories()
            budgets = try await budgetList
            categoryNames = Dictionary(uniqueKeysWithValues: try await categories.map { ($0.id, $0.name) })
            state = .loaded(true)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}
```

- [ ] **Step 4: Retitle ActivityView + delete GuidanceView**

- In `ActivityView.swift`, change `.navigationTitle("Activity")` to `.navigationTitle("Spending")` (leave everything else; pills arrive in phase 2).
- `rm ios/AalsiFinance/AalsiFinance/Features/Guidance/GuidanceView.swift` (the guidance content returns inside the AI tab in phase 3). Keep `Features/Insights/*` on disk — unused by the tab bar now, reused by phase 2.

- [ ] **Step 5: Build to verify**

Run the Global Constraints build command.
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 6: Commit**

```bash
git add -A ios/AalsiFinance/AalsiFinance
git commit -m "feat(ios): restructure nav to 5 tabs with centered AI slot

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 15: Simulator smoke verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: everything above; docker backend running; demo account seeded.

- [ ] **Step 1: Run the full Kit test suite one more time**

Run: `swift test --package-path ios/AalsiFinanceKit`
Expected: PASS, all tests.

- [ ] **Step 2: Build and install on the booted simulator**

```bash
xcodebuild -project ios/AalsiFinance/AalsiFinance.xcodeproj -scheme AalsiFinance \
  -destination 'platform=iOS Simulator,id=349C5D38-C407-47AA-81CF-CF6688BD4B30' \
  -derivedDataPath /tmp/aalsi-dd build 2>&1 | tail -3
xcrun simctl install 349C5D38-C407-47AA-81CF-CF6688BD4B30 \
  /tmp/aalsi-dd/Build/Products/Debug-iphonesimulator/AalsiFinance.app
```

- [ ] **Step 3: Launch signed in on each tab and screenshot**

```bash
for tab in home spending ai budgets money; do
  xcrun simctl terminate 349C5D38-C407-47AA-81CF-CF6688BD4B30 com.aalsi.AalsiFinance 2>/dev/null
  SIMCTL_CHILD_AALSI_DEMO_EMAIL=ios.demo@example.com \
  SIMCTL_CHILD_AALSI_DEMO_PASSWORD=ios-demo-pass-1 \
  SIMCTL_CHILD_AALSI_INITIAL_TAB=$tab \
  xcrun simctl launch 349C5D38-C407-47AA-81CF-CF6688BD4B30 com.aalsi.AalsiFinance
  sleep 6
  xcrun simctl io 349C5D38-C407-47AA-81CF-CF6688BD4B30 screenshot "/tmp/aalsi-$tab.png"
done
```

Inspect each screenshot. Checklist:
- home: greeting header + forecast hero with curve + 3 tiles + upcoming rows render with real demo data; no "Optional(...)" strings; numbers formatted as currency.
- spending: transaction list renders, title "Spending".
- ai: Advisor placeholder.
- budgets: 4 budget rows from the demo seed.
- money: net worth hero + debt/cards/income cards; tap-through Debt → loan detail shows a schedule (verify by tapping in the simulator or with a follow-up screenshot).
- Open settings via the avatar: Appearance section present; switching accent re-tints pills/tab immediately; switching theme flips dark/light.

- [ ] **Step 4: Fix anything broken, re-run, commit fixes**

Any fix discovered here gets its own small commit (`fix(ios): …`).

---

## Self-Review Notes (already applied)

- Spec coverage: nav shell ✓ (T14), persistent chrome ✓ (T8), appearance settings ✓ (T6), Home ✓ (T9–10), Money overview/debt/cards/income ✓ (T11–13), client-side forecast + upcoming derivations ✓ (T4–5), notifications bell ✓ (T8). Phase-2/3 items (Spending pills, Budgets CRUD, AI tab content, quick-add "+", search icon) intentionally absent; page-specific "+" buttons therefore also deferred to phase 2 alongside quick-add.
- The header's display name is hardcoded pending a profile endpoint (flagged inline in T10).
- `AnalyticsRow.dimension(_:)` public-ness only matters for `InsightsView` (kept compiling, off the tab bar).
