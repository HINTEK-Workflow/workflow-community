// No "server-only" here: the stores that tell the agents (deviations, machine alarms) also run in the database tests outside Next.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentPrincipal } from "@/lib/integrations/principal";
import { addSwedishDays, swedishDayKey } from "@/lib/swedish-time";
import {
  AGENT_NOTICE_CHANNEL, agentNoticeKey, CONDITION_EVENTS, CONDITION_LOOKBACK_DAYS, conditionEventId, CREDENTIAL_NOTICE_DAYS, EVENT_BURST_PER_HOUR, eventRunKey, eventTargets, isConditionEvent, missionScheduleSchema,
  type AgentEvent, type AgentEventKey, type ConditionEventKey,
} from "./model";
import { costClass } from "./templates";

/**
 * När något händer (2026-11-21): the places where things happen in Workflow tell the agents – a deviation or an incident
 * registered, a work order completed, a machine alarm, a quote answered, a new customer. Each matching active mission gets a run on
 * the same claim, lock and retries as a scheduled one (the job picks it up within five minutes), with the key of the mission and the
 * event, so a re-delivered event runs once. A change an agent made itself never starts that same mission (no loops), and a mission
 * gets at most EVENT_BURST_PER_HOUR runs an hour; past that one run says so in the history and the owner's bell. Never throws: an
 * event is a courtesy to the agents and never stops the change that made it.
 */
export function emitAgentEvent(event: Omit<AgentEvent, "byMissionId" | "at"> & { at?: Date }) {
  const principal = currentPrincipal();
  const byMissionId = principal?.kind === "AGENT" && principal.keyId.startsWith("agent:") ? principal.keyId.slice(6) : null;
  void enqueue({ ...event, at: event.at ?? new Date(), byMissionId }).catch((error) => console.error("Agent event failed", error instanceof Error ? error.message.slice(0, 200) : "unknown"));
}

export async function enqueue(event: AgentEvent) {
  const rows = await prisma.agentMission.findMany({
    where: { organizationId: event.organizationId, status: "active", deletedAt: null, schedule: { path: ["event"], equals: event.key } },
    select: { id: true, ownerId: true, status: true, schedule: true, templateKey: true, name: true }, take: 25,
  });
  if (!rows.length) return { queued: 0, held: 0 };
  const hourAgo = new Date(event.at.getTime() - 3_600_000);
  const counts = await prisma.agentRun.groupBy({ by: ["missionId"], where: { organizationId: event.organizationId, missionId: { in: rows.map((row) => row.id) }, trigger: "event", createdAt: { gte: hourAgo } }, _count: { _all: true } });
  const recent = new Map(counts.map((row) => [row.missionId, row._count._all]));
  const missions = rows.flatMap((row) => { const schedule = missionScheduleSchema.safeParse(row.schedule); return schedule.success ? [{ ...row, schedule: schedule.data, recentRuns: recent.get(row.id) ?? 0 }] : []; });
  const { run, held } = eventTargets(missions, event);
  const payload = { key: event.key, id: event.id, recordId: event.recordId, title: event.title.slice(0, 200), href: event.href } as Prisma.InputJsonValue;
  let queued = 0;
  for (const mission of run) {
    const created = await prisma.agentRun.createMany({ data: [{ organizationId: event.organizationId, missionId: mission.id, runKey: eventRunKey(mission.id, event.id), trigger: "event", slotAt: event.at, nextAttemptAt: event.at, event: payload, cost: costClass(mission.templateKey) }], skipDuplicates: true });
    queued += created.count;
  }
  // Past the limit: one run per mission and hour says so, in the history and the bell.
  const hour = event.at.toISOString().slice(0, 13);
  for (const mission of held) {
    const runKey = `${mission.id}@burst:${hour}`;
    const made = await prisma.agentRun.create({ data: { organizationId: event.organizationId, missionId: mission.id, runKey, trigger: "event", slotAt: event.at, status: "skipped", finishedAt: event.at,
      message: `Fler än ${EVENT_BURST_PER_HOUR} händelser på en timme. Resten av timmens händelser kör inte uppdraget.`, report: { title: mission.name, summary: `Fler än ${EVENT_BURST_PER_HOUR} händelser på en timme. Resten av timmens händelser kör inte uppdraget.`, sections: [] } }, select: { id: true } })
      .catch((error) => { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null; throw error; });
    if (made) await prisma.noticeDelivery.create({ data: { organizationId: event.organizationId, userId: mission.ownerId, key: agentNoticeKey(made.id), channel: AGENT_NOTICE_CHANNEL } }).catch(() => undefined);
  }
  return { queued, held: held.length };
}

/**
 * Fler händelser (2026-11-23): an invoice past its due date, a work order past Klart senast, an intyg going out within 30 days. These
 * are states that are reached, not changes anyone makes, so the job (every five minutes) looks for them for the companies that have
 * an active mission on them. Each record runs a mission once per date (the event id holds the record and its date, and the run key
 * the mission and the event), only records that reached the state within the last days count (a new mission never runs on years of
 * old records), and the burst limit holds as for every event.
 */
