import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptExternalKey,
  encryptExternalKey,
  externalHint,
  issuedKeyProblem,
  newIssuedToken,
  parseIssuedToken,
  secretMatches,
  validScopes,
} from "../lib/integrations/keys";

// Central key administration (2026-09-29): issued keys are shown once and stored as a hash; external keys are
// encrypted and only their last four characters are shown.
test("an issued key is a token shown once, stored only as a hash, and checked in constant time", () => {
  const id = "a1b2c3d4e5f6a1b2c3d4e5f6";
  const issued = newIssuedToken("API", id);
  assert.match(issued.token, /^hwf_api_a1b2c3d4e5f6a1b2c3d4e5f6_[A-Za-z0-9_-]{43}$/);
  assert.equal(issued.secretHash.length, 64);
  // The secret is the last 43 characters; it may itself hold "_", so it is cut by length, not at the last "_".
  assert.ok(!issued.secretHash.includes(issued.token.slice(-43)));
  assert.match(issued.displayHint, /^hwf_api_d4e5f6…/);
  const parsed = parseIssuedToken(issued.token)!;
  assert.deepEqual([parsed.kind, parsed.id], ["API", id]);
  assert.ok(secretMatches(parsed.secret, issued.secretHash));
  assert.ok(!secretMatches(`${parsed.secret.slice(0, -1)}x`, issued.secretHash));
  assert.equal(parseIssuedToken("sk-something"), null);
  assert.equal(parseIssuedToken(`${issued.token}!`), null);
  const mcp = newIssuedToken("MCP", id);
  assert.equal(parseIssuedToken(mcp.token)?.kind, "MCP");
});

test("a key is refused when wrong, revoked, expired, of another kind or without the scope", () => {
  const issued = newIssuedToken("API", "b1b2c3d4e5f6a1b2c3d4e5f6");
  const parsed = parseIssuedToken(issued.token);
  const stored = { kind: "API" as const, secretHash: issued.secretHash, revokedAt: null, expiresAt: new Date("2026-12-31T00:00:00Z"), scopes: ["tasks:read"] };
  const now = new Date("2026-10-01T00:00:00Z");
  assert.equal(issuedKeyProblem(parsed, stored, now, "tasks:read"), null);
  assert.equal(issuedKeyProblem(parsed, stored, now, "tasks:write"), "scope");
  assert.equal(issuedKeyProblem(parsed, { ...stored, revokedAt: now }, now), "revoked");
  assert.equal(issuedKeyProblem(parsed, stored, new Date("2027-01-01T00:00:00Z")), "expired");
  assert.equal(issuedKeyProblem(parsed, { ...stored, kind: "MCP" }, now), "invalid");
  assert.equal(issuedKeyProblem(parsed, { ...stored, secretHash: "0".repeat(64) }, now), "invalid");
  assert.equal(issuedKeyProblem(parsed, null, now), "invalid");
  assert.deepEqual(validScopes("MCP", ["mcp:read", "mcp:read"]), ["mcp:read"]);
  assert.equal(validScopes("MCP", ["tasks:write"]), null, "an API scope is not an MCP scope");
  assert.equal(validScopes("API", []), null);
});

test("an external key is encrypted with authentication and shown only as its last four characters", () => {
  const secret = "a-server-secret-that-is-long-enough-123";
  const value = "sk-proj-abcdefghijklmnopqrstuvwxyz1234";
  const stored = encryptExternalKey(value, secret);
  assert.ok(!stored.includes(value) && stored.startsWith("v1."));
  assert.notEqual(encryptExternalKey(value, secret), stored, "a new IV every time");
  assert.equal(decryptExternalKey(stored, secret), value);
  assert.throws(() => decryptExternalKey(stored, "another-server-secret-that-is-long"));
  const [version, iv, tag, body] = stored.split(".");
  assert.throws(() => decryptExternalKey([version, iv, tag, `${body.slice(0, -2)}AA`].join("."), secret), "tampering is detected");
  assert.equal(externalHint(value), "••••1234");
  assert.equal(externalHint("short"), "••••");
});

test("refused-key texts: revoked, expired, wrong kind and invalid are told apart; invalid input is Swedish with the field", async () => {
  const { keyRefusalMessage } = await import("../lib/integrations/authenticate");
  const { describeIssue } = await import("../lib/tools/issue-text");
  const { z } = await import("zod");
  assert.match(keyRefusalMessage("revoked", "API"), /återkallad/);
  assert.match(keyRefusalMessage("expired", "MCP"), /gått ut/);
  assert.match(keyRefusalMessage("wrong-kind", "API"), /MCP-nyckel/);
  assert.equal(keyRefusalMessage("invalid", "API"), "Nyckeln är ogiltig.");
  const schema = z.object({ query: z.string().max(200), page: z.number().int().min(1), day: z.iso.date().optional(), name: z.string().min(1) });
  const text = (value: unknown) => { const r = schema.safeParse(value); return r.success ? "" : describeIssue(r.error.issues[0] as never); };
  assert.equal(text({ query: 5, page: 1, name: "a" }), "Fältet ”query” ska vara text.");
  assert.equal(text({ query: "x".repeat(201), page: 1, name: "a" }), "Fältet ”query” får vara högst 200 tecken.");
  assert.equal(text({ query: "x", page: 0, name: "a" }), "Fältet ”page” ska vara minst 1.");
  assert.equal(text({ query: "x", page: 1, day: "nej", name: "a" }), "Fältet ”day” ska vara ett datum (ÅÅÅÅ-MM-DD).");
  assert.equal(text({ query: "x", page: 1 }), "Fältet ”name” saknas.");
  const union = z.discriminatedUnion("action", [z.object({ action: z.literal("a") }), z.object({ action: z.literal("b") })]).safeParse({ action: "zzz" });
  assert.ok(!union.success && !/Expected|'a'/.test(describeIssue(union.error.issues[0] as never)));
});
