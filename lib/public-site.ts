// A separate public address for the landing page (2026-10-15; Workflow's is in docs/drift/). Pure and dependency-free, so
// proxy.ts, the pages, the Origin check and the tests read the same rules.
//
// The model: APP_URL is the app – sign-in, session cookies, passkeys, API, MCP/OAuth, e-mail links, Stripe returns, QR
// labels and the mobile app all stay there. PUBLIC_SITE_URL (optional, set in .env only once DNS, certificate and
// nginx are in place) is a shop window: it shows the landing page with prices when it is published and the legal
// documents, and accepts two kinds of POST – the anonymous funnel/consent beacon and the browser's CSP reports. Every
// other address on it is sent to the app; its API answers 404. The "www." twin of the public address redirects to it.
// Without PUBLIC_SITE_URL nothing here changes anything (community installations, local QA).

export type PublicSite = {
  /** The app's origin, e.g. https://app.example.com. */
  appOrigin: string;
  appHost: string;
  /** The public site's canonical origin, e.g. https://example.com. */
  siteOrigin: string;
  siteHost: string;
  /** Hosts that only redirect to the canonical public site (its www. twin, or the apex when the site is www.). */
  aliasHosts: string[];
};

type Source = Record<string, string | undefined>;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const isIpLiteral = (hostname: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[");

/** Host header → comparable host ("Example.COM." → "example.com"; the port is kept, so loopback tests can use it). */
export function normalizeHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/\.(?=:|$)/, "");
}

function origin(value: string | undefined): URL | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * Why a PUBLIC_SITE_URL cannot be used, or null when it can (or is not set). lib/env.ts stops a production start on a
 * problem; elsewhere an unusable value simply means "no public site".
 */
export function publicSiteProblem(appUrl: string | undefined, siteUrl: string | undefined, production: boolean): string | null {
  if (!siteUrl?.trim()) return null;
  const site = origin(siteUrl);
  if (!site) return "PUBLIC_SITE_URL must be an http(s) address.";
  if (site.pathname !== "/" || site.search || site.hash || site.username || site.password)
    return "PUBLIC_SITE_URL must be an origin only (scheme and host, no path).";
  const app = origin(appUrl);
  if (!app) return "PUBLIC_SITE_URL needs a valid APP_URL.";
  if (normalizeHost(site.host) === normalizeHost(app.host)) return "PUBLIC_SITE_URL must be another host than APP_URL.";
  if (production && !LOOPBACK.has(site.hostname) && site.protocol !== "https:") return "A public PUBLIC_SITE_URL must use HTTPS.";
  return null;
}

/** The public site of this installation, or null when it has none (or the value is unusable). */
export function publicSite(source: Source = process.env): PublicSite | null {
  // Read through a variable, so no bundler inlines a build-time value (the proxy reads the environment at run time).
  const appUrl = source["APP_URL"];
  const siteUrl = source["PUBLIC_SITE_URL"];
  if (!siteUrl?.trim() || publicSiteProblem(appUrl, siteUrl, false)) return null;
  const app = new URL(appUrl!.trim());
  const site = new URL(siteUrl.trim());
  const siteHost = normalizeHost(site.host);
  const aliasHosts: string[] = [];
  if (!LOOPBACK.has(site.hostname) && !isIpLiteral(site.hostname)) {
    const twin = siteHost.startsWith("www.") ? siteHost.slice(4) : `www.${siteHost}`;
    if (twin !== normalizeHost(app.host)) aliasHosts.push(twin);
  }
  return { appOrigin: app.origin, appHost: normalizeHost(app.host), siteOrigin: site.origin, siteHost, aliasHosts };
}

/** Which of the installation's addresses a request came to. */
export function siteOfHost(host: string | null | undefined, site: PublicSite | null): "public" | "alias" | "app" {
  if (!site) return "app";
  const normalized = normalizeHost(host);
  if (normalized === site.siteHost) return "public";
  if (site.aliasHosts.includes(normalized)) return "alias";
  return "app";
}

/**
 * The POSTs the public site accepts: the anonymous funnel and consent beacon (Beteendeanalys, ee/) and the browser's reports
 * for the report-only Content-Security-Policy (S2, lib/security/csp.ts), which carry no session and change no data – and
 * the landing page's Följ nyhetsbrevet (2026-11-12: GET for the form's time stamp, POST for the confirmation mail; it keeps only
 * a pending address until the mailed link is confirmed on the app's own address).
 */
export const PUBLIC_SITE_POST_PATHS = ["/api/analytics/event", "/api/csp-report", "/api/newsletter/subscribe"] as const;

/**
 * Pages the public site renders itself; "/" decides on its own (landing page, or the app's login while hidden). The
 * cookie details are a pop-up on every page (/cookies only opens it in the app).
 */
