import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { MICROSOFT_MFA_METHOD, microsoftMfaAsserted, microsoftMfaCounts, microsoftSecondStep } from "../lib/auth/microsoft-core";
import { SIGN_IN_METHOD_LABELS, strongSignInMethod } from "../lib/auth/session-rules";
import { withPhoneHint } from "../lib/auth/passkey-hints";

// Microsofts tvåsteg räknas som Workflows (2026-11-27): only Microsoft's "mfa" in the verified ID token's amr, with the
// product owner's switch on; everything else asks for Workflow's own code exactly as before.
const TID = "72f988bf-86f1-41af-91ab-2d7cd011db47";
const OID = "00000000-0000-0000-66f3-3332eca7ea81";
const withAmr = (amr: unknown) => ({ tid: TID, oid: OID, amr });

test("amr with mfa is Microsoft's word that multi-factor was done", () => {
  assert.equal(microsoftMfaAsserted(withAmr(["pwd", "mfa"])), true, "password + Authenticator");
  assert.equal(microsoftMfaAsserted(withAmr(["rsa", "ngcmfa", "mfa"])), true, "Authenticator push (number matching)");
  assert.equal(microsoftMfaAsserted(withAmr(["fido", "mfa"])), true, "a passkey at Microsoft");
});

test("no amr, no mfa or another shape is no word at all", () => {
  assert.equal(microsoftMfaAsserted({ tid: TID, oid: OID }), false, "amr is not in a v2.0 ID token unless the app registration asks for it");
  assert.equal(microsoftMfaAsserted(withAmr(["pwd"])), false, "a password only");
  assert.equal(microsoftMfaAsserted(withAmr(["wia"])), false, "Windows integrated sign-in only");
  assert.equal(microsoftMfaAsserted(withAmr(["ngcmfa"])), false, "only the exact word mfa counts");
  assert.equal(microsoftMfaAsserted(withAmr(["MFA"])), false, "case matters");
  assert.equal(microsoftMfaAsserted(withAmr("mfa")), false, "a string is not the documented list");
  assert.equal(microsoftMfaAsserted(withAmr(["pwd", 1, "mfa"])), false, "a list with other than strings");
  assert.equal(microsoftMfaAsserted(withAmr({ 0: "mfa", length: 1 })), false);
  assert.equal(microsoftMfaAsserted(withAmr(Array.from({ length: 30 }, () => "mfa"))), false, "an absurdly long list");
  assert.equal(microsoftMfaAsserted(undefined), false);
  assert.equal(microsoftMfaAsserted(null), false);
});

test("the switch: on lets Microsoft's word count, off never", () => {
  assert.equal(microsoftMfaCounts(withAmr(["mfa"]), true), true);
  assert.equal(microsoftMfaCounts(withAmr(["mfa"]), false), false, "switched off by the product owner");
});

test("the second step of a Microsoft sign-in", () => {
  const mfa = withAmr(["pwd", "mfa"]);
  const pwd = withAmr(["pwd"]);
  // Two-step on in Workflow.
  assert.equal(microsoftSecondStep({ codeVerified: false, twoFactorOn: true, settingOn: true, claims: mfa }), "mfa", "amr with mfa → let in without Workflow's code");
  assert.equal(microsoftSecondStep({ codeVerified: false, twoFactorOn: true, settingOn: true, claims: pwd }), "code", "without mfa → the code");
  assert.equal(microsoftSecondStep({ codeVerified: false, twoFactorOn: true, settingOn: true, claims: { tid: TID, oid: OID } }), "code", "without amr → the code");
  assert.equal(microsoftSecondStep({ codeVerified: false, twoFactorOn: true, settingOn: false, claims: mfa }), "code", "switched off → the code");
  assert.equal(microsoftSecondStep({ codeVerified: false, twoFactorOn: true, settingOn: true, claims: undefined }), "code");
  // After Workflow's own code: nothing more, and amr is not read (the cookie's copy has none anyway).
  assert.equal(microsoftSecondStep({ codeVerified: true, twoFactorOn: true, settingOn: true, claims: mfa }), "none");
  // Two-step off in Workflow: no code either way, but Microsoft's word still makes the session "microsoft+mfa".
  assert.equal(microsoftSecondStep({ codeVerified: false, twoFactorOn: false, settingOn: true, claims: mfa }), "mfa");
  assert.equal(microsoftSecondStep({ codeVerified: false, twoFactorOn: false, settingOn: true, claims: pwd }), "none");
  assert.equal(microsoftSecondStep({ codeVerified: false, twoFactorOn: false, settingOn: false, claims: mfa }), "none");
});

