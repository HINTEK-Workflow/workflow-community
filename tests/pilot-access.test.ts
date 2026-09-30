import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedPrivateEmail, pilotAccessEmails } from "../lib/auth/access";

// The installation owner (INSTANCE_ADMIN_EMAIL; HINTEK: Daniel) may always sign in.
process.env.INSTANCE_ADMIN_EMAIL = "owner@instance.test";

test("pilot access: only on the public HTTPS server, only listed addresses, the owner always", () => {
  const saved = { APP_URL: process.env.APP_URL, PILOT_ACCESS_EMAILS: process.env.PILOT_ACCESS_EMAILS };
  try {
    process.env.PILOT_ACCESS_EMAILS = " Kund@Elkraft.se, fel-adress, annan@firma.se ";
    process.env.APP_URL = "https://workflow.hintek.se";
    assert.deepEqual([...pilotAccessEmails()].sort(), ["annan@firma.se", "kund@elkraft.se"]);
    assert.equal(isAllowedPrivateEmail("KUND@elkraft.se"), true);
    assert.equal(isAllowedPrivateEmail("okand@elkraft.se"), false);
    assert.equal(isAllowedPrivateEmail("owner@instance.test"), true);
    process.env.APP_URL = "http://localhost:3000";
    assert.equal(isAllowedPrivateEmail("kund@elkraft.se"), false, "never on loopback");
    process.env.APP_URL = "https://workflow.hintek.se";
    process.env.PILOT_ACCESS_EMAILS = "";
    assert.equal(isAllowedPrivateEmail("kund@elkraft.se"), false, "empty keeps the private test");
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("pilot access: addresses with s and dots are accepted, malformed ones are not", () => {
  const saved = { APP_URL: process.env.APP_URL, PILOT_ACCESS_EMAILS: process.env.PILOT_ACCESS_EMAILS };
  try {
    process.env.APP_URL = "https://workflow.hintek.se";
    process.env.PILOT_ACCESS_EMAILS = "sara.svensson@stromsund.se,utan-punkt@host,med mellanslag@firma.se";
    assert.deepEqual([...pilotAccessEmails()], ["sara.svensson@stromsund.se"]);
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
