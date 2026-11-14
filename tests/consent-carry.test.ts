import assert from "node:assert/strict";
import { test } from "node:test";
import { CONSENT_PARAM, readConsent, takeCarriedConsent, withCarriedConsent } from "../lib/analytics/consent-client";
import { consentCookieValue } from "../lib/analytics/consent";

// The cookie answer carried from the public site to the app (2026-10-15): two addresses cannot share a cookie, so
// the answer rides along in the link into the app and is stored there, never asked twice.

function browser(href: string, cookie = "") {
  const jar = new Map<string, string>(cookie ? [cookie.split("=") as [string, string]] : []);
  const replaced: string[] = [];
  const location = new URL(href);
  Object.assign(globalThis, {
    window: {
      location: { get href() { return location.toString(); }, protocol: location.protocol },
      history: { state: null, replaceState: (_: unknown, __: string, next: string) => { replaced.push(next); const url = new URL(next, location); location.search = url.search; } },
      dispatchEvent: () => true,
    },
    document: {
      get cookie() { return [...jar].map(([name, value]) => `${name}=${value}`).join("; "); },
      set cookie(line: string) { const [pair] = line.split(";"); const [name, value] = pair.split("="); if (/Max-Age=0/.test(line)) jar.delete(name); else jar.set(name, value); },
    },
    location: { protocol: location.protocol },
  });
  return { replaced };
}

test("a link into the app carries the answer, and only when there is one", () => {
  browser("https://example.com/");
  assert.equal(withCarriedConsent("https://app.example.se/login"), "https://app.example.se/login", "no answer, nothing added");
  browser("https://example.com/", `wf-consent=${consentCookieValue("statistics")}`);
  const carried = new URL(withCarriedConsent("https://app.example.se/login?x=1"));
  assert.equal(carried.searchParams.get(CONSENT_PARAM), consentCookieValue("statistics"));
  assert.equal(carried.searchParams.get("x"), "1");
});

test("the app stores a carried answer once, takes it out of the address and never overrides its own", () => {
  const first = browser(`https://app.example.se/login?${CONSENT_PARAM}=${consentCookieValue("necessary")}&y=2`);
  takeCarriedConsent();
  assert.equal(readConsent(), "necessary");
  assert.deepEqual(first.replaced, ["/login?y=2"]);
  // An answer already given on the app wins over one in the address.
  browser(`https://app.example.se/login?${CONSENT_PARAM}=${consentCookieValue("statistics")}`, `wf-consent=${consentCookieValue("necessary")}`);
  takeCarriedConsent();
  assert.equal(readConsent(), "necessary");
  // Anything that is not a valid answer of this version is dropped.
  const junk = browser(`https://app.example.se/login?${CONSENT_PARAM}=1999-01-01.s`);
  takeCarriedConsent();
  assert.equal(readConsent(), null);
  assert.deepEqual(junk.replaced, ["/login"]);
});
