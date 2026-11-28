import { indexablePublicSite } from "@/lib/seo/server";
import { serverExtensions } from "@/lib/extensions/server";

export const dynamic = "force-dynamic";

const NOT_FOUND = { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", Vary: "Host" } };

/**
 * IndexNow's key file (Growth Engine paket 2, 2026-11-28): https://<public site>/<key>.txt holds only the key, so IndexNow can
 * see that the calls come from the site's owner. proxy.ts sends /<key>.txt here (lib/seo/indexing.ts INDEXNOW_KEY_FILE). It
 * answers only on the public site, while the landing page is published and IndexNow is on, and only for the installation's own
 * key: any other key, the app's address and an installation without ee/ get 404. The key is public, never a secret.
 */
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const open = await indexablePublicSite(request.headers.get("host"));
  const own = open ? await serverExtensions.indexNowKey?.().catch(() => null) : null;
  if (!own || key !== own) return new Response("Finns inte.", NOT_FOUND);
  return new Response(own, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex", Vary: "Host" } });
}
