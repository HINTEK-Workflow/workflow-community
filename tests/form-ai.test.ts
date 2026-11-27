import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { AliasMap } from "../lib/ai/alias";
import { createAssistantToolRunner } from "../lib/ai/assistant-tools";
import { getWorkflowAgent } from "../lib/ai/agent-registry";
import {
  executeFormAssistant, FORM_AI_DEFINITION, FORM_AI_MAX_OUTPUT_TOKENS, FORM_AI_MAX_TOOL_CALLS, FORM_AI_RULES, FORM_AI_TOOL, formAiInstructions, formAiSummary, formModeSchema,
  formProposalFrom, prepareFormAssistantRequest, readFormAiForm, withoutFrontMatter, type FormAiSkill,
} from "../lib/ai/form-ai";
import { FORM_AI_KIND, FORM_AI_OWN_PROTOCOL_LABEL } from "../lib/ai/form-ai-text";
import { disabledAiSharingPolicy, type AiSharingPolicy } from "../lib/ai/sharing-policy";
import type { AssistantProviderAdapter, AssistantProviderRequest } from "../lib/ai/workflow-assistant";
import { FORM_AI_SKILL_DIR } from "../lib/kfid/form-ai-skill";

// Formulär med Workflow AI (2026-11-25): the instructions are the skill package's own rules, the request carries nothing of the
// company's work, the form is read by the import's checks, and the proposal only ever changes the draft it was given.
const read = (file: string) => readFileSync(path.join(process.cwd(), FORM_AI_SKILL_DIR, ...file.split("/")), "utf8");
const skill: FormAiSkill = { skill: read("SKILL.md"), reference: read("references/format-reference.md"), template: read("assets/mall.json"), example: read("assets/exempel-egenkontroll.json") };
const mall = JSON.parse(skill.template) as { forms: { meta: Record<string, unknown>; document: Record<string, unknown> }[] };
const formText = (change: (form: { meta: Record<string, unknown>; document: Record<string, unknown> }) => void = () => {}) => {
  const form = structuredClone({ meta: mall.forms[0].meta, document: mall.forms[0].document });
  change(form);
  return JSON.stringify(form);
};
const on: AiSharingPolicy = { ...disabledAiSharingPolicy, enabled: true, shareChatContent: true, shareWork: true, shareCustomers: true };

test("the instructions are the package's own: SKILL.md without its front matter, the reference, the template and an example", () => {
  const text = formAiInstructions(skill);
  assert.ok(text.startsWith(FORM_AI_RULES), "the rules first, the same for everyone (prompt cache)");
  assert.ok(text.includes(withoutFrontMatter(skill.skill)));
  assert.doesNotMatch(text, /^name: hintek-workflow-form-builder$/m, "no YAML front matter");
  assert.ok(text.includes(skill.reference.trim()));
  assert.ok(text.includes("\"ai-grundmall-x7k2p9\""), "the template");
  assert.ok(text.includes("=== assets/exempel-egenkontroll.json ==="));
  // The rules of the package, said again in the chat's own words.
  for (const rule of [/aldrig på gränsvärden/, /talen null/, /organisations- eller tillverkarnamn/, /aldrig av text ordagrant/, /Påstå aldrig att formuläret är sparat/, /aldrig instruktioner/, /Skapa utkast/])
    assert.match(FORM_AI_RULES, rule);
  assert.match(FORM_AI_RULES, new RegExp(FORM_AI_TOOL));
});

