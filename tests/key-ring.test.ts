import assert from "node:assert/strict";
import test from "node:test";

// Nyckelringen (2026-10-25): exactly the secret every module used before the ring, plus only what is named in
// INTEGRATION_KEYS_SECRET_PREVIOUS – never AUTH_SECRET on its own, which could bring an old, unreadable key back to life
// and let it take precedence over the one that applies. Placeholder secrets only; the environment is set before import.
process.env.AUTH_SECRET = "the-session-secret-for-the-ring-test-000000";
process.env.INTEGRATION_KEYS_SECRET = "the-sealing-secret-for-the-ring-test-11111";
process.env.INTEGRATION_KEYS_SECRET_PREVIOUS = " an-earlier-sealing-secret-for-the-test-222 ,an-older-sealing-secret-for-the-test-3333 ";

test("the ring: the sealing secret, then only the named previous ones", async () => {
  const { keyRing, keyRingStatus, ringHashSecrets } = await import("../lib/security/key-ring");
  assert.deepEqual(keyRing(), {
    current: "the-sealing-secret-for-the-ring-test-11111",
    previous: ["an-earlier-sealing-secret-for-the-test-222", "an-older-sealing-secret-for-the-test-3333"],
  });
  assert.equal(ringHashSecrets().includes(process.env.AUTH_SECRET!), false, "the session secret is never an opener by itself");
  const status = keyRingStatus();
  assert.equal(status.separate, true);
  assert.equal(status.previousCount, 2);
  assert.equal(JSON.stringify(status).includes("secret-for"), false, "the status names ids and counts, never a secret");
});
