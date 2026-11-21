import { ApiError, failure, signedInAuth } from "@/lib/kfid/server";
import { sitemapAccess } from "@/lib/sitemap/access";
import { readSitemap } from "@/lib/sitemap/server";

export const dynamic = "force-dynamic";

/**
 * Installation → Drift och säkerhet → Avancerat → Webbplatskarta (2026-10-24): the map of every page,
 * tab, step and popup and the ways between them, worked out of the code at build time. The superadmin only; read on the
 * server, never kept by a browser or a cache.
 */
export async function GET() {
  try {
    const auth = await signedInAuth();
    const access = sitemapAccess(auth?.user ?? null);
    if (!access.ok) throw new ApiError(access.status, access.message);
    const text = await readSitemap();
    if (!text) throw new ApiError(404, "Kartan finns inte i det här bygget. Kör npm run sitemap eller bygg om appen.");
    return new Response(text, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
