"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { authApi } from "@/lib/api/auth";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const t = useTranslations("auth");
  const tApp = useTranslations("app");
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function changeMode(nextMode: "login" | "signup") {
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
        });
    setBusy(false);
    if (!result.ok) {
      setError(t(mode === "login" ? "error" : "signupError"));
      return;
    }
    router.replace("/dashboard");
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-[hsl(166_44%_13%)] text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            backgroundImage:
              "radial-gradient(40rem 30rem at 110% -10%, var(--accent-soft), transparent 60%), radial-gradient(36rem 30rem at -10% 120%, var(--accent-soft), transparent 55%)",
          }}
        />
        <div className="relative flex items-center gap-3">
          <BrandMark className="ring-primary-foreground/20" />
          <span className="text-base font-semibold tracking-tight">
            {tApp("name")}
          </span>
        </div>
        <div className="relative max-w-md">
          <p className="text-2xl font-semibold leading-snug tracking-tight">
            Your whole financial picture — documents in, clarity out.
          </p>
          <p className="mt-3 text-sm text-white/70">
            Capture receipts and statements, track spending and debt, and get
            cited guidance. Private by design, on every device.
          </p>
        </div>
        <div className="relative text-xs text-white/55">
          Encrypted at rest · MFA-ready · Works offline
        </div>
      </aside>

      {/* Form panel */}
      <main className="relative flex items-center justify-center overflow-y-auto p-6 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <BrandMark />
          </div>
          <div
            className="mb-8 grid grid-cols-2 rounded-lg bg-muted/60 p-1"
            aria-label={t("authMode")}
          >
            <button
              type="button"
              aria-pressed={mode === "login"}
              onClick={() => changeMode("login")}
              className="rounded-md px-3 py-2 text-sm font-medium transition-colors aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
            >
              {t("loginTab")}
            </button>
            <button
              type="button"
              aria-pressed={mode === "signup"}
              onClick={() => changeMode("signup")}
              className="rounded-md px-3 py-2 text-sm font-medium transition-colors aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
            >
              {t("signupTab")}
            </button>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">
            {t(mode === "login" ? "loginTitle" : "signupTitle")}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {t(mode === "login" ? "loginDescription" : "signupDescription")}
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-5">
            {mode === "signup" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="displayName">{t("displayName")}</Label>
                  <Input
                    id="displayName"
                    name="displayName"
                    autoComplete="name"
                    placeholder={t("displayNamePlaceholder")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="baseCurrency">{t("baseCurrency")}</Label>
                  <Input
                    id="baseCurrency"
                    name="baseCurrency"
                    defaultValue="USD"
                    minLength={3}
                    maxLength={3}
                    pattern="[A-Za-z]{3}"
                    required
                    className="uppercase"
                  />
                </div>
              </>
            )}
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
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor="password">{t("password")}</Label>
                {mode === "login" && (
                  <Link
                    href="/forgot-password"
                    className="text-xs text-muted-foreground underline underline-offset-4"
                  >
                    {t("forgotPassword")}
                  </Link>
                )}
              </div>
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={mode === "signup" ? 8 : undefined}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder="••••••••"
              />
              {mode === "signup" && (
                <p className="text-xs text-muted-foreground">{t("passwordHint")}</p>
              )}
            </div>
            {mode === "signup" ? (
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
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="totp">{t("totp")}</Label>
                <Input
                  id="totp"
                  name="totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123 456"
                />
                <p className="text-xs text-muted-foreground">{t("totpHint")}</p>
              </div>
            )}
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" size="lg" disabled={busy}>
              {busy ? "…" : t(mode === "login" ? "submit" : "signupSubmit")}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