export async function conditionEvents(organizationId: string, key: ConditionEventKey, now: Date): Promise<AgentEvent[]> {
  const today = swedishDayKey(now);
  const since = swedishDayKey(addSwedishDays(now, -CONDITION_LOOKBACK_DAYS));
  const base = { organizationId, key, actorId: null, at: now };
  if (key === "invoice_overdue") {
    const rows = await prisma.customerInvoice.findMany({ where: { organizationId, kind: "INVOICE", paidOn: null, dueOn: { lt: today, gte: since }, credits: { none: {} } }, select: { id: true, label: true, title: true, dueOn: true }, orderBy: { dueOn: "asc" }, take: 50 });
    return rows.map((row) => ({ ...base, id: conditionEventId(key, row.id, row.dueOn ?? ""), recordId: row.id, title: `${row.label} ${row.title}`.trim().slice(0, 200), href: "/?view=customer_invoices" }));
  }
  if (key === "work_order_overdue") {
    const rows = await prisma.workflowTask.findMany({ where: { organizationId, kind: "WORK_ORDER", status: { notIn: ["COMPLETED", "CANCELLED"] }, dueDate: { lt: today, gte: since } }, select: { id: true, title: true, dueDate: true }, orderBy: { dueDate: "asc" }, take: 50 });
    return rows.map((row) => ({ ...base, id: conditionEventId(key, row.id, row.dueDate), recordId: row.id, title: row.title.slice(0, 200), href: `/?view=workflow_task&taskId=${encodeURIComponent(row.id)}&taskType=WORK_ORDER` }));
  }
  const until = swedishDayKey(addSwedishDays(now, CREDENTIAL_NOTICE_DAYS));
  const rows = await prisma.selfInspectionCredential.findMany({ where: { organizationId, leftAt: null, validUntil: { gte: today, lte: until } }, select: { id: true, title: true, validUntil: true, user: { select: { name: true, email: true } } }, orderBy: { validUntil: "asc" }, take: 50 });
  return rows.map((row) => ({ ...base, id: conditionEventId(key, row.id, row.validUntil ?? ""), recordId: row.id, title: `${row.title} (${row.user.name || row.user.email}, gäller till ${row.validUntil})`.slice(0, 200), href: "/?view=self_inspection" }));
}

/** The companies with an active mission on a reached state, and their events queued (the job). Never throws for one company. */
export async function sweepConditionEvents(now = new Date()) {
  const rows = await prisma.agentMission.findMany({ where: { status: "active", deletedAt: null, organization: { isActive: true }, OR: CONDITION_EVENTS.map((key) => ({ schedule: { path: ["event"], equals: key } })) }, select: { organizationId: true, schedule: true }, take: 500 });
  const wanted = new Map<string, Set<ConditionEventKey>>();
  for (const row of rows) {
    const schedule = missionScheduleSchema.safeParse(row.schedule);
    if (!schedule.success || schedule.data.kind !== "event" || !isConditionEvent(schedule.data.event)) continue;
    wanted.set(row.organizationId, (wanted.get(row.organizationId) ?? new Set()).add(schedule.data.event));
  }
  let queued = 0;
  for (const [organizationId, keys] of wanted) for (const key of keys) {
    try { for (const event of await conditionEvents(organizationId, key, now)) queued += (await enqueue(event)).queued; }
    catch (error) { console.error("Agent condition event failed", error instanceof Error ? error.message.slice(0, 200) : "unknown"); }
  }
  return { companies: wanted.size, queued };
}

/** The latest event of a kind in the company, as Provkör's example (null: none yet). */
export async function latestEvent(organizationId: string, key: AgentEventKey): Promise<AgentEvent | null> {
  const at = new Date();
  const base = { organizationId, key, actorId: null, at };
  if (isConditionEvent(key)) {
    // Provkör: the latest record in the state, looking further back than the sweep does.
    const found = await conditionEvents(organizationId, key, at);
    if (found[0]) return { ...found[0], id: `example:${found[0].recordId}` };
    return null;
  }
  if (key === "deviation_created" || key === "incident_created") {
    const row = await prisma.selfInspectionDeviation.findFirst({ where: { organizationId, ...(key === "incident_created" ? { type: { in: ["NEAR_MISS", "ACCIDENT"] } } : {}) }, orderBy: { createdAt: "desc" }, select: { id: true, title: true } });
    return row ? { ...base, id: `example:${row.id}`, recordId: row.id, title: row.title, href: "/?view=deviations" } : null;
  }
  if (key === "work_order_completed") {
    const row = await prisma.workflowTask.findFirst({ where: { organizationId, kind: "WORK_ORDER", status: "COMPLETED" }, orderBy: { completedAt: "desc" }, select: { id: true, title: true } });
    return row ? { ...base, id: `example:${row.id}`, recordId: row.id, title: row.title, href: `/?view=workflow_task&taskId=${row.id}&taskType=WORK_ORDER` } : null;
  }
  if (key === "machine_alarm") {
    const row = await prisma.machineEvent.findFirst({ where: { organizationId, type: "alarm" }, orderBy: { occurredAt: "desc" }, select: { id: true, text: true } });
    return row ? { ...base, id: `example:${row.id}`, recordId: row.id, title: row.text.slice(0, 120), href: "/?view=maintenance" } : null;
  }
  if (key === "quote_accepted" || key === "quote_declined") {
    const row = await prisma.quote.findFirst({ where: { organizationId, status: key === "quote_accepted" ? "ACCEPTED" : "DECLINED" }, orderBy: { decidedAt: "desc" }, select: { id: true, title: true } });
    return row ? { ...base, id: `example:${row.id}`, recordId: row.id, title: row.title, href: `/?view=quote&quoteId=${row.id}` } : null;
  }
  const row = await prisma.customer.findFirst({ where: { organizationId, ownCompany: false }, orderBy: { createdAt: "desc" }, select: { id: true, name: true } });
  return row ? { ...base, id: `example:${row.id}`, recordId: row.id, title: row.name, href: `/?view=customers&customerId=${row.id}` } : null;
}
