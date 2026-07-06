# Technical Architecture And Feasibility

## 1. Recommended Architecture

```text
Mobile App / Desktop Web App / Telegram Bot / Discord Bot
        |
API Gateway
        |
Authentication And User Service
        |
Core Finance API
        |
Transaction Service
Debt Service
Salary Service
Cross-Border Service
Document Processing Service
AI Insight Service
Notification Service
        |
PostgreSQL / Object Storage / Queue / Cache
```

## 2. Recommended Stack

### Frontend

- Mobile app: React Native with Expo, or Flutter.
- Desktop web app: Next.js with TypeScript.
- Shared API contracts: OpenAPI or tRPC if staying in TypeScript.
- Design system: shared tokens for colors, typography, spacing, and cards.

Recommended default: Next.js for web plus React Native for mobile, backed by shared TypeScript models.

### Backend

- API: NestJS or FastAPI.
- Database: PostgreSQL.
- ORM: Prisma for TypeScript stack, SQLAlchemy for Python stack.
- Queue: Redis with BullMQ, or managed queue such as SQS.
- Object storage: S3-compatible storage.
- Cache: Redis.
- Search: PostgreSQL full-text search initially.
- Vector search: optional later for document Q&A.

Recommended default: TypeScript stack with Next.js, React Native, NestJS, PostgreSQL, Prisma, Redis, and S3-compatible storage.

## 3. Core Services

### Auth Service

Responsibilities:

- Sign up and login.
- MFA support.
- Session management.
- Bot account linking.
- Device management.

### Transaction Service

Responsibilities:

- Transaction CRUD.
- Merchant normalization.
- Category and tag assignment.
- Filtering and aggregation.
- Item-level transaction records.
- Duplicate detection.

### Document Processing Service

Responsibilities:

- Upload management.
- OCR job scheduling.
- Document type detection.
- Structured extraction.
- Review queue creation.
- Source document linkage.

### AI Insight Service

Responsibilities:

- Generate plain-English summaries.
- Suggest categories.
- Detect anomalies.
- Generate recommendations from structured facts.
- Ask clarification questions.

### Debt Service

Responsibilities:

- Debt profiles.
- Payment schedules.
- Payoff estimates.
- Extra payment simulations.
- Penalty warning rules.

### Cross-Border Service

Responsibilities:

- Transfer records.
- FX rates.
- Transfer fees.
- Purpose tagging.
- Compliance education triggers.
- Country-specific finance education.

### Notification Service

Responsibilities:

- Push notifications.
- Email notifications.
- Bot reminders.
- Debt due alerts.
- Document processing updates.

## 4. Data Model

Core tables:

- users.
- households.
- accounts.
- transactions.
- transaction_items.
- merchants.
- categories.
- tags.
- documents.
- extracted_records.
- debts.
- debt_payments.
- salary_income.
- cross_border_transfers.
- currency_rates.
- recommendations.
- bot_accounts.
- bot_messages.
- notifications.
- audit_logs.

## 5. AI Design

Use LLMs for interpretation and explanation, not authoritative calculations.

LLM-suitable tasks:

- Classifying merchant/category.
- Interpreting receipt text.
- Summarizing spending patterns.
- Generating plain-English insight cards.
- Converting natural language into structured entries.

Deterministic tasks:

- Debt payoff calculations.
- Interest calculations.
- Time-series aggregations.
- Currency conversion after fetching rates.
- Due date reminders.
- Late fee rules.
- Duplicate matching thresholds.

Recommended AI flow:

1. Build structured facts from database.
2. Send only necessary facts to LLM.
3. Receive structured JSON response.
4. Validate response against schema.
5. Store recommendation with supporting facts.
6. Display recommendation with explainability.

## 6. OCR Pipeline

```text
Upload file
  -> Store encrypted object
  -> Create document record
  -> Queue OCR job
  -> OCR extracts text/tables
  -> AI classifies document
  -> AI extracts structured records
  -> Validate schema
  -> Create review items
  -> User confirms
  -> Create final records
```

