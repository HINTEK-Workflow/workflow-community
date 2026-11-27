import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { CounterBuffer } from "../lib/analytics/buffer";
import { DEMO_FLOW_KEYS, DEMO_SOURCE_KEYS, DEMO_START_KEYS, DEMO_TIME_KEYS, demoKeyLabel, demoSourceKey, demoStartKey, demoTimeKey, demoViewKey, isDemoBrowserKey, isDemoKey, kindLabel, validCounter } from "../lib/analytics/catalog";
import { isAutomatedVisitor } from "../lib/analytics/bots";
import { buildComparedReport, buildReport, changePercent, countersCsv, periodTotals, previousPeriod } from "../lib/analytics/report";
import { DEMO_LOGIN_HREF, isDemoLogin } from "../lib/demo";

// Besök i demon (2026-11-04): fixed keys, one anonymous number per day, no visitor kept.

test("only fixed demo keys are stored", () => {
  for (const key of [...DEMO_START_KEYS, ...DEMO_FLOW_KEYS, ...DEMO_TIME_KEYS, "view:stats", "view:workflow_task"]) assert.equal(validCounter("demo", key), true, key);
  for (const key of ["", "view:", "view:customer_companies", "view:behavior_analytics", "view:made_up", "start_other", "time_5", "a@b.se", "view:stats; drop", "x".repeat(200)]) assert.equal(validCounter("demo", key), false, key);
  assert.equal(isDemoKey("view:stats"), true);
  assert.equal(demoViewKey("customer_companies"), null, "the owner's own pages are not counted");
  assert.equal(demoViewKey("stats"), "view:stats");
});

test("time in the demo is one of four buckets", () => {
  assert.deepEqual([0, 59, 60, 179, 180, 599, 600, 5000].map(demoTimeKey), ["time_lt1", "time_lt1", "time_1to3", "time_1to3", "time_3to10", "time_3to10", "time_gt10", "time_gt10"]);
});

test("the buffer takes demo keys and refuses others", () => {
  const buffer = new CounterBuffer();
  assert.equal(buffer.add("2026-11-04", "demo", "start_link"), true);
  assert.equal(buffer.add("2026-11-04", "demo", "start_link"), true);
  assert.equal(buffer.add("2026-11-04", "demo", "news_visit"), false, "the news page is gone, so is its key");
  assert.equal(buffer.add("2026-11-04", "demo", "view:stats"), true);
  assert.equal(buffer.add("2026-11-04", "demo", "1.2.3.4"), false);
  assert.equal(buffer.size, 2, "one row per day and key, never one per event");
});

test("the report counts visits per way in, per page, per flow and per time bucket", () => {
  const rows = [
    { day: "2026-11-03", kind: "demo", key: "start_button", count: 3 },
    { day: "2026-11-04", kind: "demo", key: "start_login", count: 2 },
    { day: "2026-11-04", kind: "demo", key: "start_link", count: 1 },
    { day: "2026-11-04", kind: "demo", key: "view:stats", count: 6 },
    { day: "2026-11-04", kind: "demo", key: "view:time", count: 2 },
    { day: "2026-11-04", kind: "demo", key: "flow_tour_start", count: 4 },
    { day: "2026-11-04", kind: "demo", key: "time_1to3", count: 3 },
    { day: "2026-11-04", kind: "page", key: "stats", count: 9 },
  ];
  const report = buildReport(rows, "2026-11-02", "2026-11-04");
  assert.equal(report.demo.hasData, true);
  assert.equal(report.demo.starts.total, 6);
  // The operator's website (lib/operator-site.ts) may add its own start key between them; it has no count here.
  const starts: Record<string, number> = { start_button: 3, start_link: 1, start_login: 2 };
  assert.deepEqual(DEMO_START_KEYS.filter((key) => key in starts), ["start_button", "start_link", "start_login"]);
  assert.deepEqual(report.demo.starts.rows.map((row) => [row.key, row.count]), DEMO_START_KEYS.map((key) => [key, starts[key] ?? 0]));
  assert.deepEqual(report.demo.views.map((row) => [row.label, row.count]), [["Översikt", 6], ["Tid", 2]]);
  assert.equal(report.demo.flows.find((row) => row.key === "flow_tour_start")?.count, 4);
  assert.equal(report.demo.time.find((row) => row.key === "time_1to3")?.count, 3);
  assert.deepEqual(report.demo.daily.map((point) => [point.date, point.starts]), [["2026-11-02", 0], ["2026-11-03", 3], ["2026-11-04", 3]]);
  assert.equal(report.totals.pageViews, 9, "demo pages are not app page views");
  assert.equal(buildReport([], "2026-11-02", "2026-11-04").demo.hasData, false);
  assert.ok(countersCsv(rows).includes('"demo";"view:stats";"Översikt";"6"'));
  assert.equal(kindLabel("demo", "start_login"), demoKeyLabel("start_login"));
});

