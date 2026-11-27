// Agenter (2026-11-21): the pure rules – the schedule in Swedish time, Kontrollera, the description, Tolka, the caution rules
// that make Publicera automatiskt a draft, the run keys, the retries, the feedback channels, the templates, the built-in agents and
// the job's engine with its own store.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkMission, costText, describeMission, type MissionFacts } from "../lib/agents/check";
import { runAgentJob, runClaimedAgent, type AgentStore, type EngineRun } from "../lib/agents/engine";
import { daysInWords, interpretMission, timeInWords } from "../lib/agents/interpret";
import {
  agentNoticeKey, cautionReasons, changedFields, changesWhatOrWhere, effectRef, feedbackPending, MAX_MISSIONS, mainLink, manualRunKey, missionScheduleText, nextMissionRun, parseAgentNoticeKey,
  publishDecision, scheduledRunKey, settleRun, STOPPED_TEXT, type MissionDraft,
} from "../lib/agents/model";
import { allowedProposalTools, cleanFocus, FOCUS_MAX, focusInstruction, offeredAt, resolveSystemAgent, SYSTEM_AGENTS, systemAgent } from "../lib/agents/system-agents";
import { AGENT_TEMPLATES, agentTemplate, costClass, TEMPLATE_KEYS } from "../lib/agents/templates";
import { offerShown } from "../features/ai/chat-offers";
import { DEFAULT_TABS, shownTabs } from "../lib/workflow/native-layout";
import { AUTO_KINDS, isAutoKind } from "../lib/ai/chat-proposals";
import { swedishParts } from "../lib/swedish-time";