MVP OCR provider choices:

- Google Document AI for strong document parsing.
- AWS Textract for structured tables and forms.
- Azure AI Document Intelligence for broad document extraction.

## 7. SMS And App Data Feasibility

### iOS

iOS does not allow third-party apps to read SMS messages or access the Messages database. Automatic SMS transaction extraction is not feasible for iOS.

Viable alternatives:

- Manual copy-paste.
- Share sheet imports.
- Screenshot upload with OCR.
- Email forwarding.
- Receipt/document upload.
- Siri Shortcuts triggered by the user.

### Android

Android is more flexible but still highly restricted.

Possible options:

- Manual SMS paste/import.
- Notification listener with explicit user permission.
- SMS read permission only if approved under Google Play policy.
- SMS Retriever API only for app-specific verification messages, not general finance SMS reading.

Risks:

- Google Play restricts READ_SMS heavily.
- Notification access is sensitive and may reduce trust.
- Bank SMS formats vary significantly.
- Background capture can create privacy concerns.

Recommended approach:

- Do not depend on automatic SMS access in MVP.
- Build parser for pasted SMS and screenshots.
- Consider Android notification capture only as an opt-in advanced feature after privacy review.

### Other Apps

Reading data from other apps is generally not feasible or acceptable.

Constraints:

- iOS and Android sandbox applications from each other.
- App data is not accessible without explicit user action.
- Accessibility-based scraping is fragile and may violate platform policies.
- Screen scraping is not privacy-safe.

Recommended approach:

- Use share sheet imports.
- Use screenshots with OCR.
- Use email forwarding.
- Use bots.
- Avoid background scraping.

## 8. Email Feasibility

Email import is feasible but must be privacy-first.

MVP approach:

- Give each user a unique forwarding address.
- User forwards receipts, bank alerts, and remittance confirmations.
- Parse only forwarded emails.

Later approach:

- Gmail API integration with narrow scopes.
- Outlook API integration with narrow scopes.
- Provider-specific parsing templates.

Risks:

- OAuth app verification.
- Sensitive data exposure.
- User distrust of mailbox access.
- Inconsistent email formats.

## 9. Telegram And Discord Bots

Bot architecture:

```text
Telegram / Discord
  -> Bot webhook
  -> Message ingestion API
  -> User linking validation
  -> Intent parser
  -> Clarification flow if needed
  -> Transaction/debt/transfer creation
  -> Confirmation response
```

Security requirements:

- One-time linking code from app.
- DM-first interaction model.
- Rate limits.
- No sensitive documents in public channels.
- Audit bot-created records.
- Allow unlinking.

Supported bot intents:

- Log expense.
- Log debt payment.
- Log cross-border transfer.
- Upload receipt.
- Ask monthly spending summary.
- Ask category summary.
- Ask upcoming due dates.

## 10. Security Requirements

- HTTPS everywhere.
- Encryption at rest.
- Encrypted object storage.
- Secure secret management.
- MFA support.
- Biometric unlock on mobile.
- Audit logs for sensitive changes.
- Data export.
- Full account deletion.
- Consent-based integrations.
- Least-privilege access.
- PII minimization.
- No training on user data without explicit consent.

## 11. Non-Functional Requirements

Performance:

- Dashboard loads within 2 seconds for typical users.
- Uploads should return immediately and process asynchronously.
- Filters should work efficiently on multi-year transaction histories.

Reliability:

- Financial calculations must be covered by tests.
- OCR and AI jobs must be retryable.
- Duplicate detection must prevent repeated imports.

Scalability:

- Use queue-based document processing.
- Keep raw documents separate from extracted records.
- Index transaction date, merchant, category, country, and user ID.

Compliance posture:

- Add legal, tax, and investment disclaimers.
- Avoid regulated personalized advice in MVP.
- Prepare for GDPR/CCPA-like deletion and export expectations.
