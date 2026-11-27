import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { getScriptNonceFromHeader } from "next/dist/server/app-render/get-script-nonce-from-header";
import nextConfig from "../next.config";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";
import {
  buildCspPolicy, createNonce, cspDirectives, cspHeaderName, cspMode, CSP_REPORT_PATH, reportingEndpoints, wantsPagePolicy,
} from "../lib/security/csp";
import {
  createCspReportSink, CSP_LOG_LINES_PER_WINDOW, CSP_REPORTS_PER_ADDRESS, CSP_WINDOW_MS, isCspReportType, MAX_REPORTS_PER_BATCH,
  parseCspReports, safeAddress,
} from "../lib/security/csp-report";

// S2 (review 2026-10-20): a nonce-based Content-Security-Policy in report-only mode; the policy in force is unchanged.

const directive = (policy: string, name: string) => policy.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `));

test("the report-only policy: nonce and strict-dynamic for scripts, nothing else inline, reports to the app", () => {
  const policy = buildCspPolicy({ nonce: "abc123+/==" });
  assert.equal(directive(policy, "script-src"), "script-src 'self' 'nonce-abc123+/==' 'strict-dynamic'");
  assert.equal(directive(policy, "default-src"), "default-src 'self'");
  assert.equal(directive(policy, "object-src"), "object-src 'none'");
  assert.equal(directive(policy, "base-uri"), "base-uri 'self'");
  assert.equal(directive(policy, "frame-ancestors"), "frame-ancestors 'self'");
  assert.equal(directive(policy, "connect-src"), "connect-src 'self'");
  // 2026-11-02: no picture from anyone else; product pictures come through /api/product-image.
  assert.equal(directive(policy, "img-src"), "img-src 'self' data: blob:");
  assert.equal(directive(policy, "report-uri"), `report-uri ${CSP_REPORT_PATH}`);
  assert.equal(directive(policy, "report-to"), "report-to csp");
  assert.equal(reportingEndpoints(), `csp="${CSP_REPORT_PATH}"`);
  assert.doesNotMatch(policy, /unsafe-eval|ws:/, "no eval or WebSocket outside development");
  // A nonce in style-src would switch 'unsafe-inline' off for the style attributes React draws.
  assert.doesNotMatch(directive(policy, "style-src")!, /nonce/);
  assert.equal(new Set(cspDirectives({ nonce: "a" }).map(([name]) => name)).size, cspDirectives({ nonce: "a" }).length, "each directive once");
});

test("development adds eval and the hot reload's WebSocket, nothing more", () => {
  const policy = buildCspPolicy({ nonce: "abc", development: true });
  assert.match(directive(policy, "script-src")!, /'unsafe-eval'/);
  assert.equal(directive(policy, "connect-src"), "connect-src 'self' ws: wss:");
});

test("Next finds the nonce in the policy the proxy passes on", () => {
  const nonce = createNonce();
  assert.equal(getScriptNonceFromHeader(buildCspPolicy({ nonce })), nonce);
});

test("a nonce is new for every request, 16 random bytes in base64, and nothing else can be put in the policy", () => {
  const nonces = new Set(Array.from({ length: 2000 }, () => createNonce()));
  assert.equal(nonces.size, 2000);
  for (const nonce of [...nonces].slice(0, 50)) {
    assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/);
    assert.equal(Buffer.from(nonce, "base64").length, 16);
  }
  for (const bad of ["", "a b", "x'; script-src *", "a;b"]) assert.throws(() => buildCspPolicy({ nonce: bad }), /nonce/);
});

test("pages get the policy; the API and the sandboxed mailing pages do not", () => {
  for (const path of ["/", "/login", "/kunder", "/form-preview", "/legal/terms", "/p/abc", "/offline.html", "/api-docs", "/mailing"]) assert.equal(wantsPagePolicy(path), true, path);
  for (const path of ["/api", "/api/workspace", "/api/csp-report", "/m/abc"]) assert.equal(wantsPagePolicy(path), false, path);
});

test("report-only is the default; only CSP_ENFORCE=true (or 1, yes, on) enforces", () => {
  for (const value of [undefined, "", "false", "0", "no", "off", "report-only", "enforce", " tru e"]) assert.equal(cspMode(value), "report-only", String(value));
  for (const value of ["true", "TRUE", "1", "yes", "on", " true "]) assert.equal(cspMode(value), "enforce", value);
  assert.equal(cspHeaderName("report-only"), "Content-Security-Policy-Report-Only");
  assert.equal(cspHeaderName("enforce"), "Content-Security-Policy");
});

/** Runs the proxy for one address with CSP_ENFORCE set (or not): what it answers and what it passes on to Next. */
function runProxy(path: string, enforce: string | undefined, headers: Record<string, string> = {}) {
  const before = process.env.CSP_ENFORCE;
  if (enforce === undefined) delete process.env.CSP_ENFORCE; else process.env.CSP_ENFORCE = enforce;
  try {
    const response = proxy(new NextRequest(`http://127.0.0.1:3001${path}`, { headers: { host: "127.0.0.1:3001", ...headers } }));
    const passed = (name: string) => response.headers.get(`x-middleware-request-${name}`);
    return { response, passed };
  } finally {
    if (before === undefined) delete process.env.CSP_ENFORCE; else process.env.CSP_ENFORCE = before;
  }
}

