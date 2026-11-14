import assert from "node:assert/strict";
import test from "node:test";
import {
  clientIdLooksRight,
  companyLocksAllow,
  discoveryLooksRight,
  MICROSOFT_CONSUMER_TENANT,
  MICROSOFT_ERRORS,
  microsoftDiscoveryUrl,
  microsoftIdentity,
  normalizeTenant,
  tenantAccepted,
} from "../lib/auth/microsoft-core";

const TID = "72f988bf-86f1-41af-91ab-2d7cd011db47";
const OTHER = "11111111-2222-3333-4444-555555555555";
const OID = "00000000-0000-0000-66f3-3332eca7ea81";

test("the identity is tid + oid; the e-mail is only a label and never required", () => {
  const identity = microsoftIdentity({ tid: TID.toUpperCase(), oid: OID, email: "anna@contoso.example", preferred_username: "x@y", name: "Anna" });
  assert.deepEqual(identity, { tid: TID, oid: OID, providerAccountId: `${TID}:${OID}`, label: "anna@contoso.example", name: "Anna" });
  assert.equal(microsoftIdentity({ tid: TID, oid: OID })?.providerAccountId, `${TID}:${OID}`, "no e-mail needed");
  assert.equal(microsoftIdentity({ tid: TID, email: "anna@contoso.example" }), null, "an address without oid is no identity");
  assert.equal(microsoftIdentity({ tid: "contoso", oid: OID }), null);
  assert.equal(microsoftIdentity(undefined), null);
  // The same person in another directory is another identity: nothing is matched across directories.
  assert.notEqual(microsoftIdentity({ tid: OTHER, oid: OID })?.providerAccountId, identity?.providerAccountId);
});

test("tenant settings: three modes or a directory id", () => {
  assert.equal(normalizeTenant(" Common "), "common");
  assert.equal(normalizeTenant("organizations"), "organizations");
  assert.equal(normalizeTenant(TID.toUpperCase()), TID);
  assert.equal(normalizeTenant("contoso.onmicrosoft.com"), null, "a domain name is not accepted – the id is stable, a name is not");
  assert.equal(normalizeTenant(""), null);
  assert.equal(clientIdLooksRight("0a1b2c3d-0000-4000-8000-123456789abc"), true);
  assert.equal(clientIdLooksRight("my-app"), false);
  assert.equal(microsoftDiscoveryUrl("common"), "https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration");
});

test("which directories may sign in under each mode", () => {
  assert.equal(tenantAccepted("common", MICROSOFT_CONSUMER_TENANT), true);
  assert.equal(tenantAccepted("common", TID), true);
  assert.equal(tenantAccepted("organizations", MICROSOFT_CONSUMER_TENANT), false, "personal accounts are not work accounts");
  assert.equal(tenantAccepted("organizations", TID), true);
  assert.equal(tenantAccepted("consumers", TID), false);
  assert.equal(tenantAccepted("consumers", MICROSOFT_CONSUMER_TENANT), true);
  assert.equal(tenantAccepted(TID, TID), true);
  assert.equal(tenantAccepted(TID, OTHER), false);
});

test("a company lock admits only its own directory, and the strictest lock of a person's companies applies", () => {
  assert.equal(companyLocksAllow([], OTHER), true);
  assert.equal(companyLocksAllow([null, undefined], OTHER), true);
  assert.equal(companyLocksAllow([TID], TID), true);
  assert.equal(companyLocksAllow([TID], OTHER), false);
  assert.equal(companyLocksAllow([TID, null], MICROSOFT_CONSUMER_TENANT), false, "a personal account is refused under a lock");
  assert.equal(companyLocksAllow([TID, OTHER], TID), false, "two different locks cannot both be met");
});

test("Kontrollera recognises Microsoft's discovery document for the chosen setting", () => {
  const doc = (issuer: string) => ({ issuer, authorization_endpoint: "https://login.microsoftonline.com/x/oauth2/v2.0/authorize", token_endpoint: "https://login.microsoftonline.com/x/oauth2/v2.0/token", jwks_uri: "https://login.microsoftonline.com/x/discovery/v2.0/keys" });
  assert.equal(discoveryLooksRight(doc("https://login.microsoftonline.com/{tenantid}/v2.0"), "common").ok, true);
  assert.equal(discoveryLooksRight(doc("https://login.microsoftonline.com/{tenantid}/v2.0"), "organizations").ok, true);
  assert.equal(discoveryLooksRight(doc(`https://login.microsoftonline.com/${MICROSOFT_CONSUMER_TENANT}/v2.0`), "consumers").ok, true);
  assert.equal(discoveryLooksRight(doc(`https://login.microsoftonline.com/${TID}/v2.0`), TID).ok, true);
  assert.equal(discoveryLooksRight(doc(`https://login.microsoftonline.com/${OTHER}/v2.0`), TID).ok, false, "another directory");
  assert.equal(discoveryLooksRight({ ...doc(`https://login.microsoftonline.com/${TID}/v2.0`), token_endpoint: "https://evil.example.invalid/token" }, TID).ok, false);
  assert.equal(discoveryLooksRight({ issuer: "https://accounts.google.com" }, "common").ok, false);
  assert.equal(discoveryLooksRight(null, "common").ok, false);
});

test("every refusal has words for the login page", () => {
  for (const [code, text] of Object.entries(MICROSOFT_ERRORS)) assert.ok(text.length > 20 && !text.includes(code), code);
  assert.match(MICROSOFT_ERRORS.microsoft_not_linked, /koppla/);
});
