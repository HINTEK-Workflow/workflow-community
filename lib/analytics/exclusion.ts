import { cookieValue } from "./consent";

/**
 * Egna besök räknas inte (2026-11-15/16). Pure rules, shared by every place that counts and by the tests.
 *
 * - The product owner can switch off counting for one browser under Beteendeanalys: the server then sets `wf-no-stats`.
 *   It is a preference the owner sets with their own press (a necessary cookie, no consent), holds only "1" and nothing
 *   that tells browsers apart. Not HttpOnly: the cookieless beacons (demo, landing page) read it in the browser and then send
 *   nothing, so they never need to carry a cookie. Visits, clicks, demo starts and the funnel from that browser are then not counted, on the
 *   app's address and – where the public site shares its parent domain (app.example.com and example.com) – on the public site.
 * - The installation's own people are never counted in the app: a superadmin, and every member of the installation's own
 *   company (lib/branding.ts isHintekOrganization).
 */
export const NO_STATS_COOKIE = "wf-no-stats";
/** The longest a browser keeps a cookie (400 days in Chrome). */
export const NO_STATS_MAX_AGE_SECONDS = 400 * 86_400;

/** Whether a Cookie header carries the owner's "count nothing from this browser". */
export const optedOut = (header: string | null | undefined) => cookieValue(header, NO_STATS_COOKIE) === "1";
/** The same in the browser (document.cookie); false on the server or when cookies cannot be read. */
export function optedOutHere() {
  try { return typeof document !== "undefined" && optedOut(document.cookie); } catch { return false; }
}

const hostOnly = (host: string) => host.trim().toLowerCase().replace(/\.$/, "");
const plainName = (host: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) && !/^\d+(\.\d+){3}$/.test(host);

/**
 * The Domain the cookie is set for, so that both addresses send it: the public site's host (without www.) when the app is that
 * host or one under it (app.example.com under example.com). Null – the app's address alone – without a public site, with
 * a port or an IP address, or when the two do not share it.
 */
export function noStatsCookieDomain(site: { appHost: string; siteHost: string } | null): string | null {
  if (!site) return null;
  const app = hostOnly(site.appHost);
  const parent = hostOnly(site.siteHost).replace(/^www\./, "");
  if (!plainName(app) || !plainName(parent) || !parent.includes(".")) return null;
  return app === parent || app.endsWith(`.${parent}`) ? parent : null;
}

/** The Set-Cookie line that switches counting off (`on`) or back on for this browser. */
export function noStatsCookieLine(on: boolean, options: { secure: boolean; domain: string | null }) {
  const domain = options.domain ? `; Domain=${options.domain}` : "";
  return `${NO_STATS_COOKIE}=${on ? "1" : ""}; Path=/; Max-Age=${on ? NO_STATS_MAX_AGE_SECONDS : 0}${domain}; SameSite=Lax${options.secure ? "; Secure" : ""}`;
}

/** Who is never counted in the app: the superadmin and the installation's own company. */
export type CountingSubject = { cookie?: string | null; superadmin?: boolean; ownCompany?: boolean };
export const notCounted = (subject: CountingSubject | null | undefined) =>
  Boolean(subject && (subject.superadmin || subject.ownCompany || optedOut(subject.cookie)));
