import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { COOKIES, COOKIE_GROUPS, COOKIE_NOTICE_STORAGE_KEY, visibleCookieGroups } from "../lib/cookies";
import { CONSENT_COOKIE, CONSENT_MAX_AGE_SECONDS, CONSENT_VERSION, FUNNEL_COOKIE, FUNNEL_JOURNEY_DAYS, FUNNEL_MAX_AGE_SECONDS } from "../lib/analytics/consent";

// Kakor (2026-10-03; Beteendeanalys 2026-10-07): the list of every cookie and kind of browser storage, the
// optional statistics group and what the browser test that stops unknown cookies expects.
const entry = (name: string) => COOKIES.find((item) => item.name.startsWith(name));

test("every entry is listed once with its kind, content, purpose and lifetime", () => {
  const names = COOKIES.map((item) => item.name);
  assert.equal(new Set(names).size, names.length, "no cookie twice");
  for (const item of COOKIES) for (const field of [item.name, item.content, item.purpose, item.lifetime]) assert.ok(field.trim().length > 3, item.name);
  for (const group of COOKIE_GROUPS) assert.ok(group.title && group.description && group.entries.length, group.title);
});

test("statistics are an optional group of their own with the funnel cookie, and nothing else is optional", () => {
  const optional = COOKIE_GROUPS.filter((group) => group.optional);
  assert.deepEqual(optional.map((group) => group.title), ["Statistik (valfri)"]);
  assert.deepEqual(optional[0].entries.map((item) => item.name), [FUNNEL_COOKIE]);
  assert.match(optional[0].description, /bara om du väljer Tillåt statistik/i);
  assert.equal(optional[0].entries[0].kind, "Kaka");
});

test("the answer in the cookie box is a listed necessary cookie, shown only where statistics are asked about", () => {
  const consent = entry(CONSENT_COOKIE);
  assert.ok(consent, "wf-consent is listed");
  assert.equal(consent.requires, "statistics");
  assert.ok(COOKIE_GROUPS.find((group) => group.entries.includes(consent) && !group.optional), "it is in a group that is always on");
  const without = visibleCookieGroups(false);
  assert.equal(without.some((group) => group.optional), false, "the community edition shows no statistics group");
  assert.equal(without.flatMap((group) => group.entries).some((item) => item.name === CONSENT_COOKIE || item.name === FUNNEL_COOKIE), false);
  const withStatistics = visibleCookieGroups(true);
  assert.deepEqual(withStatistics.flatMap((group) => group.entries).map((item) => item.name), COOKIES.map((item) => item.name), "with statistics everything is listed");
  assert.equal(COOKIES.length - without.flatMap((group) => group.entries).length, 2, "exactly the choice cookie and the statistics cookie are hidden without statistics");
});

test("the lifetimes the list promises are the ones the code sets", () => {
  assert.equal(CONSENT_MAX_AGE_SECONDS, 365 * 86_400);
  assert.match(entry(CONSENT_COOKIE)!.lifetime, /12 månader/);
  assert.equal(FUNNEL_MAX_AGE_SECONDS, FUNNEL_JOURNEY_DAYS * 86_400);
  assert.match(entry(FUNNEL_COOKIE)!.lifetime, new RegExp(`^${FUNNEL_JOURNEY_DAYS} dagar`));
});

test("no third party: no analytics or advertising cookie is listed and the code loads nothing from another site", () => {
  for (const item of COOKIES) assert.doesNotMatch(item.name, /^(_ga|_gid|_fbp|_gcl|__utm|fr$|IDE$)/, item.name);
  // The files that exist here: the community edition has no ee/.
  for (const file of ["components/cookie-notice.tsx", "components/consent-gate.tsx", "lib/analytics/consent-client.ts", "lib/analytics/consent.ts", "ee/ui/funnel-beacon.tsx", "ee/analytics/funnel.ts"].filter((name) => existsSync(name)))
    assert.doesNotMatch(readFileSync(file, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""), /https?:\/\/(?!localhost)/, `${file} reaches no other address`);
});

test("the browser tests that stop unknown cookies know the new ones, and the QA harness reads the versions it needs", () => {
  // The browser tests and the QA harness are not part of the community edition; there only the version is checked.
  if (existsSync("tests/cookie-notice.browser.cjs")) {
    const known = /KNOWN = (\/.*\/);/.exec(readFileSync("tests/cookie-notice.browser.cjs", "utf8"))?.[1] ?? "";
    assert.ok(known.includes("wf-consent") && known.includes("wf-stat"), "tests/cookie-notice.browser.cjs lists wf-consent and wf-stat");
  }
  if (existsSync("scripts/qa/cookie-notice-seen.cjs")) {
    const harness = readFileSync("scripts/qa/cookie-notice-seen.cjs", "utf8");
    assert.ok(harness.includes("CONSENT_VERSION") && harness.includes("wf-consent"), "the harness answers 'Bara nödvändiga' so older tests are never blocked");
  }
  assert.match(readFileSync("lib/analytics/consent.ts", "utf8"), new RegExp(`CONSENT_VERSION = "${CONSENT_VERSION}"`));
  assert.ok(COOKIE_NOTICE_STORAGE_KEY.length > 0);
});
