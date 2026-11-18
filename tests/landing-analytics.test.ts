import assert from "node:assert/strict";
import test from "node:test";
import { CounterBuffer } from "../lib/analytics/buffer";
import {
  DEMO_START_KEYS, LANDING_CLICK_KEYS, demoStartKey, isLandingKey, kindLabel, landingClickOf, landingDeviceOf, referrerDomain, validCounter,
} from "../lib/analytics/catalog";
import { NO_STATS_COOKIE, noStatsCookieDomain, noStatsCookieLine, notCounted, optedOut } from "../lib/analytics/exclusion";
import { buildReport, countersCsv, periodTotals } from "../lib/analytics/report";
import { COOKIES } from "../lib/cookies";

// Landningssidan i Beteendeanalys och egna besök (2026-11-15/16).

test("only fixed website keys are stored", () => {
  for (const key of ["page:start", "page:maskinlarm", "click:demo", "click:simulator", "device:mobile", "ref:google.se", "ref:none", "ref:other", "newsletter:requested", "newsletter:confirmed"])
    assert.equal(validCounter("landing", key), true, key);
  for (const key of ["", "page:", "page:Start", "page:a/b", "click:other", "device:tv", "ref:", "ref:https://x.se/a", "ref:a", "ref:x.se:1", "newsletter:sent", "page:start:x", "a@b.se", `ref:${"a".repeat(70)}.se`])
    assert.equal(isLandingKey(key), false, key);
  const buffer = new CounterBuffer();
  assert.equal(buffer.add("2026-11-16", "landing", "page:start"), true);
  assert.equal(buffer.add("2026-11-16", "landing", "ref:/path?q=1"), false);
});

test("a referring address is kept as its domain only, never the rest, and own hosts are not a way in", () => {
  assert.equal(referrerDomain("https://www.google.se/search?q=hintek"), "google.se");
  assert.equal(referrerDomain("https://l.facebook.com/l.php?u=x"), "facebook.com");
  assert.equal(referrerDomain("https://news.bbc.co.uk/a"), "bbc.co.uk");
  assert.equal(referrerDomain("https://hintek.se/om"), "hintek.se");
  assert.equal(referrerDomain("https://app.example.com/x", ["example.com"]), null, "a subdomain of an own host");
  assert.equal(referrerDomain("https://www.example.com/", ["example.com:443"]), null);
  for (const value of ["", null, "not a url", "http://192.168.1.2/x", "android-app://com.google.android.gm", "http://localhost:3000/"]) assert.equal(referrerDomain(value), null, String(value));
});

test("a landing link is sorted by its address into the fixed buttons", () => {
  const base = "https://example.com/";
  assert.equal(landingClickOf("https://app.example.com/demo?via=button", { base }), "demo");
  assert.equal(landingClickOf("https://app.example.com/demo?via=simulator#maskin", { base }), "simulator");
  assert.equal(landingClickOf("/demo?via=button#maskin", { base }), "simulator");
  assert.equal(landingClickOf("/operator/demo", { base }), "operator_demo");
  assert.equal(landingClickOf("https://github.com/Workflow/workflow", { base, inPlans: true }), "github", "GitHub wins also among the plans");
  assert.equal(landingClickOf("https://app.example.com/login", { base, inPlans: true }), "plan");
  assert.equal(landingClickOf("#priser", { base }), "plan");
  assert.equal(landingClickOf("mailto:info@example.com?subject=x", { base }), "contact");
  assert.equal(landingClickOf("https://app.example.com/register", { base }), "signup");
  assert.equal(landingClickOf("/funktioner/maskinlarm", { base }), "read_more");
  assert.equal(landingClickOf("#steg-start", { base }), null);
  assert.equal(landingClickOf("javascript:alert(1)", { base }), null);
  assert.deepEqual([320, 767, 768, 1099, 1100, 2000].map(landingDeviceOf), ["mobile", "mobile", "tablet", "tablet", "desktop", "desktop"]);
});

test("the simulator button has its own way into the demo", () => {
  assert.equal(demoStartKey("simulator"), "start_simulator");
  assert.ok(DEMO_START_KEYS.includes("start_simulator"));
  assert.equal(validCounter("demo", "start_simulator"), true);
  assert.equal(kindLabel("demo", "start_simulator"), "Simulatorknappen på webbplatsen");
});

