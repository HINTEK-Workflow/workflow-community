import assert from "node:assert/strict";
import { test } from "node:test";
import { AliasMap } from "../lib/ai/alias";
import { planAnswer, swedishToday, swedishWeekNumber, todayAnswer } from "../lib/ai/assistant-rules";
import { AI_TOOL_HINTS, assistantToolDefinitions, createAssistantToolRunner, modelView, preloadedTask, TOOL_OUTPUT_MAX_CHARS } from "../lib/ai/assistant-tools";
import { disabledAiSharingPolicy, type AiSharingPolicy } from "../lib/ai/sharing-policy";
import { TOOL_LOOP_BUDGET_MS, toolChoiceFor } from "../lib/ai/structured-provider";
import { formResultsForReaders } from "../lib/ai/task-results";
import { assistantToolInstruction, prepareWorkflowAssistantRequest } from "../lib/ai/workflow-assistant";
import { BUILTIN_FORMS } from "../lib/workflow/builtin-forms";
import { formLeafBlocks, initialFormValues, newFormRow } from "../lib/workflow/form-document";
import type { ToolName } from "../lib/tools/catalog";

// 2026-10-05: Workflow AI should answer faster and better. These are the pure parts of that work.
const now = new Date("2026-10-05T08:00:00Z"); // Monday, week 41
const everything: AiSharingPolicy = { ...disabledAiSharingPolicy, enabled: true, shareChatContent: true, shareCustomers: true, shareDocuments: true, shareWork: true };
const plan = (question: string) => { const value = planAnswer(question, now); return value.kind === "tool" ? [value.tool, value.input] : value.kind === "lookup" ? ["lookup", { query: value.query, prefer: value.prefer }] : [value.kind]; };

test("rule-first: common questions that used to reach a phrase search or the AI model are answered directly", () => {
  assert.deepEqual(plan("Vilka uppgifter behöver åtgärdas?"), ["list_my_work", { filter: "action" }]);
  assert.deepEqual(plan("Vilka kontroller har avvikelser?"), ["list_my_work", { filter: "action", query: "kontroll" }]);
  assert.deepEqual(plan("Lista mina avvikelser"), ["list_my_work", { filter: "action" }]);
  assert.deepEqual(plan("Vilka protokoll är inte klara?"), ["list_my_work", { filter: "open", query: "kontroll" }]);
  assert.deepEqual(plan("Visa mina pågående arbetsordrar"), ["list_my_work", { filter: "active", query: "arbetsorder" }]);
  assert.deepEqual(plan("Vad är kvar att göra i projektet Kvarnen?"), ["lookup", { query: "kvarnen", prefer: "project" }], "the project, not the person's own list");
  assert.deepEqual(plan("När ska projektet Elvägen 3 vara klart?"), ["lookup", { query: "elvägen 3", prefer: "project" }]);
  assert.deepEqual(plan("Vilka kunder har vi i Växjö?"), ["list_customers", { query: "växjö", limit: 25 }]);
  for (const question of ["Vilket datum är det idag?", "Vilken vecka är det?", "vilken dag är det", "Vad är klockan?"]) assert.deepEqual(plan(question), ["today"], question);
  // Unchanged: interpretation and explanations still go to the AI model, and a meaning question is not a list.
  assert.equal(planAnswer("Sammanfatta avvikelserna i projektet Kvarnen", now).kind, "ai");
  assert.equal(planAnswer("Vad betyder avvikelse i ett protokoll?", now).kind, "ai");
  assert.equal(planAnswer("Vad står det i utförandeanteckningarna på arbetsordern Kabelbyte, och finns det någon avvikelse?", now).kind, "ai", "a question about one task's deviation needs its details");
  assert.equal(planAnswer("Vilka avvikelser finns i projektet Kvarnen?", now).kind !== "tool", true, "a named project is not the person's own list");
  assert.equal(planAnswer("Hinner vi klart med projektet Kvarnen i tid? Resonera kort.", now).kind, "ai");
});

