import assert from "node:assert/strict";
import test from "node:test";
import { CounterBuffer } from "../lib/analytics/buffer";
import { FEATURE_LABELS, featureForRequest, pageKey, validCounter, FUNNEL_STEPS, kindLabel } from "../lib/analytics/catalog";
import { CONSENT_VERSION, advanceFunnel, consentCookieValue, cookieValue, funnelCookieValue, parseConsent, parseFunnelCookie, setCookieLine, clearCookieLine } from "../lib/analytics/consent";
import { addReportDays, buildReport, countersCsv, isoWeek } from "../lib/analytics/report";
import { resolveAnalyticsSettings, retentionCutoffDay } from "../lib/analytics/settings-model";

// Beteendeanalys (2026-10-07): anonymous counters in the app, a funnel with consent on the public pages.

test("a page is counted under its view, task editors by type, and the owner's own pages not at all", () => {
  assert.equal(pageKey("stats"), "stats");
  assert.equal(pageKey("workflow_task", "FORM"), "workflow_task:FORM");
  assert.equal(pageKey("workflow_task", "<script>"), "workflow_task");
  assert.equal(pageKey("workflow_task"), "workflow_task");
  assert.equal(pageKey("customer_companies"), null);
  assert.equal(pageKey("behavior_analytics"), null);
  assert.equal(pageKey("../etc/passwd"), null);
  assert.equal(pageKey(""), null);
  assert.equal(pageKey(undefined), null);
});

test("a changing request is counted as the function its address belongs to, a read or an unknown address is not", () => {
  assert.equal(featureForRequest("POST", "/api/workflow-time"), "time");
  assert.equal(featureForRequest("post", "/api/ai/chat"), "ai_chat");
  assert.equal(featureForRequest("POST", "/api/form-schedules"), "rounds");
  assert.equal(featureForRequest("DELETE", "/api/planned-activities"), "planning");
  assert.equal(featureForRequest("POST", "/api/workflow-tasks/abc123/send"), "report_mail");
  assert.equal(featureForRequest("POST", "/api/workflow-tasks/snapshot-report"), "report_pdf");
  assert.equal(featureForRequest("POST", "/api/projects/abc/report"), "projects");
  // Task saves include autosave, so they are not counted by address.
  assert.equal(featureForRequest("POST", "/api/workflow-tasks"), null);
  assert.equal(featureForRequest("GET", "/api/ai/chat"), null);
  assert.equal(featureForRequest("POST", "/api/auth/callback/credentials"), null);
  assert.equal(featureForRequest("POST", "/somewhere/else"), null);
  assert.equal(featureForRequest("POST", "/api/importer"), null, "a prefix is a whole path segment");
  // Every function a request can map to has a Swedish name.
  for (const route of ["workflow-time", "form-schedules", "planned-activities", "projects", "places", "import", "ai/chat", "ai/proposals", "ai/review", "self-inspection", "company-values", "invitations", "integration-keys", "cloud-workspace/export", "workflow-task-files"]) {
    const key = featureForRequest("POST", `/api/${route}`);
    assert.ok(key && key in FEATURE_LABELS, route);
  }
});

test("only keys from the closed lists are stored", () => {
  assert.equal(validCounter("page", "stats"), true);
  assert.equal(validCounter("page", "workflow_task:FORM"), true);
  assert.equal(validCounter("page", "customer_companies"), false);
  assert.equal(validCounter("page", "stats; drop table"), false);
  assert.equal(validCounter("feature", "ai_chat"), true);
  assert.equal(validCounter("feature", "made-up"), false);
  assert.equal(validCounter("funnel", "pricing"), true);
  assert.equal(validCounter("funnel", "other"), false);
  assert.equal(validCounter("consent", "statistics"), true);
  assert.equal(validCounter("consent", "yes"), false);
  assert.equal(kindLabel("funnel", "register"), "Skapa konto");
  assert.equal(kindLabel("page", "unknown_view"), "unknown_view");
});

