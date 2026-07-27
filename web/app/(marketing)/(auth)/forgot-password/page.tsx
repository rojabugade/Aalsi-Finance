"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { authApi } from "@/lib/api/auth";
import { AuthShell } from "../auth-shell";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    await authApi.requestPasswordReset(email);
    setBusy(false);
    // Shown regardless of the outcome: revealing whether the address exists here
    // would make this page an account-enumeration tool.
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell title={t("forgotTitle")}>
        <p className="m-auth-notice">{t("forgotSent")}</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("forgotTitle")} description={t("forgotDescription")}>
      <form onSubmit={onSubmit} className="m-auth-fields" style={{ marginTop: 0 }}>
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
        <button type="submit" className="m-auth-submit" disabled={busy}>
          <span>{busy ? t("sending") : t("forgotSubmit")}</span>
        </button>
      </form>
    </AuthShell>
  );
}