test("today is the Swedish calendar day with weekday and ISO week, also just after midnight in Sweden", () => {
  assert.equal(todayAnswer(now), "I dag är det måndag 5 oktober 2026, vecka 41. Klockan är 10:00.");
  assert.equal(swedishToday(new Date("2026-10-04T22:30:00Z")).date, "2026-10-05", "00:30 in Sweden is already Monday");
  assert.equal(swedishWeekNumber(new Date("2026-01-01T12:00:00Z")), 1);
  assert.equal(swedishWeekNumber(new Date("2026-12-31T12:00:00Z")), 53, "2026 has 53 ISO weeks");
  assert.equal(swedishWeekNumber(new Date("2027-01-04T12:00:00Z")), 1);
  const request = prepareWorkflowAssistantRequest({ model: "gpt-5.6-luna", reasoningEffort: "low", maxOutputTokens: 1_000, organizationId: "o", actorId: "u", sources: [], history: [{ role: "USER", content: "Vad har jag i morgon?" }], now: new Date("2026-10-04T22:30:00Z") });
  const input = JSON.parse(request.input);
  assert.deepEqual(input.today, { date: "2026-10-05", text: "måndag 5 oktober 2026, vecka 41" });
  assert.equal(Object.keys(input).at(-1), "today", "still last, after everything that changes less");
});

test("instructions: one stable text whatever the question, a clear 'I don't know', facts with units, tools last", () => {
  const base = { model: "gpt-5.6-luna", reasoningEffort: "low" as const, maxOutputTokens: 1_000, organizationId: "o", actorId: "u", sources: [] };
  const first = prepareWorkflowAssistantRequest({ ...base, history: [{ role: "USER", content: "Hur mäter man Zs?" }] });
  const second = prepareWorkflowAssistantRequest({ ...base, history: [{ role: "USER", content: "Vad står i protokollet?" }], pageContext: { kind: "FORM", step: "Mätning" } });
  assert.equal(first.instructions, second.instructions, "the question and the page never change the instructions (prompt cache)");
  assert.match(first.instructions, /Det ser jag inte i Workflow/);
  assert.match(first.instructions, /Gissa aldrig namn, datum, status eller mätvärden/);
  assert.match(first.instructions, /med enhet/);
  assert.match(first.instructions, /Allmän kunskap – kontrollera mot gällande standard\./);
  assert.match(first.instructions, /behörig person/);
  const tools = { definitions: assistantToolDefinitions(everything), maxToolCalls: 3, callTool: async () => "{}", citations: new Map() };
  const withTools = prepareWorkflowAssistantRequest({ ...base, history: [{ role: "USER", content: "x" }], tools });
  assert.ok(withTools.instructions.startsWith(first.instructions), "the tool text comes last, so the prefix is shared");
  assert.ok(withTools.instructions.endsWith(assistantToolInstruction(3)));
  assert.match(assistantToolInstruction(3), /list_notifications/);
});

test("tool descriptions tell the model what each tool answers, and list_notifications is one of them", () => {
  const definitions = assistantToolDefinitions(everything);
  const byName = new Map(definitions.map((definition) => [definition.name, definition.description]));
  assert.ok(byName.has("list_notifications"));
  for (const [name, hint] of Object.entries(AI_TOOL_HINTS)) assert.ok(byName.get(name)?.endsWith(hint as string), name);
  assert.match(byName.get("get_task") ?? "", /results/);
  // Only the company's choices decide: without work shared there is no list_notifications.
  assert.equal(assistantToolDefinitions({ ...everything, shareWork: false }).some((definition) => definition.name === "list_notifications"), false);
});

// A thermography protocol with a facility limit of at most 10 K: one row 20 K over its reference.
const thermography = BUILTIN_FORMS.find((form) => form.id === "hintek-termografering")!.document;
function thermographyProtocol() {
  const values = initialFormValues(thermography);
  const block = formLeafBlocks(thermography).find((item) => item.type === "table" && item.key === "objekt");
  assert.ok(block && block.type === "table");
  values.tables.objekt = [{ ...newFormRow(block, "r1"), cells: { objekt: "Central A1, grupp 12", komponent: "Säkring", maxtemp: 60, reftemp: 40, bedomning: "Åtgärda planerat" } }];
  values.limits = { delta_ref: { low: null, high: 10, warnLow: null, warnHigh: 5, source: "Uppdragets bedömningsgrund", origin: "facility" } };
  values.signatures = { termograf: { name: "Anna Berg", confirmed: true, signedAt: "2026-10-05T08:00:00Z" } } as never;
  return values;
}

test("a protocol's results carry labels, units, the limits it was judged against and the rules' deviations", () => {
  const results = formResultsForReaders(thermography, thermographyProtocol());
  const text = JSON.stringify(results);
  assert.ok(results.limits?.some((limit) => limit.limit === "ΔT mot referens" && /10/.test(limit.allowed) && /K/.test(limit.allowed)), JSON.stringify(results.limits));
  assert.ok(text.includes("Högsta temperatur (°C)"), "columns with their units");
  assert.ok(results.validation.deviations.length > 0, "the rules' own judgement goes along");
  assert.equal(text.includes("Anna Berg"), false, "no signatures");
});

