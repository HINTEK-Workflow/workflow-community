import assert from "node:assert/strict";
import test from "node:test";
import { fallbackHit, hitRateLimit, RATE_RULES, rateLimitBucketKey, rateLimited, rateLimitState, setRateLimitStoreForTests, STORE_DOWN_RETRY_SECONDS, type RateLimitStore } from "../lib/security/rate-limit";
import { retryAfterHeaders, ToolError } from "../lib/tools/call-route";

// Säkerhetshärdning steg 1 (2026-10-08): the shared limiter, its in-process reserve and the API/MCP rule.
// Plan 1G (2026-10-11): the sign-in rules refuse while the shared store is down; the reserve is for the other rules.

/** A shared store like the RateLimitBucket table: one row per key, fixed window, atomic per call. */
function sharedStore(clock: () => number) {
  const rows = new Map<string, { count: number; windowStart: Date }>();
  const store: RateLimitStore = {
    async hit(key, windowSeconds) {
      const row = rows.get(key);
      if (!row || row.windowStart.getTime() < clock() - windowSeconds * 1000) { const fresh = { count: 1, windowStart: new Date(clock()) }; rows.set(key, fresh); return { ...fresh }; }
      row.count += 1;
      return { ...row };
    },
    async read(key) { const row = rows.get(key); return row ? { ...row } : null; },
    async clear(key) { rows.delete(key); },
  };
  return { store, rows };
}

