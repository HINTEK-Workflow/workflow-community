import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { approvedScopes, formatToken, isOAuthAccessToken, parseToken, pkceMatches, redirectMatches, requestedScopes, validChallenge, validRedirectUri } from "../lib/oauth/rules";

test("OAuth scopes: reading is always part of a connection, unknown scopes are dropped, nothing asked means read and write", () => {
  assert.deepEqual(requestedScopes(undefined), ["mcp:read", "mcp:write"]);
  assert.deepEqual(requestedScopes("mcp:write admin:all"), ["mcp:read", "mcp:write"]);
  assert.deepEqual(requestedScopes("mcp:read mcp:delete"), ["mcp:read", "mcp:delete"]);
  assert.deepEqual(approvedScopes(["mcp:delete", "mcp:write"], ["mcp:read", "mcp:write"]), ["mcp:read", "mcp:write"], "never more than the app asked for");
  assert.deepEqual(approvedScopes([], ["mcp:read", "mcp:write"]), ["mcp:read"]);
});

test("OAuth redirect addresses: https, http only on this computer, an app's own scheme; never script, data or fragments", () => {
  assert.ok(validRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect"));
  assert.ok(validRedirectUri("http://127.0.0.1:33418/callback"));
  assert.ok(validRedirectUri("cursor://anysphere.cursor-retrieval/oauth/callback"));
  assert.equal(validRedirectUri("http://evil.example/callback"), false);
  assert.equal(validRedirectUri("javascript:alert(1)"), false);
  assert.equal(validRedirectUri("data:text/html,x"), false);
  assert.equal(validRedirectUri("https://chatgpt.com/cb#frag"), false);
  assert.equal(validRedirectUri("https://user:pw@chatgpt.com/cb"), false);
  assert.ok(redirectMatches(["https://chatgpt.com/cb"], "https://chatgpt.com/cb"));
  assert.equal(redirectMatches(["https://chatgpt.com/cb"], "https://chatgpt.com/cb2"), false);
  assert.ok(redirectMatches(["http://127.0.0.1:1000/cb"], "http://127.0.0.1:5555/cb"), "a loopback address may use any port");
  assert.equal(redirectMatches(["http://127.0.0.1:1000/cb"], "http://127.0.0.1:5555/other"), false);
});

test("OAuth PKCE: only the verifier that hashes to the challenge passes", () => {
  const verifier = "a".repeat(20) + "B".repeat(23) + "-._~";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  assert.ok(validChallenge(challenge));
  assert.ok(pkceMatches(verifier, challenge));
  assert.equal(pkceMatches(verifier + "x", challenge), false);
  assert.equal(pkceMatches("short", challenge), false);
});

test("OAuth tokens: access and refresh tokens are told apart and never mistaken for MCP keys", () => {
  const id = "c".repeat(25); const secret = "s".repeat(43);
  const access = formatToken("ACCESS", id, secret);
  assert.deepEqual(parseToken(access), { kind: "ACCESS", id, secret });
  assert.equal(parseToken(formatToken("REFRESH", id, secret))?.kind, "REFRESH");
  assert.ok(isOAuthAccessToken(access));
  assert.equal(isOAuthAccessToken(`hwf_mcp_${id}_${secret}`), false);
  assert.equal(parseToken(`hwf_mcp_${id}_${secret}`), null);
});
