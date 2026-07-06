# AI Financial Management App PRD

## 1. Product Summary

Build a single AI-powered financial management product available as a mobile app and desktop web app. The product helps users track expenses, manage debt, track salary and income, and understand cross-border finances, with an initial focus on US-India use cases.

The app does not require direct bank API connections in the MVP. Instead, it relies on manual entry, user-uploaded documents, OCR, receipt parsing, statement parsing, screenshots, email forwarding, and optional bot-assisted inputs.

The experience must be designed for non-finance-savvy users. Complex financial data should be translated into simple language, clear visuals, and actionable next steps.

## 2. Product Goals

- Help users understand where their money goes without needing bank integrations.
- Provide granular expense categorization down to merchant, item, and tag level.
- Make debt payoff timelines, penalties, and payment schedules easy to understand.
- Track salary, income, deductions, bonuses, and future cashflow.
- Support US-India financial tracking, remittances, FX, compliance education, and investment education.
- Provide AI-powered recommendations while keeping users in control of all extracted data.
- Support both mobile-first everyday usage and richer desktop dashboard analysis.

## 3. Non-Goals For MVP

- Direct Plaid-style bank connections.
- Fully automatic iOS SMS reading.
- Background scraping of other apps.
- Personalized regulated investment advice.
- Tax filing or legal compliance filing.
- Fully automated categorization without user review for low-confidence data.

## 4. Target Users

### Primary Users

- Indian immigrants, students, and employees living in the US.
- Users who send money from the US to India.
- Users with Indian and US expenses, loans, or investments.
- Users who want financial visibility but do not want to connect bank accounts.
- Users managing credit cards, EMIs, student loans, personal loans, or family obligations.

### Secondary Users

- Freelancers with income in multiple currencies.
- Families tracking shared household spending.
- Users who prefer conversational expense logging through bots.
- Users planning India travel, family support, or India-based investments.

## 5. Core Product Principles

- Manual-first, automation-assisted.
- Explain before optimizing.
- AI suggestions must be editable.
- Financial math must be deterministic and testable.
- Sensitive advice must be educational, not legally or financially binding.
- Every extracted transaction should preserve source and confidence metadata.
- Mobile should support quick capture; desktop should support review and analysis.

## 6. Primary User Journeys

### Journey 1: Manual Expense Logging

1. User opens mobile app.
2. User enters `Spent $18 at Chipotle for lunch`.
3. AI extracts amount, merchant, category, date, and currency.
4. App suggests `Food > Eating Out`.
5. User confirms or edits.
6. Transaction appears in dashboard and monthly insights.

### Journey 2: Receipt Upload With Item-Level Breakdown

1. User uploads a Macy's receipt.
2. OCR extracts merchant, date, total, and line items.
3. AI groups line items into categories such as pants, tops, cosmetics.
4. User reviews uncertain fields.
5. App shows total spend at Macy's and category contribution.

### Journey 3: Debt Tracking

1. User adds a loan or credit card balance.
2. User enters due date, interest rate, minimum payment, and payment amount.
3. App calculates estimated payoff time.
4. App warns about upcoming due dates and late penalties.
5. App simulates extra payment scenarios.

### Journey 4: US-India Transfer Tracking

1. User logs a transfer from USD to INR.
2. App records sender country, recipient country, FX rate, fee, provider, purpose, and recipient.
3. App shows monthly transfer totals and purposes.
4. App displays educational compliance reminders for large or recurring transfers.

### Journey 5: Bot-Based Logging

1. User sends a Telegram or Discord message: `Paid Rs 12000 HDFC EMI`.
2. Bot identifies debt payment and currency.
3. Bot asks clarification if needed.
4. Transaction syncs to app.
5. User can ask: `How much did I spend on shopping this month?`.

## 7. Expense Tracking Requirements

### Input Methods

- Manual app entry.
- Natural-language text entry.
- Receipt upload.
- Invoice upload.
- Bank statement upload.
- Credit card statement upload.
- Screenshot upload.
- Email forwarding.
- Telegram bot.
- Discord bot.
- Manual SMS paste/import.

### Transaction Fields

- Amount.
- Currency.
- Date.
- Merchant.
- Category.
- Subcategory.
- Item category.
- Tags.
- Payment method.
- Country.
- Source type.
- Source document.
- AI confidence score.
- User confirmation status.
- Notes.
- Tax relevance flag.
- Business/personal flag.
- Reimbursable flag.
- Shared/family flag.

### Item-Level Fields

- Parent transaction.
- Item name.
- Item amount.
- Quantity when available.
- Category.
- Subcategory.
- Item group.
- Confidence score.

## 8. Deep Categorization And Filtering

The app must support hierarchical and flexible categorization.

Example hierarchy:

```text
Shopping
  Clothing
    Pants
    Tops
    Shoes
  Cosmetics
    Skincare
    Makeup
  Household
    Kitchen
    Cleaning
```

Required filtering dimensions:

- Date range.
- Month.
- Quarter.
- Year.
- Custom period.
- Merchant.
- Category.
- Subcategory.
- Item category.
- Tag.
- Currency.
- Country.
- Payment method.
- Source type.
- Recurring vs one-time.
- Essential vs discretionary.
- Debt-related.
- Salary-related.
- Cross-border transfer.
- Tax-relevant.

### Merchant Grouping Example

If a Macy's receipt contains pants, tops, and cosmetics, the app should show:

```text
Macy's total spend: $320

Contribution:
Clothing: $210
Pants: $120
Tops: $90
Cosmetics: $110
```

Quantity is useful when available, but contribution by amount is the primary requirement.

### AI Pseudo-Categories

The app should generate editable pseudo-categories such as:

- Macy's Shopping.
- Amazon Household.
- India Family Support.
- Weekend Eating Out.
- Credit Card Interest.
- Travel To India.
- Subscriptions.
- Impulse Purchases.

## 9. AI Recommendations

The AI layer should provide contextual, category-specific insights.

Recommendation examples:

- Your food delivery spending increased 32% compared to your 3-month average.
- You spent $410 at Macy's this quarter, mostly on clothing.
- Paying $150 extra toward this credit card may reduce payoff time by 5 months.
- Your India transfers are concentrated during the first week of each month.
- You have 6 subscriptions totaling $84 per month.

AI capabilities:

- OCR text interpretation.
- Receipt line-item extraction.
- Bank statement transaction extraction.
- Merchant normalization.
- Category prediction.
- Duplicate detection.
- Recurring payment detection.
- Spending anomaly detection.
- Debt payoff recommendations.
- Cashflow projections.
- Plain-English financial explanations.

AI guardrails:

- Show confidence scores.
- Ask clarifying questions for uncertain data.
- Keep calculations deterministic outside the LLM.
- Label tax, investment, and legal content as educational.
- Preserve original source documents or extracted text references.
- Allow user correction.
- Learn from user corrections only with consent and privacy controls.

## 10. OCR And Document Processing

Supported documents:

- Receipts.
- Invoices.
- Bank statements.
- Credit card statements.
- Salary slips.
- Loan documents.
- Remittance confirmations.
- Tax documents.
- Investment statements.

Processing flow:

1. User uploads document from mobile or web.
2. App stores original file securely.
3. Background job starts OCR.
4. OCR returns text and table structures.
5. AI classifies document type.
6. AI extracts structured records.
7. System assigns confidence scores.
8. User reviews and confirms extracted records.
9. Confirmed records become transactions, debt entries, salary entries, or transfers.
10. Insights and dashboards update.

MVP OCR options:

- Google Document AI.
- AWS Textract.
- Azure AI Document Intelligence.
- OCR.space for low-cost prototyping.

## 11. Debt And Loan Management

Supported debt types:

- Credit card balances.
- Student loans.
- Personal loans.
- Auto loans.
- Home loans.
- Indian EMIs.
- Family loans.
- Buy-now-pay-later balances.

Required fields:

- Debt name.
- Lender.
- Principal.
- Current balance.
- Interest rate.
- Minimum payment.
- Regular payment amount.
- Due date.
- Grace period.
- Late fee.
- Currency.
- Country.
- Linked payment transactions.

Features:

- Payment schedule.
- Due date reminders.
- Penalty warnings.
- Estimated payoff time.
- Interest paid projection.
- Extra payment simulator.
- Debt avalanche method.
- Debt snowball method.
- Credit utilization awareness for credit cards.

## 12. Salary And Income Management

MVP salary features:

- Salary entry.
- Employer.
- Gross income.
- Net income.
- Pay date.
- Currency.
- Country.
- Tax withheld.
- Deductions.
- Bonus.
- Reimbursements.
- Multiple income streams.

Future features:

- Salary slip OCR.
- Tax withholding trend analysis.
- Bonus planning.
- RSU and stock vesting tracker.
- Cashflow forecasting.
- Paycheck anomaly detection.
- US vs India income classification.

## 13. Cross-Border US-India Finance

Core features:

- Track money sent from US to India.
- Track India-based and US-based spending separately.
- Store historical FX rates.
- Track transfer provider and fees.
- Tag transfer purpose.
- Track recipient.
- Show monthly and yearly transfer summaries.
- Show educational compliance reminders.
- Provide NRI finance education.
- Provide India investment education.

Transfer fields:

- Source country.
- Destination country.
- Source currency.
- Destination currency.
- Source amount.
- Received amount.
- Exchange rate.
- Transfer fee.
- Transfer provider.
- Recipient.
- Purpose.
- Date sent.
- Date received.
- Source document.

Educational guidance areas:

- NRE, NRO, and FCNR account concepts.
- FEMA basics.
- US tax residency basics.
- Foreign account reporting awareness.
- Gift transfer considerations.
- India tax basics for NRI users.
- Currency risk.
- India investment education.

All guidance must include a disclaimer that it is educational and not legal, tax, or investment advice.

## 14. Mobile App Requirements

- Quick transaction entry.
- Camera receipt capture.
- Push notifications for reminders.
- Mobile dashboard cards.
- Offline draft support for manual entries.
- Share sheet support for screenshots and documents.
- Biometric unlock.
- Bot linking flow.
- Review queue for extracted data.

## 15. Desktop Web App Requirements

- Full dashboard with charts and filters.
- Bulk transaction review.
- Document upload and processing status.
- Debt payoff simulator.
- Salary and cashflow views.
- Cross-border transfer analysis.
- Export to CSV.
- Settings and privacy controls.

## 16. Success Metrics

- Weekly active users.
- Number of transactions logged per active user.
- Percentage of OCR transactions confirmed.
- Manual correction rate.
- Number of debts tracked.
- Reminder engagement rate.
- Cross-border transfer logs per user.
- Monthly retention.
- User-reported confidence in finances.