test("microsoft+mfa meets a superadmin's and a company's requirement; plain microsoft does not", () => {
  // lib/kfid/server.ts twoFactorBlocks: no TOTP and not a strong method while required (always for a superadmin) → blocked.
  const blocks = (method: string, totpOn: boolean, required: boolean) => !totpOn && !strongSignInMethod(method) && required;
  assert.equal(MICROSOFT_MFA_METHOD, "microsoft+mfa");
  assert.equal(strongSignInMethod(MICROSOFT_MFA_METHOD), true);
  assert.equal(blocks(MICROSOFT_MFA_METHOD, false, true), false, "a superadmin without TOTP, signed in with Microsoft's multi-factor, is let in");
  assert.equal(blocks("microsoft", false, true), true, "without Microsoft's word the superadmin must set up two-step, as today");
  assert.equal(strongSignInMethod("microsoft"), false);
  assert.equal(strongSignInMethod("microsoft+totp"), false, "TOTP is checked through the person's own setting");
  assert.equal(strongSignInMethod("google"), false);
  assert.equal(strongSignInMethod("passkey"), true, "the passkey still counts");
  assert.equal(SIGN_IN_METHOD_LABELS[MICROSOFT_MFA_METHOD], "Microsoft med Microsofts tvåsteg", "the security log says it in words");
});

test("the sign-in code: Microsoft's word is read from the verified ID token only, with nonce, and logged", () => {
  const microsoft = readFileSync(join(process.cwd(), "lib", "auth", "microsoft.ts"), "utf8");
  assert.match(microsoft, /checks: \["pkce", "state", "nonce"\]/, "the ID token must belong to this sign-in");
  assert.match(microsoft, /mfaAsSecondStep !== false/, "on unless switched off explicitly");
  assert.match(microsoft, /companyLocksAllow\(await companyLocks\(linked\.user\.id\), identity\.tid\)\) return \{ ok: false, error: "microsoft_tenant_locked" \};\n[\s\S]*microsoftSecondStep\(/, "the company lock is checked before any second step");
  const config = readFileSync(join(process.cwd(), "lib", "auth", "config.ts"), "utf8");
  assert.match(config, /const pickMicrosoftClaims = [^\n]*/);
  assert.doesNotMatch(config.match(/const pickMicrosoftClaims = [^\n]*/)![0], /amr/, "the code step's cookie never carries amr");
  assert.match(config, /microsoftMfaSignIns\.has\(profile\) \? MICROSOFT_MFA_METHOD : account\.provider/, "the session and login_ok are named microsoft+mfa");
  const route = readFileSync(join(process.cwd(), "app", "api", "superadmin", "microsoft-settings", "route.ts"), "utf8");
  assert.match(route, /mfaAsSecondStep: z\.boolean\(\)\.optional\(\)/);
  assert.match(route, /Microsofts tvåsteg räknas/, "the change is in the administration history");
});

test("Logga in med telefonen: the hybrid hint is added, nothing else changes", () => {
  const options = { challenge: "abc", rpId: "app.example", userVerification: "required", allowCredentials: [] };
  assert.deepEqual(withPhoneHint(options), { ...options, hints: ["hybrid"] });
  assert.deepEqual(options, { challenge: "abc", rpId: "app.example", userVerification: "required", allowCredentials: [] }, "the server's options are not changed in place");
  assert.deepEqual(withPhoneHint({ challenge: "x", hints: ["security-key"] }).hints, ["hybrid"]);
});

test("every way to sign in that works today is still offered (2026-11-27)", () => {
  const form = readFileSync(join(process.cwd(), "features", "auth", "components", "login-form.tsx"), "utf8");
  // The login page: e-mail + password, Logga in, passkey, the phone, Google and Microsoft, Glömt lösenord.
  for (const needle of ['id="email"', 'id="password"', "Logga in", "<PasskeySignIn returnTo={returnTo}", "<PasskeySignIn phone returnTo={returnTo}", 'signIn("google"', 'signIn("microsoft"', 'data-testid="login-microsoft"', "/forgot-password"])
    assert.ok(form.includes(needle), `the login page still has ${needle}`);
  // The two-step box: the passkey (Windows Hello / Face ID / finger), the phone, the code from the app and the backup code.
  const step = form.slice(form.indexOf('data-testid="login-code-step"'), form.indexOf("</div> : <>"));
  for (const needle of ['testId="login-code-passkey"', 'testId="login-code-phone"', "<OneTimeCodeInput", "onBackupChange={setBackup}", "Kod från autentiseringsappen", "Reservkod"])
    assert.ok(step.includes(needle), `the two-step box still has ${needle}`);
  assert.ok(step.indexOf('testId="login-code-passkey"') < step.indexOf('testId="login-code-phone"') && step.indexOf('testId="login-code-phone"') < step.indexOf("<OneTimeCodeInput"), "passkey, then phone, then the code");
  // The code after a password and after Google/Microsoft still go to the server as before.
  assert.ok(form.includes('signIn("credentials"') && form.includes('signIn("oauth-code"'));
  const passkey = readFileSync(join(process.cwd(), "features", "auth", "components", "passkey-sign-in.tsx"), "utf8");
  assert.match(passkey, /phone && !autofill \? withPhoneHint\(options\) : options/, "only the phone button adds the hint; the ordinary button and autofill are as before");
  assert.match(passkey, /Skanna QR-koden med telefonen och godkänn med ansikte eller finger\./);
  const settings = readFileSync(join(process.cwd(), "features", "security", "passkey-settings.tsx"), "utf8");
  assert.ok(settings.includes('data-testid="passkey-phone"') && settings.includes(">Fortsätt</Button>"), "Spara i telefonen beside the ordinary Fortsätt");
});
