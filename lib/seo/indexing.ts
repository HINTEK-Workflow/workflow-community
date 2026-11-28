// Sökmotorer (2026-11-10, n103): which of the installation's addresses search engines may index, and what robots.txt,
// sitemap.xml and the X-Robots-Tag header say. Pure and dependency-free, so proxy.ts, the routes and the tests read the
// same rules. The rule since 2026-10-15 stays: the app's own address is never indexed; only the separate public site
// (PUBLIC_SITE_URL) may be, and only while the landing page is published. Without a public site (a Community
// installation, local QA) nothing is indexed – the app is for the company's own use.
import type { PublicSite } from "@/lib/public-site";

/** What every answer on the app's address carries, also files and API answers which have no HTML to say it in. */
export const APP_ROBOTS_HEADER = "noindex, nofollow";

/**
 * robots.txt on the app's address, on a hidden landing page and without a public site: nothing may be crawled except the
 * login (2026-11-10), so a search engine can fetch it, see its noindex (meta and X-Robots-Tag) and drop an app
 * address it has listed from a link. Everything else stays closed.
 */
export const CLOSED_ROBOTS_TXT = "User-agent: *\nAllow: /login$\nDisallow: /\n";

/**
 * The public site's own pages and the files they need (the same lists as PUBLIC_PAGES and PUBLIC_FILES in
 * lib/public-site.ts): a search engine needs the styles, scripts, fonts and pictures to see the page as a visitor does,
 * and a link preview needs the share picture. Everything else on the public site only redirects to the app.
 */
// The film page and the news page (2026-11-21) are in the sitemap, so robots.txt lets them be crawled too. llms.txt (2026-11-28) too.
export const PUBLIC_CRAWL_ALLOW = ["/$", "/legal/", "/funktioner/", "/filmer$", "/nytt$", "/_next/", "/landing/", "/landing-images/", "/fonts/", "/picture/", "/icons/", "/brand/", "/opengraph-image", "/favicon.ico", "/sitemap.xml", "/llms.txt$"] as const;

/**
 * IndexNow's key file on the public site (2026-11-28, ee/landing/indexnow.ts): /<key>.txt with 8–128 letters, digits and hyphens.
 * proxy.ts sends such an address to the key file's route, which answers only for the installation's own key.
 */
export const INDEXNOW_KEY_FILE = /^\/([A-Za-z0-9-]{8,128})\.txt$/;
/** The route the key file is served by (proxy.ts rewrites /<key>.txt to it; it answers 404 for any other key and on the app's address). */
export const INDEXNOW_KEY_ROUTE = "/indexnow-key/";
/** The key file's line for robots.txt (it is named only while IndexNow is on). */
export const indexNowKeyAllow = (key: string) => `/${key}.txt$`;

/** robots.txt for the public site while the landing page is published, with the sitemap's address; `extraAllow`: the IndexNow key file. */
export function publicRobotsTxt(siteOrigin: string, extraAllow: readonly string[] = []): string {
  return ["User-agent: *", ...[...PUBLIC_CRAWL_ALLOW, ...extraAllow].map((path) => `Allow: ${path}`), "Disallow: /", "", `Sitemap: ${siteOrigin}/sitemap.xml`, ""].join("\n");
}

/** The X-Robots-Tag of an answer: every answer on the app's address (or without a public site) says noindex; the public site decides in its pages. */
export function robotsHeaderFor(where: "public" | "alias" | "app"): string | null {
  return where === "app" ? APP_ROBOTS_HEADER : null;
}

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** The sitemap of the public site: absolute addresses on its own origin, in the order given, no duplicates. */
export function sitemapXml(siteOrigin: string, paths: readonly string[]): string {
  const urls = [...new Set(paths.map((path) => `${siteOrigin}${path.startsWith("/") ? path : `/${path}`}`))];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`).join("\n")}\n</urlset>\n`;
}

/** The pages of the public site that may be indexed: the start page, the shown feature pages (2026-11-14) and each legal document that has a text. */
export function indexablePaths(legalKeys: readonly string[], featurePaths: readonly string[] = []): string[] {
  return ["/", ...featurePaths, ...legalKeys.map((key) => `/legal/${key}`)];
}

/** A public site that may be indexed now: the request came to it and the landing page is published there. */
export function indexableSite(site: PublicSite | null, where: "public" | "alias" | "app", landingShown: boolean): PublicSite | null {
  return site && where === "public" && landingShown ? site : null;
}