// Beteendeanalys förnyad (2026-11-11): the way in, the Referer's group, the comparison with the period before. The operator's
// own website (lib/operator-site.ts) is tried in ee/tests/operator-site.test.ts.
test("a demo start is counted by its way in: the start page's button, the login page or the plain link", () => {
  assert.deepEqual(["button", "login", null, "", "nytt", "constructor", "BUTTON"].map(demoStartKey), ["start_button", "start_login", "start_link", "start_link", "start_link", "start_link", "start_link"]);
  assert.match(readFileSync("app/demo/route.ts", "utf8"), /demoStartKey\(url\.searchParams\.get\("via"\)\)/);
});

test("where a demo start came from is one of the fixed groups, never the address", () => {
  const own = ["app.workflow.example", "workflow.example:443", null, undefined, ""];
  const cases: [string | null, string][] = [
    ["https://workflow.example/#priser", "from_own"], ["https://app.workflow.example/login", "from_own"], ["https://notworkflow.example/", "from_other"],
    ["https://www.google.se/", "from_search"], ["https://www.bing.com/search?q=x", "from_search"], ["https://duckduckgo.com/", "from_search"],
    ["https://www.linkedin.com/feed/", "from_other"], ["https://google.example.org/", "from_other"],
    [null, "from_none"], ["", "from_none"], ["not a url", "from_none"],
  ];
  for (const [referer, key] of cases) assert.equal(demoSourceKey(referer, own), key, String(referer));
  for (const key of DEMO_SOURCE_KEYS) { assert.equal(validCounter("demo", key), true, key); assert.notEqual(demoKeyLabel(key), key); }
  const route = readFileSync("app/demo/route.ts", "utf8");
  assert.match(route, /demoSourceKey\(request\.headers\.get\("referer"\)/);
  assert.doesNotMatch(route, /recordDemoEvent\([^)]*referer\)/, "the address itself is never counted");
});