const REPORT_ONLY = "Content-Security-Policy-Report-Only";
const ENFORCE = "Content-Security-Policy";
const sentByBrowser = { [ENFORCE.toLowerCase()]: "script-src *", [REPORT_ONLY.toLowerCase()]: "script-src *" };

test("the proxy: a page gets the report-only policy with a fresh nonce, and Next gets the same policy", () => {
  const { response, passed } = runProxy("/kunder", undefined, sentByBrowser);
  const policy = response.headers.get(REPORT_ONLY)!;
  assert.ok(policy, "report-only header on the answer");
  assert.equal(response.headers.get(ENFORCE), null, "nothing enforced by default");
  assert.equal(passed(REPORT_ONLY.toLowerCase()), policy, "Next reads the nonce from the request");
  assert.equal(passed(ENFORCE.toLowerCase()), null, "what the browser sent is never trusted");
  assert.equal(response.headers.get("Reporting-Endpoints"), reportingEndpoints());
  const nonce = getScriptNonceFromHeader(policy);
  assert.ok(nonce && nonce.length >= 22);
  assert.notEqual(getScriptNonceFromHeader(runProxy("/kunder", undefined).response.headers.get(REPORT_ONLY)!), nonce, "new per request");
  for (const value of ["false", "", "enforce"]) assert.ok(runProxy("/", value).response.headers.get(REPORT_ONLY), value);
});

test("the proxy: CSP_ENFORCE=true sends the same policy as Content-Security-Policy, and nothing report-only", () => {
  const { response, passed } = runProxy("/kunder", "true", sentByBrowser);
  const policy = response.headers.get(ENFORCE)!;
  assert.match(policy, /script-src 'self' 'nonce-[A-Za-z0-9+/]{22}==' 'strict-dynamic'/);
  for (const thin of ["frame-ancestors 'self'", "base-uri 'self'", "object-src 'none'"]) assert.ok(policy.includes(thin), `${thin}: the thin policy's directives are in it`);
  assert.equal(response.headers.get(REPORT_ONLY), null);
  assert.equal(passed(ENFORCE.toLowerCase()), policy);
  assert.equal(passed(REPORT_ONLY.toLowerCase()), null);
});

test("the proxy: the API and the mailing pages get no policy of their own in either mode", () => {
  for (const enforce of [undefined, "true"]) {
    for (const path of ["/api/workspace", "/m/abc"]) {
      const { response, passed } = runProxy(path, enforce, sentByBrowser);
      assert.equal(response.headers.get(ENFORCE), null, path);
      assert.equal(response.headers.get(REPORT_ONLY), null, path);
      assert.equal(passed(ENFORCE.toLowerCase()), null, path);
      assert.equal(passed(REPORT_ONLY.toLowerCase()), null, path);
    }
  }
});