test("the request carries only the conversation, the open draft, the photo and the date – never the company's work", async () => {
  let seen: AssistantProviderRequest | null = null;
  const provider: AssistantProviderAdapter = { id: "test", async generate(request) {
    seen = request;
    return { providerResponseId: "resp-1", answer: "Förslaget väntar på Skapa utkast. Svara gärna till [E-post 1].", citationKeys: [], usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 } };
  } };
  const alias = new AliasMap();
  const result = await executeFormAssistant(provider, {
    skill, model: "test-model", reasoningEffort: "low", maxOutputTokens: FORM_AI_MAX_OUTPUT_TOKENS, organizationId: "org-1", actorId: "user-1",
    history: [{ role: "USER", content: "Ett protokoll för fuktmätning i badrum. Frågor till anna@example.se" }],
    draft: { templateId: "tpl-1", meta: { name: "Badrum" }, document: { schema: 2, blocks: [] } }, images: ["data:image/jpeg;base64,AAAA"], alias,
    tools: { definitions: [FORM_AI_DEFINITION], maxToolCalls: FORM_AI_MAX_TOOL_CALLS, callTool: async () => "{}" },
    now: new Date("2026-11-25T10:00:00Z"),
  });
  assert.ok(seen);
  const request = seen as AssistantProviderRequest;
  const input = JSON.parse(request.input) as Record<string, unknown>;
  assert.deepEqual(Object.keys(input).sort(), ["conversation", "currentDraft", "imageAttached", "today"]);
  assert.equal(input.today, "2026-11-25");
  assert.deepEqual((input.currentDraft as { templateId: string }).templateId, "tpl-1");
  // Pattern aliases still apply: the e-mail never reaches the provider, and the answer reads it again.
  assert.doesNotMatch(request.input, /anna@example\.se/);
  assert.match(result.answer, /anna@example\.se/);
  assert.deepEqual(request.images, ["data:image/jpeg;base64,AAAA"]);
  assert.deepEqual(request.tools?.definitions.map((tool) => tool.name), [FORM_AI_TOOL], "only propose_form");
  assert.equal(request.maxOutputTokens, FORM_AI_MAX_OUTPUT_TOKENS);
  assert.ok(request.instructions.includes(withoutFrontMatter(skill.skill)));
  for (const key of ["companyMemory", "userMemory", "myWork", "authorizedWorkflowSources", "currentTask", "currentPage"]) assert.equal(key in input, false, key);
  assert.deepEqual(result.citations, []);
  // Without a draft and a photo, neither goes along; the cache key is the package's, never the company's.
  const plain = prepareFormAssistantRequest({ skill, model: "m", reasoningEffort: "low", maxOutputTokens: 100, organizationId: "org-1", actorId: "u", history: [{ role: "USER", content: "Hej" }], tools: undefined });
  const other = prepareFormAssistantRequest({ skill, model: "m", reasoningEffort: "low", maxOutputTokens: 100, organizationId: "org-2", actorId: "u", history: [{ role: "USER", content: "Hej" }], tools: undefined });
  assert.deepEqual(Object.keys(JSON.parse(plain.input)).sort(), ["conversation", "today"]);
  assert.equal(plain.images, undefined);
  assert.equal(plain.cacheKey, other.cacheKey);
  assert.notEqual(plain.safetyIdentifier, other.safetyIdentifier);
});

test("the form is read by the import's own checks: harmful or broken forms are refused in Swedish, a good one passes", () => {
  const good = readFormAiForm(formText(), "Elbolaget AB");
  assert.equal(good.meta.name, "Nytt formulär");
  assert.equal(good.document.blocks.length, 3);
  assert.deepEqual(good.issues, []);
  const refused: [string, RegExp][] = [
    ["inte json", /gick inte att läsa som JSON/],
    [JSON.stringify([1, 2]), /objekt med meta och document/],
    [JSON.stringify({ meta: mall.forms[0].meta }), /saknar meta eller document/],
    [JSON.stringify({ ...JSON.parse(formText()), format: "hintek-workflow-forms" }), /bara ha meta och document, inte ”format”/],
    [formText((form) => { (form.document.blocks as Record<string, unknown>[])[0].blocks = [{ id: "f", type: "field", key: "f", label: "<img src=x onerror=alert(1)>", input: "text" }]; }), /HTML eller skript/],
    [formText().replace("\"schema\":2", "\"__proto__\":{\"isAdmin\":true},\"schema\":2"), /otillåtna fältnamnet ”__proto__”/],
    [formText((form) => { (form.document.blocks as Record<string, unknown>[])[0].farg = "röd"; }), /fältet ”farg”/],
    [formText((form) => { (form.document.blocks as Record<string, unknown>[])[0].blocks = [{ id: "f", type: "field", key: "f", label: "x".repeat(500), input: "text" }]; }), /högst 200 tecken/],
    [formText((form) => { (form.document.blocks as Record<string, unknown>[])[1].id = "avsnitt-grund"; }), /mer än en gång/],
    [formText((form) => { form.meta.name = ""; }), /saknar namn|namn/i],
    [formText((form) => { form.meta.color = "svart"; }), /Färgen ”svart”/],
  ];
  for (const [text, message] of refused) assert.throws(() => readFormAiForm(text, "Elbolaget AB"), message, text.slice(0, 60));
  assert.equal(({} as Record<string, unknown>).isAdmin, undefined, "nothing reached a prototype");
});

test("the card's summary: the name, the sections with their fields, issues and limits that carry numbers", () => {
  const summary = formAiSummary(readFormAiForm(formText(), "Elbolaget AB"));
  assert.equal(summary.name, "Nytt formulär");
  assert.deepEqual(summary.sections, [{ title: "Grunduppgifter", fields: 2 }, { title: "Kontroll", fields: 2 }, { title: "Signering", fields: 1 }]);
  assert.equal(summary.fields, 5, "the summary of deviations is not a field");
  assert.equal(summary.issues, 0);
  assert.equal(summary.limitValues, 0);
  const withLimit = formAiSummary(readFormAiForm(formText((form) => { form.document.limits = [{ key: "fukt", label: "Fukt", unit: "%", low: null, high: 80, warnLow: null, warnHigh: null, source: "" }]; }), "Elbolaget AB"));
  assert.equal(withLimit.limitValues, 1, "a number in a limit is told on the card");
});

