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
