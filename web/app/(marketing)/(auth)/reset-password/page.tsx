"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { authApi } from "@/lib/api/auth";
import { AuthShell } from "../auth-shell";

function ResetPasswordForm() {
  const t = useTranslations("auth");
  const token = useSearchParams().get("token");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirmPassword") ?? "")) {
      setError(t("passwordMismatch"));
      return;
    }
    setError(null);
    setBusy(true);
    const result = await authApi.confirmPasswordReset(token, password);
    setBusy(false);
    if (!result.ok) {
      setError(t("resetInvalid"));
      return;
    }
    setDone(true);
  }

  if (!token) {
    return (
      <AuthShell title={t("resetTitle")}>
        <p className="m-auth-error">{t("resetMissingToken")}</p>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title={t("resetTitle")} showBackLink={false}>
        <p className="m-auth-notice">{t("resetDone")}</p>
        <Link href="/login" className="m-auth-submit">
          <span>{t("submit")}</span>
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("resetTitle")} description={t("resetDescription")}>
      <form onSubmit={onSubmit} className="m-auth-fields" style={{ marginTop: 0 }}>
        <div className="m-field">
          <label htmlFor="password">{t("newPassword")}</label>
          <input
            className="m-input"
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="••••••••"
          />
          <p className="m-note" style={{ marginTop: 0 }}>
            {t("passwordHint")}
          </p>
        </div>
        <div className="m-field">
          <label htmlFor="confirmPassword">{t("confirmPassword")}</label>
          <input
            className="m-input"
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="••••••••"
          />
        </div>
        {error && (
          <p role="alert" className="m-auth-error">
            {error}
          </p>
        )}
        <button type="submit" className="m-auth-submit" disabled={busy}>
          <span>{busy ? t("sending") : t("resetSubmit")}</span>
        </button>
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  // useSearchParams needs a Suspense boundary to keep the route statically shell-able.
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
