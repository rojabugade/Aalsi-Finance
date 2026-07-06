# AI Financial Management App

AI-powered personal financial management app for expense tracking, debt management, salary tracking, and US-India cross-border finance. The product is designed for mobile app and desktop web app compatibility without requiring direct bank API connections in the MVP.

## Project Documents

- [Product Requirements Document](docs/PRD.md)
- [MVP Execution Roadmap](docs/ROADMAP.md)
- [Technical Architecture And Feasibility](docs/ARCHITECTURE.md)

## MVP Direction

The first build should focus on:

- Manual expense tracking.
- Deep category, merchant, item, and tag filtering.
- Debt and salary basics.
- Multi-currency support.
- Receipt/document upload with OCR review.
- Plain-English AI insights.
- US-India transfer tracking.

Avoid depending on direct bank APIs, automatic iOS SMS extraction, full mailbox access, or regulated personalized financial advice in the MVP.

## Recommended Next Step

Convert the roadmap into an implementation backlog, then scaffold the selected app stack. Recommended default stack:

- Web: Next.js with TypeScript.
- Mobile: React Native with Expo.
- Backend: NestJS with TypeScript.
- Database: PostgreSQL with Prisma.
- Jobs/cache: Redis.
- Storage: S3-compatible object storage.

## Current Implementation

This repository now contains a runnable MVP scaffold:

- `packages/shared`: shared finance types, formatting helpers, category summaries, merchant item summaries, and debt payoff calculations.
- `apps/api`: Express API with seeded transactions, debt, salary, transfer, and insight data.
- `apps/web`: Vite React dashboard with manual expense entry, insight cards, category summaries, merchant item breakdowns, salary, debt, and US-India transfer cards.

## Run Locally

Install dependencies:

```bash
npm install
```

Start the API:

```bash
npm run dev:api
```

Start the web app in another terminal:

```bash
npm run dev:web
```

Then open the Vite URL, usually `http://localhost:5173`.

Verify the code:

```bash
npm run typecheck
npm run build
```
