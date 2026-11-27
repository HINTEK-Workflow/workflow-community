import type { Metadata } from "next";
import { LinkApp } from "@/features/boards/link-app";

export const dynamic = "force-dynamic";

/**
 * Delningslänk (Tavlor och skärmar etapp 2, 2026-11-18): /visa#k=…, a shared board for whoever has the link. No app frame, never
 * indexed, no referrer; the page reads only its own routes under /visa/api (lib/boards/guard.ts).
 */
export const metadata: Metadata = { title: "Tavla", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function LinkPage() {
  return <LinkApp />;
}
