import assert from "node:assert/strict";
import test from "node:test";
import { metaAlertAction, metaAlertState, metaAlertText } from "../lib/meta/alerts";

// Larm för Facebook och Instagram (2026-11-10): a week before the token or Meta's data access runs out, and when it has
// stopped working; one mark per company, state and token.
const day = 86_400_000;
const now = new Date("2026-11-10T06:45:00Z");
const at = (days: number) => new Date(now.getTime() + days * day);

test("the state: nothing far ahead, expiring within a week, invalid when Meta says so or a date has passed", () => {
  assert.equal(metaAlertState({ status: "ok", userTokenExpiresAt: at(40), dataAccessExpiresAt: at(80) }, now), null);
  assert.equal(metaAlertState({ status: "ok", userTokenExpiresAt: at(6), dataAccessExpiresAt: at(80) }, now), "expiring");
  assert.equal(metaAlertState({ status: "action", userTokenExpiresAt: at(40), dataAccessExpiresAt: at(7) }, now), "expiring", "the data access counts too");
  assert.equal(metaAlertState({ status: "invalid", userTokenExpiresAt: at(40), dataAccessExpiresAt: at(80) }, now), "invalid");
  assert.equal(metaAlertState({ status: "ok", userTokenExpiresAt: at(-1), dataAccessExpiresAt: null }, now), "invalid");
  assert.equal(metaAlertState({ status: "ok", userTokenExpiresAt: null, dataAccessExpiresAt: null }, now), null);
});

test("one mark per company, state and token; short plain texts", () => {
  assert.equal(metaAlertAction("org1", "expiring", "v3.key.iv.tag.abcdefghijklmnopqrstuvwxyz"), "meta_alert:org1:expiring:klmnopqrstuvwxyz");
  assert.notEqual(metaAlertAction("org1", "expiring", "token-one-xxxxxxxxxxxxxxxx"), metaAlertAction("org1", "expiring", "token-two-yyyyyyyyyyyyyyyy"));
  const soon = metaAlertText("expiring", { status: "ok", userTokenExpiresAt: at(5), dataAccessExpiresAt: at(3), pageName: "Elfirma AB" });
  assert.equal(soon.subject, "Facebook och Instagram: token går ut snart");
  assert.equal(soon.line, "Token för Facebook och Instagram (Elfirma AB) går ut 2026-11-13.");
  assert.match(metaAlertText("invalid", { status: "invalid", userTokenExpiresAt: null, dataAccessExpiresAt: null, pageName: null }).line, /fungerar inte längre/);
});
