import type { Metadata, Viewport } from "next";
import { ScreenApp } from "@/features/boards/screen-app";

export const dynamic = "force-dynamic";

/**
 * Kopplad skärm (Tavlor och skärmar etapp 2, 2026-11-18): /skarm, short enough to type with a remote control. No app frame, no menu,
 * never indexed; the page reads only its own routes under /skarm/api (lib/boards/guard.ts).
 */
export const metadata: Metadata = { title: "Skärm", robots: { index: false, follow: false } };
export const viewport: Viewport = { themeColor: "#0b1220" };

export default function ScreenPage() {
  return <ScreenApp version={process.env.NEXT_PUBLIC_APP_VERSION ?? ""} />;
}
