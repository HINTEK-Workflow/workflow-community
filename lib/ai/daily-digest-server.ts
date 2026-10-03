import "server-only";
import { Prisma } from "@prisma/client";
import { runStructuredAgent } from "@/lib/ai/agent-run";
import { AliasMap } from "@/lib/ai/alias";
import { DIGEST_INSTRUCTIONS, digestHasActivity, digestOutputSchema, ruleDigestText, type DigestFacts } from "@/lib/ai/daily-digest";
import { parseAiSharingPolicy, sharesWork } from "@/lib/ai/sharing-policy";
import { prisma } from "@/lib/db";
import { normalizeControl, validateForCompletion } from "@/lib/kfid/model";
import { addSwedishDays, startOfSwedishDay, swedishDayKey, swedishParts } from "@/lib/swedish-time";

/** The day's facts for one company, counted by the rules: numbers and projects, never people or texts. */
export async function collectDigestFacts(organizationId: string, day: string): Promise<DigestFacts> {
  const start = startOfSwedishDay(`${day}T12:00:00`);
  const end = addSwedishDays(start, 1);
  const window = { gte: start, lt: end };
  const [completed, controls, created, open, overdue, followUps, time, plannedTomorrow, touched] = await Promise.all([
    prisma.workflowTask.groupBy({ by: ["kind"], where: { organizationId, completedAt: window }, _count: { _all: true } }),
    prisma.control.count({ where: { organizationId, deletedAt: null, status: "COMPLETED", updatedAt: window } }),
    prisma.workflowTask.count({ where: { organizationId, createdAt: window } }),
    prisma.workflowTask.groupBy({ by: ["status"], where: { organizationId, status: { not: "COMPLETED" } }, _count: { _all: true } }),
    prisma.workflowTask.count({ where: { organizationId, status: { not: "COMPLETED" }, dueDate: { not: "", lt: day } } }),
    prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM "WorkflowTask" WHERE "organizationId" = ${organizationId} AND kind = 'WORK_ORDER' AND "createdAt" >= ${start} AND "createdAt" < ${end} AND data->'details'->'source'->>'taskId' IS NOT NULL`),
    prisma.workflowTimeEntry.aggregate({ _sum: { durationSec: true }, where: { startedAt: window, endedAt: { not: null }, OR: [{ task: { organizationId } }, { control: { organizationId } }] } }),
    prisma.plannedActivity.count({ where: { organizationId, deletedAt: null, startsAt: { gte: end, lt: addSwedishDays(start, 2) } } }),
    prisma.workflowTask.groupBy({ by: ["projectId"], where: { organizationId, projectId: { not: null }, updatedAt: window }, _count: { _all: true }, orderBy: { _count: { projectId: "desc" } }, take: 6 }),
  ]);
  // Open controls count as on the overview's key figures: one with mandatory points left needs action, the others
  // are in progress – so the digest and Nyckeltal never show different numbers.
  const openControls = await prisma.control.findMany({ where: { organizationId, deletedAt: null, status: { not: "COMPLETED" } }, select: { data: true, _count: { select: { attachments: true } } }, take: 2000 });
  const controlsNeedingAction = openControls.filter((control) => validateForCompletion(normalizeControl(control.data), { attachmentCount: control._count.attachments }).errors.length).length;
  const projectIds = touched.map((row) => row.projectId).filter((id): id is string => Boolean(id));
  const [projects, totals, done] = projectIds.length ? await Promise.all([
    prisma.project.findMany({ where: { organizationId, id: { in: projectIds }, archivedAt: null }, select: { id: true, name: true, dueDate: true, closedAt: true } }),
    prisma.workflowTask.groupBy({ by: ["projectId"], where: { organizationId, projectId: { in: projectIds } }, _count: { _all: true } }),
    prisma.workflowTask.groupBy({ by: ["projectId"], where: { organizationId, projectId: { in: projectIds }, status: "COMPLETED" }, _count: { _all: true } }),
  ]) : [[], [], []];
  const of = (rows: { projectId: string | null; _count: { _all: number } }[], id: string) => rows.find((row) => row.projectId === id)?._count._all ?? 0;
  const kind = (name: string) => completed.find((row) => row.kind === name)?._count._all ?? 0;
  const state = (name: string) => open.find((row) => row.status === name)?._count._all ?? 0;
  return {
    day,
    completed: { workOrders: kind("WORK_ORDER"), protocols: kind("FORM"), riskAssessments: kind("RISK_ASSESSMENT"), controls },
    created,
    open: { planned: state("PLANNED"), inProgress: state("IN_PROGRESS") + openControls.length - controlsNeedingAction, paused: state("PAUSED"), needsAction: state("NEEDS_ACTION") + controlsNeedingAction },
    overdue,
    followUps: followUps[0]?.n ?? 0,
    reportedMinutes: Math.round((time._sum.durationSec ?? 0) / 60),
    plannedTomorrow,
    projects: projectIds.flatMap((id) => {
      const project = projects.find((item) => item.id === id);
      return project ? [{ name: project.name, done: of(done, id), total: of(totals, id), dueDate: project.dueDate || null, late: Boolean(project.dueDate && project.dueDate < day && !project.closedAt) }] : [];
    }),
  };
}

/**
 * Writes the digest of one day for every company that has chosen it and had activity. One digest per company and
 * day: the row is claimed first, so a second run – or two at once – never writes or charges twice. The AI model words
 * the facts on the company's credits; when it cannot, the rules' text is stored instead. Returns counts only.
 */
export async function runDailyDigests(now = new Date(), onlyDay?: string) {
  // Run at night, the digest is about the day that has just ended; run during the day (a test), about today so far.
  const day = onlyDay ?? swedishDayKey(swedishParts(now).hour < 12 ? addSwedishDays(now, -1) : now);
  const companies = await prisma.organization.findMany({ where: { isActive: true, storageMode: "HINTEK_CLOUD" }, select: { id: true } });
  const settings = await prisma.workspaceSettings.findMany({ where: { organizationId: { in: companies.map((company) => company.id) } }, select: { organizationId: true, aiPolicy: true } });
  const result = { day, companies: 0, written: 0, byAi: 0, byRules: 0, quiet: 0, already: 0 };
  for (const setting of settings) {
    const policy = parseAiSharingPolicy(setting.aiPolicy);
    if (!policy.enabled || !policy.dailyDigest || !sharesWork(policy)) continue;
    result.companies += 1;
    const organizationId = setting.organizationId;
    const facts = await collectDigestFacts(organizationId, day);
    if (!digestHasActivity(facts)) { result.quiet += 1; continue; }
    const fallback = ruleDigestText(facts);
    let digestId: string;
    try {
      digestId = (await prisma.aiDailyDigest.create({ data: { organizationId, day, text: fallback, facts: facts as unknown as Prisma.InputJsonValue, source: "RULES" }, select: { id: true } })).id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") { result.already += 1; continue; } // already written
      throw error;
    }
    result.written += 1;
    // The run is the company's own: it is booked on an administrator, never on a person's work.
    const admin = await prisma.organizationMember.findFirst({ where: { organizationId, isActive: true, role: { in: ["OWNER", "ADMIN"] }, user: { isActive: true } }, orderBy: { createdAt: "asc" }, select: { userId: true } });
    if (!admin) { result.byRules += 1; continue; }
    const alias = new AliasMap();
    for (const project of facts.projects) alias.add("Projekt", project.name);
    const outcome = await runStructuredAgent({
      organizationId, actorId: admin.userId, agentId: "daily-digest", taskKind: "WRITING", surface: "digest", subject: { type: "ORGANIZATION_DAY", id: day },
      requestKey: `digest:${digestId}`, instructions: DIGEST_INSTRUCTIONS, input: JSON.stringify(alias.deep(facts)), schema: digestOutputSchema, schemaName: "hintek_daily_digest",
      shared: sharesWork, rateLimited: false, maxOutputTokens: 600,
    }).catch(() => ({ used: false as const, reason: "failed" }));
    if (!outcome.used) { result.byRules += 1; continue; }
    await prisma.aiDailyDigest.update({ where: { id: digestId }, data: { text: alias.restore(outcome.output.text), source: "AI", runId: outcome.runId } });
    result.byAi += 1;
  }
  return result;
}
