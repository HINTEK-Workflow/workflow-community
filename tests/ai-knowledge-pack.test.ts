import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { WORKFLOW_KNOWLEDGE, WORKFLOW_KNOWLEDGE_FINGERPRINT, WORKFLOW_KNOWLEDGE_VERSION } from "../lib/ai/knowledge/workflow-knowledge";
import { INSTANCE_DEFAULTS } from "../lib/instance-defaults";
import { prepareWorkflowAssistantRequest } from "../lib/ai/workflow-assistant";
import { helpAnswer, HELP_ANSWER } from "../lib/ai/assistant-rules";
import { RISK_QUESTIONS } from "../lib/workflow/risk-step";
import { STAFF_REGISTER_HELP } from "../lib/workflow/staff-register";

// Kunskapspaketet (Workflow AI-planen 2.1, built 2026-10-09).
test("knowledge pack: a change of the text needs a new version (the fingerprint is the version's)", () => {
  const fingerprint = createHash("sha256").update(WORKFLOW_KNOWLEDGE).digest("hex").slice(0, 16);
  // The Community export puts the installation's words in the text (community/export-rules.mjs); the fingerprint is the original's.
  if ((INSTANCE_DEFAULTS.name as string) === ["HINTEK", "Workflow"].join(" ")) assert.equal(fingerprint, WORKFLOW_KNOWLEDGE_FINGERPRINT, `The knowledge pack changed: raise WORKFLOW_KNOWLEDGE_VERSION (now ${WORKFLOW_KNOWLEDGE_VERSION}) and set WORKFLOW_KNOWLEDGE_FINGERPRINT to ${fingerprint}.`);
  assert.match(WORKFLOW_KNOWLEDGE_VERSION, /^\d{4}-\d{2}-\d{2}\.\d+$/);
  assert.ok(WORKFLOW_KNOWLEDGE.includes(`kunskapspaket ${WORKFLOW_KNOWLEDGE_VERSION}`), "the model sees the version");
});

test("knowledge pack: the concepts are there, with the labels read from the code", () => {
  for (const concept of ["Projekt", "arbetsorder", "Arbetsordern styr", "projekttid", "driftrond", "Riskbedömningssteget", "Färdigställ", "Utgår", "Planering", "bokning", "Tidplan", "Offert", "Personalliggare", "Krävd nivå", "Visningsnivån", "Egenkontroll"])
    assert.ok(WORKFLOW_KNOWLEDGE.includes(concept), concept);
  for (const question of RISK_QUESTIONS) assert.ok(WORKFLOW_KNOWLEDGE.includes(question.short), question.short);
  assert.ok(WORKFLOW_KNOWLEDGE.includes(STAFF_REGISTER_HELP));
});

test("knowledge pack: short, and nothing from standards or limit values (copyright precaution)", () => {
  assert.ok(WORKFLOW_KNOWLEDGE.length < 5_500, `${WORKFLOW_KNOWLEDGE.length} characters`);
  assert.doesNotMatch(WORKFLOW_KNOWLEDGE, /\b(SS|EN|IEC|ISO|SEK|ELSÄK|AFS)[\s-]?\d/);
  assert.doesNotMatch(WORKFLOW_KNOWLEDGE, /\d\s?(mA|MΩ|kΩ|Ω|V|A|kV|ms)\b/);
});

test("knowledge pack: first in the instructions, the same whatever the question", () => {
  const base = { model: "gpt-5.6-luna", reasoningEffort: "low" as const, maxOutputTokens: 1_000, organizationId: "o", actorId: "u", sources: [] };
  const request = prepareWorkflowAssistantRequest({ ...base, history: [{ role: "USER", content: "Varför kan jag inte starta tiden?" }] });
  const [role, rest] = [request.instructions.slice(0, request.instructions.indexOf(WORKFLOW_KNOWLEDGE)), request.instructions];
  assert.equal(role, "Du är Workflow AI i Workflow. Svara kort och tydligt på svenska. ");
  assert.ok(rest.includes("completeBlockedBy"), "the open task's job is how 'vad saknas' is answered");
  assert.ok(!request.input.includes("kunskapspaket"), "the pack is instructions, not data");
});

test("help: names the proposals only when the company's switches allow them", () => {
  assert.equal(helpAnswer(false), HELP_ANSWER);
  assert.doesNotMatch(HELP_ANSWER, /förslag/);
  const on = helpAnswer(true);
  assert.ok(on.startsWith(HELP_ANSWER));
  assert.match(on, /förslag som du själv godkänner med Använd/);
  for (const word of ["arbetsordern", "material", "tid", "Planera", "offert"]) assert.match(on, new RegExp(word, "i"), word);
  assert.match(on, /Färdigställa, signera och bekräfta riskbedömningar gör du alltid själv/);
});
