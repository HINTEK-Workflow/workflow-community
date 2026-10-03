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
  assert.ok(!issued.secretHash.includes(issued.token.split("_").at(-1)!));
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
