import Foundation
import Testing
@testable import AalsiFinanceKit

@Suite struct SpendIntelligenceTests {
    @Test func overviewUsesComparableWindowClassifierAndRefundNetting() throws {
        let period = partialJulyPeriod()
        let transactions = [
            try SpendTestFixtures.transaction("-100", date: "2026-07-10", category: SpendTestFixtures.groceriesID),
            try SpendTestFixtures.transaction("20", date: "2026-07-11", category: SpendTestFixtures.groceriesID, flags: #"{"refund":true}"#),
            try SpendTestFixtures.transaction("500", date: "2026-07-09", category: SpendTestFixtures.incomeID),
            try SpendTestFixtures.transaction("300", date: "2026-07-08", category: SpendTestFixtures.transferID),
            try SpendTestFixtures.transaction("-60", date: "2026-06-10", category: SpendTestFixtures.groceriesID),
            try SpendTestFixtures.transaction("-999", date: "2026-06-20", category: SpendTestFixtures.groceriesID),
        ]

        let snapshot = SpendDerivation.overview(
            transactions: transactions,
            categories: SpendTestFixtures.categories,
            period: period
        )

        #expect(snapshot.total == Money(80))
        #expect(snapshot.previousTotal == Money(60))
        #expect(snapshot.transactionCount == 2)
        #expect(snapshot.dailyPace == Money(Decimal(80) / Decimal(12)))
        #expect(snapshot.cumulativeDaily.count == 12)
        #expect(snapshot.cumulativeDaily[8] == Money(0))
        #expect(snapshot.cumulativeDaily[9] == Money(100))
        #expect(snapshot.cumulativeDaily[10] == Money(80))
        #expect(snapshot.cumulativeDaily[11] == Money(80))
        #expect(snapshot.categories.first?.total == Money(80))
        #expect(snapshot.merchants.first?.total == Money(80))
    }

    @Test func historicalAggregatesUseBackendBaseMoneyDomain() throws {
        let transportID = UUID(uuidString: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee")!
        let categories = SpendTestFixtures.categories + [
            Category(id: transportID, parentId: nil, name: "Transport", kind: "category", isSystem: true),
        ]
        let usdItems = lineItemsJSON([
            ("66666666-6666-6666-6666-666666666666", "Milk", "20", "1"),
        ])
        let inrItems = lineItemsJSON([
            ("77777777-7777-7777-7777-777777777777", "Ticket", "4000", "1"),
        ])
        let usd = try decodedTransaction(
            amount: "-100",
            baseAmount: "-100",
            currency: "USD",
            date: "2026-07-10",
            category: SpendTestFixtures.groceriesID,
            merchant: "USD Market",
            lineItemsJSON: usdItems
        )
        let inr = try decodedTransaction(
            amount: "-8000",
            baseAmount: "-80",
            currency: "INR",
            date: "2026-07-11",
            category: transportID,
            merchant: "INR Rail",
            lineItemsJSON: inrItems
        )

        let overview = SpendDerivation.overview(
            transactions: [inr, usd],
            categories: categories,
            period: SpendTestFixtures.july2026
        )
        let items = SpendDerivation.itemRows(
            transactions: [inr, usd],
            categories: categories,
            period: SpendTestFixtures.july2026
        )

        #expect(overview.total == Money(180))
        #expect(overview.categories.map(\.id) == [SpendTestFixtures.foodID, transportID])
        #expect(abs(overview.categories[0].share - (100.0 / 180.0)) < 0.000_000_001)
        #expect(overview.merchants.map(\.id) == ["usd market", "inr rail"])
        #expect(overview.merchants.map(\.total) == [Money(100), Money(80)])
        #expect(items.map(\.id) == ["ticket", "milk"])
        #expect(items.map(\.total) == [Money(40), Money(20)])
    }

    @Test func categoryRowsUseTopAncestorAndStableOrdering() throws {
        let transportID = UUID(uuidString: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee")!
        let categories = SpendTestFixtures.categories + [
            Category(id: transportID, parentId: nil, name: "Transport", kind: "category", isSystem: true),
        ]
        let transactions = [
            try SpendTestFixtures.transaction("-50", date: "2026-07-10", category: transportID),
            try SpendTestFixtures.transaction("-60", date: "2026-07-09", category: SpendTestFixtures.groceriesID),
            try SpendTestFixtures.transaction("10", date: "2026-07-08", category: SpendTestFixtures.groceriesID, flags: #"{"refund":true}"#),
            try SpendTestFixtures.transaction("-30", date: "2026-06-10", category: SpendTestFixtures.groceriesID),
        ]

        let rows = SpendDerivation.categoryRows(
            transactions: transactions,
            categories: categories,
            period: SpendTestFixtures.july2026
        )

        #expect(rows.map(\.id) == [SpendTestFixtures.foodID, transportID])
        #expect(rows[0].name == "Food")
        #expect(rows[0].total == Money(50))
        #expect(rows[0].previous == Money(30))
        #expect(rows[0].delta == Money(20))
        #expect(rows[0].share == 0.5)
        #expect(rows[0].count == 2)
    }

    @Test func insightPrefersLargestCategoryIncrease() throws {
        let transactions = [
            try SpendTestFixtures.transaction("-100", date: "2026-07-10", category: SpendTestFixtures.groceriesID),
            try SpendTestFixtures.transaction("-60", date: "2026-06-10", category: SpendTestFixtures.groceriesID),
        ]

        let snapshot = SpendDerivation.overview(
            transactions: transactions,
            categories: SpendTestFixtures.categories,
            period: SpendTestFixtures.july2026
        )

        #expect(snapshot.insight?.kind == .category(SpendTestFixtures.foodID))
        #expect(snapshot.insight?.delta == Money(40))
        #expect(snapshot.insight?.detail.allSatisfy { !$0.isNumber } == true)
    }

    @Test func insightUsesMerchantIncreaseWhenCategoryDidNotIncrease() throws {
        let transactions = [
            try SpendTestFixtures.transaction("-80", date: "2026-07-10", category: SpendTestFixtures.groceriesID, merchant: "Amazon"),
            try SpendTestFixtures.transaction("-20", date: "2026-07-11", category: SpendTestFixtures.groceriesID, merchant: "Market"),
            try SpendTestFixtures.transaction("-20", date: "2026-06-10", category: SpendTestFixtures.groceriesID, merchant: "amazon"),
            try SpendTestFixtures.transaction("-100", date: "2026-06-11", category: SpendTestFixtures.groceriesID, merchant: "Market"),
        ]

        let snapshot = SpendDerivation.overview(
            transactions: transactions,
            categories: SpendTestFixtures.categories,
            period: SpendTestFixtures.july2026
        )

        #expect(snapshot.insight?.kind == .merchant("amazon"))
        #expect(snapshot.insight?.delta == Money(60))
        #expect(snapshot.insight?.detail.allSatisfy { !$0.isNumber } == true)
    }

    @Test func insightUsesNewCategoryDeltaWhenPriorWindowHasOtherEvidence() throws {
        let transportID = UUID(uuidString: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee")!
        let categories = SpendTestFixtures.categories + [
            Category(id: transportID, parentId: nil, name: "Transport", kind: "category", isSystem: true),
        ]
        let currentTransport = try SpendTestFixtures.transaction(
            "-100",
            date: "2026-07-10",
            category: transportID,
            merchant: "Train"
        )
        let previousFood = try SpendTestFixtures.transaction(
            "-30",
            date: "2026-06-10",
            category: SpendTestFixtures.groceriesID,
            merchant: "Market"
        )

        let snapshot = SpendDerivation.overview(
            transactions: [currentTransport, previousFood],
            categories: categories,
            period: SpendTestFixtures.july2026
        )

        #expect(snapshot.insight?.kind == .category(transportID))
        #expect(snapshot.insight?.delta == Money(100))
    }

    @Test func insightUsesLargestPurchaseWithoutPriorEvidence() throws {
        let smaller = try SpendTestFixtures.transaction(
            "-25",
            date: "2026-07-10",
            category: SpendTestFixtures.groceriesID,
            merchant: "Market"
        )
        let largest = try SpendTestFixtures.transaction(
            "-70",
            date: "2026-07-11",
            category: SpendTestFixtures.groceriesID,
            merchant: "Restaurant"
        )

        let snapshot = SpendDerivation.overview(
            transactions: [smaller, largest],
            categories: SpendTestFixtures.categories,
            period: SpendTestFixtures.july2026
        )

        #expect(snapshot.insight?.kind == .transaction(largest.id))
        #expect(snapshot.insight?.delta == Money(70))
        #expect(snapshot.insight?.detail.allSatisfy { !$0.isNumber } == true)
    }

    @Test func insightUsesPaceWhenPriorEvidenceHasNoPositiveDelta() throws {
        let transactions = [
            try SpendTestFixtures.transaction("-100", date: "2026-07-10", category: SpendTestFixtures.groceriesID, merchant: "Market"),
            try SpendTestFixtures.transaction("-150", date: "2026-06-10", category: SpendTestFixtures.groceriesID, merchant: "Market"),
        ]

        let snapshot = SpendDerivation.overview(
            transactions: transactions,
            categories: SpendTestFixtures.categories,
            period: SpendTestFixtures.july2026
        )

        #expect(snapshot.insight?.kind == .pace)
        #expect(snapshot.insight?.delta == Money(-50))
    }

    @Test func insightFallsBackToNeutralPace() {
        let snapshot = SpendDerivation.overview(
            transactions: [],
            categories: SpendTestFixtures.categories,
            period: SpendTestFixtures.july2026
        )

        #expect(snapshot.insight?.kind == .pace)
        #expect(snapshot.insight?.delta == Money())
        #expect(snapshot.insight?.detail.allSatisfy { !$0.isNumber } == true)
    }

    @Test func merchantGroupingUsesTrimmedLowercaseKeysAndStableOrdering() throws {
        let transactions = [
            try SpendTestFixtures.transaction("-20", date: "2026-07-10", category: SpendTestFixtures.groceriesID, merchant: " Amazon "),
            try SpendTestFixtures.transaction("-30", date: "2026-07-11", category: SpendTestFixtures.groceriesID, merchant: "AMAZON"),
            try SpendTestFixtures.transaction("-50", date: "2026-07-09", category: SpendTestFixtures.groceriesID, merchant: "Zoom"),
        ]

        let rows = SpendDerivation.merchantRows(
            transactions: Array(transactions.reversed()),
            categories: SpendTestFixtures.categories,
            period: SpendTestFixtures.july2026
        )

        #expect(rows.map(\.id) == ["amazon", "zoom"])
        #expect(rows[0].count == 2)
        #expect(rows[0].total == Money(50))
        #expect(rows[0].topCategory == "Food")
    }

    @Test func merchantRowsNetRefundsAndDetectThreeMonthCadence() throws {
        let transactions = [
            try SpendTestFixtures.transaction("-15", date: "2026-05-10", category: SpendTestFixtures.groceriesID, merchant: "Netflix"),
            try SpendTestFixtures.transaction("-15", date: "2026-06-10", category: SpendTestFixtures.groceriesID, merchant: "NETFLIX"),
            try SpendTestFixtures.transaction("-20", date: "2026-07-10", category: SpendTestFixtures.groceriesID, merchant: " Netflix "),
            try SpendTestFixtures.transaction("5", date: "2026-07-11", category: SpendTestFixtures.groceriesID, merchant: "Netflix", flags: #"{"refund":true}"#),
        ]

        let rows = SpendDerivation.merchantRows(
            transactions: transactions,
            categories: SpendTestFixtures.categories,
            period: SpendTestFixtures.july2026
        )

        #expect(rows.count == 1)
        #expect(rows[0].total == Money(15))
        #expect(rows[0].previous == Money(15))
        #expect(rows[0].count == 2)
        #expect(rows[0].isRecurring)
    }

    @Test func itemRowsAggregateAmountsAndOnlyKnownQuantities() throws {
        let firstItems = lineItemsJSON([
            ("11111111-1111-1111-1111-111111111111", " Milk ", "4", "1"),
            ("22222222-2222-2222-2222-222222222222", "Bread", "2", nil),
        ])
        let secondItems = lineItemsJSON([
            ("33333333-3333-3333-3333-333333333333", "MILK", "6", "2"),
        ])
        let refundItems = lineItemsJSON([
            ("44444444-4444-4444-4444-444444444444", "milk", "1", "1"),
        ])
        let incomeItems = lineItemsJSON([
            ("55555555-5555-5555-5555-555555555555", "Milk", "100", "100"),
        ])
        let transactions = [
            try SpendTestFixtures.transaction("-6", date: "2026-07-10", category: SpendTestFixtures.groceriesID, lineItemsJSON: firstItems),
            try SpendTestFixtures.transaction("-6", date: "2026-07-11", category: SpendTestFixtures.groceriesID, lineItemsJSON: secondItems),
            try SpendTestFixtures.transaction("1", date: "2026-07-12", category: SpendTestFixtures.groceriesID, flags: #"{"refund":true}"#, lineItemsJSON: refundItems),
            try SpendTestFixtures.transaction("100", date: "2026-07-12", category: SpendTestFixtures.incomeID, lineItemsJSON: incomeItems),
        ]

        let rows = SpendDerivation.itemRows(
            transactions: transactions,
            categories: SpendTestFixtures.categories,
            period: SpendTestFixtures.july2026
        )

        #expect(rows.map(\.id) == ["milk", "bread"])
        #expect(rows[0].name == "MILK")
        #expect(rows[0].total == Money(9))
        #expect(rows[0].quantity == Money(2))
        #expect(rows[1].total == Money(2))
        #expect(rows[1].quantity == nil)
    }

    @Test func canonicalRecurringSuppressesInferredDuplicate() throws {
        let transactions = try [
            ("2026-05-10", "Netflix"), ("2026-06-10", "NETFLIX"), ("2026-07-10", " Netflix "),
            ("2026-05-12", "Hulu"), ("2026-06-12", "HULU"), ("2026-07-12", "hulu"),
            ("2026-06-15", "Spotify"), ("2026-07-15", "Spotify"),
        ].map { date, merchant in
            try SpendTestFixtures.transaction("-15", date: date, category: SpendTestFixtures.foodID, merchant: merchant)
        }
        let netflix = try recurringSeries(
            id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
            name: "Netflix",
            amount: "15",
            cadence: "monthly",
            type: "subscription",
            merchant: " NETFLIX "
        )

        let rows = SpendDerivation.recurringRows(
            transactions: transactions,
            categories: SpendTestFixtures.categories,
            canonical: [netflix]
        )

        #expect(rows.filter { $0.merchantKey == "netflix" }.count == 1)
        #expect(rows.first?.source == .canonical)
        #expect(rows.first?.merchantKey == "netflix")
        #expect(rows.contains { $0.merchantKey == "hulu" && $0.source == .inferred })
        #expect(!rows.contains { $0.merchantKey == "spotify" })
    }

    @Test func canonicalRecurringUsesReferencedTransactionMerchantForDedup() throws {
        let seriesID = UUID(uuidString: "99999999-9999-9999-9999-999999999999")!
        let canonical = try recurringSeries(
            id: seriesID.uuidString,
            name: "Family streaming",
            amount: "15",
            cadence: "monthly",
            type: "subscription",
            merchant: nil
        )
        let transactions = try ["2026-05-10", "2026-06-10", "2026-07-10"].map { date in
            try decodedTransaction(
                amount: "-15",
                baseAmount: nil,
                currency: "USD",
                date: date,
                category: SpendTestFixtures.foodID,
                merchant: " Netflix ",
                recurringSeriesID: seriesID
            )
        }

        let rows = SpendDerivation.recurringRows(
            transactions: transactions,
            categories: SpendTestFixtures.categories,
            canonical: [canonical]
        )

        #expect(rows.count == 1)
        #expect(rows[0].source == .canonical)
        #expect(rows[0].merchantKey == "netflix")
        #expect(rows[0].name == "Family streaming")
    }

    @Test func inferredRecurringAmountNetsMatchingRefundWithoutAddingOccurrence() throws {
        let charges = try ["2026-05-10", "2026-06-10", "2026-07-10"].map { date in
            try decodedTransaction(
                amount: "-15",
                baseAmount: nil,
                currency: "USD",
                date: date,
                category: SpendTestFixtures.foodID,
                merchant: "Netflix"
            )
        }
        let refund = try decodedTransaction(
            amount: "6",
            baseAmount: nil,
            currency: "USD",
            date: "2026-07-12",
            category: SpendTestFixtures.foodID,
            merchant: " NETFLIX ",
            flags: #"{"refund":true}"#
        )

        let rows = SpendDerivation.recurringRows(
            transactions: charges + [refund],
            categories: SpendTestFixtures.categories,
            canonical: []
        )

        #expect(rows.count == 1)
        #expect(rows[0].merchantKey == "netflix")
        #expect(rows[0].amount == Money(13))
        #expect(rows[0].cadence == "monthly")
    }

    @Test func canonicalRecurringExcludesIncomeTransferAndInactiveSeries() throws {
        let subscription = try recurringSeries(
            id: "11111111-1111-1111-1111-111111111111",
            name: "Phone",
            amount: "30",
            cadence: "monthly",
            type: "bill",
            merchant: "Phone Co"
        )
        let income = try recurringSeries(
            id: "22222222-2222-2222-2222-222222222222",
            name: "Salary",
            amount: "3000",
            cadence: "monthly",
            type: "income",
            merchant: "Employer"
        )
        let transfer = try recurringSeries(
            id: "33333333-3333-3333-3333-333333333333",
            name: "Savings",
            amount: "500",
            cadence: "monthly",
            type: "transfer",
            merchant: "Bank"
        )
        let paused = try recurringSeries(
            id: "44444444-4444-4444-4444-444444444444",
            name: "Old plan",
            amount: "10",
            cadence: "monthly",
            type: "subscription",
            status: "paused",
            merchant: "Old Co"
        )

        let rows = SpendDerivation.recurringRows(
            transactions: [],
            categories: SpendTestFixtures.categories,
            canonical: [income, paused, subscription, transfer]
        )

        #expect(rows.count == 1)
        #expect(rows[0].name == "Phone")
    }

    @Test func recurringMonthlyNormalizationIsExactPerCurrency() {
        let rows = [
            recurringRow(id: "weekly", amount: 12, currency: "USD", cadence: "weekly"),
            recurringRow(id: "biweekly", amount: 12, currency: "USD", cadence: "biweekly"),
            recurringRow(id: "monthly", amount: 12, currency: "USD", cadence: "monthly"),
            recurringRow(id: "quarterly", amount: 12, currency: "USD", cadence: "quarterly"),
            recurringRow(id: "yearly", amount: 12, currency: "USD", cadence: "yearly"),
            recurringRow(id: "annual", amount: 24, currency: "USD", cadence: "annual"),
            recurringRow(id: "unknown", amount: 999, currency: "USD", cadence: "irregular"),
            recurringRow(id: "inr", amount: 1_000, currency: "INR", cadence: "monthly"),
        ]

        #expect(rows[0].monthlyAmount == Money(52))
        #expect(rows[1].monthlyAmount == Money(26))
        #expect(rows[2].monthlyAmount == Money(12))
        #expect(rows[3].monthlyAmount == Money(4))
        #expect(rows[4].monthlyAmount == Money(1))
        #expect(rows[5].monthlyAmount == Money(2))
        #expect(rows[6].monthlyAmount == nil)
        #expect(SpendDerivation.recurringMonthlyTotal(rows, currency: "USD") == Money(97))
        #expect(SpendDerivation.recurringMonthlyTotal(rows, currency: "INR") == Money(1_000))
    }

    @Test func validatesSplitAndMergeWithoutMutatingInputs() {
        let id1 = UUID(uuidString: "11111111-1111-1111-1111-111111111111")!
        let id2 = UUID(uuidString: "22222222-2222-2222-2222-222222222222")!

        #expect(SpendDerivation.splitIsBalanced(source: Money(-10), parts: [Money(-6), Money(-4)]))
        #expect(!SpendDerivation.splitIsBalanced(source: Money(-10), parts: [Money(-6), Money(-3)]))
        #expect(!SpendDerivation.splitIsBalanced(source: Money(-10), parts: [Money(-10)]))
        #expect(SpendDerivation.mergeIsEligible([id1, id2]))
        #expect(!SpendDerivation.mergeIsEligible([id1]))
        #expect(!SpendDerivation.mergeIsEligible([id1, id1]))
        #expect(SpendDerivation.mergeIsEligible([id1, id1, id2]))
    }

    private func partialJulyPeriod() -> SpendPeriod {
        SpendPeriod(
            monthStart: APIDateParser.parse("2026-07-01")!,
            current: DateWindow(
                start: APIDateParser.parse("2026-07-01")!,
                end: APIDateParser.parse("2026-07-12T23:59:59")!
            ),
            previous: DateWindow(
                start: APIDateParser.parse("2026-06-01")!,
                end: APIDateParser.parse("2026-06-12T23:59:59")!
            ),
            isCurrentMonth: true
        )
    }

    private func lineItemsJSON(_ items: [(String, String, String, String?)]) -> String {
        let transactionID = "aaaaaaaa-1111-1111-1111-111111111111"
        return "[" + items.map { id, name, amount, quantity in
            let quantityJSON = quantity.map { "\"\($0)\"" } ?? "null"
            return #"{"id":"\#(id)","transaction_id":"\#(transactionID)","name":"\#(name)","amount":"\#(amount)","quantity":\#(quantityJSON),"item_type_category_id":null,"confidence":null}"#
        }.joined(separator: ",") + "]"
    }

    private func decodedTransaction(
        amount: String,
        baseAmount: String?,
        currency: String,
        date: String,
        category: UUID?,
        merchant: String,
        flags: String = "null",
        recurringSeriesID: UUID? = nil,
        lineItemsJSON: String = "[]"
    ) throws -> Transaction {
        let categoryJSON = category.map { "\"\($0.uuidString)\"" } ?? "null"
        let baseAmountJSON = baseAmount.map { "\"\($0)\"" } ?? "null"
        let recurringSeriesJSON = recurringSeriesID.map { "\"\($0.uuidString)\"" } ?? "null"
        let json = """
        {"id":"\(UUID())","household_id":"11111111-1111-1111-1111-111111111111","account_id":null,"payment_method_id":null,"recurring_series_id":\(recurringSeriesJSON),"owner_user_id":null,"merchant_id":null,"merchant":"\(merchant)","amount":"\(amount)","currency":"\(currency)","base_amount":\(baseAmountJSON),"fx_rate":null,"txn_date":"\(date)","category_id":\(categoryJSON),"status":"confirmed","source_document_id":null,"source_channel":"manual","is_shared":false,"flags":\(flags),"notes":null,"confidence":null,"external_id":null,"created_at":"\(date)T12:00:00","line_items":\(lineItemsJSON)}
        """
        return try JSONDecoder.api().decode(Transaction.self, from: Data(json.utf8))
    }

    private func recurringSeries(
        id: String,
        name: String,
        amount: String,
        cadence: String,
        type: String,
        status: String = "active",
        merchant: String?
    ) throws -> RecurringSeries {
        let merchantJSON = merchant.map { "\"\($0)\"" } ?? "null"
        let json = #"{"id":"\#(id)","name":"\#(name)","amount":"\#(amount)","currency":"USD","cadence":"\#(cadence)","type":"\#(type)","status":"\#(status)","next_due_date":"2026-08-10","merchant_name":\#(merchantJSON),"category_name":"Entertainment"}"#
        return try JSONDecoder.api().decode(RecurringSeries.self, from: Data(json.utf8))
    }

    private func recurringRow(id: String, amount: Decimal, currency: String, cadence: String) -> RecurringSpendRow {
        RecurringSpendRow(
            id: id,
            name: id,
            amount: Money(amount),
            currency: currency,
            cadence: cadence,
            nextDueDate: nil,
            merchantKey: id,
            source: .canonical
        )
    }
}
