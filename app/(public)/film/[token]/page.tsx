import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { isAutomatedVisitor } from "@/lib/analytics/bots";
import { serverExtensions } from "@/lib/extensions/server";
import { publicInstance } from "@/lib/instance";

export const dynamic = "force-dynamic";

/**
 * Personlig filmlänk (2026-11-26): /film/<token> plays a short greeting ("Hej Torbjörn!") and then one of the landing page's
 * films (ee/landing/ui/personal-film-page.tsx). Never indexed and never in the sitemap; the address is not sent on as a referrer.
 * A view is counted only by the page itself – not by its metadata, a link preview or robot, or Workflow's own administrator.
 * Without the landing page (Community, or LANDING_EDITOR_ENABLED=false): 404.
 */
const open = () => publicInstance().features.landingEditor && serverExtensions.personalFilm ? serverExtensions.personalFilm : null;

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const shown = open();
  const title = shown ? (await shown({ token: (await params).token, count: false })).title : null;
  return { title: title ?? "Filmlänken fungerar inte längre", robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function PersonalFilmRoute({ params }: { params: Promise<{ token: string }> }) {
  const shown = open();
  if (!shown) notFound();
  const user = await getCurrentUser().catch(() => null);
  const robot = isAutomatedVisitor((await headers()).get("user-agent"));
  const { node } = await shown({ token: (await params).token, count: user?.role !== "SUPERADMIN" && !robot });
  return node;
}
