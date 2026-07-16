import Foundation
import Testing
@testable import AalsiFinanceKit

@Suite struct AdvisorModelsDecodingTests {
    @Test func decodesAskResponse() throws {
        let json = """
        {
          "answer": "You're pacing 8% under plan. Skip one dine-out this week.",
          "suggestions": [{"type": "set_budget", "label": "Cap Dining at 6,000", "params": {"category": "Dining"}}],
          "available": true,
          "citations": [{"source_type": "transaction", "source_id": "abc"}],
          "thread_id": "ios-advisor"
        }
        """
        let out = try JSONDecoder.api().decode(AnalystAskResponse.self, from: Data(json.utf8))
        #expect(out.available)
        #expect(out.threadId == "ios-advisor")
        #expect(out.suggestions.first?.label == "Cap Dining at 6,000")
    }

    @Test func decodesUnavailableAskResponse() throws {
        let json = """
        {"answer": "The analyst is unavailable right now.", "suggestions": [], "available": false, "citations": [], "thread_id": null}
        """
        let out = try JSONDecoder.api().decode(AnalystAskResponse.self, from: Data(json.utf8))
        #expect(!out.available)
        #expect(out.threadId == nil)
    }

    @Test func decodesThreadHistory() throws {
        let json = """
        {"messages": [{"role": "user", "text": "How am I doing?"}, {"role": "analyst", "text": "On track."}]}
        """
        let out = try JSONDecoder.api().decode(AnalystThreadOut.self, from: Data(json.utf8))
        #expect(out.messages.count == 2)
        #expect(out.messages[0].isUser)
        #expect(!out.messages[1].isUser)
    }

    @Test func decodesPlanItem() throws {
        let json = """
        {
          "id": "55555555-5555-5555-5555-555555555555",
          "household_id": "22222222-2222-2222-2222-222222222222",
          "user_id": "11111111-1111-1111-1111-111111111111",
          "domain": "general",
          "title": "Build a 3-month emergency fund",
          "rationale": "Your EMIs are 40% of income.",
          "status": "open",
          "due_date": "2026-08-01",
          "source_refs": [{"source_type": "loan", "source_id": "x"}],
          "origin_thread_key": null,
          "created_at": "2026-07-15T09:30:00.123456",
          "updated_at": "2026-07-15T09:30:00"
        }
        """
        let item = try JSONDecoder.api().decode(GuidancePlanItem.self, from: Data(json.utf8))
        #expect(item.isOpen)
        #expect(!item.isCompleted)
        #expect(item.dueDate != nil)
    }

    @Test func decodesCrossBorderTransfer() throws {
        let json = """
        {
          "id": "66666666-6666-6666-6666-666666666666",
          "household_id": "22222222-2222-2222-2222-222222222222",
          "owner_user_id": null,
          "direction": "outbound",
          "from_currency": "USD", "to_currency": "INR",
          "amount": "2500.00", "fx_rate": "83.4500",
          "purpose": "family support", "channel": "wire",
          "transfer_date": "2026-06-30"
        }
        """
        let transfer = try JSONDecoder.api().decode(CrossBorderTransfer.self, from: Data(json.utf8))
        #expect(transfer.fromCurrency == "USD")
        #expect(transfer.fxRate.doubleValue == 83.45)
    }

    @Test func decodesLimits() throws {
        let json = """
        {
          "totals": [{"from_currency": "USD", "to_currency": "INR", "amount": "210000.00"}],
          "limits": [{"title": "LRS annual limit", "currency": "USD", "amount": "250000"}],
          "warnings": [{"message": "Transfer total is near a corpus-defined limit; verify the cited source before acting.", "ratio": "0.84", "limit_title": "LRS annual limit"}],
          "citations": [{"title": "LRS", "source_url": "https://example.com", "source_type": "regulation", "effective_date": "2026-04-01"}]
        }
        """
        let limits = try JSONDecoder.api().decode(CrossBorderLimits.self, from: Data(json.utf8))
        #expect(limits.totals.first?.amount.doubleValue == 210_000)
        #expect(limits.warnings.first?.ratio?.value == Decimal(string: "0.84"))
    }

    @Test func decodesChecklist() throws {
        let json = """
        {
          "checklist": [
            {"title": "File FBAR if balances exceed $10k", "country": "US", "topic": "reporting",
             "source_type": "regulation", "source_url": "https://example.com/fbar", "effective_date": "2026-01-01"},
            {"title": "Track LRS usage", "country": null, "topic": null, "source_type": null, "source_url": null, "effective_date": null}
          ],
          "citations": [],
          "disclaimer": "Educational information, not professional advice."
        }
        """
        let out = try JSONDecoder.api().decode(CrossBorderChecklist.self, from: Data(json.utf8))
        #expect(out.checklist.count == 2)
        #expect(out.checklist[1].effectiveDate == nil)
        #expect(!out.disclaimer.isEmpty)
    }

    @Test func decodesMemoryStatus() throws {
        let json = """
        {
          "sources": [
            {"source_type": "transaction", "count": 73, "last_indexed": "2026-07-15T04:00:00"},
            {"source_type": "budget", "count": 4, "last_indexed": null}
          ],
          "last_synced": "2026-07-15T04:00:00.500000"
        }
        """
        let status = try JSONDecoder.api().decode(MemoryStatus.self, from: Data(json.utf8))
        #expect(status.sources.first?.count == 73)
        #expect(status.lastSynced != nil)
    }

    @Test func encodesAskRequestAsSnakeCase() throws {
        let body = AnalystAskRequest(question: "How am I doing?", threadId: "ios-advisor", page: "advisor")
        let data = try JSONEncoder.api().encode(body)
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(object["thread_id"] as? String == "ios-advisor")
        #expect(object["mode"] as? String == "explain")
    }
}
