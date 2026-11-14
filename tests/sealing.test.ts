import assert from "node:assert/strict";
import test from "node:test";
import { encryptExternalKey } from "../lib/integrations/keys";
import { sealPassword } from "../lib/mail/settings";
import { sealPushKey } from "../lib/push/settings";
import { keyId, open, ringSecrets, seal, sealedKeyId } from "../lib/security/sealing";

// Gemensam försegling med nyckelring (2026-10-25): v2 bound to purpose and context, the ring opens with any of its
// secrets and seals with the current one, and every older v1 sealing still opens. Placeholder secrets only.
const OLD = "an-old-sealing-secret-for-the-test-0000000000";
const NEW = "a-new-sealing-secret-for-the-test-11111111111";
const AUTH = "the-session-secret-for-the-test-222222222222";
const before = { current: OLD, previous: [] };
const rotated = { current: NEW, previous: [OLD, AUTH] };

test("v2: sealed with the current secret, named by its id, opened only with the same purpose and context", () => {
  const sealed = seal("central", "sk_test_value", "stripe.secretKey", rotated);
  assert.match(sealed, /^v2\.[0-9a-f]{8}\./);
  assert.equal(sealedKeyId(sealed), keyId(NEW));
  assert.equal(sealed.includes("sk_test_value"), false);
  assert.deepEqual(open("central", sealed, "stripe.secretKey", rotated), { ok: true, value: "sk_test_value", current: true });
  assert.deepEqual(open("central", sealed, "smtp.password", rotated), { ok: false, reason: "unreadable" }, "another field's context does not open it");
  assert.deepEqual(open("totp", sealed, "stripe.secretKey", rotated), { ok: false, reason: "unreadable" }, "another purpose does not open it");
});

test("a rotation: what the old secret sealed still opens, and is marked for resealing", () => {
  const sealed = seal("totp", "JBSWY3DPEHPK3PXP", "user-1", before);
  assert.deepEqual(open("totp", sealed, "user-1", rotated), { ok: true, value: "JBSWY3DPEHPK3PXP", current: false });
  assert.deepEqual(open("totp", sealed, "user-1", { current: NEW, previous: [] }), { ok: false, reason: "unreadable" }, "once the old secret is gone it cannot be opened");
  assert.throws(() => seal("totp", "x", "user-1", { current: "short", previous: [] }), /hemlighet/);
});

test("the older v1 sealings open with any secret in the ring", () => {
  // Servernycklar and SMTP (label), Microsoft (prefix), webbpush (own label), the AI keys (HKDF), TOTP and the register.
  assert.deepEqual(open("central", sealPassword("smtp-pass", OLD), "smtp.password", rotated), { ok: true, value: "smtp-pass", current: false });
  assert.deepEqual(open("central", sealPassword("ms-secret", `microsoft:${AUTH}`), "microsoft.clientSecret", rotated), { ok: true, value: "ms-secret", current: false });
  assert.deepEqual(open("central", sealPushKey("vapid-private", OLD), "push.privateKey", rotated), { ok: true, value: "vapid-private", current: false });
  assert.deepEqual(open("central", encryptExternalKey("sk-openai-placeholder", AUTH), "openai.apiKey", rotated), { ok: true, value: "sk-openai-placeholder", current: false });
  assert.deepEqual(open("totp", sealPassword("TOTPSECRET", `totp:${OLD}`), "user-1", rotated), { ok: true, value: "TOTPSECRET", current: false });
  assert.deepEqual(open("staff-register", sealPassword("19121212-1212", `staff-register:${OLD}`), "org-1", rotated), { ok: true, value: "19121212-1212", current: false });
  assert.deepEqual(open("integration-key", encryptExternalKey("fortnox-token", OLD), "", rotated), { ok: true, value: "fortnox-token", current: false });
  // A v1 value sealed under a secret the ring does not hold: unreadable, never guessed.
  assert.deepEqual(open("central", sealPassword("x", "a-secret-nobody-has-any-more-333333333333"), "smtp.password", rotated), { ok: false, reason: "unreadable" });
});

test("a changed byte, an unknown kid or a foreign shape is refused", () => {
  const sealed = seal("central", "value", "scb.apiKey", rotated);
  const parts = sealed.split(".");
  // Flip a real byte (not the last base64 characters, whose spare bits the decoder ignores: the old way sometimes changed nothing).
  const bytes = Buffer.from(parts[4], "base64url");
  bytes[0] ^= 0xff;
  const flipped = [...parts.slice(0, 4), bytes.toString("base64url")].join(".");
  assert.equal(open("central", flipped, "scb.apiKey", rotated).ok, false);
  assert.equal(open("central", ["v2", "00000000", ...parts.slice(2)].join("."), "scb.apiKey", rotated).ok, false);
  assert.deepEqual(open("central", "plain-text", "scb.apiKey", rotated), { ok: false, reason: "format" });
  assert.deepEqual(open("central", "", "scb.apiKey", rotated), { ok: false, reason: "empty" });
});

test("the ring lists each usable secret once, current first", () => {
  assert.deepEqual(ringSecrets({ current: NEW, previous: [OLD, NEW, "", "short", AUTH] }), [NEW, OLD, AUTH]);
  assert.notEqual(keyId(NEW), keyId(OLD));
  assert.equal(keyId(NEW).length, 8);
});
