import assert from "node:assert/strict";
import test from "node:test";
import { canAccessTest, isAllowedPrivateEmail, loginRuleAllows, mayAuthenticate, QA_ROLE_EMAILS } from "../lib/auth/access";
import { loginListMatches, normalizeLoginEntry, parseLoginList, readLoginRule, ruleAllows, setLoginRule } from "../lib/auth/login-rule";
import { registrationGateOpen, setInvitedMembers, setRegistrationGate } from "../lib/auth/registration-gate";

// "Vem får logga in" (2026-10-06): Alla / Endast / Alla utom blockerade.
process.env.INSTANCE_ADMIN_EMAIL = "owner@instance.test";
const NOT_CHOSEN = { mode: null, allow: [], block: [] } as const;

function withEnv(values: Record<string, string>, run: () => void) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, values);
    run();
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    setLoginRule({ ...NOT_CHOSEN, allow: [], block: [] });
    setRegistrationGate(false);
    setInvitedMembers([]);
  }
}

test("login lists: addresses and domains, one per line, the rest reported", () => {
  assert.equal(normalizeLoginEntry(" Kund@Firma.SE "), "kund@firma.se");
  assert.equal(normalizeLoginEntry("@Firma.se"), "@firma.se");
  assert.equal(normalizeLoginEntry("firma.se"), "@firma.se");
  assert.equal(normalizeLoginEntry("inte en adress"), null);
  assert.deepEqual(parseLoginList("a@b.se\n\n@c.se, a@b.se\nfel"), { entries: ["a@b.se", "@c.se"], invalid: ["fel"] });
  assert.equal(loginListMatches("Anna@C.se", ["@c.se"]), true);
  assert.equal(loginListMatches("anna@sub.c.se", ["@c.se"]), false, "a domain matches exactly, not its subdomains");
  assert.deepEqual(readLoginRule({ mode: "WRONG", allow: ["x"] }), { mode: null, allow: [], block: [] });
});

test("the three modes", () => {
  assert.equal(ruleAllows({ mode: "ALL", allow: [], block: ["a@b.se"] }, "a@b.se"), true);
  assert.equal(ruleAllows({ mode: "ONLY", allow: ["@b.se"], block: [] }, "a@b.se"), true);
  assert.equal(ruleAllows({ mode: "ONLY", allow: ["@b.se"], block: [] }, "a@c.se"), false);
  assert.equal(ruleAllows({ mode: "BLOCK", allow: [], block: ["a@b.se"] }, "a@b.se"), false);
  assert.equal(ruleAllows({ mode: "BLOCK", allow: [], block: ["a@b.se"] }, "c@b.se"), true);
  assert.equal(ruleAllows({ mode: null, allow: [], block: [] }, "anyone@x.se"), true, "not chosen refuses nobody by itself");
});

test("on the public server the chosen rule decides sign-in, sessions and the clear refusal; the owner always passes", () => {
  withEnv({ APP_URL: "https://workflow.example.com", PILOT_ACCESS_EMAILS: "pilot@firma.se" }, () => {
    // Not chosen yet: the older rule – the pilot list, and everyone while "Tillåt nya konton" is on.
    assert.equal(mayAuthenticate("pilot@firma.se"), true);
    assert.equal(mayAuthenticate("kund@firma.se"), false);
    assert.equal(loginRuleAllows("kund@firma.se"), true, "invitations are not refused before a choice");
    setRegistrationGate(true);
    assert.equal(mayAuthenticate("kund@firma.se"), true);

    setLoginRule({ mode: "ONLY", allow: ["@kund.se"], block: [] });
    assert.equal(mayAuthenticate("anna@kund.se"), true);
    assert.equal(mayAuthenticate("pilot@firma.se"), false, "the pilot list was only the starting value");
    assert.equal(mayAuthenticate("kund@firma.se"), false, "Tillåt nya konton no longer opens sign-in");
    assert.equal(mayAuthenticate("owner@instance.test"), true);
    assert.equal(loginRuleAllows("kund@firma.se"), false);
    assert.equal(canAccessTest({ email: "anna@kund.se", isActive: true }), true);

    setLoginRule({ mode: "BLOCK", allow: [], block: ["spärrad@kund.se", "owner@instance.test"] });
    assert.equal(canAccessTest({ email: "spärrad@kund.se", isActive: true }), false, "an existing session is refused at the next check");
    assert.equal(isAllowedPrivateEmail("annan@kund.se"), true);
    assert.equal(mayAuthenticate("owner@instance.test"), true, "the owner can never be locked out");

    setLoginRule({ mode: "ALL", allow: [], block: [] });
    assert.equal(mayAuthenticate("vem-som-helst@x.se"), true);
  });
});

