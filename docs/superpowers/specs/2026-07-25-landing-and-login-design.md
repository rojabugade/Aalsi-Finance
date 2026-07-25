# Landing page + login revamp — design

Date: 2026-07-25
Status: approved for planning

## Goal

Give the product a public front door. Today `/` redirects straight to `/dashboard`,
so a logged-out visitor's first and only screen is a login form. Add a marketing
landing page at `/`, and restyle the auth screens so they read as the same product.

Success criteria:

1. A logged-out visitor at `/` sees a landing page that explains what the product
   does, shows what it looks like, and offers one obvious way to start.
2. A signed-in visitor at `/` still lands on `/dashboard` without an extra click.
3. Every claim on the landing page maps to a feature that actually ships today.
4. Login, signup, forgot-password, reset-password and verify-email share one
   visual language with the landing page.
5. Auth behaviour is unchanged: same endpoints, same fields, same validation.

Non-goals: pricing, blog, docs site, waitlist capture, analytics/consent banner,
i18n beyond the existing English message catalogue.

## Decisions

| Decision | Choice |
|---|---|
| Product name | **Alsi Finance**. `app.name` becomes "Alsi Finance"; the `ALSI` wordmark stays. |
| Landing route | `/` — redirects to `/dashboard` when a session hint cookie is present. |
| Scope | Full marketing page: hero, how-it-works, feature rows, security, FAQ, CTA, footer. |
| Visual direction | Dark editorial, product-forward. |
| Theming | Fixed art direction, **not** the app's 8-palette `data-theme` cookie. Dark is canonical; a light counterpart follows `prefers-color-scheme: light`. |
| Product proof | Hand-built HTML/CSS panels, not bitmap screenshots. |
| Login | Restyle to match; structure, fields and flow unchanged. |

### Why not the existing screenshots

`claude_design/` holds 26 real captures of the app, but every full-window shot
carries `Household 1 · 3 members` in the sidebar. README lists household sharing
as **removed** — each account is now a single-user private workspace. The images
also include the macOS menu bar, Arc browser chrome and a `localhost:3000` URL,
and are 3024×1964 (22 MB total).

Shipping them would advertise a feature that no longer exists. Hand-built panels
are accurate to the current app, stay crisp at any DPI, weigh ~15 KB, and can be
updated in the same commit as the UI they depict.

### Why the theme cookie is not reused

The app has eight palettes selected by a `cf-theme` cookie. A marketing page is
seen before anyone has picked a theme, so palette support would mean eight
half-directed pages instead of one designed one. The landing page defines its own
scoped variable set and ignores `data-theme` entirely.

## Architecture

```
web/app/page.tsx                        landing entry (server component)
web/app/(marketing)/
  layout.tsx                            dark/light shell, marketing metadata
  marketing.css                         scoped token set + both colour schemes
  _components/
    marketing-nav.tsx                   sticky top bar, wordmark, links, sign-in
    hero.tsx                            headline, subhead, dual CTA, product panel
    product-panel.tsx                   hand-built dashboard visual
    how-it-works.tsx                    3-step strip
    feature-row.tsx                     reusable alternating text/visual row
    panels/                             small hand-built visuals per feature row
    security.tsx                        privacy + security block
    faq.tsx                             accordion (details/summary, no JS)
    cta.tsx                             closing call to action
    marketing-footer.tsx                links, legal, honesty note
web/app/(auth)/login/page.tsx           restyled; ?mode=signup deep link
web/app/(auth)/auth-shell.tsx           restyled to match
web/components/brand.tsx                unchanged API
web/lib/i18n/messages/en.json           new `marketing` namespace
```

Each unit has one job. `feature-row.tsx` takes `{ eyebrow, title, body, bullets,
visual, reversed }` and knows nothing about which feature it renders. Panels are
pure presentational components with no props beyond an optional `className`. The
landing page composes them; none of them import app state, providers, or the API
client.

### Session redirect

`web/app/page.tsx` is a server component. It reads the `cbf_csrf` cookie
(`path=/`, non-httpOnly, set and cleared alongside the httpOnly refresh cookie by
`backend/app/auth/cookies.py`). Present ⇒ `redirect("/dashboard")`. Absent ⇒
render the landing page.