test("the thin policy in force stays in next.config.ts", async () => {
  const rules = await nextConfig.headers!();
  const csp = rules.flatMap((rule) => rule.headers).filter((header) => /content-security-policy/i.test(header.key));
  assert.deepEqual(csp, [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" }]);
});

test("a classic report and a Reporting API batch give directive, blocked source and page only", () => {
  const classic = JSON.stringify({ "csp-report": {
    "document-uri": "https://app.example.se/kunder/3f9a8c2e-1b4d-4c1e-9f00-123456789abc?tab=jobb&token=hemligt#x",
    "violated-directive": "script-src-elem", "effective-directive": "script-src-elem",
    "blocked-uri": "https://cdn.example.com/lib.js?key=abc123", "script-sample": "alert('kund@example.se')",
    referrer: "https://app.example.se/?q=kund@example.se", "original-policy": "default-src 'self'",
  } });
  assert.deepEqual(parseCspReports(classic), [{ directive: "script-src-elem", blocked: "https://cdn.example.com/lib.js", page: "/kunder/:x" }]);
  const batch = JSON.stringify([
    { type: "csp-violation", url: "https://x", user_agent: "UA", body: { documentURL: "https://app.example.se/q/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", effectiveDirective: "style-src-attr", blockedURL: "inline", sample: "color:red" } },
    { type: "deprecation", body: { id: "x" } },
    { type: "csp-violation", body: { documentURL: "https://app.example.se/", effectiveDirective: "img-src", blockedURL: "data:image/png;base64,AAAA" } },
  ]);
  assert.deepEqual(parseCspReports(batch), [
    { directive: "style-src-attr", blocked: "inline", page: "/q/:x" },
    { directive: "img-src", blocked: "data", page: "/" },
  ]);
  const logged = JSON.stringify(parseCspReports(classic).concat(parseCspReports(batch)));
  for (const secret of ["hemligt", "abc123", "kund@example.se", "alert", "3f9a8c2e", "AbCdEf", "UA", "color:red"]) assert.ok(!logged.includes(secret), secret);
});

test("anything that is not a report gives nothing, and a batch is cut", () => {
  for (const text of ["", "not json", "null", "42", "{}", '{"csp-report":{}}', '{"csp-report":{"effective-directive":"x y;z<"}}', '[{"type":"csp-violation"}]'])
    assert.deepEqual(parseCspReports(text), [], text);
  const many = JSON.stringify(Array.from({ length: 50 }, (_, index) => ({ type: "csp-violation", body: { documentURL: `https://a/${index}`, effectiveDirective: "img-src", blockedURL: "https://b/x" } })));
  assert.equal(parseCspReports(many).length, MAX_REPORTS_PER_BATCH);
});

test("addresses are logged without query, fragment, user info or long identifiers", () => {
  assert.equal(safeAddress("https://user:pass@host.example/a/b?c=d#e"), "https://host.example/a/b");
  assert.equal(safeAddress("https://host/kund%40example.se/x"), "https://host/:x/x");
  assert.equal(safeAddress("https://host/project/12345678"), "https://host/project/:x");
  assert.equal(safeAddress("https://host/kunder?id=1", true), "/kunder");
  assert.equal(safeAddress("'eval'"), "eval");
  assert.equal(safeAddress("blob:https://host/uuid"), "blob");
  assert.equal(safeAddress("chrome-extension://abcdef/x.js"), "chrome-extension:");
  assert.equal(safeAddress("not a url"), "other");
  assert.equal(safeAddress(42), "");
});

test("the receiver accepts only report content types", () => {
  for (const type of ["application/csp-report", "application/reports+json", "application/json; charset=utf-8"]) assert.equal(isCspReportType(type), true, type);
  for (const type of [null, "", "text/plain", "multipart/form-data"]) assert.equal(isCspReportType(type), false, String(type));
});

test("the receiver limits each address, writes a report once per window and caps the log", () => {
  let now = 1_000_000;
  const lines: string[] = [];
  const sink = createCspReportSink({ now: () => now, write: (line) => lines.push(line) });
  for (let index = 0; index < CSP_REPORTS_PER_ADDRESS; index += 1) assert.equal(sink.allow("a"), true);
  assert.equal(sink.allow("a"), false, "over the limit");
  assert.equal(sink.allow("b"), true, "another address has its own count");
  now += CSP_WINDOW_MS;
  assert.equal(sink.allow("a"), true, "a new window");

  const report = { directive: "script-src-elem", blocked: "inline", page: "/" };
  assert.equal(sink.record([report, report]), 1, "the same report once");
  assert.equal(sink.record([report]), 0);
  assert.deepEqual(lines, [`CSP report-only: ${JSON.stringify(report)}`]);
  now += CSP_WINDOW_MS;
  assert.equal(sink.record([report]), 1, "again in a new window");

  const flood = Array.from({ length: CSP_LOG_LINES_PER_WINDOW + 50 }, (_, index) => ({ directive: "img-src", blocked: `https://h/${index}`, page: "/" }));
  assert.equal(sink.record(flood), CSP_LOG_LINES_PER_WINDOW - 1, "the log's own cap holds");
  assert.equal(sink.record([{ directive: "img-src", blocked: "https://other", page: "/" }]), 0);
});

test("the receiver route: 204 for a report, 415 for another type, 413 for a large body, 429 over the rate", async () => {
  const { POST } = await import("../app/api/csp-report/route");
  const post = (body: string, type = "application/csp-report") =>
    POST(new Request("http://127.0.0.1/api/csp-report", { method: "POST", headers: { "content-type": type }, body }));
  const report = JSON.stringify({ "csp-report": { "document-uri": "http://127.0.0.1/", "effective-directive": "img-src", "blocked-uri": "https://x/y" } });
  const warn = console.warn;
  const lines: string[] = [];
  console.warn = (line: string) => { lines.push(line); };
  try {
    assert.equal((await post(report)).status, 204);
    assert.equal((await post(report)).status, 204);
    assert.deepEqual(lines, ['CSP report-only: {"directive":"img-src","blocked":"https://x/y","page":"/"}'], "written once");
    assert.equal((await post("x", "text/plain")).status, 415);
    assert.equal((await post("x".repeat(20_000))).status, 413);
    let last = 204;
    for (let index = 0; index < CSP_REPORTS_PER_ADDRESS; index += 1) last = (await post("{}")).status;
    assert.equal(last, 429);
  } finally {
    console.warn = warn;
  }
});

test("the receiver route limits size and rate and answers empty", () => {
  const route = readFileSync("app/api/csp-report/route.ts", "utf8");
  assert.match(route, /readLimitedText\(request, MAX_CSP_REPORT_BYTES\)/);
  assert.match(route, /sink\.allow\(address\)/);
  assert.match(route, /status: 413/);
  assert.match(route, /status: 429/);
  assert.match(route, /status: 204/);
  assert.doesNotMatch(route, /console\./, "only the sink writes to the log");
});

test("an enforced report is logged as blocked, separately from the report-only one, with the same three fields", () => {
  const body = (disposition: string) => JSON.stringify({ "csp-report": {
    "document-uri": "https://app.example.se/kunder", "effective-directive": "script-src-elem", "blocked-uri": "inline", disposition,
  } });
  const batch = JSON.stringify([{ type: "csp-violation", body: { documentURL: "https://app.example.se/", effectiveDirective: "img-src", blockedURL: "https://x/y", disposition: "enforce" } }]);
  assert.deepEqual(parseCspReports(body("report")), [{ directive: "script-src-elem", blocked: "inline", page: "/kunder" }]);
  assert.deepEqual(parseCspReports(body("enforce")), [{ directive: "script-src-elem", blocked: "inline", page: "/kunder", enforced: true }]);
  assert.deepEqual(parseCspReports(batch), [{ directive: "img-src", blocked: "https://x/y", page: "/", enforced: true }]);
  const lines: string[] = [];
  const sink = createCspReportSink({ write: (line) => lines.push(line) });
  assert.equal(sink.record([...parseCspReports(body("report")), ...parseCspReports(body("enforce"))]), 2);
  assert.deepEqual(lines, [
    'CSP report-only: {"directive":"script-src-elem","blocked":"inline","page":"/kunder"}',
    'CSP blocked: {"directive":"script-src-elem","blocked":"inline","page":"/kunder"}',
  ]);
});

test("zod never tries new Function in the browser (no 'unsafe-eval' in the policy)", () => {
  const client = readFileSync("instrumentation-client.ts", "utf8");
  assert.match(client, /config\(\{ jitless: true \}\)/);
});

/**
 * form-action 'self' also covers where a form's answer redirects (Chrome, Firefox), so a form whose route sends the browser to
 * another site (Microsoft, Google, Stripe) would stop in enforce mode (2026-11-26: the operator page's Koppla katalogen did). Every
 * form with an action of its own is listed here with where its answer ends; one that leaves the app is a link instead.
 */
const FORM_ACTIONS: Record<string, string> = {
  "/api/qa/session": "the app's own QA start page (loopback QA only)",
  "/api/newsletter/unsubscribe": "answers on the app's own address",
  "/api/newsletter/confirm": "answers on the app's own address",
};
function tsxSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return ["node_modules", "tests"].includes(name) ? [] : tsxSources(path);
    return name.endsWith(".tsx") ? [path] : [];
  });
}
test("enforce mode: no form leaves the app (form-action 'self' covers its redirect)", () => {
  const found: string[] = [];
  for (const path of ["app", "components", "features", "ee"].filter((dir) => existsSync(dir)).flatMap(tsxSources)) {
    for (const match of readFileSync(path, "utf8").matchAll(/<form\b[^>]*\saction=\{?[`"']([^`"'?$]+)/g)) found.push(match[1]);
  }
  const unknown = found.filter((action) => !(action in FORM_ACTIONS));
  assert.deepEqual(unknown, [], "a form with an action of its own: list where its answer ends, or make it a link if it leaves the app");
  assert.doesNotMatch(readFileSync("features/operator/operator-accounts-admin.tsx", "utf8"), /<form[^>]*microsoft\/start/, "the step to Microsoft is a link");
});
