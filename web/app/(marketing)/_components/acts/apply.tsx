"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { applyForBeta } from "@/lib/api/beta";

/**
 * Act 5 — the beta application, and the page's only conversion point.
 *
 * The first impression is one line: an address and a verb, sharing an
 * underline. Name, country and "how do you track money today" are real signal
 * for deciding who to let into a hand-issued beta, but asking for four things
 * up front is how a one-line ask becomes a form — so they live behind a
 * disclosure. The server takes all three as null, so submitting from the
 * collapsed state is complete, not partial.
 *
 * On success the form is replaced in place rather than navigating: the person
 * stays where they were and the state change is the whole feedback. The server
 * answers 202 whether or not the address has applied before, so there is no
 * "you already applied" branch to render and nothing this component can leak
 * about who else has applied.
 */
export function Apply() {
  const t = useTranslations("marketing.apply");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    const form = new FormData(event.currentTarget);

    const result = await applyForBeta({
      email: String(form.get("email") ?? "").trim(),
      name: String(form.get("name") ?? "").trim() || null,
      country: String(form.get("country") ?? "").trim().toUpperCase() || null,
      how_you_track_money: String(form.get("how") ?? "").trim() || null,
    });

    setState(result.ok ? "done" : "error");
  }

  return (
    <section className="m-act" id="apply" data-act="5" aria-labelledby="apply-title">
      <div className="m-veil" aria-hidden />

      <div className="m-act-body">
        <div className="m-invite m-rv" data-rv>
          <h2 className="m-h2" id="apply-title">
            {t("heading")}
          </h2>
          <p className="m-lede" style={{ marginTop: "18px" }}>
            {t("lede")}
          </p>

          {state === "done" ? (
            <div className="m-done">
              <h3 className="m-done-title">{t("doneTitle")}</h3>
              <p className="m-note">{t("doneBody")}</p>
            </div>
          ) : (
            <form onSubmit={onSubmit}>
              <div className="m-invite-line">
                {/* The field is the whole line and the placeholder says what it
                    wants, so a visible label would be a second heading over a
                    single input. Screen readers still get one. */}
                <label className="m-sr" htmlFor="apply-email">
                  {t("email")}
                </label>
                <input
                  id="apply-email"
                  className="m-invite-input"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder={t("emailPlaceholder")}
                />
                <button
                  className="m-invite-submit"
                  type="submit"
                  disabled={state === "sending"}
                >
                  {state === "sending" ? t("sending") : t("submit")}
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              </div>

              <details className="m-more">
                <summary>{t("more")}</summary>

                <div className="m-more-fields">
                  <div className="m-field">
                    <label htmlFor="apply-name">{t("name")}</label>
                    <input
                      id="apply-name"
                      className="m-input"
                      name="name"
                      type="text"
                      autoComplete="name"
                      maxLength={255}
                    />
                  </div>

                  <div className="m-field">
                    <label htmlFor="apply-country">{t("country")}</label>
                    <input
                      id="apply-country"
                      className="m-input"
                      name="country"
                      type="text"
                      maxLength={2}
                      minLength={2}
                      placeholder="US"
                      style={{ textTransform: "uppercase" }}
                    />
                  </div>

                  <div className="m-field">
                    <label htmlFor="apply-how">{t("how")}</label>
                    <textarea
                      id="apply-how"
                      className="m-input"
                      name="how"
                      maxLength={1000}
                      placeholder={t("howPlaceholder")}
                    />
                  </div>
                </div>
              </details>

              {state === "error" && (
                <p className="m-error" role="alert">
                  {t("error")}
                </p>
              )}

              <p className="m-note">
                {t("note")}{" "}
                {/* Someone holding a code is here to open an account, not to
                    sign in to one — so this deep-links to the signup tab, which
                    is what ?mode=signup exists for. */}
                <Link className="m-link" href="/login?mode=signup">
                  {t("haveCode")}
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
