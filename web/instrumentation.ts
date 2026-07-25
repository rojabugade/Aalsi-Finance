import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "@/lib/sentry-options";

export async function register() {
  // Same options for the Node and edge runtimes; both are inert without a DSN.
  Sentry.init(sentryOptions);
}

export const onRequestError = Sentry.captureRequestError;
