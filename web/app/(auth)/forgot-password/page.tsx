"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { authApi } from "@/lib/api/auth";
import { AuthShell } from "../auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
        <p className="rounded-md bg-muted px-3 py-2.5 text-sm">{t("forgotSent")}</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("forgotTitle")} description={t("forgotDescription")}>
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="email">{t("email")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
          />
        </div>
        <Button type="submit" className="w-full" size="lg" disabled={busy}>
          {busy ? "…" : t("forgotSubmit")}
        </Button>
      </form>
    </AuthShell>
  );
}
