import assert from "node:assert/strict";
import { test } from "node:test";
import { AliasMap } from "../lib/ai/alias";
import { ASSISTANT_MAX_TOOL_CALLS, assistantToolNames, collectIds, createAssistantToolRunner } from "../lib/ai/assistant-tools";
import {
  addHazardRows, appendMaterialRows, ASSISTANT_WORK_MAX_TOOL_CALLS, CHAT_PROPOSAL_DEFINITIONS, CHAT_PROPOSAL_TOOLS, chatProposalDefinitions, chatProposalInput, chatProposalToolNames, chatWorkOrderPayload,
  fillWorkOrderDetails, isWorkRequest, quoteFromProjectMaterials, timeProposalProblem, undoHazardRows, undoWorkOrderFill,
} from "../lib/ai/chat-proposals";
import { aiMay, aiSharingPolicySchema, disabledAiSharingPolicy, parseAiSharingPolicy, type AiSharingPolicy } from "../lib/ai/sharing-policy";
import { PROPOSAL_INSTRUCTION, prepareWorkflowAssistantRequest } from "../lib/ai/workflow-assistant";
import { TOOL_CATALOG } from "../lib/tools/catalog";
import { emptyFormValues } from "../lib/workflow/form-document";
import { teamWorkView } from "../lib/workflow/team-work";

const on: AiSharingPolicy = { ...disabledAiSharingPolicy, enabled: true, shareChatContent: true, shareWork: true, shareCustomers: true };
const off = (key: keyof AiSharingPolicy["abilities"]): AiSharingPolicy => ({ ...on, abilities: { ...on.abilities, [key]: false } });

test("Vad Workflow AI får göra: every switch is on for new and existing companies, and the admin can turn each off", () => {
  // A policy saved before the switches existed (no abilities) gets them all on.
  const old = parseAiSharingPolicy({ enabled: true, shareChatContent: true, shareWork: true });
  assert.deepEqual(old.abilities, { chatProposals: true, moreToolCalls: true, teamOverview: true, riskTogether: true });
  assert.equal(aiSharingPolicySchema.parse({}).abilities.teamOverview, true);
  const saved = aiSharingPolicySchema.parse({ enabled: true, shareChatContent: true, abilities: { teamOverview: false } });
  assert.equal(saved.abilities.teamOverview, false);
  assert.equal(saved.abilities.chatProposals, true, "a switch left out stays on");
  assert.equal(aiMay(saved, "teamOverview"), false);
  assert.equal(aiMay(undefined, "chatProposals"), true);
});

test("the switches decide which tools the model gets: proposals, risk together and the team overview", () => {
  assert.deepEqual(chatProposalToolNames(on), [...CHAT_PROPOSAL_TOOLS]);
  assert.deepEqual(chatProposalToolNames(off("chatProposals")), ["propose_risk_hazards"]);
  assert.equal(chatProposalToolNames(off("riskTogether")).includes("propose_risk_hazards"), false);
  // Without tasks shared with Workflow AI there is nothing to propose from.
  assert.deepEqual(chatProposalToolNames({ ...on, shareWork: false }), []);
  assert.ok(assistantToolNames(on).includes("list_team_work"));
  assert.equal(assistantToolNames(off("teamOverview")).includes("list_team_work"), false);
  // Strict schemas at every level, so the provider accepts them.
  for (const definition of chatProposalDefinitions(on)) {
    const check = (schema: Record<string, unknown>) => {
      if (schema.type === "object") { assert.equal(schema.additionalProperties, false, definition.name); assert.deepEqual([...(schema.required as string[])].sort(), Object.keys(schema.properties as object).sort()); for (const value of Object.values(schema.properties as Record<string, Record<string, unknown>>)) check(value); }
      if (schema.type === "array") check(schema.items as Record<string, unknown>);
    };
    check(definition.parameters);
  }
  // Nothing that is a safety decision is offered, and no tool takes likelihood, consequence or residual risk.
  assert.doesNotMatch(JSON.stringify(Object.values(CHAT_PROPOSAL_DEFINITIONS).map((item) => item.parameters)), /likelihood|consequence|residual|signature|complete|confirm/i);
  // The API and MCP core: the team overview is a read tool and material rows a write tool with its own scope.
  assert.equal(TOOL_CATALOG.list_team_work.effect, "read");
  assert.equal(TOOL_CATALOG.add_material_rows.apiScope, "tasks:write");
});

