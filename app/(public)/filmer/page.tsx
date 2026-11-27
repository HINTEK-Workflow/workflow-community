import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { serverExtensions } from "@/lib/extensions/server";
import { publicInstance } from "@/lib/instance";
import { indexablePublicSite } from "@/lib/seo/server";
import { featurePageMetadata } from "@/lib/site-metadata";

export const dynamic = "force-dynamic";

/**
 * Filmer (2026-11-20): every film on the landing pages on one page, with the landing page's top and footer and the texts from
 * the landing editor (ee/landing/ui/landing-films-page.tsx). Without the landing page (Community, or LANDING_EDITOR_ENABLED=false),
 * while the film page is switched off or has no film, the address answers 404.
 */
async function decide() {
  if (!publicInstance().features.landingEditor || !serverExtensions.landingFilms) return null;
  const user = await getCurrentUser().catch(() => null);
  const shown = await serverExtensions.landingFilms({ superadmin: user?.role === "SUPERADMIN" });
  return shown.kind === "render" ? shown : null;
}

export async function generateMetadata(): Promise<Metadata> {
  const shown = await decide();
  if (!shown) return { title: "Sidan finns inte" };
  const open = shown.indexable ? await indexablePublicSite() : null;
  return featurePageMetadata(publicInstance().name, open?.site.siteOrigin ?? null, shown.seo);
}

export default async function FilmsPage() {
  const shown = await decide();
  if (!shown) notFound();
  return shown.node;
}
