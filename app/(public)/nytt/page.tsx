import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { serverExtensions } from "@/lib/extensions/server";
import { publicInstance } from "@/lib/instance";
import { indexablePublicSite } from "@/lib/seo/server";
import { featurePageMetadata } from "@/lib/site-metadata";

export const dynamic = "force-dynamic";

/**
 * Nytt i systemet (2026-11-20): the latest versions out of lib/release-notes.ts on one page, with the landing page's top and
 * footer and the texts from the landing editor (ee/landing/ui/landing-news.tsx). Without the landing page (Community, or
 * LANDING_EDITOR_ENABLED=false) or while the page is switched off, the address answers 404.
 */
async function decide() {
  if (!publicInstance().features.landingEditor || !serverExtensions.landingNews) return null;
  const user = await getCurrentUser().catch(() => null);
  const shown = await serverExtensions.landingNews({ superadmin: user?.role === "SUPERADMIN" });
  return shown.kind === "render" ? shown : null;
}

export async function generateMetadata(): Promise<Metadata> {
  const shown = await decide();
  if (!shown) return { title: "Sidan finns inte" };
  const open = shown.indexable ? await indexablePublicSite() : null;
  return featurePageMetadata(publicInstance().name, open?.site.siteOrigin ?? null, shown.seo);
}

export default async function NewsPage() {
  const shown = await decide();
  if (!shown) notFound();
  return shown.node;
}
