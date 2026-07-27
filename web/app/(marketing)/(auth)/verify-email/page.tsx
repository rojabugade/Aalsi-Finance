"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { authApi } from "@/lib/api/auth";
import { AuthShell } from "../auth-shell";

type State = "pending" | "done" | "invalid";

function VerifyEmail() {
  const t = useTranslations("auth");
  const token = useSearchParams().get("token");
  const [state, setState] = useState<State>("pending");

  useEffect(() => {
    if (!token) {
      setState("invalid");
      return;
    }
    let cancelled = false;
    authApi.confirmEmailVerification(token).then((result) => {
      if (!cancelled) setState(result.ok ? "done" : "invalid");
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const message =
    state === "pending" ? t("verifyPending") : state === "done" ? t("verifyDone") : t("verifyInvalid");

  return (
    <AuthShell title={t("verifyTitle")}>
      <p className={state === "invalid" ? "m-auth-error" : "m-auth-notice"} role="status">
        {message}
      </p>
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmail />
    </Suspense>
  );
}
