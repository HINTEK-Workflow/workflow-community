// Agenter, flexiblare (2026-11-23): the freer schedule (varannan vecka, sista dagen i månaden, flera klockslag, ett visst datum),
// Tolka of those words, the new events, Kontrollera without Workflow AI, more recipients who only get what they may read, a template
// made one's own, and the tools the model may propose (never a denied one).
import assert from "node:assert/strict";
import { test } from "node:test";
import { AI_OFF_TEXT, checkMission, type MissionFacts } from "../lib/agents/check";
import { dateInWords, daysInWords, eventInWords, interpretMission, timesInWords } from "../lib/agents/interpret";
import { cleanRecipients, conditionEventId, isConditionEvent, missionDraftSchema, missionScheduleText, nextMissionRun, scheduleTimes, type MissionDraft } from "../lib/agents/model";
import { missingRights, readNeeds, resolveRecipients, type Colleague } from "../lib/agents/recipients";
import { agentTemplate, outsideTemplate, ownWordsFrom, TEMPLATES_OWN_WORDS_FIRST } from "../lib/agents/templates";
import { acceptedProposedTools, sourcesIn, writeToolMenu } from "../lib/agents/tool-policy";
import { swedishParts } from "../lib/swedish-time";
import { AGENT_LIST_KINDS, agentKindMatches, agentListMatches, type AgentListItem } from "../lib/agents/agent-list";