const brokenStore: RateLimitStore = {
  async hit() { throw Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432 password=secret"), { name: "DatabaseDown" }); },
  async read() { throw new Error("down"); },
  async clear() { throw new Error("down"); },
};

function captureWarnings() {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  return { lines, restore: () => { console.warn = original; } };
}

test("API and MCP keep 120 calls a minute, now as a shared rule", () => {
  assert.equal(RATE_RULES.integrationCall.name, "integration-call");
  assert.equal(RATE_RULES.integrationCall.limit, 120);
  assert.equal(RATE_RULES.integrationCall.windowSeconds, 60);
});

test("the integration limit is shared: two app processes count against the same row", async (t) => {
  t.after(() => setRateLimitStoreForTests(null));
  const now = Date.now();
  const { store } = sharedStore(() => now);
  setRateLimitStoreForTests(store);
  // Alternate the calls as two processes would; both reach the same bucket because the store is the database.
  for (let index = 0; index < 120; index += 1) assert.equal((await hitRateLimit(RATE_RULES.integrationCall, "key-a")).allowed, true, `call ${index + 1}`);
  const refused = await hitRateLimit(RATE_RULES.integrationCall, "key-a");
  assert.equal(refused.allowed, false);
  assert.ok(refused.retryAfterSeconds >= 1 && refused.retryAfterSeconds <= 60);
  // Another key is untouched.
  assert.equal((await hitRateLimit(RATE_RULES.integrationCall, "key-b")).allowed, true);
});

test("a new window lets calls through again", async (t) => {
  t.after(() => setRateLimitStoreForTests(null));
  let now = Date.now();
  const { store } = sharedStore(() => now);
  setRateLimitStoreForTests(store);
  for (let index = 0; index < 121; index += 1) await hitRateLimit(RATE_RULES.integrationCall, "key-w");
  assert.equal((await hitRateLimit(RATE_RULES.integrationCall, "key-w")).allowed, false);
  now += 61_000;
  assert.equal((await hitRateLimit(RATE_RULES.integrationCall, "key-w")).allowed, true);
});

test("concurrent calls are all counted", async (t) => {
  t.after(() => setRateLimitStoreForTests(null));
  const now = Date.now();
  const { store } = sharedStore(() => now);
  setRateLimitStoreForTests(store);
  const hits = await Promise.all(Array.from({ length: 150 }, () => hitRateLimit(RATE_RULES.integrationCall, "key-c")));
  assert.equal(hits.filter((hit) => hit.allowed).length, 120);
});

test("a 429 carries Retry-After for the HTTP answer", () => {
  assert.deepEqual(retryAfterHeaders(new ToolError(429, "För många", 17)), { "Retry-After": "17" });
  assert.equal(retryAfterHeaders(new ToolError(403, "Nej")), undefined);
  assert.equal(retryAfterHeaders(new Error("x")), undefined);
});

test("when the database fails, sign-in refuses instead of letting a guess through (plan 1G, 2026-10-11)", async (t) => {
  t.after(() => setRateLimitStoreForTests(null));
  setRateLimitStoreForTests(brokenStore);
  const warnings = captureWarnings();
  t.after(warnings.restore);
  const email = "someone@example.invalid";
  // The sign-in rules never use the reserve: the state is "unavailable", a hit is refused and says so, and the person
  // is asked to wait a short while – not the quarter of an hour of a real lock-out.
  for (const rule of [RATE_RULES.loginAccount, RATE_RULES.loginIp, RATE_RULES.twoFactor]) {
    assert.equal(rule.whenStoreDown, "refuse", rule.name);
    assert.equal(await rateLimitState(rule, email), "unavailable", rule.name);
    assert.equal(await rateLimited(rule, email), true, `${rule.name} does not let the try through`);
    const hit = await hitRateLimit(rule, email);
    assert.equal(hit.allowed, false, `${rule.name} refuses the hit`);
    assert.equal(hit.unavailable, true);
    assert.equal(hit.retryAfterSeconds, STORE_DOWN_RETRY_SECONDS);
  }
  // Nothing was counted in the reserve meanwhile: once the store is back, the address starts clean.
  setRateLimitStoreForTests(sharedStore(() => Date.now()).store);
  assert.equal(await rateLimitState(RATE_RULES.loginAccount, email), "open");
  // The warning names the rule and the error type, never the address, the key or the error text.
  assert.ok(warnings.lines.length >= 1);
  for (const line of warnings.lines) {
    assert.match(line, /refusing (login-account|login-ip|two-factor)/);
    assert.doesNotMatch(line, /example\.invalid|secret|ECONNREFUSED|10\.0\.0\.1/);
    assert.ok(!line.includes(rateLimitBucketKey(RATE_RULES.loginAccount, email)));
  }
});

test("the reserve uses each rule's own limit and window", async (t) => {
  t.after(() => setRateLimitStoreForTests(null));
  setRateLimitStoreForTests(brokenStore);
  const warnings = captureWarnings();
  t.after(warnings.restore);
  // Rules without a refusal (mail per IP address, API/MCP) keep their own limit per process while the store is down.
  for (let index = 0; index < RATE_RULES.mailIp.limit; index += 1) assert.equal((await hitRateLimit(RATE_RULES.mailIp, "203.0.113.9")).allowed, true);
  assert.equal((await hitRateLimit(RATE_RULES.mailIp, "203.0.113.9")).allowed, false);
  assert.equal(await rateLimited(RATE_RULES.mailIp, "203.0.113.9"), true);
  assert.equal(await rateLimited(RATE_RULES.mailIp, "203.0.113.10"), false);
  for (let index = 0; index < 120; index += 1) assert.equal((await hitRateLimit(RATE_RULES.integrationCall, "key-down")).allowed, true);
  const refused = await hitRateLimit(RATE_RULES.integrationCall, "key-down");
  assert.equal(refused.allowed, false);
  assert.ok(refused.retryAfterSeconds <= 60);
  // One warning per rule and minute, not one per call.
  assert.equal(warnings.lines.length, 2);
  for (const line of warnings.lines) { assert.match(line, /in-process reserve for/); assert.doesNotMatch(line, /203\.0\.113\.9|key-down/); }
});

test("the reserve window expires", (t) => {
  t.after(() => setRateLimitStoreForTests(null));
  setRateLimitStoreForTests(null);
  const rule = { name: "test-rule", limit: 2, windowSeconds: 60 };
  const now = 1_000_000;
  assert.equal(fallbackHit(rule, "k", now).allowed, true);
  assert.equal(fallbackHit(rule, "k", now + 1).allowed, true);
  const third = fallbackHit(rule, "k", now + 2);
  assert.equal(third.allowed, false);
  assert.equal(third.retryAfterSeconds, 60);
  assert.equal(fallbackHit(rule, "k", now + 60_000).allowed, true);
});
