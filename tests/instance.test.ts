import assert from "node:assert/strict";
import test from "node:test";
import { publicInstance } from "../lib/instance";
import { instanceAdminEmail } from "../lib/instance-server";
import { INSTANCE_DEFAULTS } from "../lib/instance-defaults";
import { isHintekOrganization, shellBranding } from "../lib/branding";
import { EE_PRESENT } from "@ee/present";

// Instance settings (Fas 1, 2026-09-30): an empty environment is the installation's defaults (HINTEK's in the private
// repository, neutral ones in the community edition).
test("an empty environment gives the installation's defaults with every part it has on", () => {
  const instance = publicInstance({});
  assert.equal(instance.name, INSTANCE_DEFAULTS.name);
  assert.equal(instance.operator, INSTANCE_DEFAULTS.operator);
  assert.equal(instance.defaultBrand, (INSTANCE_DEFAULTS.name as string) === "HINTEK Workflow");
  // Fas 2: billing, credits, the landing page, HINTEK AI and the API/MCP server exist only with ee/.
  assert.deepEqual(instance.features, { billing: EE_PRESENT, credits: EE_PRESENT, ai: EE_PRESENT, integrations: EE_PRESENT, googleSignIn: EE_PRESENT, terms: EE_PRESENT, demoOnLogin: !EE_PRESENT, landingEditor: EE_PRESENT });
  assert.equal(instanceAdminEmail({}), INSTANCE_DEFAULTS.adminEmail);
});

test("the operator's organization is recognised by domain, subdomain, slug and name", () => {
  const hintek = publicInstance({ INSTANCE_OPERATOR: "HINTEK", INSTANCE_OPERATOR_DOMAINS: "hintek.se", INSTANCE_OPERATOR_SLUGS: "hintek" });
  for (const organization of [
    { name: "HINTEK Internal", slug: "hintek-internal" },
    { name: "Något", domain: "hintek.se" },
    { name: "Något", domain: "app.hintek.se" },
    { name: "HINTEK" },
  ]) assert.equal(isHintekOrganization(organization, hintek), true, JSON.stringify(organization));
  for (const organization of [{ name: "Elbolaget AB", slug: "elbolaget" }, { name: "Hintekno AB", domain: "hintekno.se" }])
    assert.equal(isHintekOrganization(organization, hintek), false, JSON.stringify(organization));
});

test("another installation names itself, its operator and its admin", () => {
  const env = {
    INSTANCE_NAME: "Elbolaget Flöde", INSTANCE_OPERATOR: "Elbolaget", INSTANCE_OPERATOR_DOMAINS: "elbolaget.se, el.example",
    INSTANCE_OPERATOR_SLUGS: "elbolaget", INSTANCE_ADMIN_EMAIL: " Admin@Elbolaget.se ",
    BILLING_ENABLED: "false", CREDITS_ENABLED: "false", AI_ENABLED: "FALSE", LANDING_EDITOR_ENABLED: "false",
  };
  const instance = publicInstance(env);
  assert.equal(instance.name, "Elbolaget Flöde");
  assert.equal(instance.defaultBrand, false);
  assert.deepEqual(instance.features, { billing: false, credits: false, ai: false, integrations: EE_PRESENT, googleSignIn: EE_PRESENT, terms: EE_PRESENT, demoOnLogin: !EE_PRESENT, landingEditor: false });
  assert.equal(instanceAdminEmail(env), "admin@elbolaget.se");
  assert.equal(isHintekOrganization({ name: "Elbolaget", slug: "elbolaget" }, instance), true);
  assert.equal(isHintekOrganization({ name: "X", domain: "el.example" }, instance), true);
  assert.equal(isHintekOrganization({ name: "HINTEK Internal", slug: "hintek-internal" }, instance), false);
  assert.equal(shellBranding(null, null, instance).companyName, "Elbolaget");
});
