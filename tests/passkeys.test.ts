import assert from "node:assert/strict";
import test from "node:test";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import {
  challengeUsable,
  cleanPasskeyName,
  defaultPasskeyName,
  mayRemoveSignInWay,
  parsePasskeyResponse,
  PASSKEY_ALGORITHMS,
  PASSKEY_RESPONSE_MAX_BYTES,
  relyingParty,
  signInWaysLeft,
} from "../lib/auth/passkey-core";
import { strongSignInMethod, SIGN_IN_METHOD_LABELS } from "../lib/auth/session-rules";
import { SECURITY_EVENT_TYPES } from "../lib/security/security-log-core";
import { SoftAuthenticator } from "./helpers/soft-authenticator";

test("the relying party is the app's own host; NEXTAUTH_URL adds an origin only on the same host", () => {
  assert.deepEqual(relyingParty("https://workflow.example.invalid/x"), { rpID: "workflow.example.invalid", origins: ["https://workflow.example.invalid"] });
  assert.deepEqual(relyingParty("http://localhost:3000", "http://localhost:3002"), { rpID: "localhost", origins: ["http://localhost:3000", "http://localhost:3002"] });
  assert.deepEqual(relyingParty("https://a.example.invalid", "https://evil.example.invalid").origins, ["https://a.example.invalid"], "another host never becomes an accepted origin");
  assert.deepEqual(relyingParty("https://a.example.invalid", "not a url").origins, ["https://a.example.invalid"]);
});

test("a challenge is used only for its own purpose, by its own person and before it expires", () => {
  const now = Date.parse("2026-10-11T10:00:00Z");
  const later = new Date(now + 60_000);
  assert.equal(challengeUsable({ purpose: "login", userId: null, expiresAt: later }, "login", null, now), true);
  assert.equal(challengeUsable({ purpose: "login", userId: null, expiresAt: new Date(now) }, "login", null, now), false, "expired at the second");
  assert.equal(challengeUsable({ purpose: "register", userId: "u1", expiresAt: later }, "login", null, now), false, "a registration challenge never signs in");
  assert.equal(challengeUsable({ purpose: "reauth", userId: "u1", expiresAt: later }, "reauth", "u1", now), true);
  assert.equal(challengeUsable({ purpose: "reauth", userId: "u1", expiresAt: later }, "reauth", "u2", now), false, "never another person's");
  assert.equal(challengeUsable({ purpose: "register", userId: "u1", expiresAt: later }, "register", null, now), false);
  assert.equal(challengeUsable({ purpose: "login", userId: "u1", expiresAt: later }, "login", null, now), false, "a login challenge belongs to nobody");
  assert.equal(challengeUsable(null, "login", null, now), false);
});