test("a browser can send the demo's own events, never a start or a source", () => {
  for (const key of ["view:stats", "flow_tour_start", "flow_exit", "time_lt1"]) assert.equal(isDemoBrowserKey(key), true, key);
  for (const key of [...DEMO_START_KEYS, ...DEMO_SOURCE_KEYS, "a@b.se", "view:customer_companies"]) assert.equal(isDemoBrowserKey(key), false, key);
  if (existsSync("ee/api/analytics-event.ts")) assert.match(readFileSync("ee/api/analytics-event.ts", "utf8"), /refine\(isDemoBrowserKey/);
});

test("the report has the sources, the public pages per day and week, and the period before", () => {
  const rows = [
    { day: "2026-11-01", kind: "demo", key: "start_button", count: 2 },
    { day: "2026-11-01", kind: "funnel", key: "landing", count: 10 },
    { day: "2026-11-01", kind: "consent", key: "statistics", count: 4 },
    { day: "2026-11-01", kind: "consent", key: "necessary", count: 4 },
    { day: "2026-11-03", kind: "demo", key: "start_button", count: 3 },
    { day: "2026-11-03", kind: "demo", key: "from_search", count: 3 },
    { day: "2026-11-04", kind: "demo", key: "start_link", count: 1 },
    { day: "2026-11-04", kind: "demo", key: "from_none", count: 1 },
    { day: "2026-11-04", kind: "funnel", key: "landing", count: 20 },
    { day: "2026-11-04", kind: "funnel", key: "register", count: 5 },
    { day: "2026-11-04", kind: "consent", key: "statistics", count: 9 },
    { day: "2026-11-04", kind: "consent", key: "necessary", count: 1 },
    { day: "2026-11-04", kind: "page", key: "stats", count: 7 },
  ];
  const report = buildComparedReport(rows, "2026-11-03", "2026-11-04");
  const sources: Record<string, number> = { from_search: 3, from_none: 1 };
  assert.deepEqual(DEMO_SOURCE_KEYS.filter((key) => ["from_own", "from_search", "from_other", "from_none"].includes(key)), ["from_own", "from_search", "from_other", "from_none"]);
  assert.deepEqual(report.demo.sources.map((row) => [row.key, row.count]), DEMO_SOURCE_KEYS.map((key) => [key, sources[key] ?? 0]));
  assert.deepEqual(report.publicDaily.map((point) => [point.date, point.landing, point.register, point.statistics, point.necessary, point.demoStarts]), [["2026-11-03", 0, 0, 0, 0, 3], ["2026-11-04", 20, 5, 9, 1, 1]]);
  assert.deepEqual(report.publicWeekly.map((point) => [point.label, point.landing, point.demoStarts]), [["v. 45", 20, 4]]);
  assert.deepEqual(report.daily.map((point) => point.pages), [0, 7], "the app's series are as before");
  const now = periodTotals(report);
  assert.deepEqual([now.demoStarts, now.landing, now.register, now.registerRate, now.consentRate], [4, 20, 5, 25, 90]);
  assert.deepEqual([report.previous.from, report.previous.to], ["2026-11-01", "2026-11-02"]);
  assert.deepEqual([report.previous.demoStarts, report.previous.landing, report.previous.consentRate, report.previous.registerRate], [2, 10, 50, 0]);
  assert.equal(report.funnel.steps[0].count, 20, "the period before never leaks into the period");
  assert.deepEqual([changePercent(4, 2), changePercent(1, 4), changePercent(3, 0), changePercent(0, 0)], [100, -75, null, null]);
  assert.deepEqual(previousPeriod("2026-11-01", "2026-11-30"), { from: "2026-10-02", to: "2026-10-31" });
  assert.ok(countersCsv(rows).includes('"demo";"start_button";"Knapp på startsidan";"3"'));
});

test("link previews and robots are not visits", () => {
  assert.equal(isAutomatedVisitor("Slackbot-LinkExpanding 1.0"), true);
  assert.equal(isAutomatedVisitor("Mozilla/5.0 (compatible; Googlebot/2.1)"), true);
  assert.equal(isAutomatedVisitor(null), true);
  assert.equal(isAutomatedVisitor("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36"), false);
});

test("demo / demo is an exact match and nothing else", () => {
  assert.equal(isDemoLogin("demo", "demo"), true);
  for (const [email, password] of [["demo", "demo1"], ["demo", ""], ["demo", "Demo"], ["Demo", "demo"], ["demo ", "demo"], ["demo@example.se", "demo"], ["", "demo"], ["admin", "demo"]]) assert.equal(isDemoLogin(email, password), false, `${email}/${password}`);
  assert.equal(DEMO_LOGIN_HREF, "/demo?via=login");
});

test("the demo login is checked in the browser before sign-in and never touches the server's sign-in", () => {
  const form = readFileSync("features/auth/components/login-form.tsx", "utf8");
  assert.ok(form.indexOf("isDemoLogin(email, password)") > 0 && form.indexOf("isDemoLogin(email, password)") < form.indexOf('signIn("credentials"'), "demo / demo is decided before signIn is called");
  // The e-mail field lets exactly "demo" through and every other value must still look like an address.
  assert.ok(form.includes('pattern="demo|[^\\s@]+@[^\\s@]+\\.[^\\s@]+"'));
  for (const file of ["lib/auth/session.ts", "lib/auth/options.ts", "lib/auth/credentials.ts", "lib/auth/rate-limit.ts", "auth.ts"]) {
    let text = "";
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    assert.doesNotMatch(text, /isDemoLogin|DEMO_LOGIN/, `${file} knows nothing about demo / demo`);
  }
  // The demo route sets the same cookie as before; it holds "1" and no identity.
  const route = readFileSync("app/demo/route.ts", "utf8");
  assert.match(route, /DEMO_COOKIE, "1"/);
  assert.doesNotMatch(route, /session|token|signIn|prisma/i);
});

test("the one request that leaves the demo carries a fixed key only", () => {
  const backend = readFileSync("features/demo/demo-backend.ts", "utf8");
  const at = backend.indexOf("export function sendDemoEvent");
  const send = backend.slice(at, at + 600);
  assert.match(send, /isDemoBrowserKey\(key\)/);
  assert.match(send, /type: "demo", key/);
  assert.match(send, /credentials: "omit"/, "no cookie goes with it");
  assert.equal((backend.match(/realFetch\(/g) ?? []).length, 1);
});
