# Dashboard Widgets Module — Execution Roadmap

**Date:** 2026-06-19
**Status:** Approved (sequencing). Source vision: `mockup images/widgets.md` (22 sections).
**Parent of:** per-slice design specs (each slice gets its own `*-design.md` → plan → build).

## Context

`widgets.md` is a large product vision (~10 independent subsystems), not a single spec.
Phase 0 — the board engine + 7 configurable widgets — already shipped per
`2026-06-18-configurable-dashboard-widgets-design.md` (grid engine, registry + config
model, selection-aware glass PersonalizeSheet, drag/resize/lattice canvas, localStorage
layout-store v2). This roadmap sequences the remaining slices. Ordering is driven by
dependency (what unblocks what), not MVP labels alone.

## Sequence

| Order | Slice | Scope | Blocked by |
|------|-------|-------|-----------|
| 0 ✓ | A — Board engine + 7 widgets | shipped | — |
| 1 | **B — Global Controls shell** | Top command bar: Add-Txn split button, Ask-AI/search bar, date-range selector, Customize/Layout toggles, Analyst toggle, Review Queue chip, sync/status. Targets stubbed. | — |
| 2 | **D — Widget-system standard** | Base Widget contract: states (empty/loading/error/partial), adaptive tiers, presets (Compact/Standard/Detailed/Analytical), insight chips (rule-based), Focus View. Retrofit the 7. | — |
| 3 | **C-be — backend for card/debt/recurring/holdings** | Migration + endpoints + hooks for the just-designed schema. | schema design ✓ |
| 4 | **C — data-backed widgets** | Credit Card, Debt, Recurring, Merchant — built to D's standard, fed by C-be. | D, C-be |
| 5 | **E — personalization depth** | Density modes (Calm/Balanced/Power/Minimal), Layout vs Customize split, saved layouts, theme presets, privacy modes. | D |
| 6 | **F — templates + onboarding** | Preset dashboards, goal→board generation. | C, B |
| 7 | **I — Add-Txn import pipeline** | upload→AI extract→preview→confirm→import (backend OCR M5 exists). Fills B's Add-Txn target. | B |
| 8 | **G — AI Analyst Pane** | Monitor/Explain/Plan/Action modes, tone presets, inline insights. Upgrades D's chips to AI. (LLM gateway M3 exists.) Fills B's Analyst toggle. | B, D |
| 9 | **H — Review Queue** | Uncertain-data triage. Fills B's Review chip; consumes I's import flags + G's AI uncertainty. | B, I, G |
| 10 | **J — AI-generated widgets** | Schema-driven AI widget creation. | D, G |

## Cross-cutting decisions baked into this ordering

1. **Global date range vs per-widget range.** B adds a global selector; widgets already
   carry per-widget `config.range`. Rule (to finalize in slice B): global is the default,
   per-widget config can override.
2. **Insight chips ship twice.** D delivers rule-based chips; G upgrades them to AI. Accepted.
3. **B ships with stubs.** Add-Txn / Analyst / Review controls are present-but-inert until
   slices 7 / 8 / 9 land.

## Process

Each slice runs the full brainstorm → design spec → writing-plans → execute cycle
independently. This file is the index; do not let a slice's detail leak upward into it.
