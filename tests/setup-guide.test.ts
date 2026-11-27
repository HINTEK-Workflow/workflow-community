import assert from "node:assert/strict";
import test from "node:test";
import { AI_CHOICES, aiChoiceOf, aiChoiceTitle, policyFor, retentionSummary, setupRecap, setupStartLinks, setupStepStatus, setupStepsFor, SETUP_STEPS, SKIPPED_SUMMARY, type AiPolicy } from "../lib/setup-guide";
import { HISTORY_RETENTION_CHOICES } from "../lib/workflow/history-retention";

// Ställ in Workflow (2026-10-02, polished 2026-10-07): five steps, only the agreements required.
const policy = (fields: Partial<AiPolicy> = {}): AiPolicy => ({ enabled: false, shareChatContent: false, shareWork: false, shareCustomers: false, shareDocuments: false, shareControls: false, shareConversationHistory: false, dailyDigest: false, allowedModules: ["work"], ...fields });

test("an administrator meets seven steps in order, a member the agreements and Visning; only the agreements are required", () => {
  assert.deepEqual(setupStepsFor(true).map((step) => step.label), ["Avtal", "Yrkesprofil", "Visning", "Företaget", "Säkerhet", "Workflow AI", "Klart"]);
  assert.deepEqual(setupStepsFor(false).map((step) => step.key), ["legal", "display"]);
  // Yrkesprofil is one combined step: a member meets it only when the admin chose none (and it was asked for).
  assert.deepEqual(setupStepsFor(false, true).map((step) => step.key), ["legal", "profile", "display"]);
  assert.equal(SETUP_STEPS.filter((step) => step.key === "profile").length, 1);
  assert.deepEqual(SETUP_STEPS.filter((step) => step.required).map((step) => step.key), ["legal"]);
  for (const step of SETUP_STEPS) assert.ok(step.description.length <= 60, `${step.label}: a short line`);
});

test("a step's chip says what is asked of it, then how it went", () => {
  const [legal, , company] = SETUP_STEPS;
  assert.deepEqual(setupStepStatus(legal), { label: "Krävs", tone: "warning" });
  assert.deepEqual(setupStepStatus(company), { label: "Valfritt", tone: "neutral" });
  assert.deepEqual(setupStepStatus(company, { status: "saved", summary: "Acme AB" }), { label: "Klart", tone: "success" });
  assert.deepEqual(setupStepStatus(company, { status: "skipped", summary: SKIPPED_SUMMARY }), { label: "Hoppades över", tone: "neutral" });
});

test("the last page recaps the steps before it, and a step never visited reads as skipped", () => {
  const recap = setupRecap(setupStepsFor(true), { legal: { status: "saved", summary: "Godkända" }, display: { status: "saved", summary: "Dator: Allt" }, company: { status: "saved", summary: "Acme AB" }, ai: { status: "skipped", summary: SKIPPED_SUMMARY } });
  assert.deepEqual(recap.map((item) => item.label), ["Avtal", "Yrkesprofil", "Visning", "Företaget", "Säkerhet", "Workflow AI"]);
  assert.deepEqual(recap.map((item) => item.status), ["saved", "skipped", "saved", "saved", "skipped", "skipped"]);
  assert.equal(recap[3].summary, "Acme AB");
  assert.equal(recap[4].summary, SKIPPED_SUMMARY);
  assert.deepEqual(setupRecap(setupStepsFor(false), {}), [{ key: "legal", label: "Avtal", status: "skipped", summary: SKIPPED_SUMMARY }, { key: "display", label: "Visning", status: "skipped", summary: SKIPPED_SUMMARY }]);
});

test("the history line follows the chosen retention", () => {
  assert.equal(retentionSummary(24), "Historik sparas 2 år");
  assert.equal(retentionSummary(6), "Historik sparas 6 månader");
  assert.equal(retentionSummary(12), "Historik sparas 1 år");
  assert.equal(retentionSummary(null), "Historiken raderas bara för hand");
  for (const months of HISTORY_RETENTION_CHOICES) assert.ok(retentionSummary(months).length <= 40);
});

