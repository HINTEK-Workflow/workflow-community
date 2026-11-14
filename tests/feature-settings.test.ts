import assert from "node:assert/strict";
import test from "node:test";
import { FEATURE_DEFINITIONS, FEATURE_KEYS, OBJECT_DATA_OFF, featureSettingsOf, withoutObjectData } from "../lib/workflow/feature-settings";
import { SETTINGS_VIEWS, settingsTabs } from "../features/workflow/section-tabs";
import { placeObjectFields } from "../lib/workflow/maintenance";

// Inställningar → Funktioner (2026-10-07): the company's on/off choices on one page, one place per choice.

test("every function has one definition with its own action, and nothing is on until chosen", () => {
  assert.deepEqual(FEATURE_DEFINITIONS.map((feature) => feature.key), [...FEATURE_KEYS]);
  assert.equal(new Set(FEATURE_DEFINITIONS.map((feature) => feature.action)).size, FEATURE_DEFINITIONS.length, "an action per choice");
  assert.deepEqual(featureSettingsOf(null), { maintenance: false, riskException: true });
  assert.deepEqual(featureSettingsOf({}), { maintenance: false, riskException: true });
  assert.deepEqual(featureSettingsOf({ maintenance: 1 } as Record<string, unknown>), { maintenance: false, riskException: true }, "only a real true is on");
  assert.deepEqual(featureSettingsOf({ riskException: false }), { maintenance: false, riskException: false }, "the risk exception is on until it is turned off");
  // Kontor och avdelningar and Mät igen were removed (2026-10-24): an older answer's officeStructure or
  // measureAgain is not a choice any more.
  assert.deepEqual(featureSettingsOf({ maintenance: true, officeStructure: true, measureAgain: true } as Record<string, unknown>), { maintenance: true, riskException: true });
  for (const feature of FEATURE_DEFINITIONS) assert.ok(feature.title && feature.label && feature.text.length > 40, feature.key);
});

test("the choices keep the names they had, Kontor och avdelningar and Mät igen are gone and nothing is tied to Cloud", () => {
  const byKey = Object.fromEntries(FEATURE_DEFINITIONS.map((feature) => [feature.key, feature]));
  assert.equal(byKey.maintenance.title, "Objektdata på platser");
  assert.equal(byKey.maintenance.action, "maintenance");
  assert.deepEqual([...FEATURE_KEYS], ["maintenance", "riskException"]);
  assert.equal(FEATURE_DEFINITIONS.some((feature) => feature.action === "office_structure" || /kontor/i.test(feature.title)), false);
  assert.equal(FEATURE_DEFINITIONS.some((feature) => feature.action === "measure_again" || /mät igen/i.test(feature.title)), false);
  assert.deepEqual(FEATURE_DEFINITIONS.filter((feature) => feature.cloudOnly).map((feature) => feature.key), []);
});

test("a place saved while object data is off leaves the object fields out but keeps the type, the rest stays", () => {
  const facility = { name: "Station 1", kind: "OBJECT", parentId: "p1", city: "Uppsala", objectType: "Pump", operatingState: "IN_SERVICE", manufacturer: "X", model: "Y", serialNumber: "1", installedOn: "2020-01-01", attributes: [{ label: "kW", value: "5" }] };
  const kept = withoutObjectData(facility);
  assert.deepEqual(kept, { name: "Station 1", kind: "OBJECT", parentId: "p1", city: "Uppsala", objectType: "Pump" });
  for (const key of Object.keys(placeObjectFields)) if (key !== "objectType") assert.equal(key in kept, false, key);
  assert.equal(facility.objectType, "Pump", "the request itself is not changed");
  assert.match(OBJECT_DATA_OFF, /Arbetssätt/);
});

test("Funktioner is Arbetssätt, one settings page for company admins only, with Workflow AI on the same page in Cloud", () => {
  assert.ok((SETTINGS_VIEWS as readonly string[]).includes("company_features"));
  const options = { admin: true, cloud: true, ai: true, integrations: true, credits: true };
  const working = settingsTabs(options).find((tab) => tab.label === "Arbetssätt");
  // One page per tab (2026-10-15); since C2 (2026-10-22) Workflow AI and Priser och offert are parts of this page and the
  // register Värden och referenser is reached from it.
  assert.deepEqual(working?.sections.map((section) => [section.view, section.label]), [["company_features", "Arbetssätt"]]);
  assert.deepEqual(working?.aliases, { ai_settings: "ai", quote_settings: "prices", company_values: null });
  assert.equal(working?.key, "company_features", "the tab opens Funktioner");
  assert.equal(settingsTabs({ ...options, admin: false }).some((tab) => tab.key === "company_features"), false);
  assert.equal(settingsTabs({ ...options, cloud: false }).some((tab) => tab.key === "company_features"), true, "Local companies choose their functions too");
  assert.match(OBJECT_DATA_OFF, /Inställningar → Arbetssätt\./);
});
