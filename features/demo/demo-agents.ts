import { checkMission, type MissionFacts } from "@/lib/agents/check";
import { interpretMission, refineMission } from "@/lib/agents/interpret";
import { deniedActionsIn } from "@/lib/agents/tool-policy";
import { missionDraftSchema, missionScheduleText, nextMissionRun, type MissionDraft } from "@/lib/agents/model";
import { resolveSystemAgent, SYSTEM_AGENTS } from "@/lib/agents/system-agents";
import { AGENT_TEMPLATES, agentTemplate } from "@/lib/agents/templates";

/**
 * Agenter in the public demo (2026-11-21): the templates, the built-in agents and two invented missions with a few invented
 * runs, from memory. Kontrollera and Tolka work (they are Workflow's own rules); saving, running, Provkör and every change are
 * refused with one plain sentence – nothing runs in the demo, and no request fails.
 */
export class DemoAgentsError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export const DEMO_AGENTS_REFUSAL = "Agenter går inte att köra eller spara i demon. Du kan titta på mallarna, kontrollera ett uppdrag och se exempel på körningar.";

type Request = { method: string; url: URL; body: unknown };
const now = () => new Date();
const facts = (admin: boolean): MissionFacts => ({
  now: now(), server: true, ownerActive: true, admin, modulesOn: ["customers", "projects", "planning", "rounds", "upkeep", "time", "quotes", "invoicing", "purchasing", "self_inspection", "boards"],
  rights: ["work-order:read", "work-order:create", "projects:read", "quotes:read", "team:read"], missionCount: 2, ai: { ready: false, reason: "Workflow AI går inte att prova i demon." }, credits: { system: false, balance: 0 },
  connections: { facebook: { connected: false, publishing: false, name: null }, instagram: { connected: false, publishing: false, name: null }, linkedin: { connected: false, publishing: false, name: null } },
  news: false, projects: {}, rounds: {},
});

function mission(id: string, templateKey: string, ownerName: string): MissionDraft & Record<string, unknown> {
  const template = agentTemplate(templateKey)!;
  const draft: MissionDraft = { name: template.name, instruction: "", templateKey, scope: { projectIds: [], roundScheduleId: null }, schedule: template.defaults.schedule, target: template.defaults.target, feedback: template.defaults.feedback };
  return { ...draft, id, ownerName, mine: true, status: "active", pausedReason: null, nextRunAt: nextMissionRun(draft.schedule, now())?.toISOString() ?? null, scheduleText: missionScheduleText(draft.schedule),
    lastRunAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), updatedAt: new Date(Date.now() - 7 * 86_400_000).toISOString(), lastOutcomeLabel: "Klar", firstRunPending: false, cost: "rules", version: 1, templateName: template.name };
}
const runs = (missionId: string) => [
  { id: `${missionId}-run-1`, trigger: "schedule", status: "done", statusLabel: "Klar", tone: "success", createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), read: { arbetsordrar: 14 },
    actions: [], report: { title: "Veckans arbetsorder (exempel)", summary: "14 arbetsordrar den här veckan. 3 saknar ansvarig och 1 är förfallen.", sections: [{ heading: "Saknar ansvarig", rows: [{ title: "Byte av belysning i trapphus (exempel)" }, { title: "Service av ventilationsaggregat (exempel)" }, { title: "Felsökning jordfelsbrytare (exempel)" }] }] },
    feedback: { EMAIL: "sent" }, cost: "rules", chargedCredits: 0, message: null },
  { id: `${missionId}-run-2`, trigger: "schedule", status: "nothing", statusLabel: "Inget att rapportera", tone: "neutral", createdAt: new Date(Date.now() - 10 * 86_400_000).toISOString(), read: { arbetsordrar: 0 },
    actions: [], report: { title: "Veckans arbetsorder (exempel)", summary: "Inga arbetsordrar den här veckan.", sections: [] }, feedback: { EMAIL: "sent" }, cost: "rules", chargedCredits: 0, message: null },
];
const MISSIONS = () => [mission("demo-weekly", "weekly_work_orders", "Demoanvändaren"), mission("demo-time", "my_week_time", "Demoanvändaren")];

export function demoAgents(ctx: { admin: boolean }, request: Request): unknown {
  const params = request.url.searchParams;
  if (request.method === "GET") {
    const system = SYSTEM_AGENTS.map((agent) => { const chosen = resolveSystemAgent(agent, null, null); return { ...agent, on: chosen.on, focus: chosen.focus, level: chosen.level, standard: true, whenChosen: chosen.when }; });
    if (params.get("part") === "system") return { system };
    const id = params.get("mission");
    if (id) {
      const found = MISSIONS().find((item) => item.id === id);
      if (!found) throw new DemoAgentsError(404, "Uppdraget finns inte.");
      return { mission: found, runs: runs(id) };
    }
    return { demo: true, missions: MISSIONS(), templates: AGENT_TEMPLATES, system, me: "demo",
      options: { projects: [], rounds: [], connections: facts(ctx.admin).connections, news: false, ai: facts(ctx.admin).ai, credits: { system: false, balance: 0 }, admin: ctx.admin, missionCount: 2, modulesOn: facts(ctx.admin).modulesOn } };
  }
  const body = (request.body && typeof request.body === "object" ? request.body : {}) as Record<string, unknown>;
  if (body.action === "check") return { check: checkMission(body.mission, facts(ctx.admin), { creating: !body.missionId }), options: {} };
  if (body.action === "interpret" && typeof body.text === "string") {
    // Samtalet (2026-11-23): a follow-up changes the current draft with the same pure rules; a first message is read from the start.
    const current = missionDraftSchema.safeParse(body.current);
    const denied = deniedActionsIn(body.text).map((item) => item.reason);
    if (current.success && !(current.data.templateKey === "custom" && !current.data.instruction.trim())) {
      const refined = refineMission(current.data, body.text);
      return { draft: refined.draft, questions: [], understood: [], changes: refined.changes, denied: refined.denied, check: checkMission(refined.draft, facts(ctx.admin), { creating: !body.missionId }) };
    }
    const read = interpretMission(body.text);
    const draft = current.success && current.data.name.trim() ? { ...read.draft, name: current.data.name } : read.draft;
    return { ...read, draft, questions: read.questions.filter((item) => item.field !== "instruction"), changes: [], denied, check: checkMission(draft, facts(ctx.admin), { creating: true }) };
  }
  if (body.action === "preview") {
    const check = checkMission(body.mission, facts(ctx.admin), { creating: !body.missionId });
    return { check, preview: { read: {}, report: { title: "", summary: "", sections: [] }, effects: [], nothing: true, skip: "Provkör går inte i demon. I Workflow visar Provkör exakt vad agenten skulle göra, utan att spara något.", fail: null,
      feedback: { title: String((body.mission as { name?: string } | undefined)?.name ?? "Uppdrag"), summary: "", links: ["Visa hela rapporten (förhandsvisning)"], channels: [] } } };
  }
  // Hur ofta du får förslag: shown as chosen for the moment, never stored.
  if (body.action === "system_person") return demoAgents(ctx, { method: "GET", url: new URL("?part=system", request.url), body: null });
  throw new DemoAgentsError(403, DEMO_AGENTS_REFUSAL);
}