test("work requests get up to five tool calls, ordinary questions three", () => {
  assert.equal(ASSISTANT_MAX_TOOL_CALLS, 3);
  assert.equal(ASSISTANT_WORK_MAX_TOOL_CALLS, 5);
  for (const question of ["Fyll i arbetsordern: bytte JFB i central 2, 25 m kabel", "Skriv tid 7–11 på centralbytet", "Planera in resten av projektet nästa vecka", "Gör en arbetsorder av det här", "Skapa offert från projektets material", "Gör riskbedömningen med mig"])
    assert.ok(isWorkRequest(question), question);
  for (const question of ["Vilka jobb är försenade?", "Vad är kvar i projektet Kvarnen?", "Hur mäter man Zs?"]) assert.equal(isWorkRequest(question), false, question);
});

test("the proposal runner: refused unless allowed, links only to what the server read, placeholders turned back", async () => {
  const alias = new AliasMap();
  const handled: { name: string; input: Record<string, unknown>; seen: string[] }[] = [];
  const runner = createAssistantToolRunner({ policy: on, alias, maxCalls: 5, run: async () => ({ id: "t1", kind: "WORK_ORDER", title: "Byt central hos Njudung Bygg AB", projectId: "p1", customerId: "c1", details: {} }),
    proposer: { allowed: ["propose_work_order"], handle: async (name, input, seen) => { handled.push({ name, input, seen: [...seen] }); return { proposal: { id: "x", kind: "WORK_ORDER", summary: "Arbetsorder." } }; } } });
  // A proposal tool the company does not allow is refused and never handled.
  assert.match(JSON.parse(await runner.callTool("propose_quote", "{}")).error, /inte tillåtet/);
  const customer = alias.add("Kund", "Njudung Bygg AB");
  await runner.callTool("get_task", JSON.stringify({ taskId: "t1" }));
  await runner.callTool("propose_work_order", JSON.stringify({ title: `Åtgärda hos ${customer}`, description: "• Byt", dueDate: null, sourceTaskId: "t1", projectId: null, customerId: null }));
  assert.equal(handled.length, 1);
  assert.equal(handled[0].input.title, "Åtgärda hos Njudung Bygg AB");
  assert.equal("dueDate" in handled[0].input, false, "a null is left out");
  assert.deepEqual(handled[0].seen.sort(), ["c1", "p1", "t1"]);
  // Without a proposer the same call is an unknown tool.
  const plain = createAssistantToolRunner({ policy: on, alias: new AliasMap(), run: async () => ({}) });
  assert.match(JSON.parse(await plain.callTool("propose_work_order", "{}")).error, /inte tillåtet/);
  assert.deepEqual([...collectIds({ projects: [{ id: "a", tasks: [{ id: "b", workOrderId: "c" }] }] }, new Set())].sort(), ["a", "b", "c"]);
});

test("a proposed work order takes its links from the server, never from the model", () => {
  const input = chatProposalInput.propose_work_order.parse({ title: "Byt kanalisation", description: "• Laga genomföringen", dueDate: "2026-10-20", projectId: "model-guess" });
  const payload = chatWorkOrderPayload(input, { projectId: "p1", customerId: "c1", sourceTaskId: "t1", facilityId: null });
  assert.equal(payload.projectId, "p1");
  assert.equal(payload.sourceTaskId, "t1");
  assert.equal("facilityId" in payload, false);
});

