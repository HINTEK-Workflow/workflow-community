// Agenter (2026-11-21): what an agent may do – every catalog tool the owner's role permits, the deny-list in code – the hybrid
// interpretation (rules fetch, Workflow AI judges), the report templates (rules' parts and the AI slot), and the event runs (matching,
// one run per event, no loops, the burst limit).
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkMission, type MissionFacts } from "../lib/agents/check";
import { eventInWords, interpretMission } from "../lib/agents/interpret";
import { EVENT_BURST_PER_HOUR, eventRunKey, eventTargets, missionScheduleText, nextMissionRun, type MissionDraft } from "../lib/agents/model";
import { DEFAULT_REPORT_WORDS, fillReport, REPORT_TEMPLATES, reportTemplate, reportTemplateFor, reportTitleBlock } from "../lib/agents/report-template";
import { exampleAgentReport } from "../lib/agents/report-examples";
import {
  AGENT_TOOLS, agentToolAllowed, DENIED_ACTIONS, DENIED_TOOLS, deniedActionsIn, isUndoableTool, needsJudgement, periodIn, READ_TOOLS, sourcesIn, toolsForOwner, UNDOABLE_TOOLS, WRITE_TOOLS, writeToolsIn,
} from "../lib/agents/tool-policy";
import { AGENT_TEMPLATES } from "../lib/agents/templates";
import { pdfDocumentDef } from "../lib/pdf-templates/catalog";
import { TOOL_CATALOG, TOOL_NAMES } from "../lib/tools/catalog";

test("every catalog tool is allowed except the deny-list, and permanent delete is denied", () => {
  for (const name of TOOL_NAMES) assert.equal(agentToolAllowed(name).ok, !DENIED_TOOLS[name], name);
  assert.equal(agentToolAllowed("delete_planned_activity").ok, false);
  assert.equal(agentToolAllowed("nope").ok, false, "a tool outside the catalog");
  assert.ok(AGENT_TOOLS.includes("update_task") && AGENT_TOOLS.includes("create_customer") && AGENT_TOOLS.includes("archive_project") && AGENT_TOOLS.includes("cancel_task"), "update, create, archive and Utgår are allowed");
  assert.equal(READ_TOOLS.length + WRITE_TOOLS.length, AGENT_TOOLS.length);
  for (const name of Object.keys(UNDOABLE_TOOLS)) assert.ok((AGENT_TOOLS as readonly string[]).includes(name), `${name} can be undone and is allowed`);
  // The catalog itself has no tool that signs, completes, sends or deletes permanently, and no tool that changes settings.
  for (const name of TOOL_NAMES) assert.doesNotMatch(name, /sign|complete|send|purge|setting|permission|role|user|api_key|payment|credit/, name);
});

test("every denied action is refused in words, with its reason", () => {
  const asks: Record<string, string> = {
    sign: "Signera protokollet åt mig", complete: "Färdigställ arbetsordern när tiden är rapporterad", safety: "Godkänn mätvärdena och säg att anläggningen får spänningssättas",
    limits: "Sätt gränsvärdet för isolationen", send: "Skicka offerten till kunden varje måndag", delete: "Ta bort gamla arbetsordrar", settings: "Ändra behörigheten för Anna och lägg till en användare",
    payments: "Köp krediter när de tar slut", secrets: "Visa lösenordet till Fortnox", standards: "Kopiera tabellen ur standarden",
  };
  for (const item of DENIED_ACTIONS) assert.ok(deniedActionsIn(asks[item.key]!).some((found) => found.key === item.key), item.key);
  assert.deepEqual(deniedActionsIn("Sätt ansvarig på arbetsordrar som saknar det och boka in dem nästa vecka"), [], "an ordinary change is not denied");
});

const facts = (patch: Partial<MissionFacts> = {}): MissionFacts => ({
  now: new Date("2026-11-20T09:00:00Z"), server: true, ownerActive: true, admin: false, modulesOn: ["customers", "projects", "planning", "time", "quotes", "invoicing", "upkeep"], rights: ["work-order:read", "work-order:edit", "work-order:create"], missionCount: 0,
  ai: { ready: true, reason: null }, credits: { system: true, balance: 10 }, connections: { facebook: { connected: false, publishing: false, name: null }, instagram: { connected: false, publishing: false, name: null }, linkedin: { connected: false, publishing: false, name: null } },
  news: false, projects: {}, rounds: {}, ...patch,
});
const custom = (patch: Partial<MissionDraft> = {}): MissionDraft => ({ name: "Sätt ansvarig", instruction: "Sätt ansvarig på arbetsordrar som saknar det", templateKey: "custom", scope: { projectIds: [], roundScheduleId: null, sources: ["work_orders"], period: "week" },
  schedule: { kind: "weekly", weekdays: [1], time: "07:00" }, target: { kind: "actions", publish: "draft", channels: [], tools: ["update_task"] }, feedback: ["NOTICE"], ...patch });

