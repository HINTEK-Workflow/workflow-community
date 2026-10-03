import assert from "node:assert/strict";
import test from "node:test";
import { effectiveMailConfig, mailSettingsInput, openPassword, publicMailSettings, sealPassword } from "../lib/mail/settings";

// E-post (2026-09-30): what is saved in the app wins, the rest falls back to .env; the password never leaves the server.
const env = {
  APP_URL: "https://workflow.example.test", SMTP_HOST: "smtp.env.test", SMTP_PORT: 465, SMTP_SECURE: true, SMTP_USER: "env-user",
  SMTP_PASS: "env-pass", MAIL_FROM_NAME: "Env", MAIL_FROM_ADDRESS: "env@example.test", INVITATION_DELIVERY_ENABLED: true,
};
const options = { password: "", loopbackQa: false };

test("nothing saved in the app: the server's .env applies unchanged", () => {
  const config = effectiveMailConfig({}, env, options);
  assert.equal(config.source, "server");
  assert.deepEqual(config.transport, { host: "smtp.env.test", port: 465, secure: true, user: "env-user", password: "env-pass" });
  assert.deepEqual(config.delivery, { invitations: true, roundReminders: false, alerts: false });
});

test("saved in the app: the app's server, sender and switches win", () => {
  const config = effectiveMailConfig({ host: "smtp.app.test", port: 587, secure: false, user: "app", fromName: "App", fromAddress: "app@example.test", invitations: false, roundReminders: true }, env, { ...options, password: "app-pass" });
  assert.equal(config.source, "app");
  assert.deepEqual(config.transport, { host: "smtp.app.test", port: 587, secure: false, user: "app", password: "app-pass" });
  assert.deepEqual(config.from, { name: "App", address: "app@example.test" });
  assert.deepEqual(config.delivery, { invitations: false, roundReminders: true, alerts: false });
});

test("saved without a password for the .env account: the .env password still applies, never for another account", () => {
  assert.equal(effectiveMailConfig({ host: "smtp.env.test", user: "env-user", alerts: true }, env, options).transport.password, "env-pass");
  assert.equal(effectiveMailConfig({ host: "smtp.env.test", user: "env-user" }, env, { ...options, password: "app-pass" }).transport.password, "app-pass");
  assert.equal(effectiveMailConfig({ host: "smtp.other.test", user: "env-user" }, env, options).transport.password, "");
  assert.equal(effectiveMailConfig({ host: "smtp.env.test", user: "someone-else" }, env, options).transport.password, "");
});

test("a loopback QA instance never sends the switched mail, whatever is saved", () => {
  const config = effectiveMailConfig({ host: "smtp.app.test", invitations: true, roundReminders: true, alerts: true }, { ...env, APP_URL: "http://localhost:3001" }, { password: "", loopbackQa: true });
  assert.deepEqual(config.delivery, { invitations: false, roundReminders: false, alerts: false });
  assert.ok(config.blockedReason);
});

test("the page sees whether a password is set, never the password", () => {
  const view = publicMailSettings(effectiveMailConfig({ host: "smtp.app.test" }, env, { ...options, password: "hemligt" }));
  assert.equal(view.hasPassword, true);
  assert.equal(JSON.stringify(view).includes("hemligt"), false);
});

test("the sealed password opens only with the same secret", () => {
  const sealed = sealPassword("smtp-lösen", "secret-one-with-enough-length-0123456789");
  assert.equal(sealed.includes("smtp-lösen"), false);
  assert.equal(openPassword(sealed, "secret-one-with-enough-length-0123456789"), "smtp-lösen");
  assert.equal(openPassword(sealed, "another-secret-with-enough-length-01234"), "");
});

test("alerts need a recipient", () => {
  const base = { host: "smtp.app.test", port: 587, secure: false, user: "", fromName: "W", fromAddress: "w@example.test", invitations: false, roundReminders: false, alerts: true, alertEmail: "" };
  assert.equal(mailSettingsInput.safeParse(base).success, false);
  assert.equal(mailSettingsInput.safeParse({ ...base, alertEmail: "drift@example.test" }).success, true);
});
