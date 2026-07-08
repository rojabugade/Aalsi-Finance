# Dashboard Widget Data Backend (Slice C-be)

**Date:** 2026-06-19  
**Status:** Implemented  
**Sources:** `mockup images/widgets.md`, `2026-06-19-dashboard-widgets-roadmap.md`, `2026-06-19-schema-expansion-payment-cc-holdings-recurring-design.md`

## Goal

Materialize the approved payment-method, credit-card-detail, recurring-series, and
investment-holding schema and expose household-scoped API surfaces that slice C's
widgets can consume directly. No widget UI or payment-execution behavior is included.

## Data contract

- Payment methods identify the funding instrument used by a transaction. They never
  store credentials. Transactions may reference a payment method.
- Recurring series describe subscriptions, bills, income, transfers, and other repeated
  events. Transactions may reference a series. A series never schedules or posts money.
- Credit-card details extend existing `loan(type=credit_card)` rows one-to-one. The card
  read model joins loan and statement data and exposes utilization plus
  `detail_complete`; missing statement data is an explicit partial-data condition.
- Holdings belong only to `account_logical(type=investment)`. List responses include the
  latest valuation; valuation history is a separate endpoint.

All new resources follow existing household and owner visibility rules. References are
validated in the caller's scope before writes, including transaction links.

## Endpoints

| Resource | Endpoints |
|---|---|
| Payment methods | `GET/POST /payment-methods`, `PATCH/DELETE /payment-methods/{id}` |
| Credit cards | `GET /credit-cards`, `PUT /loans/{id}/credit-card-detail` |
| Recurring series | `GET/POST /recurring-series`, `PATCH/DELETE /recurring-series/{id}` |
| Holdings | `GET/POST /holdings`, `PATCH/DELETE /holdings/{id}` |
| Valuations | `GET/POST /holdings/{id}/valuations` |

The generated OpenAPI contract is consumed by React Query hooks in
`web/lib/api/widget-data.ts`. Merchant widget data remains on the existing analytics
breakdown endpoint, and debt remains on the existing loans endpoints.

## Trust and calculation rules

- Card utilization is `statement balance (or outstanding principal) / credit limit`.
- Available credit is returned as stored; if omitted, it is derived from limit minus
  the selected balance.
- A holding valuation may provide `value`; otherwise the backend calculates
  `price × quantity`.
- Card records without `credit_card_detail` remain visible with
  `detail_complete=false`, allowing the widget contract to render partial state.

## Out of scope

- Widget components and registry entries (slice C).
- Recurring detection, cancellation reminders, autopay, or payment execution.
- Market-price fetch jobs and investment advice.
- Rewards and autopay fields, which have no approved source-of-truth schema yet.
