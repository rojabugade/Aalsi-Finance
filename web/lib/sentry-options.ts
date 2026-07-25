// Shared Sentry configuration for the browser, server and edge runtimes.
//
// Inert unless NEXT_PUBLIC_SENTRY_DSN is set, so local dev and CI report nothing.
//
// This app renders financial data, so the permissive defaults are turned off:
// sendDefaultPii stays false, and a beforeSend hook drops request bodies, cookies,
// headers and user identity. A crash report must never carry someone's
// transactions, or a password-reset token sitting in a URL.

import type { ErrorEvent, EventHint } from "@sentry/nextjs";

export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";

function scrub(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    // Reset and email-verification links carry their token in the query string.
    delete event.request.query_string;
    if (event.request.url) event.request.url = event.request.url.split("?")[0];
  }
  delete event.user;
  return event;
}

export const sentryOptions = {
  dsn: SENTRY_DSN,
  enabled: Boolean(SENTRY_DSN),
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "production",
  sendDefaultPii: false,
  // Performance tracing is opt-in; it samples spans, not just errors.
  tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0),
  beforeSend: scrub,
};