test("the counter buffer sums per day, ignores what is not allowed and stops at its limit", () => {
  const buffer = new CounterBuffer(3);
  assert.equal(buffer.add("2026-10-08", "page", "stats"), true);
  assert.equal(buffer.add("2026-10-08", "page", "stats", 2), true);
  assert.equal(buffer.add("2026-10-08", "feature", "ai_chat"), true);
  assert.equal(buffer.add("2026-10-08", "feature", "made-up"), false);
  assert.equal(buffer.add("08-10-2026", "page", "stats"), false);
  assert.equal(buffer.add("2026-10-08", "page", "stats", 0), false);
  assert.equal(buffer.add("2026-10-09", "page", "stats"), true);
  assert.equal(buffer.add("2026-10-10", "page", "stats"), false, "past the limit of different counters");
  assert.equal(buffer.size, 3);
  const rows = buffer.drain();
  assert.deepEqual(rows.find((row) => row.day === "2026-10-08" && row.key === "stats"), { day: "2026-10-08", kind: "page", key: "stats", count: 3 });
  assert.equal(buffer.size, 0);
  buffer.add("2026-10-08", "page", "stats");
  buffer.restore(rows);
  assert.equal(buffer.drain().find((row) => row.key === "stats" && row.day === "2026-10-08")?.count, 4, "rows put back are added to what was counted since");
});

test("a counter row holds nothing but day, kind, key and count", () => {
  const buffer = new CounterBuffer();
  buffer.add("2026-10-08", "page", "stats");
  for (const row of buffer.drain()) assert.deepEqual(Object.keys(row).sort(), ["count", "day", "key", "kind"]);
});

test("the consent cookie holds the visitor's answer for this version of the box only", () => {
  assert.equal(parseConsent(consentCookieValue("statistics")), "statistics");
  assert.equal(parseConsent(consentCookieValue("necessary")), "necessary");
  assert.equal(parseConsent(`${CONSENT_VERSION}.s`), "statistics");
  assert.equal(parseConsent("2020-01-01.s"), null, "an answer to an older box is asked again");
  assert.equal(parseConsent(`${CONSENT_VERSION}.x`), null);
  assert.equal(parseConsent(""), null);
  assert.equal(parseConsent(null), null);
  assert.equal(parseConsent(undefined), null);
});

test("a cookie is read out of a Cookie header by its exact name", () => {
  const header = "a=1; wf-consent=2026-10-08.s; wf-stat=1.20261008.1; xwf-consent=no";
  assert.equal(cookieValue(header, "wf-consent"), "2026-10-08.s");
  assert.equal(cookieValue(header, "wf-stat"), "1.20261008.1");
  assert.equal(cookieValue(header, "missing"), null);
  assert.equal(cookieValue(null, "a"), null);
});

test("the funnel cookie counts a step once per visit and holds no identity", () => {
  const first = advanceFunnel(null, "landing", "2026-10-08");
  assert.equal(first.counted, true);
  assert.deepEqual(first.next, { day: "20261008", mask: 1 });
  assert.equal(advanceFunnel(first.next, "landing", "2026-10-08").counted, false, "a reload is not a second visitor");
  const pricing = advanceFunnel(first.next, "pricing", "2026-10-08");
  assert.equal(pricing.counted, true);
  assert.equal(pricing.next.mask, 3);
  // A step can be reached without the ones before (a direct link): it is counted, the earlier ones are not invented.
  const direct = advanceFunnel(null, "checkout", "2026-10-08");
  assert.deepEqual(direct, { counted: true, next: { day: "20261008", mask: 8 } });
  // The value is the same for every visitor in the same state, so it cannot tell two visitors apart.
  assert.equal(funnelCookieValue(first.next), funnelCookieValue(advanceFunnel(null, "landing", "2026-10-08").next));
  assert.match(funnelCookieValue(first.next), /^1\.\d{8}\.\d+$/);
});

test("a funnel cookie older than a visit, from the future or damaged starts a new visit", () => {
  assert.deepEqual(parseFunnelCookie("1.20261008.3", "2026-10-20"), { day: "20261008", mask: 3 });
  assert.equal(parseFunnelCookie("1.20261008.3", "2026-11-20"), null, "more than 30 days ago");
  assert.equal(parseFunnelCookie("1.20261008.3", "2026-10-01"), null, "from the future");
  assert.equal(parseFunnelCookie("1.20261008.99", "2026-10-08"), null);
  assert.equal(parseFunnelCookie("garbage", "2026-10-08"), null);
  assert.equal(parseFunnelCookie(null, "2026-10-08"), null);
  assert.deepEqual(parseFunnelCookie("1.20260930.1", "2026-10-02"), { day: "20260930", mask: 1 }, "across a month end");
  assert.equal(FUNNEL_STEPS.length, 4);
});

