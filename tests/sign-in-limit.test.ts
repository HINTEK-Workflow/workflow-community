import assert from "node:assert/strict";
import test from "node:test";
import { LOGIN_RATE_LIMITED, LOGIN_UNAVAILABLE } from "../lib/auth/password";
import { assertMayTry, assertMayTryApi, countIpTry, SIGN_IN_UNAVAILABLE_TEXT } from "../lib/auth/sign-in-limit";
import { ApiError } from "../lib/kfid/errors";
import { UNKNOWN_CLIENT_IP } from "../lib/security/client-ip";
import { RATE_RULES, setRateLimitStoreForTests, type RateLimitStore } from "../lib/security/rate-limit";

// Inloggningsspärren spärrar (plan 1G, 2026-10-11): the checks every sign-in makes, with the store up, full and down.

function memoryStore(full = false): RateLimitStore {
  const rows = new Map<string, { count: number; windowStart: Date }>();
  return {
    async hit(key) { const row = rows.get(key) ?? { count: 0, windowStart: new Date() }; row.count += 1; rows.set(key, row); return { ...row }; },
    async read(key) { if (full) return { count: 1_000, windowStart: new Date() }; const row = rows.get(key); return row ? { ...row } : null; },
    async clear(key) { rows.delete(key); },
  };
}
const brokenStore: RateLimitStore = {
  async hit() { throw Object.assign(new Error("down"), { name: "DatabaseDown" }); },
  async read() { throw Object.assign(new Error("down"), { name: "DatabaseDown" }); },
  async clear() { throw new Error("down"); },
};

function quiet(t: { after: (fn: () => void) => void }) {
  const warn = console.warn;
  console.warn = () => undefined;
  t.after(() => { console.warn = warn; setRateLimitStoreForTests(null); });
}

test("store up: an open window lets the try through, a full one refuses it as too many tries", async (t) => {
  quiet(t);
  setRateLimitStoreForTests(memoryStore());
  await assertMayTry(RATE_RULES.loginAccount, "a@example.invalid");
  await countIpTry(RATE_RULES.loginIp, "203.0.113.5");
  await assertMayTryApi(RATE_RULES.loginAccount, "a@example.invalid");
  setRateLimitStoreForTests(memoryStore(true));
  await assert.rejects(assertMayTry(RATE_RULES.loginAccount, "a@example.invalid"), { message: LOGIN_RATE_LIMITED });
  await assert.rejects(assertMayTryApi(RATE_RULES.loginAccount, "a@example.invalid"), (error: unknown) => error instanceof ApiError && error.status === 429);
});

test("store down: every check refuses with 'try again in a while', nothing is let through", async (t) => {
  quiet(t);
  setRateLimitStoreForTests(brokenStore);
  await assert.rejects(assertMayTry(RATE_RULES.loginAccount, "a@example.invalid"), { message: LOGIN_UNAVAILABLE });
  await assert.rejects(assertMayTry(RATE_RULES.twoFactor, "user-1"), { message: LOGIN_UNAVAILABLE });
  await assert.rejects(countIpTry(RATE_RULES.loginIp, "203.0.113.5"), { message: LOGIN_UNAVAILABLE });
  await assert.rejects(assertMayTryApi(RATE_RULES.loginAccount, "a@example.invalid"), (error: unknown) =>
    error instanceof ApiError && error.status === 503 && error.message === SIGN_IN_UNAVAILABLE_TEXT);
  assert.match(SIGN_IN_UNAVAILABLE_TEXT, /Försök igen om en stund/);
});

test("an unknown client address is not counted per IP, as before", async (t) => {
  quiet(t);
  setRateLimitStoreForTests(brokenStore);
  await countIpTry(RATE_RULES.loginIp, UNKNOWN_CLIENT_IP);
});
