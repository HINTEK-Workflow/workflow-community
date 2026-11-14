import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { AppRegistration } from "@/features/kfid/app-registration";
import { InstanceProvider } from "@/components/instance-provider";
import { CookieNotice } from "@/components/cookie-notice";
import { TruncationTitles } from "@/components/truncation-titles";
import { headers } from "next/headers";
import { publicInstance } from "@/lib/instance";
import { publicSite, siteOfHost } from "@/lib/public-site";
import { SITE_DESCRIPTION, SITE_TAGLINE, sitePreview } from "@/lib/site-metadata";
import { instanceAppUrl } from "@/lib/instance-server";
import { getAnalyticsSettings } from "@/lib/analytics/settings";
import { requestFirstFrame } from "@/lib/workflow/first-frame-server";
import { firstFrameAttributes } from "@/lib/workflow/first-frame";
import { FirstFrameProvider } from "@/features/workflow/use-detail-level";

// One typeface everywhere (2026-10-16, docs/design-standard.md): Manrope (SIL Open Font License 1.1) for text and
// headings. next/font downloads it at build time and serves it from the app itself (/_next/static/media, no call to Google
// at run time); app/globals.css reads the variable and falls back to the system font.
const textFont = Manrope({ subsets: ["latin", "latin-ext"], variable: "--font-manrope", display: "swap" });

// Instance settings are read at run time, so no page may be prerendered with the build machine's values.
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Let browsers which support the viewport standard reduce the layout area
  // for the on-screen keyboard, rather than only covering it visually.
  interactiveWidget: "resizes-content",
  themeColor: "#113351",
};

// Fas 1 (2026-09-30): the name and address come from the instance settings; Workflow's installation keeps its texts.
export async function generateMetadata(): Promise<Metadata> {
  const { name, features } = publicInstance();
  const icons = await (await import("@/lib/instance-icon")).instanceIconUrls(features.ownIcon);
  const appUrl = new URL(instanceAppUrl());
  // The install manifest is the app's (app/manifest.webmanifest/route.ts): the public site answers 404 for it
  // (lib/public-site.ts), so its pages do not link it.
  const site = publicSite();
  const onPublicSite = Boolean(site) && siteOfHost((await headers()).get("host"), site) !== "app";
  return {
    metadataBase: appUrl,
    title: {
      default: `${name} – ${SITE_TAGLINE}`,
      template: `%s | ${name}`,
    },
    description: SITE_DESCRIPTION,
    // The link preview (lib/site-metadata.ts); the public site's start page sets its own address (app/page.tsx).
    ...sitePreview(name, appUrl.href),
    ...(onPublicSite ? {} : { manifest: "/manifest.webmanifest" }),
    appleWebApp: {
      capable: true,
      title: name,
      statusBarStyle: "default",
    },
    icons: {
      // The installation's icon (lib/instance-icon.ts): its own when the superadmin uploaded one, otherwise the built-in.
      icon: [
        { url: icons["32"], sizes: "32x32", type: "image/png" },
        { url: icons["192"], sizes: "192x192", type: "image/png" },
      ],
      // Full-bleed so iOS's own rounded mask never shows dark corners.
      apple: icons.maskable,
    },
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Beteendeanalys (2026-10-07): the cookie box asks about statistics only where the public pages are measured.
  const statistics = (await getAnalyticsSettings()).funnel;
  // Telefonens första bild (stabil sidladdning steg 4, lib/workflow/first-frame.ts): the app's layout attributes are in the
  // server's HTML – the app on a phone, the app column, the content level – so no first frame is drawn as a computer. The
  // shell's apply() takes them over after loading and corrects a wrong guess; the hooks start from the same values.
  // Attributes only, no script before the page, so the Content-Security-Policy needs no exception.
  const firstFrame = await requestFirstFrame();
  return (
    <html lang="sv" className={textFont.variable} {...firstFrameAttributes(firstFrame)}>
      <body>
        <FirstFrameProvider value={firstFrame}>
        <InstanceProvider value={publicInstance()}>
          {children}
          <AppRegistration />
          <TruncationTitles />
          <Suspense fallback={null}><CookieNotice statistics={statistics} /></Suspense>
        </InstanceProvider>
        </FirstFrameProvider>
      </body>
    </html>
  );
}