test("work order fill: text after what is there, rows last, and undo restores exactly that", () => {
  let next = 0;
  const makeId = () => `00000000-0000-4000-8000-00000000000${++next}`;
  const details = { executionNotes: "Kabel dragen.", deviations: "", materials: [{ id: "old", name: "Dvärgbrytare", quantity: "2", unit: "st" }] };
  const fill = fillWorkOrderDetails(details, { executionNotes: "Bytte JFB i central 2.", deviations: null, materials: [{ name: "Kabel EKK 3G2,5", quantity: "25", unit: "m" }] }, makeId);
  assert.equal(fill.details.executionNotes, "Kabel dragen.\nBytte JFB i central 2.");
  assert.equal(fill.details.deviations, "");
  assert.equal((fill.details.materials as unknown[]).length, 2);
  assert.deepEqual(fill.undo.rowIds, ["00000000-0000-4000-8000-000000000001"]);
  const back = undoWorkOrderFill({ ...fill.details, materials: [...(fill.details.materials as object[]), { id: "later", name: "Annat" }] }, fill.undo);
  assert.equal(back.executionNotes, "Kabel dragen.");
  assert.deepEqual((back.materials as { id: string }[]).map((row) => row.id), ["old", "later"], "only the proposed rows go");
  assert.deepEqual(appendMaterialRows([], [{ name: " Kabel " }], makeId).materials[0], { id: "00000000-0000-4000-8000-000000000002", name: "Kabel", quantity: "", unit: "", kind: "material" });
  assert.equal(chatProposalInput.propose_work_order_fill.safeParse({ taskId: "t1", executionNotes: null, deviations: null, materials: [] }).success, false, "an empty fill is no proposal");
});

test("hazards for the extended risk assessment: only Fara and Åtgärd, empty rows first, undo takes them back", () => {
  const risker: ReturnType<typeof emptyFormValues>["tables"][string] = [{ id: "r1", label: "", cells: {} }, { id: "r2", label: "", cells: { fara: "Stege", atgard: "Fotstöd", sannolikhet: 3 } }];
  const values = { ...emptyFormValues(), tables: { risker } };
  const added = addHazardRows(values, "risker", [{ hazard: "Spänningsförande delar", measure: "Bryt och lås" }, { hazard: "Trafik", measure: "Avspärrning" }], () => "new-1");
  const rows = added.values.tables.risker;
  assert.deepEqual(rows.map((row) => row.id), ["r1", "r2", "new-1"]);
  assert.deepEqual(rows[0].cells, { fara: "Spänningsförande delar", atgard: "Bryt och lås" });
  assert.deepEqual(Object.keys(rows[2].cells).sort(), ["atgard", "fara"], "no likelihood, consequence or residual risk");
  const back = undoHazardRows(added.values, added.undo).tables.risker;
  assert.deepEqual(back.map((row) => row.id), ["r1", "r2"]);
  assert.deepEqual(back[0].cells, { fara: "", atgard: "" });
  assert.equal(back[1].cells.fara, "Stege");
});

test("time proposals stay within bounds", () => {
  const now = new Date("2026-10-09T15:00:00Z");
  assert.equal(timeProposalProblem("2026-10-09T07:00:00+02:00", "2026-10-09T11:00:00+02:00", now), null);
  assert.match(timeProposalProblem("2026-10-09T11:00:00+02:00", "2026-10-09T07:00:00+02:00", now) ?? "", /efter starttiden/);
  assert.match(timeProposalProblem("2026-10-10T07:00:00+02:00", "2026-10-10T11:00:00+02:00", now) ?? "", /framtiden/);
  assert.match(timeProposalProblem("2026-10-08T00:00:00+02:00", "2026-10-09T08:00:00+02:00", now) ?? "", /högst 16/);
  assert.match(timeProposalProblem("2026-08-01T07:00:00+02:00", "2026-08-01T09:00:00+02:00", now) ?? "", /äldre än 31/);
});