This is a **hint, not an authorisation decision**. The refresh cookie is scoped to
`/auth` and is unreadable at `/`, so no real credential is involved. Worst case a
stale hint sends someone to `/dashboard`, where the existing `(app)/layout.tsx`
session bootstrap bounces them to `/login` — the behaviour they get today.

### Colour scheme handling

The root layout sets `data-theme` on `<html>` and `bg-bg text-fg` on `<body>`.
The marketing layout wraps its children in a `.marketing` element that declares
its own variables and its own background/foreground, so the app's tokens never
leak in and the marketing tokens never leak out.

```css
.marketing {
  --m-bg: #0b0d14;      --m-bg-2: #121628;    --m-fg: #eef0f7;
  --m-muted: #9ba3bd;   --m-line: rgba(255,255,255,.08);
  --m-accent: #7c6bf2;  --m-accent-ink: #fff; --m-panel: #151a2e;
  --m-band: #0f1320;    /* alternating section band */
}
@media (prefers-color-scheme: light) {
  .marketing {
    --m-bg: #f7f7fb;    --m-bg-2: #ffffff;    --m-fg: #14162a;
    --m-muted: #5f6480; --m-line: rgba(20,22,42,.1);
    --m-accent: #5b46d6; --m-accent-ink: #fff; --m-panel: #ffffff;
    --m-band: #eeeef6;
  }
}
```

Dark is the canonical design. The light counterpart keeps identical layout,
type scale and accent role; glows become soft tints and hairlines darken.

## Visual system

- **Canvas** — `--m-bg` with a single radial accent wash behind the hero. No
  gradients elsewhere.
- **Headline** — Inter 600, `clamp(2.75rem, 7vw, 5rem)`, tracking `-0.04em`,
  `line-height: 1.02`. Two lines maximum on desktop.
- **Body** — 1rem/1.65, `--m-muted`, max 62ch.
- **Numerals** — the existing `--font-mono` stack. Every figure on the page is
  mono; this is the product's own signature carried outward.
- **Accent** — one colour, used for: primary CTA fill, hero glow, section
  eyebrows, and the single highlighted figure in each panel. Nothing else.
- **Borders** — 1px `--m-line`. On dark, elevation is glow only; no drop shadows.
- **Radii** — reuse the app's panel scale: 14px cards, 12px controls, 8px chips.
- **Spacing** — section rhythm `clamp(5rem, 12vh, 8rem)` vertical; 1200px max
  content width; 24px gutters, 16px below 640px.
- **Motion** — fade + 8px rise on scroll-in, 400ms, staggered 60ms. Fully
  disabled under `prefers-reduced-motion: reduce`.

## Page content

Every section's copy lives in the `marketing` i18n namespace.

1. **Nav** — wordmark, anchor links (Features, Security, FAQ), `Sign in` text
   link, `Get started` button. Sticky, translucent, hairline bottom border once
   scrolled.
2. **Hero** — headline "Your whole financial picture. Documents in, clarity
   out."; subhead naming the three real inputs (receipts and statements, linked
   US bank accounts, manual entry); CTAs `Create account` → `/login?mode=signup`
   and `See how it works` → `#how`. Product panel below, accent glow behind.
3. **How it works** — three steps: *Capture* (photo, PDF, CSV, or a linked
   account) → *Confirm* (nothing lands until you approve it) → *Understand* (the
   analyst reads everything you've kept).
4. **Feature rows** — four alternating rows, each with a hand-built visual:
   - *Ingestion* — OCR + vision extraction, batch receipt grouping, CSV/XLSX,
     Plaid linking on a 6-hourly scheduled sync, SMS forwarder.
   - *AI analyst* — four modes (monitor, explain, plan, act), cited answers,
     durable memory, page-aware context.
   - *Spend and money* — categories-first analytics, merchant drill-down,
     transfer/refund-aware totals, monthly leftover as one authoritative number.
   - *Debt and cross-border* — cards, EMI tracking, snowball vs avalanche
     payoff comparison, multi-currency normalisation, India/US checklists.
5. **Security** — private single-user workspace; argon2 passwords; TOTP MFA with
   recovery codes; AES-256-GCM document encryption at rest; bank credentials
   never stored; money-moving writes stay `draft` until confirmed; own LLM
   gateway.
6. **FAQ** — native `<details>`/`<summary>`, no JS. Six questions covering: is my
   data sold (no), where does it run (self-hosted), which banks (US via Plaid),
   what about non-US accounts (documents and manual entry), does the AI see
   everything (yes, within your workspace), what's not built yet (linked to the
   README list).
