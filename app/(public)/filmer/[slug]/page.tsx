import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { serverExtensions } from "@/lib/extensions/server";
import { publicInstance } from "@/lib/instance";
import { indexablePublicSite } from "@/lib/seo/server";
import { featurePageMetadata } from "@/lib/site-metadata";

export const dynamic = "force-dynamic";

/**
 * A film's own address (2026-11-24, delning): /filmer/<kortnamn> shows the film page (ee/landing/ui/landing-films-page.tsx) with that
 * film chosen, and a shared link's preview has the film's name, line and poster. An unknown address shows the film page with a short
 * line, never an error. Without the landing page (Community, or LANDING_EDITOR_ENABLED=false) and while the film page is closed: 404.
 */
// Only small letters, digits and dashes reach the extension; anything else is the same as an unknown film.
const SLUG = /^[a-z0-9-]{1,60}$/;

async function decide(raw: string) {
  if (!publicInstance().features.landingEditor || !serverExtensions.landingFilms) return null;
  const slug = SLUG.test(raw) ? raw : "-";
  const user = await getCurrentUser().catch(() => null);
  const shown = await serverExtensions.landingFilms({ superadmin: user?.role === "SUPERADMIN", slug });
  return shown.kind === "render" ? shown : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const shown = await decide(slug);
  if (!shown) return { title: "Sidan finns inte" };
  const open = shown.indexable ? await indexablePublicSite() : null;
  return featurePageMetadata(publicInstance().name, open?.site.siteOrigin ?? null, shown.seo);
}

export default async function FilmPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shown = await decide(slug);
  if (!shown) notFound();
  return shown.node;
}