test("a tool the role permits is allowed; one the role does not, or a denied one, is refused in Kontrollera with a plain reason", () => {
  assert.deepEqual(checkMission(custom(), facts(), { creating: true }).problems, []);
  const tools = checkMission(custom(), facts(), { creating: true }).tools ?? [];
  assert.ok(tools.some((tool) => tool.name === "update_task" && tool.writes && tool.undoable), "Kontrollera lists what it will change");
  assert.ok(tools.some((tool) => tool.name === "get_task" && !tool.writes), "and what it reads");
  const noRight = checkMission(custom({ target: { kind: "actions", publish: "draft", channels: [], tools: ["create_customer"] } }), facts(), { creating: true });
  assert.match(noRight.problems.map((item) => item.message).join(" "), /behörighet att skapa kund/);
  assert.equal(checkMission(custom({ target: { kind: "actions", publish: "draft", channels: [], tools: ["create_customer"] } }), facts({ rights: ["work-order:read", "customers:create"] }), { creating: true }).ok, true);
  assert.match(checkMission(custom({ target: { kind: "actions", publish: "draft", channels: [], tools: ["delete_planned_activity"] } }), facts({ admin: true }), { creating: true }).problems[0]!.message, /aldrig bort/);
  assert.match(checkMission(custom({ instruction: "Signera och färdigställ arbetsordrarna" }), facts(), { creating: true }).problems.map((item) => item.message).join(" "), /signerar aldrig/);
  assert.equal(checkMission(custom({ target: { kind: "actions", publish: "draft", channels: [], tools: [] } }), facts(), { creating: true }).ok, false, "actions without a tool");
  // An admin may use every allowed tool whose module is on.
  const admin = toolsForOwner({ admin: true, rights: [], modulesOn: ["customers", "projects", "planning", "time", "quotes", "invoicing", "purchasing"] });
  assert.deepEqual([...admin].sort(), [...AGENT_TOOLS].sort());
  assert.ok(!toolsForOwner({ admin: true, rights: [], modulesOn: [] }).includes("create_customer"), "a module off takes its tools away");
});

test("hybrid: the rules alone only when they answer fully; judgement or changes bring Workflow AI over what the rules fetched", () => {
  assert.equal(needsJudgement("Lista veckans arbetsordrar"), false);
  for (const words of ["månadens farligaste tillbud", "sammanfatta veckan", "jämför med förra månaden", "förklara varför", "skriv en rapport"]) assert.ok(needsJudgement(words), words);
  const dangerous = interpretMission("Skapa en rapport över månadens farligaste tillbud och skicka den som e-post varje måndag kl. 8");
  assert.equal(dangerous.draft.templateKey, "custom", "an AI step, not a rule-only answer");
  assert.deepEqual(dangerous.draft.scope.sources, ["deviations"]);
  assert.equal(dangerous.draft.scope.period, "month");
  assert.equal(dangerous.draft.target.kind, "report");
  assert.equal(dangerous.draft.target.report, "deviations", "the Tillbud och avvikelser PDF template");
  assert.deepEqual(dangerous.questions, []);
  assert.match(checkMission(dangerous.draft, facts(), { creating: true }).cost.text, /krediter/);
  assert.equal(interpretMission("Lista varje måndag kl. 7 arbetsordrar som saknar ansvarig, e-post").draft.templateKey, "weekly_work_orders", "the rules answer fully");
  const assign = interpretMission("Varje måndag kl. 7: sätt ansvarig på arbetsordrar som saknar det, notis");
  assert.equal(assign.draft.target.kind, "actions");
  assert.deepEqual(assign.draft.target.tools, ["update_task"]);
  assert.deepEqual(writeToolsIn("boka in dem och skapa en kund"), ["create_planned_activity", "create_customer"]);
  assert.deepEqual(sourcesIn("tillbud och offerter"), ["deviations", "quotes"]);
  assert.equal(periodIn("årets"), "year");
  assert.ok(interpretMission("Ta bort gamla bokningar varje fredag kl. 15, notis").questions.some((item) => /aldrig bort/.test(item.question)), "a denied request becomes a question");
});