const friday = new Date("2026-11-20T09:00:00Z"); // Friday 20 November 2026, 10:00 Swedish time
const parts = (date: Date | null) => { assert.ok(date); const p = swedishParts(date); return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`; };

test("the freer schedule: every other week, the last day of the month, several times a day and a date once", () => {
  assert.equal(parts(nextMissionRun({ kind: "biweekly", weekdays: [1], time: "07:00", from: "2026-11-16" }, friday)), "2026-11-30 07:00", "week 1 is skipped, week 2 runs");
  assert.equal(parts(nextMissionRun({ kind: "biweekly", weekdays: [1], time: "07:00", from: "2026-11-23" }, friday)), "2026-11-23 07:00", "the first week runs");
  assert.equal(parts(nextMissionRun({ kind: "biweekly", weekdays: [5], time: "07:00", from: "2026-12-01" }, friday)), "2026-12-04 07:00", "nothing before the first week");
  assert.equal(parts(nextMissionRun({ kind: "monthly_last", time: "16:00" }, friday)), "2026-11-30 16:00");
  assert.equal(parts(nextMissionRun({ kind: "monthly_last", time: "16:00" }, new Date("2027-02-10T09:00:00Z"))), "2027-02-28 16:00", "February");
  assert.equal(parts(nextMissionRun({ kind: "daily", time: "08:00", times: ["15:00"] }, friday)), "2026-11-20 15:00", "the second time the same day");
  assert.equal(parts(nextMissionRun({ kind: "daily", time: "15:00", times: ["08:00"] }, new Date("2026-11-20T15:00:00Z"))), "2026-11-23 08:00", "the earliest time of the next day");
  assert.equal(parts(nextMissionRun({ kind: "once", date: "2026-12-05", time: "08:00" }, friday)), "2026-12-05 08:00");
  assert.equal(nextMissionRun({ kind: "once", date: "2026-11-01", time: "08:00" }, friday), null, "a date that has passed never runs");
  assert.deepEqual(scheduleTimes({ kind: "weekly", weekdays: [1], time: "15:00", times: ["08:00", "15:00"] }), ["08:00", "15:00"]);
  assert.equal(missionScheduleText({ kind: "daily", time: "08:00", times: ["15:00"] }), "Varje vardag 08:00 och 15:00");
  assert.equal(missionScheduleText({ kind: "biweekly", weekdays: [1, 4], time: "07:00", from: "2026-11-16" }), "Varannan vecka, måndagar och torsdagar 07:00");
  assert.equal(missionScheduleText({ kind: "monthly_last", time: "16:00" }), "Sista dagen varje månad 16:00");
  assert.equal(missionScheduleText({ kind: "once", date: "2026-12-05", time: "08:00" }), "En gång, 5 december 2026 08:00");
  assert.equal(missionDraftSchema.safeParse({ templateKey: "custom", schedule: { kind: "daily", time: "08:00", times: ["1", "2"] }, target: { kind: "report" } }).success, false, "a time must be TT:MM");
  assert.equal(missionDraftSchema.safeParse({ templateKey: "custom", schedule: { kind: "once", date: "2026-13-01", time: "08:00" }, target: { kind: "report" } }).success, false);
});

test("Tolka: varannan vecka, sista dagen i månaden, kl 8 och 15, den 5 december", () => {
  assert.deepEqual(timesInWords("kl 8 och 15"), ["08:00", "15:00"]);
  assert.deepEqual(timesInWords("kl. 7, 12 och kl 16.30"), ["07:00", "12:00", "16:30"]);
  assert.deepEqual(timesInWords("inget klockslag"), []);
  assert.equal(dateInWords("den 5 december", friday), "2026-12-05");
  assert.equal(dateInWords("den 1 november", friday), "2027-11-01", "a day that has passed this year is next year's");
  assert.equal(dateInWords("2027-01-15", friday), "2027-01-15");
  assert.equal(dateInWords("5 marknader", friday), null, "only a month's name");
  assert.equal(dateInWords("den 31 februari", friday), null);
  assert.deepEqual(daysInWords("sista dagen i månaden", friday), { kind: "monthly_last" });
  assert.deepEqual(daysInWords("varannan måndag", friday), { kind: "biweekly", weekdays: [1], from: "2026-11-20" });
  const biweekly = interpretMission("Varannan måndag kl 8 och 15: lista arbetsordrar som saknar ansvarig, e-post", { now: friday });
  assert.deepEqual(biweekly.draft.schedule, { kind: "biweekly", weekdays: [1], from: "2026-11-20", time: "08:00", times: ["15:00"] });
  assert.deepEqual(biweekly.questions, []);
  assert.equal(interpretMission("Sista dagen i månaden kl. 16, sammanfatta månadens avvikelser, notis", { now: friday }).draft.schedule.kind, "monthly_last");
  const once = interpretMission("Den 5 december kl 9: skriv en sammanfattning av årets offerter, e-post", { now: friday });
  assert.deepEqual(once.draft.schedule, { kind: "once", date: "2026-12-05", time: "09:00" });
  assert.ok(interpretMission("Varannan vecka kl 7, lista offerter, notis", { now: friday }).questions.some((item) => /veckodag/.test(item.question)), "the day is asked, never guessed");
});

test("the new events: the words, Med egna ord about the record, its basis, one run per record and date", () => {
  assert.equal(eventInWords("när en faktura har passerat förfallodagen"), "invoice_overdue");
  assert.equal(eventInWords("när en arbetsorder har passerat klart senast"), "work_order_overdue");
  assert.equal(eventInWords("när ett intyg går ut"), "credential_expiring");
  const overdue = interpretMission("När en faktura har passerat förfallodagen vill jag ha ett mejl");
  assert.equal(overdue.draft.templateKey, "custom");
  assert.deepEqual(overdue.draft.schedule, { kind: "event", event: "invoice_overdue", time: "07:00" });
  assert.ok(overdue.draft.scope.sources?.includes("invoices"));
  assert.equal(isConditionEvent("invoice_overdue"), true);
  assert.equal(isConditionEvent("deviation_created"), false);
  assert.equal(conditionEventId("invoice_overdue", "i1", "2026-11-18"), "invoice_overdue:i1:2026-11-18");
  assert.notEqual(conditionEventId("work_order_overdue", "w1", "2026-11-18"), conditionEventId("work_order_overdue", "w1", "2026-11-25"), "a new date is a new event");
  assert.deepEqual(sourcesIn("obetalda fakturor och intyg"), ["credentials", "invoices"]);
});

const facts = (patch: Partial<MissionFacts> = {}): MissionFacts => ({
  now: friday, server: true, ownerActive: true, admin: false, modulesOn: ["customers", "projects", "planning", "time", "quotes", "invoicing", "self_inspection"], rights: ["work-order:read", "work-order:edit", "work-order:create"], missionCount: 0,
  ai: { ready: true, reason: null }, credits: { system: true, balance: 10 }, connections: { facebook: { connected: false, publishing: false, name: null }, instagram: { connected: false, publishing: false, name: null }, linkedin: { connected: false, publishing: false, name: null } },
  news: false, projects: {}, rounds: {}, ...patch,
});
const custom = (patch: Partial<MissionDraft> = {}): MissionDraft => ({ name: "Veckans läge", instruction: "Sammanfatta veckans arbetsordrar och vad som är försenat", templateKey: "custom", scope: { projectIds: [], roundScheduleId: null, sources: ["work_orders"], period: "week" },
  schedule: { kind: "weekly", weekdays: [1], time: "07:00" }, target: { kind: "report", publish: "draft", channels: [] }, feedback: ["NOTICE"], ...patch });

test("Kontrollera without Workflow AI: a report is still a list and says so plainly; a text needs AI", () => {
  const off = { ai: { ready: false, reason: "Workflow AI är inte påslaget för företaget." } };
  const report = checkMission(custom(), facts(off), { creating: true });
  assert.equal(report.ok, true, "a list works without AI");
  assert.ok(report.notes.includes(AI_OFF_TEXT));
  assert.equal(AI_OFF_TEXT, "Utan Workflow AI blir det bara en lista, ingen bedömning eller text.");
  assert.equal(report.cost.kind, "rules", "no credits for a list");
  assert.doesNotMatch(report.summary.join(" "), /bara en lista/, "the AI-off line is said once, as a note");
  assert.equal(report.notes.filter((note) => note === AI_OFF_TEXT).length, 1);
  const changes = checkMission(custom({ target: { kind: "actions", publish: "draft", channels: [], tools: ["update_task"] } }), facts(off), { creating: true });
  assert.ok(changes.problems.some((item) => item.field === "general"), "changes need the model");
  assert.ok(changes.notes.includes(AI_OFF_TEXT));
  assert.equal(checkMission(custom(), facts(), { creating: true }).notes.includes(AI_OFF_TEXT), false, "with AI on nothing is said");
});

test("Kontrollera: a date that has passed, and an event the owner may not read", () => {
  assert.match(checkMission(custom({ schedule: { kind: "once", date: "2026-11-01", time: "08:00" } }), facts(), { creating: true }).problems[0]!.message, /redan varit/);
  assert.equal(checkMission(custom({ schedule: { kind: "once", date: "2026-12-05", time: "08:00" } }), facts(), { creating: true }).ok, true);
  const invoice = custom({ schedule: { kind: "event", event: "invoice_overdue", time: "07:00" }, scope: { projectIds: [], roundScheduleId: null, sources: ["invoices"], period: "week" } });
  assert.match(checkMission(invoice, facts(), { creating: true }).problems.map((item) => item.message).join(" "), /se fakturor/);
  assert.equal(checkMission(invoice, facts({ rights: ["work-order:read", "invoicing:read"] }), { creating: true }).ok, true);
  assert.match(checkMission(invoice, facts({ rights: ["work-order:read", "invoicing:read"], modulesOn: [] }), { creating: true }).problems.map((item) => item.message).join(" "), /avstängt/);
  const credential = custom({ schedule: { kind: "event", event: "credential_expiring", time: "07:00" } });
  assert.match(checkMission(credential, facts(), { creating: true }).problems.map((item) => item.message).join(" "), /administratör/);
  assert.equal(checkMission(credential, facts({ admin: true }), { creating: true }).ok, true);
});

const team: Colleague[] = [
  { id: "owner", name: "Ägaren", admin: true, rights: [] },
  { id: "admin", name: "Anna Admin", admin: true, rights: [] },
  { id: "field", name: "Fredrik Fält", admin: false, rights: ["work-order:read"] },
  { id: "lead", name: "Lisa Ledare", admin: false, rights: ["work-order:read", "team:read"] },
];

test("more recipients: active colleagues only, each only when they may read what the mission reads", () => {
  const everyone = custom({ recipients: { userIds: [], roles: ["everyone"] } });
  const choice = resolveRecipients(everyone, team, "owner");
  assert.deepEqual(choice.included.map((item) => item.id), ["admin", "lead"], "never the owner twice");
  assert.deepEqual(choice.excluded.map((item) => item.id), ["field"]);
  assert.match(choice.excluded[0]!.reason, /Fredrik Fält får inte resultatet.*se Teamet/);
  assert.deepEqual(resolveRecipients(custom({ recipients: { userIds: [], roles: ["admins"] } }), team, "owner").included.map((item) => item.id), ["admin"]);
  const gone = resolveRecipients(custom({ recipients: { userIds: ["left-company", "lead"], roles: [] } }), team, "owner");
  assert.deepEqual(gone.included.map((item) => item.id), ["lead"]);
  assert.match(gone.excluded[0]!.reason, /inte längre aktiv/, "someone not an active member gets nothing");
  assert.deepEqual(readNeeds(custom({ scope: { projectIds: [], roundScheduleId: null, sources: ["quotes"] } })), ["work-order:read", "quotes:read"]);
  assert.deepEqual(missingRights({ admin: false, rights: ["quotes:read"] }, ["work-order:read", "quotes:read"]), ["work-order:read"]);
  assert.deepEqual(missingRights({ admin: true, rights: [] }, ["admin"]), []);
  assert.ok(readNeeds({ templateKey: "expiring_calibrations", scope: { projectIds: [], roundScheduleId: null }, schedule: { kind: "weekly", weekdays: [1], time: "07:00" } }).includes("admin"));
  assert.equal(cleanRecipients({ userIds: [], roles: [] }), undefined, "nobody chosen is only the owner");
  const check = checkMission(everyone, facts({ members: team, ownerId: "owner" }), { creating: true });
  assert.equal(check.ok, true, "a left-out recipient never stops the mission");
  assert.deepEqual(check.recipients?.included.map((item) => item.id), ["admin", "lead"]);
  assert.ok(check.notes.some((note) => /Fredrik Fält får inte resultatet/.test(note)), "Kontrollera explains who is left out");
  assert.ok(check.summary.some((line) => /Anna Admin och Lisa Ledare får det också som e-post/.test(line)));
  assert.equal(checkMission(custom(), facts({ members: team, ownerId: "owner" }), { creating: true }).recipients, undefined);
  assert.equal(missionDraftSchema.safeParse({ ...everyone, recipients: { userIds: [], roles: ["customers@example.com"] } }).success, false, "never an outside address or an unknown role");
});

test("a template is a starting point: Med egna ord first, and a change makes it the owner's own", () => {
  assert.equal(TEMPLATES_OWN_WORDS_FIRST[0]!.key, "custom");
  const template = agentTemplate("open_deviations")!;
  const fromTemplate: MissionDraft = { name: template.name, instruction: "", templateKey: template.key, scope: { projectIds: ["p1"], roundScheduleId: null }, schedule: { kind: "weekly", weekdays: [3], time: "09:00" }, target: { kind: "report", publish: "draft", channels: [] }, feedback: ["EMAIL"], recipients: { userIds: [], roles: ["admins"] } };
  const own = ownWordsFrom({ ...fromTemplate, instruction: "Lista också vem som är ansvarig" });
  assert.equal(own.templateKey, "custom");
  assert.equal(own.instruction, "Lista också vem som är ansvarig");
  assert.deepEqual(own.scope.sources, ["deviations"], "the template's basis");
  assert.deepEqual(own.scope.projectIds, ["p1"]);
  assert.deepEqual(own.schedule, fromTemplate.schedule, "when stays");
  assert.deepEqual(own.recipients, fromTemplate.recipients, "who gets it stays");
  assert.match(ownWordsFrom(fromTemplate).instruction, /Listar öppna avvikelser/, "no words: the template's own text");
  const round = ownWordsFrom({ ...fromTemplate, templateKey: "round_month", target: { kind: "work_order", publish: "draft", channels: [] } });
  assert.deepEqual([round.target.kind, round.target.tools], ["actions", ["create_work_order"]], "a planned work order becomes the change the owner approves");
  assert.equal(outsideTemplate({ templateKey: "open_deviations", target: { kind: "actions", publish: "draft", channels: [] } }), true);
  assert.equal(outsideTemplate({ templateKey: "open_deviations", target: { kind: "report", publish: "draft", channels: [] } }), false);
  assert.deepEqual(checkMission(own, facts({ projects: { p1: "Skolan" } }), { creating: true }).problems, []);
});

test("the start page's one list: Mina is the own missions, a status or a trigger leaves out what has none, the kinds count", () => {
  const item = (patch: Partial<AgentListItem>): AgentListItem => ({ key: "k", kind: "mission", name: "n", description: "", href: "/", mine: true, status: "active", trigger: "schedule", when: "", updatedAt: null, ...patch });
  const rows = [item({ key: "m1" }), item({ key: "m2", mine: false, status: "paused" }), item({ key: "t", kind: "template", mine: false, status: null }), item({ key: "s", kind: "system", mine: false, trigger: null, status: "off" })];
  const keys = (filter: Partial<Parameters<typeof agentListMatches>[1]>) => rows.filter((row) => agentListMatches(row, { scope: "all", status: "", trigger: "", ...filter })).map((row) => row.key);
  assert.deepEqual(keys({}), ["m1", "m2", "t", "s"]);
  assert.deepEqual(keys({ scope: "mine" }), ["m1"]);
  assert.deepEqual(keys({ status: "paused" }), ["m2"]);
  assert.deepEqual(keys({ status: "off" }), ["s"]);
  assert.deepEqual(keys({ trigger: "schedule" }), ["m1", "m2", "t"], "a built-in agent has no schedule");
  assert.deepEqual(AGENT_LIST_KINDS.map((kind) => rows.filter((row) => agentKindMatches(row, kind)).length), [4, 2, 1, 1]);
});

test("Tolka med Workflow AI: only the catalog's write tools pass, never a denied or a reading one", () => {
  assert.deepEqual(acceptedProposedTools(["update_task", "delete_planned_activity", "get_task", "sign_protocol", 7, "update_task", "create_work_order"]), ["update_task", "create_work_order"]);
  assert.doesNotMatch(writeToolMenu(), /delete_planned_activity/);
  assert.match(writeToolMenu(), /create_work_order: /);
});
