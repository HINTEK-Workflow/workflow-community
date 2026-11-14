import { headers } from "next/headers";
import { serverExtensions } from "@/lib/extensions/server";
import type { LandingSeo } from "@/lib/extensions/types";
import { publicInstance } from "@/lib/instance";
import { publicSite, siteOfHost, type PublicSite } from "@/lib/public-site";
import { indexableSite } from "@/lib/seo/indexing";

/**
 * The public site when this request may be indexed (lib/seo/indexing.ts): it came to the public site's address and the
 * landing page is published there. Null on the app's address, while the landing page is hidden, and without ee/.
 * The landing page's search and share settings come with it.
 */
export async function indexablePublicSite(): Promise<{ site: PublicSite; seo: LandingSeo | undefined } | null> {
  const site = publicSite();
  const where = siteOfHost((await headers()).get("host"), site);
  if (!site || where !== "public" || !publicInstance().features.landingEditor) return null;
  const shown = await serverExtensions.landing({ superadmin: false, preview: false });
  const open = indexableSite(site, where, shown.kind === "render");
  return open ? { site: open, seo: shown.kind === "render" ? shown.seo : undefined } : null;
}