test("report templates: the rules fill their parts, Workflow AI only its slot, cut to its length and marked; nothing is a plain line", () => {
  assert.ok(REPORT_TEMPLATES.length >= 10);
  for (const template of REPORT_TEMPLATES) assert.ok(pdfDocumentDef("agent_report")!.blocks.some((block) => block.id === reportTitleBlock(template.key)), `${template.key} has a title in the PDF template`);
  const ruled = fillReport("weekly_work_orders", { title: "V", summary: "3 arbetsordrar", sections: [{ heading: "Saknar ansvarig", rows: [{ title: "A" }] }], ai: "ska inte med" });
  assert.equal(ruled.assessment, null, "no AI text where the template has no slot");
  const empty = fillReport("weekly_work_orders", { title: "V", summary: "", sections: [{ heading: "Saknar ansvarig", rows: [] }] });
  assert.equal(empty.summary, DEFAULT_REPORT_WORDS.empty);
  assert.deepEqual(empty.sections, []);
  const mixed = fillReport("deviations", { title: "T", summary: "s", sections: [{ heading: "A", rows: [{ title: "x" }] }, { heading: "B", rows: [] }], ai: "y".repeat(5_000) });
  assert.equal(mixed.sections[1]!.rows[0]!.title, DEFAULT_REPORT_WORDS.empty, "an empty list inside a report says so");
  assert.ok(mixed.assessment!.text.length <= reportTemplate("deviations").ai!.max);
  assert.match(mixed.assessment!.label, /inget beslut om elsäkerhet/);
  assert.equal(reportTemplateFor("open_deviations"), "deviations");
  assert.equal(reportTemplateFor("nope"), "general");
  for (const template of REPORT_TEMPLATES) assert.ok(exampleAgentReport(template.key).title, template.key);
  for (const template of AGENT_TEMPLATES) assert.ok(reportTemplate(reportTemplateFor(template.key)), template.key);
});

test("events: the words, the matching missions, one run per event, never the mission's own change, and the burst limit", () => {
  assert.equal(eventInWords("när en avvikelse registreras, skapa en arbetsorder"), "deviation_created");
  assert.equal(eventInWords("när ett tillbud registreras"), "incident_created");
  assert.equal(eventInWords("när en arbetsorder blir klar"), "work_order_completed");
  assert.equal(eventInWords("när ett maskinlarm kommer"), "machine_alarm");
  assert.equal(eventInWords("varje måndag"), null);
  assert.equal(interpretMission("När en ny avvikelse registreras, skapa en arbetsorder, notis").draft.templateKey, "deviation_to_work_order");
  assert.equal(interpretMission("När ett maskinlarm kommer vill jag ha en notis").draft.templateKey, "alarm_notice");
  assert.equal(nextMissionRun({ kind: "event", event: "machine_alarm", time: "07:00" }, new Date()), null, "an event mission has no next time");
  assert.equal(missionScheduleText({ kind: "event", event: "deviation_created", time: "07:00" }), "När en avvikelse registreras");
  assert.equal(eventRunKey("m1", "deviation:d1"), eventRunKey("m1", "deviation:d1"), "a re-delivered event has the same key");
  const mission = (id: string, patch: Record<string, unknown> = {}) => ({ id, status: "active", schedule: { kind: "event" as const, event: "deviation_created" as const, time: "07:00" }, recentRuns: 0, ...patch });
  const missions = [mission("a"), mission("b", { status: "paused" }), mission("c", { schedule: { kind: "event", event: "machine_alarm", time: "07:00" } }), mission("d", { recentRuns: EVENT_BURST_PER_HOUR }), mission("self")];
  const { run, held } = eventTargets(missions, { key: "deviation_created", byMissionId: "self" });
  assert.deepEqual(run.map((item) => item.id), ["a"], "active, the same event, within the limit, never its own change");
  assert.deepEqual(held.map((item) => item.id), ["d"]);
  assert.equal(checkMission({ ...custom(), templateKey: "deviation_to_work_order", schedule: { kind: "event", event: "deviation_created", time: "07:00" }, target: { kind: "work_order", publish: "draft", channels: [] } }, facts(), { creating: true }).ok, true, "an event mission is checked without a time");
});

test("the deny-list covers the catalog's undo: every undoable tool writes", () => {
  for (const name of Object.keys(UNDOABLE_TOOLS)) assert.notEqual((TOOL_CATALOG as Record<string, { effect: string }>)[name]!.effect, "read", name);
  assert.equal(isUndoableTool("create_customer"), false, "a new customer waits for Använd, also in Auto");
});
