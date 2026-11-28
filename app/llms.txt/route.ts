import { legalKeysWithText } from "@/lib/legal/shown-document";
import { indexablePublicSite } from "@/lib/seo/server";
import { serverExtensions } from "@/lib/extensions/server";

export const dynamic = "force-dynamic";

const NOT_FOUND = { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", Vary: "Host" } };

/**
 * llms.txt (Growth Engine paket 2, 2026-11-28): the public site in short for AI services (ee/landing/llms.ts), on the public
 * site's own address and only while the landing page is published there – the same rule as the sitemap. The app's address, its
 * alias, a hidden landing page and an installation without ee/ answer 404. The file itself is not a page to be found in search.
 */
export async function GET(request: Request) {
  const open = await indexablePublicSite(request.headers.get("host"));
  if (!open) return new Response("Finns inte.", NOT_FOUND);
  const body = await serverExtensions.landingLlmsTxt?.({ siteOrigin: open.site.siteOrigin, legalKeys: await legalKeysWithText() }).catch(() => null);
  if (!body) return new Response("Finns inte.", NOT_FOUND);
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex", Vary: "Host" } });
}
