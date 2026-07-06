# MVP Execution Roadmap

## Phase 0: Product Foundation

Goal: Convert the concept into an implementation-ready backlog.

Deliverables:

- PRD finalized.
- Data model finalized.
- UX flows drafted.
- Technical stack selected.
- Security baseline agreed.
- MVP scope locked.

Exit criteria:

- Engineering can start implementation without major product ambiguity.
- MVP modules are prioritized into buildable milestones.

## Phase 1: Core Manual Tracker

Goal: Deliver a usable finance tracker without automation.

Features:

- User authentication.
- Manual expense entry.
- Natural-language transaction entry.
- Categories, subcategories, merchants, and tags.
- Transaction list.
- Date filters by month, quarter, year, and custom range.
- Merchant summaries.
- Basic dashboard.
- Multi-currency transaction storage.
- Mobile-responsive web experience.

Implementation steps:

1. Build auth and user profile.
2. Build category and merchant models.
3. Build transaction CRUD APIs.
4. Build transaction entry UI.
5. Build dashboard summaries.
6. Build filters and merchant breakdowns.
7. Add basic test coverage for financial calculations and filters.

Exit criteria:

- User can log and analyze expenses manually.
- User can filter spending by time, category, merchant, and tags.

## Phase 2: Debt And Salary MVP

Goal: Add core financial planning modules.

Features:

- Debt profile creation.
- Payment schedule.
- Due date reminders.
- Penalty warnings.
- Estimated payoff calculator.
- Extra payment simulator.
- Salary entry.
- Net/gross salary tracking.
- Employer and pay-date tracking.

Implementation steps:

1. Build debt data model and APIs.
2. Build deterministic payoff calculation engine.
3. Build debt UI and simulator.
4. Build notification scheduling.
5. Build salary data model and APIs.
6. Build income dashboard cards.

Exit criteria:

- User can track debt, due dates, and payoff projections.
- User can track salary and income basics.

## Phase 3: OCR And Document Review

Goal: Reduce manual effort using uploads and AI extraction.

Features:

- Receipt upload.
- Bank and credit card statement upload.
- OCR job pipeline.
- AI document classification.
- Transaction extraction.
- Item-level receipt parsing.
- Confidence scoring.
- User review and confirmation queue.
- Duplicate detection.

Implementation steps:

1. Add object storage for uploaded files.
2. Add document table and processing statuses.
3. Add background worker queue.
4. Integrate OCR provider.
5. Implement extraction prompts and schemas.
6. Build review UI.
7. Convert confirmed extracted data into records.
8. Add duplicate detection logic.

Exit criteria:

- User can upload a receipt or statement and confirm extracted transactions.
- Extracted data includes source references and confidence scores.

## Phase 4: AI Insights

Goal: Move from tracking to actionable guidance.

Features:

- Spending trend detection.
- Category-specific recommendations.
- Merchant-level insights.
- Recurring payment detection.
- Subscription detection.
- Anomaly detection.
- Plain-English monthly summary.
- Debt optimization recommendations.

Implementation steps:

1. Build analytics aggregation queries.
2. Build deterministic insight rules.
3. Add LLM summary generation using structured facts.
4. Add recommendation table.
5. Build insight cards in mobile and desktop UI.
6. Add user feedback on recommendations.

Exit criteria:

- User receives useful monthly and category-level recommendations.
- All recommendations are explainable from underlying data.

## Phase 5: Cross-Border US-India Module

Goal: Deliver the product's main differentiation.

Features:

- Cross-border transfer logging.
- FX rate storage.
- Transfer fees.
- Recipient and purpose tagging.
- US vs India dashboard views.
- Educational compliance reminders.
- India investment education content.

Implementation steps:

1. Build transfer data model and APIs.
2. Integrate FX rate provider.
3. Build transfer logging UI.
4. Build cross-border analytics dashboard.
5. Create educational guidance content library.
6. Add compliance reminder rules with disclaimers.

Exit criteria:

- User can understand cross-border transfers by month, purpose, fee, FX, and recipient.
- App provides educational guidance without giving regulated advice.

## Phase 6: Bot Interfaces

Goal: Enable fast conversational logging.

Features:

- Telegram bot.
- Discord bot.
- Secure account linking.
- Natural-language expense logging.
- Receipt image upload through bot.
- Summary queries.
- Debt reminders through bot.

Implementation steps:

1. Build bot account linking with one-time codes.
2. Build message ingestion service.
3. Parse expense, debt, and transfer intents.
4. Add clarification question flow.
5. Add bot response templates.
6. Add rate limits and security controls.

Exit criteria:

- User can log expenses and ask basic summaries through Telegram or Discord.

## Phase 7: Advanced Imports

Goal: Add privacy-safe import channels after the core product works.

Features:

- Email forwarding parser.
- Gmail and Outlook integrations with narrow scopes.
- Android manual SMS paste parser.
- Android notification capture as optional advanced feature.
- iOS share sheet and screenshot OCR.
- Siri Shortcuts.

Implementation steps:

1. Build unique forwarding email addresses.
2. Build email parser pipeline.
3. Add provider-specific templates.
4. Add Gmail/Outlook OAuth after privacy review.
5. Add mobile share sheet support.
6. Evaluate Android notification listener feasibility.

Exit criteria:

- User can import transaction-like data without direct bank APIs.
- Import methods respect platform privacy constraints.