const at = (iso: string) => new Date(iso);
const parts = (date: Date | null) => { assert.ok(date); const p = swedishParts(date); return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`; };

test("the schedule: the next run in Swedish time, strictly after now", () => {
  // Friday 2026-11-20 10:00 Swedish time (09:00 UTC).
  const friday = at("2026-11-20T09:00:00Z");
  assert.equal(parts(nextMissionRun({ kind: "weekly", weekdays: [1], time: "07:00" }, friday)), "2026-11-23 07:00", "next Monday");
  assert.equal(parts(nextMissionRun({ kind: "weekly", weekdays: [5], time: "14:00" }, friday)), "2026-11-20 14:00", "later the same day");
  assert.equal(parts(nextMissionRun({ kind: "weekly", weekdays: [5], time: "10:00" }, friday)), "2026-11-27 10:00", "the same minute is not a next run");
  assert.equal(parts(nextMissionRun({ kind: "daily", time: "07:00" }, friday)), "2026-11-23 07:00", "a weekday, never Saturday");
  assert.equal(parts(nextMissionRun({ kind: "monthly_first_weekday", time: "06:30" }, friday)), "2026-12-01 06:30", "1 December 2026 is a Tuesday");
  assert.equal(parts(nextMissionRun({ kind: "monthly_first_weekday", time: "06:30" }, at("2026-07-15T10:00:00Z"))), "2026-08-03 06:30", "1–2 August 2026 are a weekend");
  assert.equal(parts(nextMissionRun({ kind: "monthly_first", weekday: 1, time: "07:00" }, friday)), "2026-12-07 07:00", "the first Monday of December");
  // Summer time starts 2027-03-28: 02:30 does not exist that night and runs at 03:30.
  assert.equal(parts(nextMissionRun({ kind: "weekly", weekdays: [7], time: "02:30" }, at("2027-03-27T12:00:00Z"))), "2027-03-28 03:30");
  assert.equal(parts(nextMissionRun({ kind: "weekly", weekdays: [1], time: "07:00" }, at("2026-10-25T12:00:00Z"))), "2026-10-26 07:00", "winter time");
});

test("the schedule in plain Swedish", () => {
  assert.equal(missionScheduleText({ kind: "weekly", weekdays: [1], time: "07:00" }), "Måndagar 07:00");
  assert.equal(missionScheduleText({ kind: "weekly", weekdays: [4, 1], time: "07:00" }), "Måndagar och torsdagar 07:00");
  assert.equal(missionScheduleText({ kind: "weekly", weekdays: [1, 2, 3, 4, 5], time: "07:00" }), "Vardagar 07:00");
  assert.equal(missionScheduleText({ kind: "monthly_first_weekday", time: "06:30" }), "Första vardagen varje månad 06:30");
  assert.equal(missionScheduleText({ kind: "monthly_first", weekday: 1, time: "07:00" }), "Första måndagen varje månad 07:00");
});

test("the run keys: one per mission and slot, and what a run makes carries it", () => {
  const slot = at("2026-11-23T06:00:00Z");
  assert.equal(scheduledRunKey("m1", slot), "m1@2026-11-23T06:00:00.000Z");
  assert.equal(scheduledRunKey("m1", slot), scheduledRunKey("m1", new Date(slot.getTime())), "the same slot is the same key");
  assert.notEqual(manualRunKey("m1", "a"), manualRunKey("m1", "b"));
  assert.ok(effectRef("x".repeat(400)).length <= 200);
  assert.equal(parseAgentNoticeKey(agentNoticeKey("run7")), "run7");
  assert.equal(parseAgentNoticeKey("TEAM:x"), null);
});

test("caution: Publicera automatiskt becomes a draft when it is sensitive, uncertain – and always the first time", () => {
  const plain = { text: "Den här veckan har vi bytt belysning i en skola och gjort service på ventilation.", firstRun: false, basisCount: 3 };
  assert.deepEqual(cautionReasons(plain), []);
  assert.equal(publishDecision("auto", cautionReasons(plain)), "publish");
  assert.equal(publishDecision("draft", []), "draft", "Spara som utkast never publishes");
  assert.match(cautionReasons({ ...plain, firstRun: true }).join(" "), /första körning/);
  for (const text of ["Ring oss på 070-123 45 67", "Mejla anna@exempel.se", "Arbetet på Storgatan 12 är klart", "Arbetet hos Kvarnens Bageri är klart"])
    assert.match(cautionReasons({ ...plain, text, sensitive: ["Kvarnens Bageri"] }).join(" "), /kunder, personer eller kontaktuppgifter/, text);
  assert.match(cautionReasons({ ...plain, text: "Nu 20 % rabatt" }).join(" "), /priser/);
  assert.match(cautionReasons({ ...plain, text: "Isolationsresistansen var 500 MΩ" }).join(" "), /elsäkerhet/);
  assert.match(cautionReasons({ ...plain, text: "Vi garanterar att allt håller" }).join(" "), /lovar/);
  assert.match(cautionReasons({ ...plain, uncertain: true }).join(" "), /osäkert/);
  assert.match(cautionReasons({ ...plain, basisCount: 0 }).join(" "), /tunt/);
  assert.equal(publishDecision("auto", ["x"]), "draft");
});

test("an edit of what, target or basis makes the next run a first run; the log names the parts, never the text", () => {
  const base: MissionDraft = { name: "A", instruction: "x", templateKey: "weekly_work_orders", scope: { projectIds: ["p1", "p2"], roundScheduleId: null }, schedule: { kind: "weekly", weekdays: [1], time: "07:00" }, target: { kind: "report", publish: "draft", channels: [] }, feedback: ["EMAIL"] };
  const renamed: MissionDraft = { ...base, name: "B", schedule: { kind: "daily", time: "08:00" }, feedback: ["CHAT"] };
  assert.equal(changesWhatOrWhere(base, renamed), false);
  assert.equal(changesWhatOrWhere(base, { ...base, scope: { projectIds: ["p2", "p1"], roundScheduleId: null } }), false, "the order of the projects is no change");
  assert.equal(changesWhatOrWhere(base, { ...base, target: { kind: "post", publish: "auto", channels: ["facebook"] } }), true);
  assert.equal(changesWhatOrWhere(base, { ...base, instruction: "y" }), true);
  assert.deepEqual(changedFields(base as never, { ...base, name: "B", feedback: ["CHAT"] } as never), ["name", "feedback"]);
});

test("retries after 5, 15 and 45 minutes; three failures in a row pause; a refusal that will not pass pauses at once", () => {
  const now = at("2026-11-23T06:00:00Z");
  assert.deepEqual(settleRun({ kind: "done", message: "" }, 1, now, 2), { status: "done", nextAttemptAt: null, streak: 0, pause: null });
  assert.equal(settleRun({ kind: "skip", message: "Planering är avstängt för företaget." }, 1, now, 1).status, "skipped");
  const retry = settleRun({ kind: "retry", message: "nätet" }, 1, now, 0);
  assert.equal(retry.status, "queued");
  assert.equal(retry.nextAttemptAt!.getTime() - now.getTime(), 5 * 60_000);
  assert.equal(settleRun({ kind: "retry", message: "nätet" }, 3, now, 0).nextAttemptAt!.getTime() - now.getTime(), 45 * 60_000);
  assert.equal(settleRun({ kind: "retry", message: "nätet" }, 4, now, 0).status, "failed", "the last attempt fails");
  assert.equal(settleRun({ kind: "fail", message: "x" }, 1, now, 1).pause, null);
  assert.match(settleRun({ kind: "fail", message: "x" }, 1, now, 2).pause ?? "", /3 misslyckade/);
  assert.equal(settleRun({ kind: "fail", message: "Ägaren har lämnat", pause: true }, 1, now, 0).pause, "Ägaren har lämnat");
});

test("feedback: a resend sends only the channels that did not go out", () => {
  assert.deepEqual(feedbackPending(["EMAIL", "NOTICE", "CHAT"], { NOTICE: "sent", EMAIL: "failed" }), ["EMAIL", "CHAT"]);
  assert.deepEqual(feedbackPending(["EMAIL"], { EMAIL: "sent" }), []);
  assert.deepEqual(mainLink([{ kind: "post_draft", label: "x", href: "/p", linkText: "Öppna utkast", state: "done" }], { missionId: "m", runId: "r" }), { href: "/p", text: "Öppna utkast" });
  assert.deepEqual(mainLink([], { missionId: "m", runId: "r" }), { href: "/?view=agents&mission=m&run=r", text: "Visa hela rapporten" });
});

const facts = (patch: Partial<MissionFacts> = {}): MissionFacts => ({
  now: at("2026-11-20T09:00:00Z"), server: true, ownerActive: true, admin: true, modulesOn: ["planning", "rounds", "time", "quotes", "invoicing", "web_posts"], rights: [], missionCount: 0,
  ai: { ready: true, reason: null }, credits: { system: true, balance: 50 },
  connections: { facebook: { connected: true, publishing: true, name: "Sidan" }, instagram: { connected: false, publishing: false, name: null }, linkedin: { connected: true, publishing: false, name: "Företaget" } },
  news: true, projects: { p1: "Skolan" }, rounds: { r1: "Ventilation" }, ...patch,
});
const draft = (patch: Partial<MissionDraft> = {}): MissionDraft => ({ name: "Veckans arbetsorder", instruction: "", templateKey: "weekly_work_orders", scope: { projectIds: [], roundScheduleId: null }, schedule: { kind: "weekly", weekdays: [1], time: "07:00" }, target: { kind: "report", publish: "draft", channels: [] }, feedback: ["EMAIL"], ...patch });
const fields = (raw: unknown, facts_: MissionFacts, creating = true) => checkMission(raw, facts_, { creating }).problems.map((item) => item.field);

test("Kontrollera: a good mission is green, with the next run, the cost and the description", () => {
  const check = checkMission(draft(), facts(), { creating: true });
  assert.equal(check.ok, true);
  assert.equal(check.nextRunAt, "2026-11-23T06:00:00.000Z");
  assert.equal(check.cost.kind, "rules");
  assert.match(check.cost.text, /kostar inget/);
  assert.ok(check.summary.some((line) => /måndagar 07:00, nästa gång måndag 23 november kl\. 07:00/.test(line)), check.summary.join(" | "));
  assert.ok(check.summary.some((line) => /dina behörigheter/.test(line)));
});

test("Kontrollera: each problem names its field and says how to fix it; a mission with a problem cannot be switched on", () => {
  assert.deepEqual(fields(draft({ name: "" }), facts()), ["name"]);
  assert.deepEqual(fields(draft({ feedback: [] }), facts()), ["feedback"]);
  assert.deepEqual(fields(draft(), facts({ missionCount: MAX_MISSIONS })), ["general"]);
  assert.deepEqual(fields(draft(), facts({ missionCount: MAX_MISSIONS }), false), [], "an edit does not count against the limit");
  assert.deepEqual(fields(draft({ templateKey: "custom", instruction: "kort" }), facts()), ["instruction"]);
  assert.deepEqual(fields(draft({ templateKey: "round_month", target: { kind: "work_order", publish: "draft", channels: [] } }), facts()), ["scope"], "the round must be chosen");
  assert.deepEqual(fields(draft({ templateKey: "round_month", scope: { projectIds: [], roundScheduleId: "gone" }, target: { kind: "work_order", publish: "draft", channels: [] } }), facts()), ["scope"]);
  assert.deepEqual(fields(draft({ scope: { projectIds: ["nope"], roundScheduleId: null } }), facts()), ["scope"]);
  assert.deepEqual(fields(draft({ target: { kind: "post", publish: "draft", channels: [] } }), facts()), ["target"], "the template makes no posts");
  assert.ok(fields(draft({ templateKey: "my_week_time" }), facts({ modulesOn: [] })).includes("target"), "a module off");
  const post = draft({ templateKey: "weekly_news_draft", target: { kind: "post", publish: "auto", channels: [] } });
  assert.deepEqual(fields(post, facts()), ["channels"], "auto-publish needs a channel");
  assert.deepEqual(fields({ ...post, target: { kind: "post", publish: "auto", channels: ["instagram"] } }, facts()), ["channels"], "not connected");
  assert.match(checkMission({ ...post, target: { kind: "post", publish: "auto", channels: ["linkedin"] } }, facts(), { creating: true }).problems[0]!.message, /Publicering till LinkedIn är avstängd/);
  assert.equal(checkMission({ ...post, target: { kind: "post", publish: "draft", channels: ["linkedin"] } }, facts(), { creating: true }).ok, true, "a draft needs no publishing switch");
  assert.deepEqual(fields({ ...post, target: { kind: "post", publish: "draft", channels: ["facebook"] } }, facts({ admin: false, rights: ["work-order:read"] })), ["owner"], "posts are an admin's");
  assert.deepEqual(fields({ ...post, target: { kind: "post", publish: "draft", channels: ["facebook"] } }, facts({ ai: { ready: false, reason: "AI är av." } })), ["general"], "a writing template needs AI");
  assert.deepEqual(fields(draft({ templateKey: "weekly_planning_news", target: { kind: "news", publish: "auto", channels: [] } }), facts({ news: false })), ["target"]);
  assert.deepEqual(fields(draft(), facts({ admin: false, rights: [] })), ["scope"], "a right missing");
  assert.deepEqual(fields(draft(), facts({ server: false })), ["general"]);
  assert.deepEqual(fields({ ...draft(), schedule: { kind: "weekly", weekdays: [], time: "07:00" } }, facts()), ["schedule"]);
  assert.deepEqual(fields({ ...draft(), schedule: { kind: "weekly", weekdays: [1], time: "25:00" } }, facts()), ["schedule"]);
});

test("Kontrollera: auto-publish says what may make it a draft; no credits is a note, not a stop", () => {
  const check = checkMission(draft({ templateKey: "weekly_news_draft", target: { kind: "post", publish: "auto", channels: ["facebook"] } }), facts({ credits: { system: true, balance: 0 } }), { creating: true });
  assert.equal(check.ok, true);
  assert.equal(check.cost.kind, "ai");
  assert.equal(check.cautions.length, 2);
  assert.match(check.notes.join(" "), /inga AI-krediter/);
  assert.match(check.summary.join(" "), /Facebook \(Sidan\)/);
  assert.match(costText("ai", { system: false }), /egen AI-nyckel/);
  assert.equal(describeMission(draft({ templateKey: "nope" }), { next: null }).length, 0);
});

test("Tolka: the words become a mission; what they do not say becomes a question, never a guess", () => {
  assert.equal(timeInWords("varje måndag kl. 7"), "07:00");
  assert.equal(timeInWords("klockan 14.30"), "14:30");
  assert.equal(timeInWords("inget klockslag"), null);
  assert.deepEqual(daysInWords("måndagar och torsdagar"), { kind: "weekly", weekdays: [1, 4] });
  assert.deepEqual(daysInWords("första måndagen i månaden"), { kind: "monthly_first", weekday: 1 });
  assert.deepEqual(daysInWords("första vardagen varje månad"), { kind: "monthly_first_weekday" });
  const full = interpretMission("Lista varje måndag kl. 7 veckans arbetsordrar som saknar ansvarig och skicka det som e-post.");
  assert.equal(full.draft.templateKey, "weekly_work_orders");
  assert.deepEqual(full.draft.schedule, { kind: "weekly", weekdays: [1], time: "07:00" });
  assert.deepEqual(full.draft.feedback, ["EMAIL"]);
  assert.deepEqual(full.questions, []);
  const vague = interpretMission("Skriv ett inlägg om veckans arbeten");
  assert.equal(vague.draft.templateKey, "weekly_news_draft");
  assert.deepEqual(vague.questions.map((item) => item.field).sort(), ["feedback", "schedule", "schedule", "target"]);
  const publish = interpretMission("Skriv en veckonyhet varje fredag kl 14 och publicera automatiskt, notis till mig");
  assert.equal(publish.draft.target.publish, "auto");
  assert.ok(publish.questions.some((item) => item.field === "channels"), "where it publishes is asked");
  const round = interpretMission("Driftrond Ventilation första vardagen varje månad kl. 6:30, notis", { rounds: { r1: "Ventilation", r2: "Kyla" } });
  assert.equal(round.draft.scope.roundScheduleId, "r1");
  assert.equal(interpretMission("driftronden varje månad kl 6, notis", { rounds: { r1: "Ventilation", r2: "Kyla" } }).questions.some((item) => item.field === "scope"), true, "two rounds and none named: asked");
});

test("the ten templates and Med egna ord: what they make, what they cost and that they never widen anything", () => {
  // The ten, the two that start on an event (2026-11-21) and Med egna ord.
  assert.equal(TEMPLATE_KEYS.length, 13);
  assert.equal(AGENT_TEMPLATES.filter((item) => item.key !== "custom" && item.defaults.schedule.kind !== "event").length, 10);
  for (const template of AGENT_TEMPLATES) {
    assert.ok(template.targets.includes(template.defaults.target.kind), `${template.key}: its default target is its own`);
    assert.ok(template.defaults.feedback.length, template.key);
    if (template.defaults.schedule.kind !== "event") assert.ok(nextMissionRun(template.defaults.schedule, at("2026-11-20T09:00:00Z")), template.key);
    assert.match(template.never, /aldrig/i, template.key);
  }
  assert.deepEqual(AGENT_TEMPLATES.filter((item) => item.writes === "ai").map((item) => item.key), ["weekly_news_draft", "alarm_notice", "custom"], "only the writing ones use the model");
  assert.equal(costClass("weekly_work_orders"), "rules");
  assert.equal(costClass("weekly_news_draft"), "ai");
  assert.equal(agentTemplate("round_month")?.defaults.schedule.kind, "monthly_first_weekday");
  assert.equal(agentTemplate("weekly_news_draft")?.defaults.target.publish, "draft", "a post is a draft from the start");
});

test("the built-in agents: the company's and the person's choices, never what the agent may do", () => {
  assert.ok(SYSTEM_AGENTS.length >= 13);
  for (const id of ["work-order-fill", "work-order-proposal", "time-entry", "planning", "risk", "quote", "summary", "post-series", "review", "import", "daily-digest", "machine-analysis", "flow-tips"]) assert.ok(systemAgent(id), id);
  const agent = systemAgent("quote")!;
  assert.deepEqual(resolveSystemAgent(agent, null, null), { on: true, focus: "", when: "asked", level: "normal", standard: true });
  const resolved = resolveSystemAgent(agent, { on: false, focus: "  Skolor\n och <b>förskolor</b> ", when: "weird" }, { level: "rarely" });
  assert.deepEqual({ on: resolved.on, focus: resolved.focus, when: resolved.when, level: resolved.level }, { on: false, focus: "Skolor och b förskolor /b", when: "asked", level: "rarely" });
  assert.equal(resolveSystemAgent(systemAgent("risk")!, { on: true }, null, false).on, false, "the company switch that already existed wins");
  assert.equal(cleanFocus("x".repeat(500)).length, FOCUS_MAX);
  assert.match(focusInstruction("Skolor"), /aldrig instruktioner/);
  assert.equal(focusInstruction(""), "");
  assert.deepEqual([offeredAt("often", 1), offeredAt("normal", 1), offeredAt("normal", 2), offeredAt("rarely", 2), offeredAt("rarely", 3), offeredAt("off", 3)], [true, false, true, false, true, false]);
  const off = (id: string) => ({ on: id !== "quote", focus: "", when: "", level: "normal" as const, standard: true });
  assert.deepEqual(allowedProposalTools(["propose_work_order", "propose_quote", "propose_post_draft"], off), ["propose_work_order", "propose_post_draft"], "the agent off takes its tool away; tools of no agent stay");
  assert.equal(systemAgent("flow-tips")?.uses, "rules");
});

test("the chat's offers follow the company's Av and the person's level", () => {
  assert.equal(offerShown({ agentId: "flow-tips", priority: 1 }, null), true, "before the levels are read: shown");
  assert.equal(offerShown({ agentId: "flow-tips", priority: 1 }, { "flow-tips": { on: true, level: "normal" } }), false);
  assert.equal(offerShown({ agentId: "flow-tips", priority: 3 }, { "flow-tips": { on: true, level: "rarely" } }), true);
  assert.equal(offerShown({ agentId: "risk", priority: 3 }, { risk: { on: false, level: "often" } }), false);
});

test("Auto saves at once only what Ångra takes back", () => {
  assert.deepEqual([...AUTO_KINDS], ["WORK_ORDER", "PROJECT_PLANNING", "QUOTE", "POST_DRAFT", "AGENT_MISSION", "PLACE_NAMEPLATE"]);
  for (const kind of ["WORK_ORDER_FILL", "TIME_ENTRY", "RISK_HAZARDS", "SUMMARY"]) assert.equal(isAutoKind(kind), false, kind);
});

test("the phone's tab row: Workflow AI is a standard tab; without it Tid takes its place", () => {
  assert.deepEqual([...DEFAULT_TABS], ["home", "jobs", "new", "ai"]);
  assert.deepEqual(shownTabs(DEFAULT_TABS, ["home", "jobs", "new", "ai", "time"]), ["home", "jobs", "new", "ai"]);
  assert.deepEqual(shownTabs(DEFAULT_TABS, ["home", "jobs", "new", "time"]), ["home", "jobs", "new", "time"]);
  assert.deepEqual(shownTabs(["home", "ai"], ["home"]), ["home"], "no Tid either: nothing added");
});

// ---------- the job's engine with its own store ----------
function memoryStore() {
  const runs = new Map<string, EngineRun & { nextAttemptAt: Date; lockedUntil: Date | null; message?: string }>();
  const missions = new Map([["m1", { id: "m1", organizationId: "o1", schedule: { kind: "weekly" as const, weekdays: [1], time: "07:00" }, nextRunAt: at("2026-11-23T06:00:00Z"), failureStreak: 0, paused: null as string | null }]]);
  const store: AgentStore = {
    stale: async (now) => [...runs.values()].filter((run) => run.status === "running" && run.lockedUntil && run.lockedUntil < now),
    dueMissions: async (now) => [...missions.values()].filter((mission) => !mission.paused && mission.nextRunAt && mission.nextRunAt <= now).map((mission) => ({ ...mission })),
    enqueue: async (mission, runKey, slotAt) => { if ([...runs.values()].some((run) => run.runKey === runKey)) return false; runs.set(`r${runs.size + 1}`, { id: `r${runs.size + 1}`, organizationId: mission.organizationId, missionId: mission.id, runKey, attempts: 0, status: "queued", nextAttemptAt: slotAt, lockedUntil: null }); return true; },
    advance: async (missionId, from, to) => { const mission = missions.get(missionId)!; if (mission.nextRunAt?.getTime() === from.getTime()) mission.nextRunAt = to as Date; },
    dueRuns: async (now) => [...runs.values()].filter((run) => run.status === "queued" && run.nextAttemptAt <= now),
    claim: async (runId, now, lockedUntil) => { const run = runs.get(runId); if (!run || run.status !== "queued" || run.nextAttemptAt > now) return null; run.status = "running"; run.lockedUntil = lockedUntil; run.attempts += 1; return { ...run }; },
    finish: async (runId, data) => { const run = runs.get(runId); if (!run || run.status !== "running") return false; run.status = data.status; run.message = data.message; if (data.nextAttemptAt) run.nextAttemptAt = data.nextAttemptAt; run.lockedUntil = null; return true; },
    missionAfterRun: async (missionId, data) => { const mission = missions.get(missionId)!; mission.failureStreak = data.streak; if (data.pause) mission.paused = data.pause; },
    streakOf: async (missionId) => missions.get(missionId)!.failureStreak,
  };
  return { store, runs, missions };
}

test("the engine: one run per slot even when two jobs start at the same minute, and the next time moves on", async () => {
  const { store, runs, missions } = memoryStore();
  let executed = 0;
  const deps = { store, execute: async () => { executed += 1; return { kind: "done" as const, message: "Klar" }; }, notify: async () => undefined };
  const now = at("2026-11-23T06:01:00Z");
  const [first, second] = await Promise.all([runAgentJob(deps, now), runAgentJob(deps, now)]);
  assert.equal(first.queued + second.queued, 1);
  assert.equal(executed, 1, "the claim lets one job carry the run out");
  assert.equal(runs.size, 1);
  assert.equal(missions.get("m1")!.nextRunAt.toISOString(), "2026-11-30T06:00:00.000Z");
});

test("the engine: a stopped run is marked and never retried; retries wait; three failures pause and tell the owner", async () => {
  const { store, runs, missions } = memoryStore();
  const told: string[] = [];
  runs.set("old", { id: "old", organizationId: "o1", missionId: "m1", runKey: "k-old", attempts: 1, status: "running", nextAttemptAt: at("2026-11-23T05:00:00Z"), lockedUntil: at("2026-11-23T05:10:00Z") });
  let outcome: { kind: "retry" | "fail"; message: string } = { kind: "retry", message: "Azure svarade inte" };
  const deps = { store, execute: async () => outcome, notify: async (_run: EngineRun, kind: string) => { told.push(kind); } };
  const result = await runAgentJob(deps, at("2026-11-23T06:01:00Z"));
  assert.equal(result.stale, 1);
  assert.equal(runs.get("old")!.status, "stopped");
  assert.equal(runs.get("old")!.message, STOPPED_TEXT);
  assert.equal(result.retried, 1);
  const queued = [...runs.values()].find((run) => run.id !== "old")!;
  assert.equal(queued.status, "queued");
  outcome = { kind: "fail", message: "Du har inte längre rätt" };
  missions.get("m1")!.failureStreak = 2;
  const done = await runClaimedAgent(deps, queued.id, new Date(queued.nextAttemptAt.getTime() + 1));
  assert.equal(done.status, "failed");
  assert.match(missions.get("m1")!.paused ?? "", /3 misslyckade körningar/);
  assert.deepEqual(told, ["stopped", "paused"]);
});
