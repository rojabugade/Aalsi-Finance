"use client";

// Last-resort boundary for errors thrown during render, including in the root
// layout. Without it those crashes are invisible to Sentry and the user sees
// Next's default blank error screen.

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main
          style={{
            minHeight: "100dvh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1.5rem",
            fontFamily: "system-ui, sans-serif",
            textAlign: "center",
          }}
        >
          <div style={{ maxWidth: "28rem" }}>
            <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Something went wrong</h1>
            <p style={{ marginTop: "0.5rem", opacity: 0.7, fontSize: "0.875rem" }}>
              The error has been reported. Your data is unaffected — nothing was saved
              from this screen.
            </p>
            <button
              onClick={reset}
              style={{
                marginTop: "1.5rem",
                padding: "0.5rem 1rem",
                borderRadius: "0.5rem",
                border: "1px solid currentColor",
                background: "transparent",
                cursor: "pointer",
                font: "inherit",
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