test("cookie header lines carry the lifetime and, over https, Secure", () => {
  assert.equal(setCookieLine("wf-stat", "1.20261008.1", 2592000, true), "wf-stat=1.20261008.1; Path=/; Max-Age=2592000; SameSite=Lax; Secure");
  assert.equal(setCookieLine("wf-stat", "x", 10, false), "wf-stat=x; Path=/; Max-Age=10; SameSite=Lax");
  assert.match(clearCookieLine("wf-stat", false), /Max-Age=0/);
});

test("the switches: Workflow's defaults, the community edition's and what was chosen", () => {
  assert.deepEqual(resolveAnalyticsSettings(null, { usage: true, funnel: true }), { usage: true, funnel: false, retentionMonths: 14 }, "the funnel waits for the product owner");
  assert.equal(resolveAnalyticsSettings({ funnel: true }, { usage: true, funnel: true }).funnel, true, "switched on by the product owner");
  assert.deepEqual(resolveAnalyticsSettings({}, { usage: false, funnel: false }), { usage: false, funnel: false, retentionMonths: 14 });
  assert.equal(resolveAnalyticsSettings({ usage: true }, { usage: false, funnel: false }).usage, true, "a choice beats the default");
  assert.equal(resolveAnalyticsSettings({ funnel: true }, { usage: false, funnel: false }).funnel, false, "no funnel without the part that measures it");
  assert.equal(resolveAnalyticsSettings({ funnel: false }, { usage: true, funnel: true }).funnel, false);
  assert.equal(resolveAnalyticsSettings({ retentionMonths: 6 }, { usage: true, funnel: true }).retentionMonths, 6);
  assert.equal(resolveAnalyticsSettings({ retentionMonths: 7 }, { usage: true, funnel: true }).retentionMonths, 14, "only the offered choices");
  assert.equal(resolveAnalyticsSettings([1, 2], { usage: true, funnel: true }).usage, true);
});

test("the retention cut-off is whole months back, the last day of a shorter month", () => {
  assert.equal(retentionCutoffDay("2026-10-08", 14), "2025-08-08");
  assert.equal(retentionCutoffDay("2026-03-31", 1), "2026-02-28");
  assert.equal(retentionCutoffDay("2024-03-31", 1), "2024-02-29");
  assert.equal(retentionCutoffDay("2026-01-15", 3), "2025-10-15");
});

test("weeks are ISO weeks starting on Monday", () => {
  assert.deepEqual(isoWeek("2026-10-08"), { year: 2026, week: 41 });
  assert.deepEqual(isoWeek("2026-01-01"), { year: 2026, week: 1 });
  assert.deepEqual(isoWeek("2027-01-01"), { year: 2026, week: 53 });
  assert.equal(addReportDays("2026-02-28", 1), "2026-03-01");
});

const rows = [
  { day: "2026-10-05", kind: "page", key: "stats", count: 10 },
  { day: "2026-10-06", kind: "page", key: "stats", count: 6 },
  { day: "2026-10-06", kind: "page", key: "tasks", count: 4 },
  { day: "2026-10-07", kind: "page", key: "workflow_task:FORM", count: 2 },
  { day: "2026-10-07", kind: "feature", key: "ai_chat", count: 3 },
  { day: "2026-10-12", kind: "feature", key: "time", count: 5 },
  { day: "2026-10-06", kind: "funnel", key: "landing", count: 40 },
  { day: "2026-10-06", kind: "funnel", key: "pricing", count: 20 },
  { day: "2026-10-07", kind: "funnel", key: "register", count: 5 },
  { day: "2026-10-07", kind: "funnel", key: "checkout", count: 2 },
  { day: "2026-10-06", kind: "consent", key: "statistics", count: 30 },
  { day: "2026-10-06", kind: "consent", key: "necessary", count: 10 },
];

