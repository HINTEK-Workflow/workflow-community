import { CONSENT_COOKIE, CONSENT_MAX_AGE_SECONDS, FUNNEL_COOKIE, clearCookieLine, consentCookieValue, cookieValue, parseConsent, setCookieLine } from "./consent";
import type { ConsentChoice } from "./catalog";

/**
 * The visitor's answer in the browser (2026-10-07). Browser only: reads and writes `wf-consent`, takes
 * `wf-stat` away when statistics are refused or withdrawn, and tells the page (and the funnel beacon) that the answer changed.
 */
export const CONSENT_EVENT = "wf:consent-changed";

const secure = () => typeof location !== "undefined" && location.protocol === "https:";

/** The answer the browser holds, or null when the visitor has not answered this version of the box. */
export function readConsent(): ConsentChoice | null {
  if (typeof document === "undefined") return null;
  try { return parseConsent(cookieValue(document.cookie, CONSENT_COOKIE)); } catch { return null; }
}

/** Stores the answer. "Bara nödvändiga" also removes the statistics cookie at once. */
export function writeConsent(choice: ConsentChoice) {
  try {
    document.cookie = setCookieLine(CONSENT_COOKIE, consentCookieValue(choice), CONSENT_MAX_AGE_SECONDS, secure());
    if (choice !== "statistics") document.cookie = clearCookieLine(FUNNEL_COOKIE, secure());
  } catch { /* the choice is asked again next time */ }
  window.dispatchEvent(new Event(CONSENT_EVENT));
}

/** Tells the server which answer was given (a sum per day, no cookie, nothing about the visitor). */
export function reportConsentChoice(choice: ConsentChoice) {
  try {
    void fetch("/api/analytics/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "consent", choice }), keepalive: true }).catch(() => undefined);
  } catch { /* counting is never needed */ }
}

export function subscribeConsent(callback: () => void) {
  window.addEventListener(CONSENT_EVENT, callback);
  return () => window.removeEventListener(CONSENT_EVENT, callback);
}

// ---------- pages whose measuring waits for the answer ----------

let measuredPages = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** A public page that is measured (landing page, Skapa konto) mounts this while it is shown; the box then blocks until answered. */
export function markMeasuredPage(): () => void {
  measuredPages += 1;
  notify();
  return () => { measuredPages = Math.max(0, measuredPages - 1); notify(); };
}
export const subscribeMeasuredPage = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const measuredPageNow = () => measuredPages > 0;

// ---------- the answer carried from the public site to the app (2026-10-15) ----------

/**
 * Two addresses cannot share a cookie: an answer given on the public site (example.com) rides along in the link into the
 * app (Logga in, Prova demo, a plan) as `?samtycke=<version>.<s|n>`, so Skapa konto never asks the same visitor again.
 * Only the answer travels – nothing about the visitor – and only when there is one.
 */
export const CONSENT_PARAM = "samtycke";

/** The link with the visitor's answer added, or unchanged when there is none (or the link cannot be read). */
export function withCarriedConsent(href: string): string {
  const choice = readConsent();
  if (!choice) return href;
  try {
    const url = new URL(href, window.location.href);
    url.searchParams.set(CONSENT_PARAM, consentCookieValue(choice));
    return url.toString();
  } catch {
    return href;
  }
}

/**
 * On the app: an answer that came along in the address is stored as if given here – unless the visitor has already
 * answered on this address – and is taken out of the address at once. Not counted again (the public site counted it).
 */
export function takeCarriedConsent() {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    const carried = url.searchParams.get(CONSENT_PARAM);
    if (carried === null) return;
    url.searchParams.delete(CONSENT_PARAM);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    const choice = parseConsent(carried);
    if (choice && readConsent() === null) writeConsent(choice);
  } catch { /* the box simply asks */ }
}
