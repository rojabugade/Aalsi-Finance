"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { authApi } from "@/lib/api/auth";
import { AuthShell } from "../auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
        <p className="rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          {t("resetMissingToken")}
        </p>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title={t("resetTitle")} showBackLink={false}>
        <p className="rounded-md bg-muted px-3 py-2.5 text-sm">{t("resetDone")}</p>
        <Button asChild className="mt-5 w-full" size="lg">
          <Link href="/login">{t("submit")}</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("resetTitle")} description={t("resetDescription")}>
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="password">{t("newPassword")}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="••••••••"
          />
          <p className="text-xs text-muted-foreground">{t("passwordHint")}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
          <Input
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
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" size="lg" disabled={busy}>
          {busy ? "…" : t("resetSubmit")}
        </Button>
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
