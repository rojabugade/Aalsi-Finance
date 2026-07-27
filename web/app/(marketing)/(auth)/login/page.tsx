"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { authApi } from "@/lib/api/auth";
import { fetchBetaStatus } from "@/lib/api/beta";
import { BackHome } from "../back-home";
import { BrandPanel } from "../brand-panel";

type Mode = "login" | "signup";

/**
 * Sign in and create account, on the landing page's canvas.
 *
 * The fields are the landing page's fields — `.m-field` and `.m-input`, a mono
 * label over a rule, no box — because the form is meant to read as something you
 * write on rather than something you fill in. Nothing about the *behaviour*
 * changed when the styling did: same endpoints, same payloads, same validation,
 * same redirect.
 */
function LoginForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  // Landing CTAs deep-link to ?mode=signup. Read once as the initial value; the
  // toggle owns the state from then on, so switching tabs doesn't fight the URL
  // and the URL doesn't fight the person.
  const initialMode: Mode =
    useSearchParams().get("mode") === "signup" ? "signup" : "login";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Null until the answer arrives. The field renders on `true` only, so a slow
  // or failed status call shows the form without a code box rather than a box
  // that might turn out to be pointless — and the server still refuses a
  // codeless signup either way, with a message that says so.
  const [inviteRequired, setInviteRequired] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    fetchBetaStatus()
      .then((status) => live && setInviteRequired(status.invite_required))
      .catch(() => live && setInviteRequired(false));
    return () => {
      live = false;
    };
  }, []);

  function changeMode(nextMode: Mode) {
    setMode(nextMode);
    setError(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    if (mode === "signup" && password !== String(form.get("confirmPassword") ?? "")) {
      setError(t("passwordMismatch"));
      setBusy(false);
      return;
    }

    const result = mode === "login"
      ? await authApi.login({
          email,
          password,
          totp_code: String(form.get("totp") ?? "").trim() || null,
        })
        : await authApi.signup({
          email,
          password,
          display_name: String(form.get("displayName") ?? "").trim() || null,
          base_currency: String(form.get("baseCurrency") ?? "USD").trim().toUpperCase(),
          // Both are `required` on the inputs, so the browser blocks submit before
          // this runs. Sent anyway because the server is the gate that counts.
          age_confirmed: form.get("ageConfirmed") === "on",
          terms_accepted: form.get("termsAccepted") === "on",
          invite_code: String(form.get("inviteCode") ?? "").trim() || null,
        });
    setBusy(false);
    if (!result.ok) {
      if (mode === "login") {
        setError(t("error"));
      } else {
        // A 400 from signup is the invite gate — every other failure mode there
        // is a 409 (email taken) or a 422 (malformed body).
        setError(t(result.status === 400 ? "inviteCodeInvalid" : "signupError"));
      }
      return;
    }
    router.replace("/dashboard");
  }

  return (
    <div className="m-auth">
      <BrandPanel />

      <main className="m-auth-form">
        <div className="m-auth-col">
          <div className="m-auth-tabs" aria-label={t("authMode")}>
            <Tab active={mode === "login"} onClick={() => changeMode("login")}>
              {t("loginTab")}
            </Tab>
            <Tab active={mode === "signup"} onClick={() => changeMode("signup")}>
              {t("signupTab")}
            </Tab>
          </div>

          <h1 className="m-auth-title">
            {t(mode === "login" ? "loginTitle" : "signupTitle")}
          </h1>
          <p className="m-auth-sub">
            {t(mode === "login" ? "loginDescription" : "signupDescription")}
          </p>

          <form onSubmit={onSubmit} className="m-auth-fields">
            {mode === "signup" && inviteRequired && (
              <div className="m-field">
                <label htmlFor="inviteCode">{t("inviteCode")}</label>
                <input
                  id="inviteCode"
                  className="m-input"
                  name="inviteCode"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={64}
                  placeholder={t("inviteCodePlaceholder")}
                  style={{
                    fontFamily: "var(--m-font-num)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                />
                <p className="m-note" style={{ marginTop: 0 }}>
                  {t("inviteCodeHint")}{" "}
                  <Link href="/#apply" className="m-link">
                    {t("requestInvite")}
                  </Link>
                </p>
              </div>
            )}

            {mode === "signup" && (
              <>
                <div className="m-field">
                  <label htmlFor="displayName">{t("displayName")}</label>
                  <input
                    id="displayName"
                    className="m-input"
                    name="displayName"
                    autoComplete="name"
                    placeholder={t("displayNamePlaceholder")}
                  />
                </div>
                <div className="m-field">
                  <label htmlFor="baseCurrency">{t("baseCurrency")}</label>
                  <input
                    id="baseCurrency"
                    className="m-input"
                    name="baseCurrency"
                    defaultValue="USD"
                    minLength={3}
                    maxLength={3}
                    pattern="[A-Za-z]{3}"
                    required
                    style={{
                      fontFamily: "var(--m-font-num)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  />
                </div>
              </>
            )}

            <div className="m-field">
              <label htmlFor="email">{t("email")}</label>
              <input
                id="email"
                className="m-input"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </div>

            <div className="m-field">
              <div className="m-auth-aside">
                <label htmlFor="password">{t("password")}</label>
                {mode === "login" && (
                  <Link href="/forgot-password" className="m-link" style={{ fontSize: "12px" }}>
                    {t("forgotPassword")}
                  </Link>
                )}
              </div>
              <input
                id="password"
                className="m-input"
                name="password"
                type="password"
                required
                minLength={mode === "signup" ? 8 : undefined}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder="••••••••"
              />
              {mode === "signup" && (
                <p className="m-note" style={{ marginTop: 0 }}>
                  {t("passwordHint")}
                </p>
              )}
            </div>

            {mode === "signup" ? (
              <div className="m-field">
                <label htmlFor="confirmPassword">{t("confirmPassword")}</label>
                <input
                  id="confirmPassword"
                  className="m-input"
                  name="confirmPassword"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
              </div>
            ) : (
              <div className="m-field">
                <label htmlFor="totp">{t("totp")}</label>
                <input
                  id="totp"
                  className="m-input"
                  name="totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123 456"
                  style={{ fontFamily: "var(--m-font-num)", letterSpacing: "0.16em" }}
                />
                <p className="m-note" style={{ marginTop: 0 }}>
                  {t("totpHint")}
                </p>
              </div>
            )}

            {mode === "signup" && (
              <div style={{ display: "grid", gap: "12px" }}>
                <label htmlFor="ageConfirmed" className="m-auth-check">
                  <input id="ageConfirmed" name="ageConfirmed" type="checkbox" required />
                  <span>{t("ageConfirm")}</span>
                </label>
                <label htmlFor="termsAccepted" className="m-auth-check">
                  <input id="termsAccepted" name="termsAccepted" type="checkbox" required />
                  <span>
                    {t.rich("termsAccept", {
                      terms: (chunks) => <Link href="/terms">{chunks}</Link>,
                      privacy: (chunks) => <Link href="/privacy">{chunks}</Link>,
                    })}
                  </span>
                </label>
              </div>
            )}

            {error && (
              <p role="alert" className="m-auth-error">
                {error}
              </p>
            )}

            <button type="submit" disabled={busy} className="m-auth-submit">
              <span>
                {busy
                  ? t(mode === "login" ? "submitting" : "signupSubmitting")
                  : t(mode === "login" ? "submit" : "signupSubmit")}
              </span>
              <ArrowRight />
            </button>
          </form>

          {/* The only route back to the marketing page. It used to be the brand
              panel's wordmark, which is hidden on narrow screens, so a
              signed-out returning visitor on a laptop had no way home at all. */}
          <div className="m-auth-foot">
            <BackHome label={t("backToLanding")} />
            <p className="m-auth-legal">
              <Link href="/privacy">{t("privacy")}</Link>
              {" · "}
              <Link href="/terms">{t("terms")}</Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className="m-auth-tab">
      {children}
    </button>
  );
}

function ArrowRight() {
  return (
    <svg
      width="18"
      height="18"
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
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary to keep the route statically shell-able.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
