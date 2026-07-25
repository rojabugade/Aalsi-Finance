import createNextIntlPlugin from "next-intl/plugin";
import withSerwistInit from "@serwist/next";
import { withSentryConfig } from "@sentry/nextjs";
import { fileURLToPath } from "node:url";

const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");
const projectRoot = fileURLToPath(new URL(".", import.meta.url));

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: projectRoot,
  },
  async rewrites() {
    const api = process.env.API_INTERNAL_URL;
    if (!api) return [];

    const apiRoutes = [
      "/api/:path*",
      "/account",
      "/admin/:path*",
      "/analytics/:path*",
      "/auth/:path*",
      "/budgets",
      "/budgets/:path*",
      "/categories",
      "/categories/:path*",
      "/consents",
      "/consents/:path*",
      "/cross-border/:path*",
      "/documents/:path*",
      "/email/:path*",
      "/equity/:path*",
      "/export",
      "/fx/:path*",
      "/guidance/:path*",
      "/health",
      "/workspace",
      "/workspace/:path*",
      "/income-sources",
      "/income/:path*",
      "/income-sources/:path*",
      "/loans",
      "/loans/:path*",
      "/notifications",
      "/notifications/:path*",
      "/paystubs/:path*",
      "/plaid/:path*",
      "/recommendations/:path*",
      "/review-queue/:path*",
      "/rules/:path*",
      "/settings",
      "/sms/:path*",
      "/tags",
      "/tags/:path*",
      "/transactions",
      "/transactions/:path*",
      "/version",
      "/webhooks/:path*",
    ];

    return apiRoutes.map((source) => ({
      source,
      destination: source.startsWith("/api/") ? `${api}/:path*` : `${api}${source}`,
    }));
  },
};

// Sentry wraps last so it can see the fully-composed config. Source-map upload is
// skipped unless SENTRY_AUTH_TOKEN is present, so builds work without Sentry creds.
export default withSentryConfig(withSerwist(withNextIntl(nextConfig)), {
  silent: true,
  disableLogger: true,
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