test("the AI step keeps its three choices: Av, frågor och arbete, and also customers, controls and documents", () => {
  assert.deepEqual(AI_CHOICES.map((choice) => choice.value), ["off", "basic", "full"]);
  assert.equal(aiChoiceOf(policy()), "off");
  assert.equal(aiChoiceOf(policy({ enabled: true, shareChatContent: true, shareWork: true })), "basic");
  for (const field of ["shareCustomers", "shareDocuments", "shareControls"] as const) assert.equal(aiChoiceOf(policy({ enabled: true, [field]: true })), "full", field);
  const full = policyFor("full", policy());
  assert.deepEqual([full.enabled, full.shareChatContent, full.shareWork, full.shareCustomers, full.shareControls, full.shareDocuments], [true, true, true, true, true, true]);
  const basic = policyFor("basic", full);
  assert.deepEqual([basic.enabled, basic.shareWork, basic.shareCustomers, basic.shareControls, basic.shareDocuments], [true, true, false, false, false]);
  const off = policyFor("off", full);
  assert.equal(off.enabled, false);
  assert.equal(off.shareCustomers, true, "Av only switches AI off; what was chosen is kept for later");
  for (const choice of AI_CHOICES) assert.equal(aiChoiceOf(policyFor(choice.value, policy())), choice.value, `${choice.value} survives a round trip`);
  assert.equal(policyFor("basic", policy({ allowedModules: ["x"], dailyDigest: true })).dailyDigest, true, "other settings are untouched");
  assert.equal(aiChoiceTitle("basic"), "På – frågor och arbete");
});

test("the three first things to do have titles that fit one line side by side (card-titles-one-line)", () => {
  for (const local of [false, true]) {
    const links = setupStartLinks(local);
    assert.equal(links.length, 3);
    for (const link of links) {
      assert.ok(link.title.length <= 26, `${link.title} is too long for one line`);
      assert.match(link.href, /^\/\?view=[a-z_]+$/);
      assert.ok(link.text.length <= 90, `${link.title}: keep the text short`);
    }
    assert.equal(new Set(links.map((link) => link.title)).size, 3);
  }
  assert.deepEqual(setupStartLinks(false).map((link) => link.title), ["Bjud in kollegor", "Skapa ett projekt", "Kontroll eller arbetsorder"]);
  assert.ok(!setupStartLinks(false).concat(setupStartLinks(true)).some((link) => /Gör en kontroll/.test(link.title)), "the title that broke onto two lines is gone");
});

// Första inloggningen (2026-11-18): a new owner of a Community installation is a superadmin made by admin:create with
// setupPending; without a start page of their own they land in Kom igång, not in Produktöversikten. Once the guide is closed
// (setup), or for a superadmin never asked to set up, Produktöversikten as before.
test("a new superadmin owner lands in Kom igång, afterwards in Produktöversikten", async () => {
  const { setupStillDue, superadminStartHref } = await import("../lib/setup-guide");
  assert.equal(superadminStartHref({ tours: { setupPending: "2026-11-18T08:00:00.000Z" } }), "/?view=setup");
  assert.equal(superadminStartHref({ tours: { setupPending: "2026-11-18T08:00:00.000Z", setup: "2026-11-18T08:10:00.000Z" } }), "/?view=product_overview");
  assert.equal(superadminStartHref({ tours: {} }), "/?view=product_overview");
  assert.equal(superadminStartHref(null), "/?view=product_overview");
  assert.equal(superadminStartHref([]), "/?view=product_overview");
  assert.equal(setupStillDue({ tours: { setupPending: "x", setup: null } }), true);
  const { readFileSync } = await import("node:fs");
  assert.match(readFileSync("app/page.tsx", "utf8"), /preferred === "stats"\) redirect\(superadminStartHref\(preferences\?\.data\)\)/, "the start page uses the rule");
  assert.match(readFileSync("scripts/admin/create-admin.ts", "utf8"), /tours: \{ setupPending:/, "admin:create marks the guide as due");
});