7. **CTA** — one line, one button, back on dark.
8. **Footer** — Privacy, Terms, GitHub, and a short honesty note naming what is
   not built yet.

### Claim discipline

The landing page must not mention: Gmail ingestion (returns `410`), web push
notifications (no VAPID keys, nothing delivered), WebAuthn/passkeys (not
implemented), household or family sharing (removed), or Plaid webhooks (accepted
and echoed, no work done). Plaid is described as a **scheduled 6-hourly sync with
manual refresh**, never as real-time.

Every panel figure is illustrative and reads as sample data — the panels carry a
visible `Sample data` chip so nothing is mistaken for a real account.

## Login revamp

Unchanged: the `mode` toggle, every field, client-side password-match check,
`authApi.login` / `authApi.signup` payloads, the age and terms checkboxes, the
`router.replace("/dashboard")` on success.

Changed:

- **Brand panel** — adopts the marketing canvas, wordmark, accent glow and one
  compact product panel reused from `(marketing)/_components/panels/`. Replaces
  the hardcoded `hsl(166 44% 13%)` teal, which matches none of the eight app
  palettes.
- **Form panel** — tighter field rhythm, clearer error block, and a busy state
  that reads `Signing in…` / `Creating account…` instead of `…`.
- **Deep link** — `?mode=signup` initialises the toggle so landing CTAs open the
  right tab. Read once as the `useState` initial value; the toggle continues to
  own the state afterwards.
- **`auth-shell.tsx`** — same brand treatment, so forgot-password,
  reset-password and verify-email match.

The login page keeps the app's `data-theme` tokens for its form side. Only the
brand panel uses the fixed marketing palette — that panel is decorative, so it
cannot break contrast in any of the eight themes.

## Error and edge handling

- **No JS** — the landing page is a server component with no client state. The
  FAQ uses `<details>`. Everything reads and links correctly without hydration.
- **Reduced motion** — all scroll animation disabled.
- **Narrow viewports** — the product panel is the only wide element; it scrolls
  inside its own `overflow-x: auto` container below 480px. The page body never
  scrolls horizontally.
- **Stale session hint** — covered above; degrades to today's behaviour.
- **Login errors** — unchanged; the existing `t("error")` / `t("signupError")`
  messages render in the restyled error block.

## Testing

- **Unit (vitest)** — landing renders each section heading; the FAQ exposes six
  `<summary>` elements; the footer links to `/privacy` and `/terms`.
- **Unit** — login initialises to the signup tab when `?mode=signup` is present
  and to the login tab otherwise.
- **Claim guard** — a test asserts the rendered landing markup contains none of:
  `Gmail`, `passkey`, `WebAuthn`, `push notification`, `household`. This keeps
  the honesty constraint enforced rather than remembered.
- **E2E (playwright)** — logged-out `/` renders the hero and does not redirect;
  `Create account` lands on `/login` with the signup tab active; existing auth
  E2E specs continue to pass unchanged.
- **Accessibility** — one `<h1>`; nav is a `<nav>` with a skip link; the CTA
  contrast ratio is checked in both colour schemes.

## Build order

1. `marketing.css` token set and `(marketing)/layout.tsx`.
2. `product-panel.tsx` — the hardest visual; settles the panel language first.
3. Hero + nav; `page.tsx` with the session-hint redirect.
4. Remaining sections in page order, reusing `feature-row.tsx`.
5. i18n `marketing` namespace; `app.name` → "Alsi Finance".
6. Login and `auth-shell` restyle.
7. Tests.
