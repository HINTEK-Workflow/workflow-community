import { legalKeysWithText } from "@/lib/legal/shown-document";
import { indexablePaths, sitemapXml } from "@/lib/seo/indexing";
import { indexablePublicSite } from "@/lib/seo/server";
import { serverExtensions } from "@/lib/extensions/server";

export const dynamic = "force-dynamic";

/**
 * The public site's sitemap (Sökmotorer, 2026-11-10): the start page, the shown feature pages (2026-11-14) and the legal documents with a text, on the public
 * site's own address, only while the landing page is published there. The app's address, a hidden landing page and an
 * installation without a public site have none (404), the same rule as robots.txt.
 */
export async function GET() {
  const open = await indexablePublicSite();
  if (!open) return new Response("Finns inte.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", Vary: "Host" } });
  const features = (await serverExtensions.landingPagePaths?.().catch(() => [])) ?? [];
  const body = sitemapXml(open.site.siteOrigin, indexablePaths(await legalKeysWithText(), features));
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store", Vary: "Host" } });
}