test("a quote from the project's material: amounts by the rules, unpriced rows marked, the model writes only text", () => {
  const project = { id: "p1", customerId: "c1", facilityId: null, materials: { lines: [
    { name: "Kabel EKK", unit: "m", quantity: "25", total: 25, price: { purchase: 200, sale: 250, unpriced: 0 } },
    { name: "Dvärgbrytare", unit: "st", quantity: "2", total: 2, price: { purchase: 100, sale: 120, unpriced: 1 } },
    { name: "Diverse", unit: "", quantity: "ca 3", total: null },
  ] } };
  const made = quoteFromProjectMaterials(project, { title: "Centralbyte", description: "Byte av central." });
  assert.deepEqual(made.quote.lines.map((line) => [line.name, line.quantity, line.unitPrice]), [["Kabel EKK", "25", "10"], ["Dvärgbrytare", "2", ""]]);
  assert.equal(made.unpriced, 1);
  assert.equal(made.skipped, 1);
  assert.equal(made.quote.projectId, "p1");
  assert.equal(made.quote.customerId, "c1");
  assert.doesNotMatch(JSON.stringify(CHAT_PROPOSAL_DEFINITIONS.propose_quote.parameters), /price|amount|belopp/i);
});

test("the team overview sorts the list Alla into late, due soon, needs action and waiting", () => {
  const items = [
    { id: "a", kind: "WORK_ORDER", title: "Sen", status: "PLANNED", dueDate: "2026-10-01", assignedToName: "Erik Holm", projectName: "Kvarnen" },
    { id: "b", kind: "FORM", title: "Snart", status: "IN_PROGRESS", dueDate: "2026-10-12" },
    { id: "c", kind: "WORK_ORDER", title: "Väntar", status: "PAUSED", dueDate: "", maintenance: { waitingOn: "MATERIAL" } },
    { id: "d", kind: "WORK_ORDER", title: "Åtgärd", status: "NEEDS_ACTION", dueDate: "2026-11-30" },
    { id: "e", kind: "WORK_ORDER", title: "Klar", status: "COMPLETED", dueDate: "2026-09-01" },
  ];
  const view = teamWorkView(items, "late", "2026-10-09");
  assert.deepEqual(view.counts, { open: 4, late: 1, due_soon: 1, action: 1, waiting: 1 });
  assert.deepEqual(view.items.map((row) => row.id), ["a"]);
  assert.equal(view.items[0].assignedToName, "Erik Holm");
  assert.deepEqual(teamWorkView(items, "waiting", "2026-10-09").items.map((row) => row.waitingOn), ["MATERIAL"]);
});

test("the model is told to take part with proposals only when it has proposal tools, and never to decide safety", () => {
  const base = { model: "m", reasoningEffort: "low" as const, maxOutputTokens: 100, organizationId: "o", actorId: "u", sources: [], history: [{ role: "USER" as const, content: "x" }] };
  const tools = (definitions: { name: string; description: string; parameters: Record<string, unknown> }[]) => ({ definitions, maxToolCalls: 5, callTool: async () => "{}", citations: new Map() });
  const withProposals = prepareWorkflowAssistantRequest({ ...base, tools: tools(chatProposalDefinitions(on)) });
  const readOnly = prepareWorkflowAssistantRequest({ ...base, tools: tools([{ name: "search", description: "Sök", parameters: {} }]) });
  assert.ok(withProposals.instructions.endsWith(PROPOSAL_INSTRUCTION));
  assert.ok(!readOnly.instructions.includes(PROPOSAL_INSTRUCTION));
  assert.match(PROPOSAL_INSTRUCTION, /förenklade riskbedömningen svarar personen själv/);
  assert.match(PROPOSAL_INSTRUCTION, /signera/);
  assert.match(withProposals.instructions, /högst 5 anrop/);
});