test("the report has every day of the period, the weeks, the most used and the funnel", () => {
  const report = buildReport(rows, "2026-10-05", "2026-10-12");
  assert.equal(report.daily.length, 8);
  assert.deepEqual(report.daily[0], { date: "2026-10-05", pages: 10, features: 0 });
  assert.deepEqual(report.daily[1], { date: "2026-10-06", pages: 10, features: 0 });
  assert.deepEqual(report.daily[3], { date: "2026-10-08", pages: 0, features: 0 }, "a day without counts is a zero, not a gap");
  assert.deepEqual(report.weekly.map((week) => [week.date, week.label, week.pages, week.features]), [["2026-10-05", "v. 41", 22, 3], ["2026-10-12", "v. 42", 0, 5]]);
  assert.deepEqual(report.totals, { pageViews: 22, featureUses: 8 });
  assert.deepEqual(report.pages.map((row) => [row.label, row.count]), [["Översikt", 16], ["Uppgifter", 4], ["Protokoll (öppnat)", 2]]);
  assert.equal(report.pages[0].share, 72.7);
  assert.deepEqual(report.features.map((row) => row.key), ["time", "ai_chat"]);
  assert.deepEqual(report.funnel.steps.map((step) => [step.step, step.count, step.ofPrevious, step.ofFirst]), [["landing", 40, null, null], ["pricing", 20, 50, 50], ["register", 5, 25, 12.5], ["checkout", 2, 40, 5]]);
  assert.equal(report.funnel.conversion, 5);
  assert.deepEqual(report.consent, { statistics: 30, necessary: 10, rate: 75 });
  assert.equal(report.hasData, true);
});

test("the funnel never shows more than 100 percent and says nothing without a first step", () => {
  const direct = buildReport([{ day: "2026-10-06", kind: "funnel", key: "landing", count: 2 }, { day: "2026-10-06", kind: "funnel", key: "pricing", count: 5 }], "2026-10-06", "2026-10-06");
  assert.equal(direct.funnel.steps[1].ofPrevious, 100);
  const none = buildReport([{ day: "2026-10-06", kind: "funnel", key: "register", count: 5 }], "2026-10-06", "2026-10-06");
  assert.equal(none.funnel.conversion, null);
  assert.equal(none.funnel.steps[2].ofPrevious, null, "no share of an empty step");
  const empty = buildReport([], "2026-10-06", "2026-10-07");
  assert.equal(empty.hasData, false);
  assert.equal(empty.funnel.hasData, false);
  assert.equal(empty.consent.rate, null);
});

test("a long period is cut to the most recent 400 days", () => {
  const report = buildReport([], "2020-01-01", "2026-10-08");
  assert.equal(report.daily.length, 400);
  assert.equal(report.daily[report.daily.length - 1].date, "2026-10-08");
});

test("the CSV opens in Excel: byte order mark, semicolons, quoted cells, names in Swedish", () => {
  const csv = countersCsv([{ day: "2026-10-06", kind: "page", key: "stats", count: 6 }, { day: "2026-10-05", kind: "feature", key: "ai_chat", count: 3 }]);
  assert.ok(csv.startsWith("﻿\"datum\";\"typ\";\"nyckel\";\"namn\";\"antal\""));
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[1], "\"2026-10-05\";\"funktion\";\"ai_chat\";\"Workflow AI: fråga i chatten\";\"3\"");
  assert.equal(lines[2], "\"2026-10-06\";\"sida\";\"stats\";\"Översikt\";\"6\"");
  assert.equal(countersCsv([{ day: "2026-10-06", kind: "page", key: "a\"b", count: 1 }]).includes("\"a\"\"b\""), true);
  // R2 (review 2026-10-20): a key that starts like a formula is neutralised, as in the quote export.
  const formula = countersCsv([{ day: "2026-10-06", kind: "page", key: "=HYPERLINK(\"x\")", count: 1 }]);
  assert.ok(formula.includes("\"'=HYPERLINK(\"\"x\"\")\""), formula);
});

