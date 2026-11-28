import { CLOSED_ROBOTS_TXT, indexNowKeyAllow, publicRobotsTxt } from "@/lib/seo/indexing";
import { indexablePublicSite } from "@/lib/seo/server";
import { serverExtensions } from "@/lib/extensions/server";

export const dynamic = "force-dynamic";

/**
 * Sökmotorer (2026-10-15): the app's address is never indexed; the public site (PUBLIC_SITE_URL)
 * may be, but only its start page and legal documents and only while the landing page is published. The files those
 * pages need (styles, scripts, pictures, the share picture) may be fetched too, and the sitemap is named (2026-11-10,
 * lib/seo/indexing.ts). The answer depends on the address asked, so it is never cached for another. IndexNow's key file
 * (2026-11-28) is named while IndexNow is on.
 */
export async function GET() {
  const open = await indexablePublicSite();
  const key = open ? await serverExtensions.indexNowKey?.().catch(() => null) : null;
  const body = open ? publicRobotsTxt(open.site.siteOrigin, key ? [indexNowKeyAllow(key)] : []) : CLOSED_ROBOTS_TXT;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", Vary: "Host" } });
}
