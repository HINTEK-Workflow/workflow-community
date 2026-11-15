/**
 * Who may read the site map (2026-10-24: "en del av avancerade inställningar för produktionsadmin"): the
 * superadmin only. The map names every page, file and line of the app, so it is never in public/ or in the client
 * bundle; app/api/superadmin/sitemap reads it on the server after this check. Pure, so the tests read the same rule.
 */
export type SitemapAccess = { ok: true } | { ok: false; status: 401 | 403; message: string };

export function sitemapAccess(user: { role?: string | null } | null | undefined): SitemapAccess {
  if (!user) return { ok: false, status: 401, message: "Logga in för att fortsätta." };
  if (user.role !== "SUPERADMIN") return { ok: false, status: 403, message: "Bara installationens administratör kan göra det." };
  return { ok: true };
}

/** Where the build writes the map (scripts/sitemap/generate.cjs, DEFAULT_OUT): inside .next, never under public/. */
export const SITEMAP_FILE_PARTS = [".next", "workflow-sitemap.json"] as const;
