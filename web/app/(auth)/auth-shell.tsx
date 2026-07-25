"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { BrandMark } from "@/components/brand";

/** Centred card used by the account-recovery screens, matching the login panel. */
export function AuthShell({
  title,
  description,
  children,
  showBackLink = true,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  showBackLink?: boolean;
}) {
  const t = useTranslations("auth");
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-y-auto p-6 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <BrandMark />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
        )}
        <div className="mt-8">{children}</div>
        {showBackLink && (
          <p className="mt-6 text-sm">
            <Link href="/login" className="text-muted-foreground underline underline-offset-4">
              {t("backToLogin")}
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
