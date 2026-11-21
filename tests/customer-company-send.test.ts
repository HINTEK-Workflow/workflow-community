import assert from "node:assert/strict";
import test from "node:test";
import { CLOUD_NEEDS_PAYMENT, ownerInvitationSendRefusal, storageChangeRefusal } from "../lib/kfid/customer-company-list";

// Skicka admininbjudan: the rule the route asks inside the invitation's row lock.
const now = new Date("2026-11-01T12:00:00.000Z");
const state = { companyActive: true, hasAdmin: false, status: "PREPARED", sentAt: null, resend: false, now };

test("a prepared invitation may go out once, in an active company without an admin", () => {
  assert.equal(ownerInvitationSendRefusal(state), null);
  assert.match(ownerInvitationSendRefusal({ ...state, companyActive: false }) ?? "", /pausat/);
  assert.match(ownerInvitationSendRefusal({ ...state, hasAdmin: true }) ?? "", /redan en aktiv administratör/);
  assert.match(ownerInvitationSendRefusal({ ...state, status: "REVOKED" }) ?? "", /kan inte skickas/);
});

test("a double click or a second window sends one mail; a resend is asked for and waits", () => {
  const sent = { ...state, status: "PENDING", sentAt: new Date(now.getTime() - 60_000) };
  assert.match(ownerInvitationSendRefusal(sent) ?? "", /redan skickad/, "the second of two sends");
  assert.match(ownerInvitationSendRefusal({ ...sent, resend: true }) ?? "", /nyss/, "too soon");
  assert.equal(ownerInvitationSendRefusal({ ...sent, resend: true, sentAt: new Date(now.getTime() - 6 * 60_000) }), null);
});

test("storage: Local to Cloud waits for payment only where billing exists; other changes pass to the route's own checks", () => {
  assert.equal(storageChangeRefusal("LOCAL", "HINTEK_CLOUD", true), CLOUD_NEEDS_PAYMENT, "Cloud is unchanged");
  assert.equal(storageChangeRefusal("LOCAL", "HINTEK_CLOUD", false), null, "no billing, nothing to pay");
  assert.equal(storageChangeRefusal("HINTEK_CLOUD", "LOCAL", true), null);
  assert.equal(storageChangeRefusal("LOCAL", "LOCAL", true), null);
});
