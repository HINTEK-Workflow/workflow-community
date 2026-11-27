import assert from "node:assert/strict";
import test from "node:test";
import { mayAuthenticate, sessionOutdated } from "../lib/auth/access";

test("a session from before a password change has ended; a later one and an account never changed live on", () => {
  const changed = new Date("2026-10-02T12:00:00Z");
  const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
  assert.equal(sessionOutdated(at("2026-10-02T11:59:00Z"), changed), true);
  assert.equal(sessionOutdated(at("2026-10-02T12:01:00Z"), changed), false);
  assert.equal(sessionOutdated(at("2026-10-02T11:59:00Z"), null), false);
});

test("the pilot list may sign in and reset its password only on the public HTTPS server", () => {
  const saved = { app: process.env.APP_URL, pilot: process.env.PILOT_ACCESS_EMAILS };
  try {
    process.env.PILOT_ACCESS_EMAILS = "pilot@example.invalid";
    process.env.APP_URL = "https://workflow.example.invalid";
    assert.equal(mayAuthenticate("Pilot@Example.invalid"), true);
    assert.equal(mayAuthenticate("someone@example.invalid"), false);
    process.env.APP_URL = "http://localhost:3001";
    assert.equal(mayAuthenticate("pilot@example.invalid"), false, "never on a loopback instance");
  } finally {
    process.env.APP_URL = saved.app; process.env.PILOT_ACCESS_EMAILS = saved.pilot;
    if (saved.app === undefined) delete process.env.APP_URL;
    if (saved.pilot === undefined) delete process.env.PILOT_ACCESS_EMAILS;
  }
});