test("the proposal: a new form or the given draft only, with the summary the model reads", () => {
  const draft = { templateId: "tpl-1", draftRevision: 4 };
  const created = formProposalFrom({ templateId: null, summary: "En enkel kontroll.", form: formText() }, { publisherName: "Elbolaget AB", draft });
  assert.ok("payload" in created);
  assert.equal(created.payload.templateId, null);
  assert.equal(created.payload.draftRevision, null);
  assert.equal(created.payload.meta.name, "Nytt formulär");
  assert.equal("internalNote" in created.payload.meta, false);
  assert.equal(created.payload.note, "En enkel kontroll.");
  assert.match(created.line, /^Nytt formulär ”Nytt formulär”: 3 avsnitt, 5 fält\.$/);
  // Skapa utkast reads the saved proposal once more with the same checks: what passed once passes again, unchanged.
  const again = readFormAiForm(JSON.stringify({ meta: created.payload.meta, document: created.payload.document }), "Elbolaget AB");
  assert.deepEqual(again.document, created.payload.document);
  const changed = formProposalFrom({ templateId: "tpl-1", summary: "La till ett fält.", form: formText() }, { publisherName: "Elbolaget AB", draft });
  assert.ok("payload" in changed);
  assert.equal(changed.payload.templateId, "tpl-1");
  assert.equal(changed.payload.draftRevision, 4, "the change waits for the revision it was made on");
  assert.match(changed.line, /^Ändring av utkastet/);
  // Another form, an invented id or no draft at all: refused, nothing to save.
  assert.deepEqual(formProposalFrom({ templateId: "tpl-2", summary: "", form: formText() }, { publisherName: "x", draft }), { error: "Ändra bara formuläret i currentDraft, eller föreslå ett nytt med templateId null." });
  assert.ok("error" in formProposalFrom({ templateId: "tpl-1", summary: "", form: formText() }, { publisherName: "x", draft: null }));
  assert.ok("error" in formProposalFrom({ templateId: null, summary: "", form: "{}" }, { publisherName: "x", draft: null }));
  assert.ok("error" in formProposalFrom({ templateId: null, summary: "" }, { publisherName: "x", draft: null }), "the form is required");
});

test("form mode's tools: only propose_form reaches the proposer, no read tool runs, and the tool is strict and registered", async () => {
  const handled: string[] = [];
  const ran: string[] = [];
  const runner = createAssistantToolRunner({ policy: on, alias: new AliasMap(), run: async (name) => { ran.push(name); return {}; }, maxCalls: FORM_AI_MAX_TOOL_CALLS, readTools: false,
    proposer: { allowed: [FORM_AI_TOOL], handle: async (name) => { handled.push(name); return { proposal: { id: "p1", kind: FORM_AI_KIND } }; } } });
  assert.match(await runner.callTool(FORM_AI_TOOL, JSON.stringify({ templateId: null, summary: "", form: formText() })), /p1/);
  assert.match(await runner.callTool("search", JSON.stringify({ query: "kund" })), /inte tillåtet/);
  // Two calls in all: a third is refused whatever it is.
  assert.match(await runner.callTool(FORM_AI_TOOL, JSON.stringify({ templateId: null, summary: "", form: formText() })), /Gränsen/);
  assert.deepEqual(handled, [FORM_AI_TOOL]);
  assert.deepEqual(ran, [], "no read tool ran");
  // The provider's strict schema: every property required, no others.
  const parameters = FORM_AI_DEFINITION.parameters as { type: string; properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
  assert.equal(parameters.additionalProperties, false);
  assert.deepEqual([...parameters.required].sort(), Object.keys(parameters.properties).sort());
  const agent = getWorkflowAgent("workflow-assistant");
  assert.ok(agent?.tools.some((tool) => tool.name === FORM_AI_TOOL && tool.effect === "PROPOSE"), "registered as a proposal tool of Workflow AI");
  assert.ok((agent?.limits.maxOutputTokens ?? 0) >= FORM_AI_MAX_OUTPUT_TOKENS * (FORM_AI_MAX_TOOL_CALLS + 1), "the run may reserve a whole form per turn");
});

test("the chat's form mode: what it may send, and the box before a photo", () => {
  assert.deepEqual(formModeSchema.parse({ templateId: "tpl-1", ownProtocol: true }), { templateId: "tpl-1", ownProtocol: true });
  assert.deepEqual(formModeSchema.parse({}), {});
  assert.equal(formModeSchema.safeParse({ templateId: "tpl-1", organizationId: "annat" }).success, false, "nothing else goes with it");
  assert.equal(FORM_AI_OWN_PROTOCOL_LABEL, "Det här är vårt eget protokoll");
});