test("an invited active member may sign in on a closed installation; registration stays closed for everyone else", () => {
  withEnv({ APP_URL: "https://arbete.example", PILOT_ACCESS_EMAILS: "" }, () => {
    assert.equal(mayAuthenticate("anna@kund.se"), false, "before the invitation is accepted");
    setInvitedMembers([" Anna@Kund.se "]);
    assert.equal(mayAuthenticate("anna@kund.se"), true);
    assert.equal(canAccessTest({ email: "ANNA@kund.se", isActive: true }), true, "the session holds too");
    assert.equal(canAccessTest({ email: "anna@kund.se", isActive: false }), false, "a deactivated account does not");
    assert.equal(mayAuthenticate("annan@kund.se"), false, "nobody else gets in");
    assert.equal(registrationGateOpen(), false, "and new accounts stay closed");
    setInvitedMembers([]);
    assert.equal(canAccessTest({ email: "anna@kund.se", isActive: true }), false, "removed from the company: out at the next check");
    // A chosen rule decides on its own.
    setInvitedMembers(["anna@kund.se"]);
    setLoginRule({ mode: "ONLY", allow: ["@annat.se"], block: [] });
    assert.equal(mayAuthenticate("anna@kund.se"), false);
  });
});

test("loopback: an invited real address stays out, and synthetic QA identities are not widened", () => {
  withEnv({ APP_URL: "http://localhost:3004", KFID_LOCAL_ROLE_QA: "true", DATABASE_URL: "postgresql://t:t@localhost:5432/kfid_v3_test", INVITATION_DELIVERY_ENABLED: "false" }, () => {
    setInvitedMembers(["riktig@firma.se", "inbjuden@role-test.invalid"]);
    assert.equal(mayAuthenticate("riktig@firma.se"), false, "the private-test rule holds");
    assert.equal(mayAuthenticate("inbjuden@role-test.invalid"), true, "a synthetic address may, as with open registration");
    assert.equal(mayAuthenticate(QA_ROLE_EMAILS.worker), false, "a QA role keeps its own entrance");
    assert.equal(canAccessTest({ email: QA_ROLE_EMAILS.worker, isActive: true }), true);
  });
});

test("loopback: never a real identity, and the QA identities keep working until a rule says otherwise", () => {
  withEnv({ APP_URL: "http://localhost:3004", KFID_LOCAL_ROLE_QA: "true", DATABASE_URL: "postgresql://t:t@localhost:5432/kfid_v3_test", INVITATION_DELIVERY_ENABLED: "false" }, () => {
    assert.equal(canAccessTest({ email: QA_ROLE_EMAILS.worker, isActive: true }), true);
    setLoginRule({ mode: "ALL", allow: [], block: [] });
    assert.equal(mayAuthenticate("riktig@firma.se"), false);
    assert.equal(canAccessTest({ email: QA_ROLE_EMAILS.worker, isActive: true }), true);
    setLoginRule({ mode: "BLOCK", allow: [], block: [QA_ROLE_EMAILS.worker] });
    assert.equal(canAccessTest({ email: QA_ROLE_EMAILS.worker, isActive: true }), false);
    assert.equal(canAccessTest({ email: QA_ROLE_EMAILS.owner, isActive: true }), true);
    setLoginRule({ mode: "ONLY", allow: ["riktig@firma.se", "@role-test.invalid"], block: [] });
    assert.equal(mayAuthenticate("riktig@firma.se"), false, "a real address stays out on loopback even when listed");
    assert.equal(canAccessTest({ email: QA_ROLE_EMAILS.superadmin, isActive: true }), true);
  });
});