test("the model reads a protocol's results instead of its raw values, judgement first, and signatures as aliases", async () => {
  const values = thermographyProtocol();
  const task = { id: "t1", kind: "FORM", title: "Termografering A1", status: "IN_PROGRESS", details: { values }, results: formResultsForReaders(thermography, values), project: { id: "p1", name: "Kvarnen etapp 2" } };
  const view = modelView("get_task", task);
  assert.equal("values" in (view.details as object), false);
  assert.deepEqual(Object.keys(view.results as object).slice(0, 2), ["protocol", "validation"], "a long protocol is cut at the table rows, never at the judgement");
  // A work order without results is untouched, and its signature's name becomes a placeholder.
  const order = { id: "w1", kind: "WORK_ORDER", title: "Byt central", status: "COMPLETED", details: { executionNotes: "Klart.", signature: { name: "Erik Holm", confirmed: true } } };
  assert.equal(modelView("get_task", order), order);
  const alias = new AliasMap();
  const runner = createAssistantToolRunner({ policy: everything, alias, run: async (name: ToolName) => (name === "get_task" ? order : {}) });
  const seen = await runner.callTool("get_task", JSON.stringify({ taskId: "w1" }));
  assert.equal(seen.includes("Erik Holm"), false);
  assert.match(seen, /\[Person 1\]/);
  assert.ok(seen.indexOf("\"sources\"") < seen.indexOf("\"data\""), "the source keys come first, so a cut answer can still be cited");
});

test("the open task is fetched by the server before the model is asked, and does not use the model's calls", async () => {
  const ran: string[] = [];
  const runner = createAssistantToolRunner({ policy: everything, alias: new AliasMap(), maxCalls: 1, run: async (name: ToolName) => { ran.push(name); return { id: "t1", kind: "WORK_ORDER", title: "Byt central", status: "PLANNED", details: {} }; } });
  const preloaded = preloadedTask(await runner.preload("get_task", { taskId: "t1" })) as { sources: { key: string }[]; data: { title: string } };
  assert.equal(preloaded.data.title, "Byt central");
  assert.equal(preloaded.sources[0].key, "source-7");
  assert.equal(runner.calls[0].preloaded, true);
  // The model still has its one call.
  const own = await runner.callTool("get_task", JSON.stringify({ taskId: "t1" }));
  assert.equal(JSON.parse(own).error, undefined);
  assert.match(JSON.parse(await runner.callTool("get_task", JSON.stringify({ taskId: "t1" }))).error, /Gränsen/);
  assert.deepEqual(ran, ["get_task", "get_task"]);
  // A refused preload goes nowhere; a cut one goes as text.
  const refused = createAssistantToolRunner({ policy: { ...everything, shareWork: false }, alias: new AliasMap(), run: async () => ({}) });
  assert.equal(preloadedTask(await refused.preload("get_task", { taskId: "t1" })), undefined);
  assert.equal(preloadedTask(`${"x".repeat(TOOL_OUTPUT_MAX_CHARS)}…(avkortat)`), `${"x".repeat(TOOL_OUTPUT_MAX_CHARS)}…(avkortat)`);
  assert.equal(preloadedTask(null), undefined);
  // The preloaded task goes with the question, after the page and before the conversation.
  const request = prepareWorkflowAssistantRequest({ model: "m", reasoningEffort: "low", maxOutputTokens: 1, organizationId: "o", actorId: "u", sources: [], history: [{ role: "USER", content: "Vad saknas?" }], pageContext: { kind: "WORK_ORDER", taskId: "t1" }, currentTask: preloaded });
  assert.deepEqual(Object.keys(JSON.parse(request.input)), ["authorizedWorkflowSources", "currentPage", "currentTask", "conversation", "today"]);
});

test("a tool loop answers with what it has once the time budget is spent", () => {
  assert.equal(toolChoiceFor(0, 3, 0), "auto");
  assert.equal(toolChoiceFor(2, 3, TOOL_LOOP_BUDGET_MS - 1), "auto");
  assert.equal(toolChoiceFor(3, 3, 0), "none", "the call limit");
  assert.equal(toolChoiceFor(1, 3, TOOL_LOOP_BUDGET_MS), "none", "the time budget");
});
