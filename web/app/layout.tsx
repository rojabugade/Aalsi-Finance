import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import "./globals.css";
import { cn } from "@/lib/utils";
import { getLocale } from "@/lib/i18n/locale";
import { Providers } from "./providers";
import { Toaster } from "@/components/ui/sonner";
import { SwRegister } from "@/components/sw-register";
import { parseTheme, THEME_BG, THEME_COOKIE, THEME_ID_PATTERN } from "@/lib/theme/themes";

const inter = localFont({
  src: [
    {
      path: "./fonts/inter-latin-400.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/inter-latin-600.woff2",
      weight: "600",
      style: "normal",
    },
  ],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CodeName-Finance",
  description: "Document-driven, AI-assisted personal finance.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Finance" },
};

export async function generateViewport(): Promise<Viewport> {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: THEME_BG[theme],
  };
}

// Belt-and-suspenders: re-assert data-theme from the cookie before paint.
// Pattern is shared with isThemeId so new palettes can't be silently dropped.
const NO_FLASH = `(function(){try{var m=document.cookie.match(/(?:^|; )cf-theme=([^;]+)/);var t=m?decodeURIComponent(m[1]):'indigo-light';if(!new RegExp(${JSON.stringify(THEME_ID_PATTERN)}).test(t))t='indigo-light';document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','indigo-light');}})();`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html lang={locale} data-theme={theme} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body
        className={cn(
          inter.variable,
          "min-h-dvh bg-bg font-sans text-fg antialiased",
        )}
      >
        <SwRegister />
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
