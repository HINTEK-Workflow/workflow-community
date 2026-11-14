import { FUNNEL_STEPS, isConsentChoice, type ConsentChoice, type FunnelStep } from "./catalog";

/**
 * Samtycke och trattens kaka (2026-10-07). Pure rules shared by the cookie box in the browser and the server that
 * counts a step, so what the browser promises and what the server does cannot drift apart.
 *
 * - `wf-consent` remembers the visitor's answer ("2026-10-08.s" = statistics allowed, ".n" = only what is necessary). It
 *   is needed to not ask again, so it is a necessary cookie; the answer expires after a year or when the box changes.
 * - `wf-stat` exists only after "Tillåt statistik". It holds the steps the visitor has already been counted for and the
 *   day the visit began – no number that tells visitors apart – so a step is counted once per visit and the server
 *   stores nothing about the visitor, only a sum per day.
 */
export const CONSENT_COOKIE = "wf-consent";
export const FUNNEL_COOKIE = "wf-stat";
/** Changes when what the statistics cookie holds or is used for changes, so everyone is asked again. */
export const CONSENT_VERSION = "2026-10-08";
export const CONSENT_MAX_AGE_SECONDS = 365 * 86_400;
export const FUNNEL_MAX_AGE_SECONDS = 30 * 86_400;
export const FUNNEL_JOURNEY_DAYS = 30;

export const consentCookieValue = (choice: ConsentChoice, version = CONSENT_VERSION) => `${version}.${choice === "statistics" ? "s" : "n"}`;

/** The answer a cookie value holds, or null when there is none, it is not understood or it is from an older box. */
export function parseConsent(value: string | null | undefined, version = CONSENT_VERSION): ConsentChoice | null {
  const match = /^(\d{4}-\d{2}-\d{2})\.([sn])$/.exec((value ?? "").trim());
  if (!match || match[1] !== version) return null;
  const choice = match[2] === "s" ? "statistics" : "necessary";
  return isConsentChoice(choice) ? choice : null;
}

/** The value of one cookie in a Cookie header (server) or document.cookie (browser). */
export function cookieValue(header: string | null | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

// ---------- the funnel cookie ----------

export type FunnelState = { /** The Swedish day the visit began, YYYYMMDD. */ day: string; /** The steps already counted, one bit each in FUNNEL_STEPS order. */ mask: number };
const bit = (step: FunnelStep) => 1 << FUNNEL_STEPS.indexOf(step);
const compact = (day: string) => day.replace(/-/g, "");

export const funnelCookieValue = (state: FunnelState) => `1.${state.day}.${state.mask}`;

/** Whole days between two YYYYMMDD days (calendar arithmetic, so it holds across month ends). */
function daysBetween(from: string, to: string) {
  const time = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)));
  return Math.round((time(to) - time(from)) / 86_400_000);
}

/** The state a cookie value holds; null when there is none, it is damaged or the visit began more than 30 days ago. */
export function parseFunnelCookie(value: string | null | undefined, today: string): FunnelState | null {
  const match = /^1\.(\d{8})\.(\d{1,2})$/.exec((value ?? "").trim());
  if (!match) return null;
  const mask = Number(match[2]);
  if (mask < 0 || mask >= 1 << FUNNEL_STEPS.length) return null;
  const age = daysBetween(match[1], compact(today));
  return age < 0 || age > FUNNEL_JOURNEY_DAYS ? null : { day: match[1], mask };
}

/**
 * Reaching a step: `counted` is true the first time in a visit (add one to that day's count), false when the visitor
 * was already counted for it. `next` is the state to put back in the cookie. `today` is the Swedish day, YYYY-MM-DD.
 */
export function advanceFunnel(state: FunnelState | null, step: FunnelStep, today: string): { counted: boolean; next: FunnelState } {
  const current = state ?? { day: compact(today), mask: 0 };
  if (current.mask & bit(step)) return { counted: false, next: current };
  return { counted: true, next: { day: current.day, mask: current.mask | bit(step) } };
}

/** The Set-Cookie header lines (HTTP) for the two cookies; `secure` follows the address the visitor is on. */
export function setCookieLine(name: string, value: string, maxAgeSeconds: number, secure: boolean) {
  return `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
export const clearCookieLine = (name: string, secure: boolean) => `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure ? "; Secure" : ""}`;
