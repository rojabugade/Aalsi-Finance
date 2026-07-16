import Foundation
import Testing
@testable import AalsiFinanceKit

@Suite struct SpendDerivationTests {
    @Test func classifiesSpendIncomeTransferAndRefund() throws {
        let f = SpendTestFixtures.self
        #expect(SpendDerivation.classify(try f.transaction("-20", date: "2026-07-10", category: f.groceriesID), categories: f.categories) == .spend(Money(20)))
        #expect(SpendDerivation.classify(try f.transaction("100", date: "2026-07-10", category: f.incomeID), categories: f.categories) == .income(Money(100)))
        #expect(SpendDerivation.classify(try f.transaction("75", date: "2026-07-10", category: f.transferID), categories: f.categories) == .transfer(Money(75)))
        #expect(SpendDerivation.classify(try f.transaction("8", date: "2026-07-10", category: f.groceriesID, flags: "{\"refund\":true}"), categories: f.categories) == .refund(Money(8)))
    }

    @Test func classificationUsesTopAncestorFlagsAndSign() throws {
        let f = SpendTestFixtures.self
        let salaryID = UUID(uuidString: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee")!
        let categories = f.categories + [
            Category(id: salaryID, parentId: f.incomeID, name: "Salary", kind: "category", isSystem: false),
        ]

        #expect(SpendDerivation.classify(try f.transaction("2500", date: "2026-07-10", category: salaryID), categories: categories) == .income(Money(2500)))
        #expect(SpendDerivation.classify(try f.transaction("250", date: "2026-07-10", category: f.groceriesID, flags: "{\"transfer\":true}"), categories: categories) == .transfer(Money(250)))
        // A positive amount on a spend category is a credit back against
        // spending (card credit, reimbursement) even without a refund flag.
        #expect(SpendDerivation.classify(try f.transaction("12", date: "2026-07-10", category: f.groceriesID), categories: categories) == .refund(Money(12)))
        #expect(SpendDerivation.classify(try f.transaction("0", date: "2026-07-10", category: f.groceriesID), categories: categories) == .ignored)
    }

    @Test func classificationUsesPlaidTaxonomyAndMerchantHints() throws {
        let f = SpendTestFixtures.self

        // Plaid's personal-finance-category rides in flags and beats the
        // positive-means-refund fallback for uncategorized rows.
        #expect(SpendDerivation.classify(
            try f.transaction("5200", date: "2026-07-01", category: nil, flags: "{\"plaid_pfc\":{\"primary\":\"INCOME\"}}"),
            categories: f.categories
        ) == .income(Money(5200)))
        #expect(SpendDerivation.classify(
            try f.transaction("300", date: "2026-07-01", category: nil, flags: "{\"plaid_pfc\":{\"primary\":\"TRANSFER_IN\"}}"),
            categories: f.categories
        ) == .transfer(Money(300)))

        // Merchant text rescues uncategorized deposits that are clearly pay.
        #expect(SpendDerivation.classify(
            try f.transaction("2400", date: "2026-07-01", category: nil, merchant: "ACME CORP PAYROLL"),
            categories: f.categories
        ) == .income(Money(2400)))

        // Anything else positive is a credit against spending, not income.
        #expect(SpendDerivation.classify(
            try f.transaction("45", date: "2026-07-01", category: nil, merchant: "AMAZON MKTP REFUND"),
            categories: f.categories
        ) == .refund(Money(45)))
    }

    @Test func currentMonthUsesComparableElapsedPriorWindow() {
        let now = ISO8601DateFormatter().date(from: "2026-07-12T12:00:00Z")!
        var utcCalendar = Calendar(identifier: .gregorian)
        utcCalendar.timeZone = TimeZone(secondsFromGMT: 0)!

        let period = SpendDerivation.period(containing: now, now: now, calendar: utcCalendar)

        #expect(utcCalendar.component(.day, from: period.current.end) == 12)
        #expect(utcCalendar.component(.day, from: period.previous.end) == 12)
        #expect(period.monthStart == APIDateParser.parse("2026-07-01"))
        #expect(period.previous.start == APIDateParser.parse("2026-06-01"))
        #expect(period.isCurrentMonth)
    }

    @Test func historicalMonthUsesFullInclusiveCalendarWindows() {
        let selected = APIDateParser.parse("2026-06-15")!
        let now = ISO8601DateFormatter().date(from: "2026-07-12T12:00:00Z")!
        var utcCalendar = Calendar(identifier: .gregorian)
        utcCalendar.timeZone = TimeZone(secondsFromGMT: 0)!

        let period = SpendDerivation.period(containing: selected, now: now, calendar: utcCalendar)

        #expect(period.current.start == APIDateParser.parse("2026-06-01"))
        #expect(period.current.end == APIDateParser.parse("2026-06-30T23:59:59"))
        #expect(period.previous.start == APIDateParser.parse("2026-05-01"))
        #expect(period.previous.end == APIDateParser.parse("2026-05-31T23:59:59"))
        #expect(!period.isCurrentMonth)
    }

    @Test func apiDateOnlyPeriodsStayCanonicalWithNonUTCCalendar() throws {
        let firstDay = try SpendTestFixtures.transaction(
            "-20",
            date: "2026-07-01",
            category: SpendTestFixtures.groceriesID
        )
        let now = ISO8601DateFormatter().date(from: "2026-07-12T12:00:00Z")!
        var newYorkCalendar = Calendar(identifier: .gregorian)
        newYorkCalendar.timeZone = TimeZone(identifier: "America/New_York")!

        let selectedFromAPIDate = SpendDerivation.period(
            containing: firstDay.txnDate,
            now: now,
            calendar: newYorkCalendar
        )
        #expect(selectedFromAPIDate.monthStart == APIDateParser.parse("2026-07-01"))
        #expect(selectedFromAPIDate.isCurrentMonth)

        let currentJuly = SpendDerivation.period(
            containing: now,
            now: now,
            calendar: newYorkCalendar
        )
        #expect(
            SpendDerivation.filter(
                [firstDay],
                categories: SpendTestFixtures.categories,
                period: currentJuly,
                filter: SpendFilter()
            ) == [firstDay]
        )
    }

    @Test func categoryPathResolvesRootAndLeaf() {
        let f = SpendTestFixtures.self

        let childPath = SpendDerivation.categoryPath(for: f.groceriesID, categories: f.categories)
        #expect(childPath.parent?.id == f.foodID)
        #expect(childPath.leaf?.id == f.groceriesID)
        #expect(childPath.displayName == "Food › Groceries")

        let rootPath = SpendDerivation.categoryPath(for: f.foodID, categories: f.categories)
        #expect(rootPath.parent == nil)
        #expect(rootPath.leaf?.id == f.foodID)
        #expect(rootPath.displayName == "Food")

        #expect(SpendDerivation.categoryPath(for: nil, categories: f.categories) == CategoryPath(parent: nil, leaf: nil))
    }

    @Test func parentFilterIncludesDescendants() throws {
        let filter = SpendFilter(categoryId: SpendTestFixtures.foodID)
        let childTxn = try SpendTestFixtures.transaction("-20", date: "2026-07-10", category: SpendTestFixtures.groceriesID)
        #expect(SpendDerivation.filter([childTxn], categories: SpendTestFixtures.categories, period: SpendTestFixtures.july2026, filter: filter) == [childTxn])
    }

    @Test func filterUsesInclusivePeriodDirectionAndAmountBand() throws {
        let f = SpendTestFixtures.self
        let atStart = try f.transaction("-24.99", date: "2026-07-01", category: f.groceriesID)
        let atEnd = try f.transaction("-25", date: "2026-07-31", category: f.groceriesID)
        let income = try f.transaction("99.99", date: "2026-07-15", category: f.incomeID)
        let outside = try f.transaction("-20", date: "2026-08-01", category: f.groceriesID)
        let transactions = [atStart, atEnd, income, outside]

        let spend = SpendDerivation.filter(
            transactions,
            categories: f.categories,
            period: f.july2026,
            filter: SpendFilter(direction: .spend, amountBand: .under25)
        )
        #expect(spend == [atStart])

        let incomeResult = SpendDerivation.filter(
            transactions,
            categories: f.categories,
            period: f.july2026,
            filter: SpendFilter(direction: .income, amountBand: .from25To100)
        )
        #expect(incomeResult == [income])
    }

    @Test func filterNormalizesRecurringMerchantAndSearchesMerchantOrNotes() throws {
        let f = SpendTestFixtures.self
        let recurring = try f.transaction("-40", date: "2026-07-20", category: f.groceriesID, merchant: "  NetFlix  ", notes: "Family plan")
        let notesMatch = try f.transaction("-10", date: "2026-07-10", category: f.groceriesID, merchant: "Market", notes: "Weekly MILK run")
        let categoryOnlyMatch = try f.transaction("-8", date: "2026-07-09", category: f.groceriesID, merchant: "Corner Shop")

        let recurringResult = SpendDerivation.filter(
            [recurring, notesMatch],
            categories: f.categories,
            period: f.july2026,
            filter: SpendFilter(recurringOnly: true),
            recurringMerchantKeys: ["netflix"]
        )
        #expect(recurringResult == [recurring])

        let searchResult = SpendDerivation.filter(
            [recurring, notesMatch],
            categories: f.categories,
            period: f.july2026,
            filter: SpendFilter(query: "  milk  ")
        )
        #expect(searchResult == [notesMatch])

        let categorySearch = SpendDerivation.filter(
            [categoryOnlyMatch],
            categories: f.categories,
            period: f.july2026,
            filter: SpendFilter(query: "groceries")
        )
        #expect(categorySearch.isEmpty)
    }

    @Test func filterMatchesStatusAndSortsByDateThenCreationTime() throws {
        let f = SpendTestFixtures.self
        let olderCreation = try f.transactionWithMetadata("-10", date: "2026-07-20", createdAt: "2026-07-20T08:00:00", category: f.groceriesID)
        let newerCreation = try f.transactionWithMetadata("-20", date: "2026-07-20", createdAt: "2026-07-20T15:00:00", category: f.groceriesID)
        let newerDate = try f.transactionWithMetadata("-30", date: "2026-07-21", createdAt: "2026-07-21T07:00:00", category: f.groceriesID)
        let draft = try f.transactionWithMetadata("-40", date: "2026-07-22", createdAt: "2026-07-22T07:00:00", category: f.groceriesID, status: "draft")

        let result = SpendDerivation.filter(
            [olderCreation, draft, newerDate, newerCreation],
            categories: f.categories,
            period: f.july2026,
            filter: SpendFilter(status: "confirmed")
        )

        #expect(result.map(\.id) == [newerDate.id, newerCreation.id, olderCreation.id])
    }
}
