import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppRegistration } from "@/features/kfid/app-registration";
import { InstanceProvider } from "@/components/instance-provider";
import { publicInstance } from "@/lib/instance";
import { instanceAppUrl } from "@/lib/instance-server";

// Instance settings are read at run time, so no page may be prerendered with the build machine's values.
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Fas 1 (2026-09-30): the name and address come from the instance settings; HINTEK's installation keeps its texts.
export function generateMetadata(): Metadata {
  const { name } = publicInstance();
  return {
    metadataBase: new URL(instanceAppUrl()),
    title: {
      default: `${name} – arbetsorder, riskbedömning och planering`,
      template: `%s | ${name}`,
    },
    description:
      "Projekt, arbetsorder, riskbedömning, kontroll före idrifttagning, planering och tidrapport på ett ställe.",
    appleWebApp: {
      capable: true,
      title: name,
      statusBarStyle: "default",
    },
    icons: {
      icon: [
        { url: "/icons/hintek-workflow-32.png", sizes: "32x32", type: "image/png" },
        { url: "/icons/hintek-workflow-192.png", sizes: "192x192", type: "image/png" },
      ],
      apple: "/icons/hintek-workflow-192.png",
    },
    robots: { index: false, follow: false },
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="sv">
      <body>
        <InstanceProvider value={publicInstance()}>
          {children}
          <AppRegistration />
        </InstanceProvider>
      </body>
    </html>
  );
}
