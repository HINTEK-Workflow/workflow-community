import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedPrivateEmail, pilotAccessEmails } from "../lib/auth/access";

// The installation owner (INSTANCE_ADMIN_EMAIL) may always sign in.
process.env.INSTANCE_ADMIN_EMAIL = "owner@instance.test";

test("pilot access: only on the public HTTPS server, only listed addresses, the owner always", () => {
  const saved = { APP_URL: process.env.APP_URL, PILOT_ACCESS_EMAILS: process.env.PILOT_ACCESS_EMAILS };
  try {
    process.env.PILOT_ACCESS_EMAILS = " Kund@Elkraft.test, fel-adress, annan@firma.test ";
    process.env.APP_URL = "https://workflow.hintek.se";
    assert.deepEqual([...pilotAccessEmails()].sort(), ["annan@firma.test", "kund@elkraft.test"]);
    assert.equal(isAllowedPrivateEmail("KUND@elkraft.test"), true);
    assert.equal(isAllowedPrivateEmail("okand@elkraft.test"), false);
    assert.equal(isAllowedPrivateEmail("owner@instance.test"), true);
    process.env.APP_URL = "http://localhost:3000";
    assert.equal(isAllowedPrivateEmail("kund@elkraft.test"), false, "never on loopback");
    process.env.APP_URL = "https://workflow.hintek.se";
    process.env.PILOT_ACCESS_EMAILS = "";
    assert.equal(isAllowedPrivateEmail("kund@elkraft.test"), false, "empty keeps the private test");
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("pilot access: addresses with s and dots are accepted, malformed ones are not", () => {
  const saved = { APP_URL: process.env.APP_URL, PILOT_ACCESS_EMAILS: process.env.PILOT_ACCESS_EMAILS };
  try {
    process.env.APP_URL = "https://workflow.hintek.se";
    process.env.PILOT_ACCESS_EMAILS = "sara.svensson@stromsund.test,utan-punkt@host,med mellanslag@firma.test";
    assert.deepEqual([...pilotAccessEmails()], ["sara.svensson@stromsund.test"]);
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