test("the report shows the website's pages, buttons, ways in, screens and newsletter", () => {
  const rows = [
    { day: "2026-11-15", kind: "landing", key: "page:start", count: 5 },
    { day: "2026-11-16", kind: "landing", key: "page:start", count: 3 },
    { day: "2026-11-16", kind: "landing", key: "page:maskinlarm", count: 2 },
    { day: "2026-11-16", kind: "landing", key: "click:demo", count: 4 },
    { day: "2026-11-16", kind: "landing", key: "ref:google.se", count: 3 },
    { day: "2026-11-16", kind: "landing", key: "ref:none", count: 1 },
    { day: "2026-11-16", kind: "landing", key: "device:mobile", count: 6 },
    { day: "2026-11-16", kind: "landing", key: "device:desktop", count: 4 },
    { day: "2026-11-16", kind: "landing", key: "newsletter:requested", count: 2 },
    { day: "2026-11-16", kind: "landing", key: "newsletter:confirmed", count: 1 },
  ];
  const report = buildReport(rows, "2026-11-15", "2026-11-16");
  assert.equal(report.landing.hasData, true);
  assert.equal(report.landing.views, 10);
  assert.deepEqual(report.landing.pages.map((row) => [row.label, row.count]), [["Startsidan", 8], ["Undersida: Maskinlarm", 2]]);
  assert.equal(report.landing.clicks.length, LANDING_CLICK_KEYS.length, "every button, in a fixed order");
  assert.equal(report.landing.clicks.find((row) => row.key === "click:demo")?.count, 4);
  assert.deepEqual(report.landing.sources.map((row) => row.label), ["google.se", "Ingen hänvisning (direkt)"]);
  assert.deepEqual(report.landing.devices.map((row) => row.count), [6, 0, 4]);
  assert.deepEqual(report.landing.newsletter, { requested: 2, confirmed: 1 });
  assert.deepEqual(report.publicDaily.map((point) => point.landingViews), [5, 5]);
  assert.equal(periodTotals(report).landingViews, 10);
  assert.match(countersCsv(rows), /"webbplats";"page:start";"Startsidan";"5"/);
  assert.equal(buildReport([], "2026-11-15", "2026-11-16").landing.hasData, false);
});

test("the owner's opt-out cookie: one value, the shared parent domain only when the app is under the public site", () => {
  assert.equal(optedOut(`a=1; ${NO_STATS_COOKIE}=1`), true);
  assert.equal(optedOut(`${NO_STATS_COOKIE}=0`), false);
  assert.equal(optedOut(null), false);
  assert.equal(noStatsCookieDomain({ appHost: "app.hintekwork.com", siteHost: "hintekwork.com" }), "hintekwork.com");
  assert.equal(noStatsCookieDomain({ appHost: "app.example.com", siteHost: "www.example.com" }), "example.com");
  assert.equal(noStatsCookieDomain({ appHost: "app.other.se", siteHost: "example.com" }), null);
  assert.equal(noStatsCookieDomain({ appHost: "localhost:3000", siteHost: "127.0.0.1:3001" }), null);
  assert.equal(noStatsCookieDomain(null), null);
  const on = noStatsCookieLine(true, { secure: true, domain: "hintekwork.com" });
  assert.match(on, /^wf-no-stats=1; Path=\/; Max-Age=34560000; Domain=hintekwork\.com; SameSite=Lax; Secure$/);
  assert.match(noStatsCookieLine(false, { secure: false, domain: null }), /^wf-no-stats=; Path=\/; Max-Age=0; SameSite=Lax$/);
  assert.ok(COOKIES.some((entry) => entry.name === NO_STATS_COOKIE), "the cookie is listed under the cookie button");
});

test("the installation's own people and a switched-off browser are never counted", () => {
  assert.equal(notCounted(null), false);
  assert.equal(notCounted({ cookie: "x=1" }), false);
  assert.equal(notCounted({ superadmin: true }), true);
  assert.equal(notCounted({ ownCompany: true }), true);
  assert.equal(notCounted({ cookie: `${NO_STATS_COOKIE}=1` }), true);
});
