"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { BackHome } from "./back-home";
import { BrandPanel } from "./brand-panel";

/** Account-recovery screens, sharing the login page's split brand/form layout. */
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
    <div className="m-auth">
      <BrandPanel />

      <main className="m-auth-form">
        <div className="m-auth-col">
          <h1 className="m-auth-title" style={{ marginTop: 0 }}>
            {title}
          </h1>
          {description && <p className="m-auth-sub">{description}</p>}

          <div className="m-auth-fields">{children}</div>

          {showBackLink && (
            <p style={{ margin: "26px 0 0" }}>
              <Link href="/login" className="m-link">
                {t("backToLogin")}
              </Link>
            </p>
          )}

          <div className="m-auth-foot">
            <BackHome label={t("backToLanding")} />
          </div>
        </div>
      </main>
    </div>
  );
}
