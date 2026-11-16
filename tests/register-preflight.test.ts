// register:sync (2026-11-15): Solar refuses the first token request just after midnight UTC; one refused sign-in is tried once
// more after a short wait and logged, so a single refusal does not fail the job. Nothing else is retried.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { authRetryLine, preflightWithAuthRetry, REGISTER_AUTH_RETRY_MS } from "../lib/catalogue/register-preflight";
import type { ApiPreflight } from "../lib/integrations/wholesale-api";

const ok: ApiPreflight = { ok: true, message: "Solars produktkatalog svarar." };
const auth: ApiPreflight = { ok: false, reason: "auth", message: "Solar godkände inte klient-id och hemlighet för Workflow." };
const answers = (...list: ApiPreflight[]) => {
  const calls = { count: 0 };
  return { calls, preflight: async () => list[Math.min(calls.count++, list.length - 1)] };
};
const recorder = () => {
  const waits: number[] = [];
  const lines: string[] = [];
  return { waits, lines, pause: async (ms: number) => { waits.push(ms); }, log: (line: string) => { lines.push(line); } };
};

test("a refused sign-in is tried once more after the wait, and the second answer counts", async () => {
  const { calls, preflight } = answers(auth, ok);
  const r = recorder();
  assert.deepEqual(await preflightWithAuthRetry(preflight, r.pause, r.log), ok);
  assert.equal(calls.count, 2);
  assert.deepEqual(r.waits, [REGISTER_AUTH_RETRY_MS]);
  assert.ok(REGISTER_AUTH_RETRY_MS >= 60_000 && REGISTER_AUTH_RETRY_MS <= 90_000, "60–90 seconds");
  assert.equal(r.lines[0], authRetryLine(REGISTER_AUTH_RETRY_MS));
  assert.match(r.lines[0], /nytt försök om 75 s/);
  assert.match(r.lines[1], /lyckades/);
});

test("at most one retry: a second refusal stands", async () => {
  const { calls, preflight } = answers(auth, auth, ok);
  const r = recorder();
  assert.deepEqual(await preflightWithAuthRetry(preflight, r.pause, r.log), auth);
  assert.equal(calls.count, 2);
  assert.equal(r.waits.length, 1);
  assert.match(r.lines[1], /misslyckades också/);
});

test("only the refused sign-in is retried: a working connection and every other reason stand at once", async () => {
  for (const answer of [ok, { ok: false, reason: "unreachable", message: "x" }, { ok: false, reason: "denied", message: "x" }, { ok: false, reason: "inactive", message: "x" }, { ok: false, reason: "no-key", message: "x" }] as ApiPreflight[]) {
    const { calls, preflight } = answers(answer, ok);
    const r = recorder();
    assert.deepEqual(await preflightWithAuthRetry(preflight, r.pause, r.log), answer);
    assert.equal(calls.count, 1, `${answer.ok ? "ok" : answer.reason}: one check`);
    assert.deepEqual(r.waits, []);
    assert.deepEqual(r.lines, []);
  }
});

test("the sync's run uses the retry before it claims the run", () => {
  const source = readFileSync("lib/catalogue/register-sync.ts", "utf8");
  const at = source.indexOf("await preflightWithAuthRetry(use.preflight, use.pause)");
  assert.ok(at > 0, "the run's check goes through the retry");
  assert.ok(at < source.indexOf(`UPDATE "WholesaleRegisterSync" SET "runId"`), "before the run is claimed");
});