// The feature pages (/funktioner/<adress>, 2026-11-14) are the landing page's and decide on their own (404 while hidden).
// The film page (/filmer, 2026-11-20) and the news page (/nytt, 2026-11-21) the same way.
const PUBLIC_PAGES = [/^\/$/, /^\/legal\/[a-z-]+\/?$/, /^\/funktioner\/[a-z0-9-]+\/?$/, /^\/filmer\/?$/, /^\/nytt\/?$/];
/** Files the pages above need. Next's own files (/_next/…) always pass. */
const PUBLIC_FILES = [/^\/_next\//, /^\/icons\//, /^\/brand\//, /^\/landing\//, /^\/landing-images\//, /^\/landing-films\//, /^\/fonts\//, /^\/picture\//, /^\/favicon\.ico$/, /^\/robots\.txt$/, /^\/sitemap\.xml$/, /^\/opengraph-image(?:-[\w-]+)?$/];
/** Never on the public site: the API, OAuth/MCP discovery, the app's service worker and install manifest. */
const PUBLIC_NOT_FOUND = [/^\/api(\/|$)/, /^\/\.well-known(\/|$)/, /^\/sw\.js$/, /^\/manifest\.webmanifest$/];

export type SiteDecision =
  | { kind: "pass" }
  | { kind: "redirect"; location: string; status: 307 | 308 }
  | { kind: "not-found" };

/**
 * What proxy.ts does with a request. The app's own address is never touched. On the public site: its pages, files and
 * the beacon pass; the API and discovery answer 404 (a POST is never forwarded to the app); everything else – the
 * login, registration, demo, QR labels (/p/…), quote links – is the app's and goes there with the same path and query.
 * 307 (temporary) for those, so nothing is cached in browsers if the public site later serves more; 308 for www.
 */
export function routePublicSite(request: { host: string | null | undefined; pathname: string; search: string }, site: PublicSite | null): SiteDecision {
  const where = siteOfHost(request.host, site);
  if (!site || where === "app") return { kind: "pass" };
  const path = request.pathname || "/";
  if (where === "alias") return { kind: "redirect", location: `${site.siteOrigin}${path}${request.search}`, status: 308 };
  if ((PUBLIC_SITE_POST_PATHS as readonly string[]).includes(path)) return { kind: "pass" };
  if (PUBLIC_NOT_FOUND.some((rule) => rule.test(path))) return { kind: "not-found" };
  if (PUBLIC_PAGES.some((rule) => rule.test(path)) || PUBLIC_FILES.some((rule) => rule.test(path))) return { kind: "pass" };
  return { kind: "redirect", location: `${site.appOrigin}${path}${request.search}`, status: 307 };
}

/**
 * The origins a mutation may come from. Always the app (APP_URL, and NEXTAUTH_URL when it differs); the public site
 * only for a route that opts in (the beacon) and only when the request really came to the public site's host – never
 * "any", never the www. twin (it only redirects).
 */
export function allowedOrigins(input: { appUrl: string; nextAuthUrl?: string; site: PublicSite | null; host?: string | null; publicSite?: boolean }): string[] {
  const allowed = [new URL(input.appUrl).origin];
  const nextAuth = origin(input.nextAuthUrl);
  if (nextAuth && !allowed.includes(nextAuth.origin)) allowed.push(nextAuth.origin);
  if (input.publicSite && input.site && siteOfHost(input.host, input.site) === "public") allowed.push(input.site.siteOrigin);
  return allowed;
}

/**
 * A link into the app from a page that may be shown on the public site: absolute when the installation has one (so it
 * never makes a hop through a redirect), otherwise the plain path as before.
 */
export function appHref(path: string, site: PublicSite | null = publicSite()): string {
  return site ? `${site.appOrigin}${path}` : path;
}

/**
 * The start page for a link "to the start page" (2026-11-06): the public site when the installation has one. On the app's
 * own address "/" sends a signed-out visitor to the login, so such a link never reached the landing page. The public site
 * decides for itself (publicStartTarget): the landing page while it is published, otherwise the app's login – no loop.
 * Without a public site the app's "/" as before (its own landing page or the login).
 */
export function startHref(site: PublicSite | null = publicSite()): string {
  return site ? `${site.siteOrigin}/` : "/";
}

/** The price section of the landing page: on the public site when there is one. */
export function pricesHref(siteOrigin: string | null | undefined): string {
  return siteOrigin ? `${siteOrigin}/#priser` : "/#priser";
}

/**
 * What the public site's start page does (app/page.tsx): the landing page while it is published; while it is hidden the
 * visitor goes to the app's login, as before 2026-11-04.
 */
export function publicStartTarget(landing: "render" | "hidden", site: Pick<PublicSite, "appOrigin">): { kind: "landing" } | { kind: "redirect"; location: string } {
  return landing === "render" ? { kind: "landing" } : { kind: "redirect", location: `${site.appOrigin}/login` };
}