test("labels fall back to the key, the guards accept only the closed lists", async () => {
  const { featureLabel, isAnalyticsKind, isConsentChoice, isFeatureKey, isFunnelStep, pageLabel, CONSENT_LABELS, FUNNEL_LABELS } = await import("../lib/analytics/catalog");
  assert.equal(pageLabel("planning"), "Planering – Kalender");
  assert.equal(pageLabel("workflow_task:RISK_ASSESSMENT"), "Riskbedömning (öppnad)");
  assert.equal(pageLabel("a_new_view"), "a_new_view", "a view without a name is shown by its key");
  assert.equal(featureLabel("report_pdf"), "Rapport hämtad (PDF eller Excel)");
  assert.equal(featureLabel("unknown"), "unknown");
  assert.equal(isFeatureKey("ai_chat"), true);
  assert.equal(isFeatureKey("constructor"), false, "no inherited names");
  assert.deepEqual(["page", "feature", "funnel", "consent", "other", undefined].map((value) => isAnalyticsKind(value)), [true, true, true, true, false, false]);
  assert.deepEqual(["landing", "pricing", "register", "checkout", "login", ""].map((value) => isFunnelStep(value)), [true, true, true, true, false, false]);
  assert.deepEqual(["necessary", "statistics", "all", null].map((value) => isConsentChoice(value)), [true, true, false, false]);
  assert.deepEqual(Object.values(FUNNEL_LABELS), ["Landningssidan", "Priser", "Skapa konto", "Kassa"]);
  assert.deepEqual(Object.values(CONSENT_LABELS), ["Bara nödvändiga", "Tillåt statistik"]);
});

test("the browser keeps the answer in wf-consent, drops the statistics cookie when it is refused and tells the page", async () => {
  const jar = new Map<string, string>();
  const events = new EventTarget();
  const requests: { url: string; body: string }[] = [];
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = { document: globals.document, location: globals.location, window: globals.window, fetch: globals.fetch };
  Object.defineProperty(globals, "document", { configurable: true, value: { get cookie() { return [...jar].map(([name, value]) => `${name}=${value}`).join("; "); }, set cookie(line: string) {
    const [pair, ...attributes] = line.split(";").map((part) => part.trim());
    const [name, ...rest] = pair.split("=");
    if (attributes.some((attribute) => attribute === "Max-Age=0")) jar.delete(name); else jar.set(name, rest.join("="));
  } } });
  Object.defineProperty(globals, "location", { configurable: true, value: { protocol: "https:" } });
  Object.defineProperty(globals, "window", { configurable: true, value: { dispatchEvent: (event: Event) => events.dispatchEvent(event), addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) } });
  Object.defineProperty(globals, "fetch", { configurable: true, value: async (url: string, init: { body: string }) => { requests.push({ url, body: init.body }); return new Response(null, { status: 204 }); } });
  try {
    const client = await import("../lib/analytics/consent-client");
    assert.equal(client.readConsent(), null, "no answer yet");
    let heard = 0;
    const stop = client.subscribeConsent(() => { heard += 1; });
    client.writeConsent("statistics");
    assert.equal(client.readConsent(), "statistics");
    assert.equal(jar.get("wf-consent"), `${CONSENT_VERSION}.s`);
    jar.set("wf-stat", "1.20261008.1");
    client.writeConsent("necessary");
    assert.equal(client.readConsent(), "necessary");
    assert.equal(jar.has("wf-stat"), false, "refusing takes the statistics cookie away");
    assert.equal(heard, 2, "the page is told about every answer");
    stop();
    client.writeConsent("statistics");
    assert.equal(heard, 2, "no listener, no call");
    client.reportConsentChoice("necessary");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(requests, [{ url: "/api/analytics/event", body: JSON.stringify({ type: "consent", choice: "necessary" }) }]);
    // A page that is measured is remembered while it is shown.
    assert.equal(client.measuredPageNow(), false);
    let changes = 0;
    const unsubscribe = client.subscribeMeasuredPage(() => { changes += 1; });
    const leave = client.markMeasuredPage();
    assert.equal(client.measuredPageNow(), true);
    const second = client.markMeasuredPage();
    leave();
    assert.equal(client.measuredPageNow(), true, "still one measured page shown");
    second();
    assert.equal(client.measuredPageNow(), false);
    assert.equal(changes, 4);
    unsubscribe();
  } finally {
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete globals[name]; else Object.defineProperty(globals, name, { configurable: true, value }); }
  }
});
