"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "codename.app.version";
const LEGACY_STORAGE_KEY = "codename.dashboard.version";

export type AppVersion = "new" | "classic";

export function appVersion(pathname: string): AppVersion | null {
  if (pathname === "/dashboard" || pathname === "/transactions") return "new";
  if (pathname === "/dashboard/classic" || pathname === "/transactions/classic") return "classic";
  return null;
}

export function versionedHref(href: "/dashboard" | "/transactions", version: AppVersion): string {
  return version === "classic" ? `${href}/classic` : href;
}

export function useAppVersion(pathname: string): AppVersion {
  const current = appVersion(pathname);
  const [preferred, setPreferred] = useState<AppVersion>(current ?? "new");

  useEffect(() => {
    if (current) {
      localStorage.setItem(STORAGE_KEY, current);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      setPreferred(current);
      return;
    }

    const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (saved === "new" || saved === "classic") setPreferred(saved);
  }, [current]);

  return current ?? preferred;
}