test("names are one clean line of at most 60 characters, with a default from the browser", () => {
  assert.equal(cleanPasskeyName("  Jobb\ndatorn\t \u0007 "), "Jobb datorn");
  assert.equal(cleanPasskeyName("x".repeat(80)).length, 60);
  assert.equal(cleanPasskeyName(null), "");
  assert.equal(defaultPasskeyName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0"), "Passkey – Edge på Windows");
  assert.equal(defaultPasskeyName(""), "Passkey");
});

test("the last way to sign in can never be removed", () => {
  assert.equal(signInWaysLeft({ hasPassword: true, linkedAccounts: 1, passkeys: 2 }), 4);
  assert.equal(mayRemoveSignInWay({ hasPassword: false, linkedAccounts: 0, passkeys: 1 }), false, "the only passkey");
  assert.equal(mayRemoveSignInWay({ hasPassword: false, linkedAccounts: 1, passkeys: 0 }), false, "the only linked account");
  assert.equal(mayRemoveSignInWay({ hasPassword: true, linkedAccounts: 0, passkeys: 1 }), true);
  assert.equal(mayRemoveSignInWay({ hasPassword: false, linkedAccounts: 0, passkeys: 2 }), true);
});

test("a browser answer is parsed only when small and shaped like a credential", () => {
  assert.equal(parsePasskeyResponse('{"id":"abc","type":"public-key"}')?.id, "abc");
  assert.equal(parsePasskeyResponse('{"id":"abc","type":"password"}'), null);
  assert.equal(parsePasskeyResponse("not json"), null);
  assert.equal(parsePasskeyResponse(undefined), null);
  assert.equal(parsePasskeyResponse(JSON.stringify({ id: "a", type: "public-key", pad: "x".repeat(PASSKEY_RESPONSE_MAX_BYTES) })), null);
});

test("passkey, Google and Microsoft meet a two-step requirement; a bare password does not", () => {
  assert.equal(strongSignInMethod("passkey"), true);
  assert.equal(strongSignInMethod("google"), true);
  assert.equal(strongSignInMethod("microsoft"), true);
  assert.equal(strongSignInMethod("password"), false);
  assert.equal(strongSignInMethod("password+totp"), false, "TOTP is checked through the user's own setting, not the method");
  assert.equal(strongSignInMethod(undefined), false);
  assert.equal(SIGN_IN_METHOD_LABELS.passkey, "Passkey");
  for (const type of ["passkey_added", "passkey_removed", "microsoft_linked", "microsoft_unlinked", "microsoft_tenant_policy"]) assert.ok(type in SECURITY_EVENT_TYPES, type);
});

test("a registered passkey verifies with user verification and refuses a foreign origin, no fingerprint and a replay", async () => {
  const { rpID, origins } = relyingParty("http://localhost:3000");
  const device = new SoftAuthenticator(rpID, origins[0]);
  const registration = await generateRegistrationOptions({ rpName: "Workflow", rpID, userName: "anna@example.invalid", userID: new TextEncoder().encode("u1"), authenticatorSelection: { residentKey: "required", userVerification: "required" }, supportedAlgorithmIDs: PASSKEY_ALGORITHMS });
  const created = await verifyRegistrationResponse({ response: device.register(registration), expectedChallenge: registration.challenge, expectedOrigin: origins, expectedRPID: rpID, requireUserVerification: true, supportedAlgorithmIDs: PASSKEY_ALGORITHMS });
  assert.equal(created.verified, true);
  const credential = { ...created.registrationInfo!.credential };
  assert.equal(credential.id, device.id);

  const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
  const answer = device.authenticate(options);
  const ok = await verifyAuthenticationResponse({ response: answer, expectedChallenge: options.challenge, expectedOrigin: origins, expectedRPID: rpID, credential, requireUserVerification: true });
  assert.equal(ok.verified, true);
  assert.equal(ok.authenticationInfo.userVerified, true);
  credential.counter = ok.authenticationInfo.newCounter;

  const other = await generateAuthenticationOptions({ rpID });
  await assert.rejects(verifyAuthenticationResponse({ response: device.authenticate(other, { origin: "https://evil.example.invalid" }), expectedChallenge: other.challenge, expectedOrigin: origins, expectedRPID: rpID, credential, requireUserVerification: true }), "a phishing site's origin is refused");
  await assert.rejects(verifyAuthenticationResponse({ response: device.authenticate(other), expectedChallenge: options.challenge, expectedOrigin: origins, expectedRPID: rpID, credential, requireUserVerification: true }), "another ceremony's challenge is refused");
  await assert.rejects(verifyAuthenticationResponse({ response: device.authenticate(other, { counter: 1 }), expectedChallenge: other.challenge, expectedOrigin: origins, expectedRPID: rpID, credential, requireUserVerification: true }), "a counter that goes backwards is refused");
  device.userVerified = false;
  await assert.rejects(verifyAuthenticationResponse({ response: device.authenticate(other), expectedChallenge: other.challenge, expectedOrigin: origins, expectedRPID: rpID, credential, requireUserVerification: true }), "no fingerprint, face or PIN is refused");
});
