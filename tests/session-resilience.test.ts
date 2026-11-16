import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Utloggad efter omstart (2026-11-16): a restart or a lost database connection must never end a valid session.
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("the access settings: every caller waits for the read under way, a failed read keeps the last values", () => {
  const source = read("lib/auth/registration.ts");
  assert.match(source, /if \(reading\) return reading;/, "callers during a read wait for it instead of using the closed defaults");
  assert.ok(source.indexOf("if (reading) return reading;") < source.indexOf("Date.now() - checkedAt < 15_000"), "the read under way is joined before the cache is trusted");
  assert.match(source, /if \(!loaded\) \{ setRegistrationGate\(false\); setInvitedMembers\(\[\]\); \}/, "closed until the first good read");
  assert.match(source, /\.catch\(\(\) => null\);/, "unreadable invited members are a failure, not an empty list");
  assert.doesNotMatch(source, /\.catch\(\(\) => \[\]\)/);
});

test("the session check: a database error keeps the cookie but lets nothing in", () => {
  const config = read("lib/auth/config.ts");
  assert.match(config, /return \{ \.\.\.token, unavailable: true \};/, "the jwt callback keeps the token, marked, instead of throwing");
  assert.match(config, /delete token\.unavailable;/, "the mark never survives into a check that succeeds");
  assert.match(config, /if \(token\.unavailable\) \{\s*\/\/[^\n]*\n\s*delete \(session as \{ user\?: unknown \}\)\.user;/, "an unchecked token gives no user");
  const host = read("features/security/session-expired-host.tsx");
  assert.match(host, /if \(session\?\.unavailable\) return undefined;/, "the page does not say utloggad while the server cannot tell");
});
