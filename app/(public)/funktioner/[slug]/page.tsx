import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { serverExtensions } from "@/lib/extensions/server";
import { publicInstance } from "@/lib/instance";
import { indexablePublicSite } from "@/lib/seo/server";
import { featurePageMetadata } from "@/lib/site-metadata";

export const dynamic = "force-dynamic";

/**
 * Funktionssidorna (2026-11-14): each feature on the landing page has its own page here, with the landing page's top and
 * footer and the texts from the landing editor (ee/landing/ui/landing-subpage.tsx). Without the landing page (Community, or
 * LANDING_EDITOR_ENABLED=false) and for a hidden or unknown page the address answers 404.
 */
async function decide(slug: string) {
  if (!publicInstance().features.landingEditor || !serverExtensions.landingPage) return null;
  const user = await getCurrentUser().catch(() => null);
  const shown = await serverExtensions.landingPage({ slug, superadmin: user?.role === "SUPERADMIN" });
  return shown.kind === "render" ? shown : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const shown = await decide(slug);
  if (!shown) return { title: "Sidan finns inte" };
  // On the public site, while the landing page is published, a shown page may be found (sitemap.xml names it); a superadmin's
  // look at a hidden page, and the app's own address, stay out of search.
  const open = shown.indexable ? await indexablePublicSite() : null;
  return featurePageMetadata(publicInstance().name, open?.site.siteOrigin ?? null, shown.seo);
}

export default async function FeaturePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shown = await decide(slug);
  if (!shown) notFound();
  return shown.node;
}
