import { placeSourceText } from "@/lib/kfid/facility-server";
import { verifyTaskReferences } from "@/lib/kfid/task-references-server";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess, requireControlDelete, requireModule, requireWorkflowPermission } from "@/lib/kfid/server";
import { requireCustomersOrOwn } from "@/lib/kfid/own-company-server";
import { organizationModuleOn } from "@/lib/workflow/modules";
import { bindFormTask, formFamily, visibleFormVersionWhere } from "@/lib/kfid/form-server";
import { formDocumentSchema, formLeafBlocks, type FormDocument, type FormValues } from "@/lib/workflow/form-document";
import { applyFormPrefill } from "@/lib/workflow/form-prefill";
import { FORM_TREND_LIMIT, formTrendSeries } from "@/lib/workflow/form-trend";
import { FORM_PERMISSION_AREAS, hasWorkflowPermission, readableTaskScope, workflowSubjectForTask, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { memberMayReadJob } from "@/lib/workflow/assignee-access";
import { placeFieldFollowsPlace } from "@/lib/workflow/customer-place";
import { readableTaskWhere } from "@/lib/workflow/task-access";
import { stampCustomerAndJudgements, workflowTaskCompletion, workflowTaskDataSchema, workflowTaskHasDocumentation, workflowTaskInputSchema, workflowTaskProgress, workflowTaskStatuses, resetWorkflowTaskApproval, stampWorkflowTaskApproval, type WorkflowTaskStatus } from "@/lib/workflow/task-model";
import { remove } from "@/lib/kfid/storage";
import type { StoppedTimer } from "@/lib/workflow/running-timer";
import { closeTimeEntries, pauseOtherOwnTimers } from "@/lib/workflow/timer-server";
import { assertTimeOpen } from "@/lib/workflow/time-period-lock";
import { followWorkOrder, loadTimeOwner, requireFollowingLevels } from "@/lib/kfid/work-order-link-server";
import { assertRoundHolder, roundProtocolWorkOrder } from "@/lib/kfid/round-work-orders-server";
import { roundOfProtocolValues, withRoundOrderTempPlace } from "@/lib/workflow/round-work-orders";
import { sharedBasicsChanged, taskIsSigned, WORK_ORDER_REQUIRED, workOrderRemovalRefusal, workOrderRemovalSummary, workOrderRequiredError } from "@/lib/workflow/work-order-link";
import { applyRoundSafetyOnSave, requireOrderRoundSafety, requireRoundSafety, roundSafetyOnSave } from "@/lib/workflow/round-safety-server";
import { FORM_HISTORY_LIMIT, formHistoryItem } from "@/lib/workflow/form-history";
import { publishTaskChange } from "@/lib/workflow/live-bus";
import { claimMachineAlarm } from "@/lib/machine/alarm-notice-store";
import { claimFaultAlarm } from "@/lib/operator/on-call-store";
import { claimClosedText, claimTakenText } from "@/lib/machine/alarm-notice";
import { maintenanceFactsSchema, withoutStaleWaiting } from "@/lib/workflow/maintenance";
import { deviationItem } from "@/lib/maintenance/server";
import { savedStatusForTask } from "@/lib/workflow/task-status-rule";
import { taskScheduleError } from "@/lib/workflow/schedule";
import { normalizeStage, startForNewJob } from "@/lib/workflow/job-planning";
import { obstacleBlocked, obstacleInputSchema, reportObstacle, resolveObstacle, OBSTACLE_REASON_LABELS } from "@/lib/workflow/obstacles";
import { clearObstacleNotices, obstacleRecipients, recordObstacle } from "@/lib/workflow/obstacle-notice";
import { swedishDayKey } from "@/lib/swedish-time";
import { CANCELLED_STATUS, CLOSED_TASK_STATUSES, cancelTaskError, isTaskCancelled, restoreTaskError, restoredTaskStatus } from "@/lib/workflow/task-cancel";
import { taskListPaging } from "@/lib/workflow/list-paging";
import { requireSavedTaskLevels, requireTaskLevel } from "@/lib/self-inspection/levels-server";
import { recordFeature } from "@/lib/analytics/record";
import { markAssignmentSeen, recordAssignment } from "@/lib/workflow/task-assignment-notice";
import { applyRiskStepOnSave, requireRiskStep } from "@/lib/workflow/risk-step-server";
import { canSeePrices, redactTaskPrices } from "@/lib/workflow/material-prices";
import { linkDeviationsOnOrderSave } from "@/lib/self-inspection/deviation-link-server";
import { applyMaterialPriceRules } from "@/lib/workflow/material-prices-server";
import { assertNotDormant, planOrderChanged, roundOrderChanged } from "@/lib/maintenance/plan-server";
import { answerAfterTaken, claimIdempotencyKey, IdempotencyTaken, idempotencyClaim, replayedAnswer, storeIdempotentAnswer } from "@/lib/security/idempotency-server";

/** Återkommande underhåll (2026-10-30): after a plan's work order changed, its plan fills again; never fails the request. */
const refillPlan = async (organization: { id: string; disabledModules?: readonly string[] | null }, task: { id: string; maintenancePlanId?: string | null; roundScheduleId?: string | null; roundOccurrence?: string | null } | null | undefined) => {
  // With Underhåll off a plan makes no new work orders; it fills again by itself when the module is on.
  if (task?.maintenancePlanId && organizationModuleOn(organization, "upkeep")) await planOrderChanged(organization.id, task.id).catch(() => undefined);
  // Underhåll i driftronden (2026-11-27): a round's work order changed – the plans done in the round follow (an item waiting for it, one on a closed one).
  if (task?.roundScheduleId && !task.roundOccurrence && organizationModuleOn(organization, "upkeep")) await roundOrderChanged(organization.id, { id: task.id, roundScheduleId: task.roundScheduleId }).catch(() => undefined);
};

const identifier = z.string().min(1).max(100);
const json = (value: unknown) => value as Prisma.InputJsonValue;
/** The timer met a newer version of the task: read again and retry (M4), never told to the person unless it keeps happening. */
class TimerVersionConflict extends Error {}
export const dynamic = "force-dynamic";

/**
 * Plats as the source (approved 2026-10-07): a protocol's field that is filled from the facility (the control's "Projekt /
 * anläggning", the planning's "Anläggning") holds the linked place's whole way – also when the place is linked through the
 * API or MCP, so the report shows it. Filled when the field is empty or the link is new or changed; the editors do the same.
 * A text typed by hand is never replaced (MEMORY 2026-10-08, simulation 2026-10-10): on a new or changed link the field
 * is filled only while it is empty or still holds what was filled in by itself – the previous place's way or the
 * project's name (placeFieldFollowsPlace). Choosing a place in the editor fills the field there first.
 */
async function fillPlaceField(organizationId: string, task: z.infer<typeof workflowTaskInputSchema>) {
  if (task.kind !== "FORM" || task.data.kind !== "FORM" || !task.facilityId) return;
  const details = task.data.details as { document: FormDocument; values: FormValues };
  const field = formLeafBlocks(details.document).find((block) => block.type === "field" && block.prefill === "facility");
  if (!field || !("key" in field)) return;
  const previous = task.id ? await prisma.workflowTask.findFirst({ where: { id: task.id, organizationId }, select: { facilityId: true } }) : null;
  const current = String(details.values.fields[field.key] ?? "");
  const text = await placeSourceText(organizationId, { facilityId: task.facilityId, previousFacilityId: previous?.facilityId ?? null, current }, 500);
  if (!text || current.trim() === text) return;
  if (current.trim()) {
    const previousText = previous?.facilityId ? await placeSourceText(organizationId, { facilityId: previous.facilityId, current: "" }, 500) : null;
    const project = task.projectId ? await prisma.project.findFirst({ where: { id: task.projectId, organizationId }, select: { name: true } }) : null;
    if (!placeFieldFollowsPlace(current, [previousText ?? "", project?.name ?? ""].filter(Boolean))) return;
  }
  details.values = applyFormPrefill(details.document, details.values, { facility: text }, { kinds: ["facility"], overwrite: true });
}

// History is paged (2026-09-26): the list carries the newest revisions and a count; older ones load on request.
const REVISION_PAGE_SIZE = 10;
type RevisionRow = { id: string; version: number; snapshot: Prisma.JsonValue; createdAt: Date };
/** Priser på materialraden (2026-10-09): purchase prices and markup only for those who may see prices. */
const pricesVisible = (ctx: { admin: boolean; workflowPermissions: Parameters<typeof canSeePrices>[0]["permissions"] }) => canSeePrices({ admin: ctx.admin, permissions: ctx.workflowPermissions });

function revisionView(task: { kind: string; title: string; description: string; status: string; data: Prisma.JsonValue }, revisions: RevisionRow[], prices: boolean) {
  const data = workflowTaskDataSchema.parse(task.data);
  return revisions.flatMap((revision) => {
    const snapshot = revision.snapshot && typeof revision.snapshot === "object" && !Array.isArray(revision.snapshot)
      ? revision.snapshot as Record<string, unknown>
      : {};
    const parsedData = workflowTaskDataSchema.safeParse(snapshot.data);
    if (!parsedData.success || parsedData.data.kind !== task.kind) return [];
    const status = workflowTaskStatuses.includes(snapshot.status as WorkflowTaskStatus)
      ? snapshot.status as WorkflowTaskStatus
      : task.status as WorkflowTaskStatus;
    return [{ id: revision.id, version: revision.version, createdAt: revision.createdAt, snapshot: {
      title: typeof snapshot.title === "string" ? snapshot.title : task.title,
      description: typeof snapshot.description === "string" ? snapshot.description : task.description,
      status,
      progress: typeof snapshot.progress === "number" ? Math.max(0, Math.min(100, Math.round(snapshot.progress))) : workflowTaskProgress({ ...task, data } as Parameters<typeof workflowTaskProgress>[0]),
      data: prices ? parsedData.data : redactTaskPrices(parsedData.data),
      completedAt: typeof snapshot.completedAt === "string" ? snapshot.completedAt : null,
      ...(typeof snapshot.note === "string" && snapshot.note ? { note: snapshot.note.slice(0, 300) } : {}),
    } }];
  });
}

export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const url = new URL(request.url);
    const revisionTaskId = url.searchParams.get("revisionsFor");
    if (revisionTaskId) {
      const before = Number(url.searchParams.get("before"));
      const task = await prisma.workflowTask.findFirst({ where: { id: identifier.parse(revisionTaskId), organizationId: ctx.organizationId }, select: { kind: true, formArea: true, title: true, description: true, status: true, data: true } });
      if (!task || !(ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, workflowSubjectForTask(task.kind, task.formArea), "read"))) throw new ApiError(404, "Uppgiften hittades inte.");
      const page = await prisma.workflowTaskRevision.findMany({
        where: { taskId: revisionTaskId, ...(Number.isInteger(before) && before > 0 ? { version: { lt: before } } : {}) },
        orderBy: { version: "desc" },
        take: 20,
        select: { id: true, version: true, snapshot: true, createdAt: true },
      });
      return NextResponse.json({ revisions: revisionView(task, page, pricesVisible(ctx)) });
    }
    // Ta bort arbetsorder (2026-10-26, svar 2b): what the confirmation shows before removal – the tasks that go with
    // it, and why it cannot be removed when one of them is completed or signed. Within the company, for those who may edit it.
    const removalFor = url.searchParams.get("removalFor");
    if (removalFor) {
      const order = await prisma.workflowTask.findFirst({ where: { id: identifier.parse(removalFor), organizationId: ctx.organizationId }, select: { id: true, kind: true, formArea: true } });
      if (!order || !(ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, workflowSubjectForTask(order.kind, order.formArea), "edit"))) throw new ApiError(404, "Uppgiften hittades inte.");
      const inside = order.kind === "WORK_ORDER" ? await prisma.workflowTask.findMany({ where: { organizationId: ctx.organizationId, workOrderId: order.id }, orderBy: { createdAt: "asc" }, select: { id: true, kind: true, title: true, status: true, data: true } }) : [];
      const tasks = inside.map(({ data, ...task }) => ({ ...task, signed: taskIsSigned(data) }));
      return NextResponse.json({ tasks, refusal: workOrderRemovalRefusal(tasks), summary: workOrderRemovalSummary(tasks) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    // Earlier protocols of the same form for the same facility or customer (follow-up, 2026-09-26).
    const historyTemplate = url.searchParams.get("formHistory");
    if (historyTemplate) {
      const canRead = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
      if (!readableTaskScope(canRead).areas.length) return NextResponse.json({ items: [] });
      const facilityId = url.searchParams.get("facilityId");
      const customerId = url.searchParams.get("customerId");
      if (!facilityId && !customerId) return NextResponse.json({ items: [] });
      const exclude = url.searchParams.get("exclude");
      const rows = await prisma.workflowTask.findMany({
        where: {
          organizationId: ctx.organizationId, kind: "FORM", AND: [readableTaskWhere(canRead)], data: { path: ["details", "templateId"], equals: identifier.parse(historyTemplate) },
          ...(facilityId ? { facilityId: identifier.parse(facilityId) } : { customerId: identifier.parse(customerId) }),
          ...(exclude ? { id: { not: identifier.parse(exclude) } } : {}),
        },
        orderBy: { updatedAt: "desc" }, take: FORM_HISTORY_LIMIT,
        select: { id: true, title: true, status: true, completedAt: true, updatedAt: true, data: true },
      });
      return NextResponse.json({ items: rows.map(formHistoryItem) });
    }
    // Trends (2026-09-28): the numbers marked `trend` over earlier protocols of the same form family at the same
    // facility (or customer), read with each protocol's own copy of the form; the series follow the given version.
    const trendTemplate = url.searchParams.get("formTrend");
    if (trendTemplate) {
      const canRead = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
      const facilityId = url.searchParams.get("facilityId");
      const customerId = url.searchParams.get("customerId");
      const version = Number(url.searchParams.get("version"));
      if (!readableTaskScope(canRead).areas.length || (!facilityId && !customerId)) return NextResponse.json({ series: [] });
      const { ids } = await formFamily(ctx.organizationId, identifier.parse(trendTemplate));
      // The version is read only when its form is Workflow's or the company's own (tenant isolation).
      const stored = Number.isInteger(version) ? await prisma.formTemplateVersion.findFirst({ where: visibleFormVersionWhere(ctx.organizationId, identifier.parse(trendTemplate), version), select: { document: true } }) : null;
      const exclude = url.searchParams.get("exclude");
      const rows = await prisma.workflowTask.findMany({
        where: {
          organizationId: ctx.organizationId, kind: "FORM", AND: [readableTaskWhere(canRead), { OR: ids.map((id) => ({ data: { path: ["details", "templateId"], equals: id } })) }],
          ...(facilityId ? { facilityId: identifier.parse(facilityId) } : { customerId: identifier.parse(customerId) }),
          ...(exclude ? { id: { not: identifier.parse(exclude) } } : {}),
        },
        orderBy: { updatedAt: "desc" }, take: FORM_TREND_LIMIT,
        select: { id: true, status: true, completedAt: true, updatedAt: true, data: true },
      });
      const fallback = rows[0] ? formDocumentSchema.safeParse((rows[0].data as { details?: { document?: unknown } }).details?.document) : null;
      const document = stored ? formDocumentSchema.parse(stored.document) : fallback?.success ? fallback.data : null;
      return NextResponse.json({ series: document ? formTrendSeries(document, null, rows) : [] });
    }
    // The guided flow (2026-09-30): the state of linked tasks – a deviation row's work order, the protocol a work order
    // came from – and the next open task of a project, as title and status only, within what the person may read.
    const links = url.searchParams.get("links");
    const projectNext = url.searchParams.get("projectNext");
    if (links || projectNext) {
      const canRead = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
      const select = { id: true, title: true, status: true, kind: true, dueDate: true, assignedToUserId: true } as const;
      const view = (row: { id: string; title: string; status: string; kind: string; dueDate: string; assignedToUserId?: string | null }) => ({ id: row.id, title: row.title, status: row.status, kind: row.kind, dueDate: row.dueDate });
      if (links) {
        const ids = [...new Set(links.split(",").filter(Boolean))].slice(0, 50).map((value) => identifier.parse(value));
        const rows = await prisma.workflowTask.findMany({ where: { organizationId: ctx.organizationId, id: { in: ids }, AND: [readableTaskWhere(canRead)] }, select });
        return NextResponse.json({ links: rows.map(view) });
      }
      const exclude = url.searchParams.get("exclude");
      const rows = await prisma.workflowTask.findMany({
        where: { organizationId: ctx.organizationId, projectId: identifier.parse(projectNext), status: { notIn: [...CLOSED_TASK_STATUSES] }, AND: [readableTaskWhere(canRead)], ...(exclude ? { id: { not: identifier.parse(exclude) } } : {}) },
        orderBy: [{ updatedAt: "desc" }], take: 50, select,
      });
      // The one due first; tasks without a date come after the dated ones.
      // Only the person's own or unassigned tasks are suggested (simulation 2026-10-02: a colleague's paused order was).
      const next = rows.filter((row) => !row.assignedToUserId || row.assignedToUserId === ctx.user.id).sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"))[0];
      return NextResponse.json({ next: next ? view(next) : null, open: rows.length });
    }
    // Bounded reads (2026-09-26): the editor asks for one task (`id`) or only the members (`members=only`)
    // instead of every task in the organization with its history.
    const onlyId = url.searchParams.get("id");
    const membersOnly = url.searchParams.get("members") === "only";
    // Without an id the read is a bounded page of readable tasks (quality check 2026-10-05, F4: the whole organization
    // with history was 91 MB). `limit` defaults to 25 and is capped at 100; `page` is 1-based.
    const paging = onlyId || membersOnly ? null : taskListPaging(url.searchParams);
    const canReadList = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
    const [tasks, members] = await Promise.all([
      membersOnly || (paging && !readableTaskScope(canReadList).areas.length) ? Promise.resolve([]) : prisma.workflowTask.findMany({
        where: { organizationId: ctx.organizationId, ...(onlyId ? { id: identifier.parse(onlyId) } : { AND: [readableTaskWhere(canReadList)] }) },
        ...(paging ? { skip: (paging.page - 1) * paging.limit, take: paging.limit + 1 } : {}),
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        include: {
          project: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true, company: true, customerType: true } },
          // Arbetsordern styr (2026-10-26): the order the task is in, and its time – a task's time is the work order's
          // (the part reported from this task, `sourceTaskId`, is shown as its own since 2026-10-27).
          workOrder: { select: { id: true, title: true, status: true, timeEntries: { select: { userId: true, startedAt: true, endedAt: true, durationSec: true, sourceTaskId: true } } } },
          timeEntries: { orderBy: { startedAt: "desc" } },
          attachments: { orderBy: { createdAt: "desc" }, select: { id: true, filename: true, mimeType: true, size: true, receipt: true, createdAt: true } },
          revisions: { orderBy: { version: "desc" }, take: REVISION_PAGE_SIZE, select: { id: true, version: true, snapshot: true, createdAt: true } },
          _count: { select: { revisions: true } },
        },
      }),
      prisma.organizationMember.findMany({
        where: { organizationId: ctx.organizationId, isActive: true, user: { isActive: true } },
        orderBy: { user: { name: "asc" } },
        select: { userId: true, role: true, workflowPermissions: true, user: { select: { name: true, email: true } } },
      }),
    ]);
    // Ansvarig (simulation 2026-10-10): whether each member may read the job's type, so the list offers only those; the
    // job's own area when one task is read, else the area a new job asks about (`subject`). Only that one fact is sent.
    const subjectParam = url.searchParams.get("subject");
    const memberSubject: WorkflowPermissionSubject | null = onlyId && tasks[0] ? workflowSubjectForTask(tasks[0].kind, tasks[0].formArea)
      : subjectParam && (["work-order", "risk-assessment", ...FORM_PERMISSION_AREAS] as string[]).includes(subjectParam) ? subjectParam as WorkflowPermissionSubject : null;
    const hasMore = Boolean(paging && tasks.length > paging.limit);
    // "Tilldelad dig" (Fas 1B): the person opened the task, so their notice of it is read. Not for an API/MCP key.
    const opened = onlyId && !ctx.integration ? tasks[0] : null;
    const prices = pricesVisible(ctx);
    if (opened && (ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, workflowSubjectForTask(opened.kind, opened.formArea), "read")))
      // A reported obstacle stays in the bell until it is resolved (användartest 2026-10-31, F3), so opening reads only the assignment.
      await markAssignmentSeen(prisma, { organizationId: ctx.organizationId, userId: ctx.user.id, taskId: opened.id });
    return NextResponse.json({
      ...(paging ? { page: paging.page, limit: paging.limit, hasMore } : {}),
      tasks: (hasMore ? tasks.slice(0, paging!.limit) : tasks).filter((task) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, workflowSubjectForTask(task.kind, task.formArea), "read")).map((task) => {
        const data = workflowTaskDataSchema.parse(task.data);
        // The work order's title only for those who may read work orders; the link itself is shown either way.
        const workOrder = task.workOrder ? { id: task.workOrder.id, status: task.workOrder.status, title: canReadList("work-order") ? task.workOrder.title : "", readable: canReadList("work-order") } : null;
        return ({
        ...task,
        workOrder,
        data: prices ? data : redactTaskPrices(data),
        revisions: revisionView(task, task.revisions, prices),
        revisionCount: task._count.revisions,
        _count: undefined,
        progress: workflowTaskProgress({ ...task, data }),
        totalDurationSec: (task.kind !== "WORK_ORDER" && task.workOrder ? task.workOrder.timeEntries : task.timeEntries).reduce((sum, entry) => sum + entry.durationSec + (!entry.endedAt ? Math.max(0, Math.floor((Date.now() - entry.startedAt.getTime()) / 1000)) : 0), 0),
        // The time reported from this task on its work order (a round occurrence's own time, 2026-10-27).
        ...(task.kind !== "WORK_ORDER" && task.workOrder ? { ownDurationSec: task.workOrder.timeEntries.filter((entry) => entry.sourceTaskId === task.id).reduce((sum, entry) => sum + entry.durationSec + (!entry.endedAt ? Math.max(0, Math.floor((Date.now() - entry.startedAt.getTime()) / 1000)) : 0), 0) } : {}),
        // The editor's Starta/Pausa button reflects the caller's own timer (on the work order for a task); colleagues keep their own.
        timerRunning: task.timeEntries.some((entry) => !entry.endedAt && entry.userId === ctx.user.id) || Boolean(task.workOrder?.timeEntries.some((entry) => !entry.endedAt && entry.userId === ctx.user.id)),
      });}),
      members: members.map((member) => ({ id: member.userId, name: member.user.name || member.user.email, ...(memberSubject ? { canRead: memberMayReadJob(member, memberSubject) } : {}) })),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    // Stopping the timer (pause or completion) finishes an entry; it enters the append-only time history then.
    const closeRunningTimeEntries = (tx: Prisma.TransactionClient, running: { id: string; userId: string; startedAt: Date; note: string }[], owner: { id: string; title: string }, now: Date) =>
      closeTimeEntries(tx, ctx, running, owner, now);
    const input = z.discriminatedUnion("action", [
      // `autosave`: saved by itself a few seconds after a change (2026-10-04); the person's own autosaves within
      // ten minutes share one entry in the history instead of one per pause in the typing.
      // `maintenance` (Underhåll, 2026-10-30): a new work order made from a protocol's deviation row sends the row's facts; the
      // order gets a maintenance item with them when the protocol is on a machine part (lib/maintenance/server.ts deviationItem).
      z.object({ action: z.literal("save"), task: workflowTaskInputSchema, autosave: z.boolean().optional(), maintenance: maintenanceFactsSchema.optional() }),
      // `keepShort` (2026-10-12): the person answered "Spara ändå" for a timer under a minute, which is otherwise discarded.
      z.object({ action: z.literal("timer"), id: identifier, command: z.enum(["START", "PAUSE"]), keepShort: z.boolean().optional() }),
      z.object({ action: z.literal("reopen"), id: identifier }),
      // Utgår (2026-10-09): a job that will not be done, with a required reason; Återuppta lifts it.
      z.object({ action: z.literal("cancel"), id: identifier, reason: z.string().max(2000), keepShort: z.boolean().optional() }),
      z.object({ action: z.literal("restore"), id: identifier }),
      // Rapportera hinder (plan 1M, 2026-10-11): one press on any job; Lös hindret puts the status back.
      z.object({ action: z.literal("obstacle"), id: identifier, version: z.number().int().nonnegative().optional(), obstacle: obstacleInputSchema }),
      z.object({ action: z.literal("resolve_obstacle"), id: identifier, version: z.number().int().nonnegative().optional() }),
      // Kvittera ett maskinlarm (S4): "Jag tar den" on an automatic work order; sets Ansvarig if nobody has it.
      z.object({ action: z.literal("claim_machine_alarm"), id: identifier }),
    ]).parse(await body(request));

    if (input.action === "claim_machine_alarm") {
      // A person's own act: never an API/MCP key. The same people who may edit work orders.
      if (ctx.integration) throw new ApiError(403, "Det här görs av en person i appen.");
      requireWorkflowPermission(ctx, "work-order", "edit");
      const actorName = ctx.user.name || ctx.user.email;
      const args = { organizationId: ctx.organizationId, userId: ctx.user.id, userName: actorName, taskId: input.id };
      // A fault report from the operator page that went to the on-call person is acknowledged the same way (lib/operator/on-call-store.ts).
      let claim = await claimMachineAlarm(args);
      if (claim.result === "not_found") claim = await claimFaultAlarm(args);
      if (claim.result === "not_found") throw new ApiError(404, "Arbetsordern hittades inte.");
      if (claim.result === "closed") throw new ApiError(409, claimClosedText);
      if (claim.result === "taken") return NextResponse.json({ ok: false, taken: true, by: claim.by, message: claimTakenText(claim.by) });
      if (claim.result === "claimed") publishTaskChange(input.id, { version: claim.version, byUserId: ctx.user.id, byName: actorName, status: claim.status, reason: "save" });
      return NextResponse.json({ ok: true, id: input.id, version: claim.version, status: claim.status, mine: true });
    }

    if (input.action === "obstacle" || input.action === "resolve_obstacle") {
      const task = await prisma.workflowTask.findFirst({ where: { id: input.id, organizationId: ctx.organizationId } });
      if (!task) throw new ApiError(404, "Uppgiften hittades inte.");
      // The same people who may edit the job.
      requireWorkflowPermission(ctx, workflowSubjectForTask(task.kind, task.formArea), "edit");
      // An obstacle is reported on work that has started: a draft is linked to a work order first (2026-10-27).
      if (input.action === "obstacle" && task.kind !== "WORK_ORDER" && !task.workOrderId) throw new ApiError(409, WORK_ORDER_REQUIRED);
      const blocked = obstacleBlocked(task);
      if (blocked) throw new ApiError(409, blocked);
      if (input.version !== undefined && input.version !== task.version) throw new ApiError(409, "Uppgiften har ändrats. Läs in den senaste versionen.");
      const project = task.projectId ? await prisma.project.findFirst({ where: { id: task.projectId, organizationId: ctx.organizationId }, select: { id: true, archivedAt: true, closedAt: true, responsibleUserId: true } }) : null;
      if (project?.archivedAt) throw new ApiError(409, "Återställ projektet först.");
      if (project?.closedAt) throw new ApiError(409, "Projektet är avslutat. Återöppna projektet först.");
      const now = new Date();
      const report = input.action === "obstacle";
      const data = workflowTaskDataSchema.parse(task.data);
      const actorName = ctx.user.name || ctx.user.email;
      // Time runs on the work order (Arbetsordern styr, 2026-10-26).
      const running = report ? await prisma.workflowTimeEntry.count({ where: { taskId: task.kind === "WORK_ORDER" ? task.id : task.workOrderId ?? task.id, endedAt: null } }) : 0;
      const applied = report
        ? reportObstacle({ kind: task.kind, status: task.status, data, hasRunningTime: running > 0 }, input.obstacle, now, actorName)
        : resolveObstacle({ kind: task.kind, status: task.status, data });
      const nextVersion = task.version + 1;
      const progress = workflowTaskProgress({ ...task, status: applied.status as WorkflowTaskStatus, data: applied.data });
      await prisma.$transaction(async (tx) => {
        const changed = await tx.workflowTask.updateMany({
          where: { id: task.id, organizationId: ctx.organizationId, version: task.version, status: task.status },
          data: { status: applied.status, progress, data: json(applied.data), version: { increment: 1 }, updatedBy: ctx.user.id },
        });
        if (!changed.count) throw new ApiError(409, "Uppgiften har ändrats. Läs in den senaste versionen.");
        await tx.workflowTaskRevision.create({ data: { taskId: task.id, version: nextVersion, createdBy: ctx.user.id, snapshot: json({ title: task.title, description: task.description, status: applied.status, progress, data: applied.data, completedAt: null }) } });
        if (task.projectId) await tx.projectEvent.create({ data: { organizationId: ctx.organizationId, projectId: task.projectId, kind: "UPDATED", summary: (report ? `Hinder på ${task.title}: ${OBSTACLE_REASON_LABELS[input.obstacle.reason]}${input.obstacle.text ? ` – ${input.obstacle.text}` : ""}` : `Hindret på ${task.title} är löst`).slice(0, 500), taskId: task.id, actorName, createdBy: ctx.user.id } });
        if (!report) { await clearObstacleNotices(tx, { organizationId: ctx.organizationId, taskId: task.id }); return; }
        // The job's and the project's responsible people (active members of the company), never the reporter.
        const wanted = [task.assignedToUserId, project?.responsibleUserId].filter((id): id is string => Boolean(id) && id !== ctx.user.id);
        const active = wanted.length ? await tx.organizationMember.findMany({ where: { organizationId: ctx.organizationId, isActive: true, user: { isActive: true }, userId: { in: wanted } }, select: { userId: true } }) : [];
        await recordObstacle(tx, { organizationId: ctx.organizationId, taskId: task.id, reporterId: ctx.user.id, recipients: obstacleRecipients({ taskResponsibleId: task.assignedToUserId, projectResponsibleId: project?.responsibleUserId, reporterId: ctx.user.id, activeMemberIds: new Set(active.map((member) => member.userId)) }) });
      });
      publishTaskChange(task.id, { version: nextVersion, byUserId: ctx.user.id, byName: actorName, status: applied.status, reason: "save" });
      return NextResponse.json({ ok: true, id: task.id, version: nextVersion, status: applied.status });
    }

    if (input.action === "cancel" || input.action === "restore") {
      const task = await prisma.workflowTask.findFirst({ where: { id: input.id, organizationId: ctx.organizationId } });
      if (!task) throw new ApiError(404, "Uppgiften hittades inte.");
      // The same people who may edit the job (lib/workflow/task-cancel.ts).
      requireWorkflowPermission(ctx, workflowSubjectForTask(task.kind, task.formArea), "edit");
      const refusal = input.action === "cancel" ? cancelTaskError(task, input.reason) : restoreTaskError(task);
      if (refusal) throw new ApiError(409, refusal);
      if (task.projectId) {
        const project = await prisma.project.findFirst({ where: { id: task.projectId, organizationId: ctx.organizationId }, select: { archivedAt: true, closedAt: true } });
        if (project?.archivedAt) throw new ApiError(409, "Återställ projektet först.");
        if (project?.closedAt) throw new ApiError(409, "Projektet är avslutat. Återöppna projektet först.");
      }
      const now = new Date();
      const cancel = input.action === "cancel";
      const reason = cancel ? input.reason.trim() : "";
      const status = cancel ? CANCELLED_STATUS : restoredTaskStatus(task.cancelledFromStatus);
      const nextVersion = task.version + 1;
      const data = workflowTaskDataSchema.parse(task.data);
      const progress = workflowTaskProgress({ ...task, status, data });
      const fields = cancel
        ? { status, cancelledAt: now, cancelledBy: ctx.user.id, cancelReason: reason, cancelledFromStatus: task.status }
        : { status, cancelledAt: null, cancelledBy: null, cancelReason: "", cancelledFromStatus: null };
      const actorName = ctx.user.name || ctx.user.email;
      const stopped = await prisma.$transaction(async (tx) => {
        const changed = await tx.workflowTask.updateMany({
          where: { id: task.id, organizationId: ctx.organizationId, version: task.version, status: task.status },
          data: { ...fields, progress, version: { increment: 1 }, updatedBy: ctx.user.id },
        });
        if (!changed.count) throw new ApiError(409, "Uppgiften har ändrats. Läs in den senaste versionen.");
        await tx.workflowTaskRevision.create({ data: { taskId: task.id, version: nextVersion, createdBy: ctx.user.id, snapshot: json({ title: task.title, description: task.description, status, progress, data, completedAt: null, ...(cancel ? { cancelReason: reason } : {}) }) } });
        if (task.projectId) await tx.projectEvent.create({ data: { organizationId: ctx.organizationId, projectId: task.projectId, kind: "UPDATED", summary: (cancel ? `Jobbet ${task.title} utgår: ${reason}` : `Jobbet ${task.title} återupptogs`).slice(0, 500), taskId: task.id, actorName, createdBy: ctx.user.id } });
        // Utgår stops everyone's running time on the job; the entries enter the time history as on completion.
        if (!cancel) return [];
        const running = await tx.workflowTimeEntry.findMany({ where: { taskId: task.id, endedAt: null } });
        return closeTimeEntries(tx, ctx, running, { id: task.id, title: task.title }, now, { keepShort: input.action === "cancel" && Boolean(input.keepShort) });
      });
      publishTaskChange(task.id, { version: nextVersion, byUserId: ctx.user.id, byName: actorName, status, reason: "save" });
      // Utgår skips a plan's occurrence; Återuppta gives it back (the plan's days follow).
      await refillPlan(ctx.organization, task);
      return NextResponse.json({ ok: true, status, stopped });
    }

    if (input.action === "reopen") {
      const task = await prisma.workflowTask.findFirst({ where: { id: input.id, organizationId: ctx.organizationId } });
      if (!task) throw new ApiError(404, "Uppgiften hittades inte.");
      const subject = workflowSubjectForTask(task.kind, task.formArea);
      // A completed control stays as it was signed; it is continued with Spara som (MEMORY: controls are immutable).
      if (subject === "kfid") throw new ApiError(409, "En slutförd kontroll återöppnas inte. Använd Spara som för att fortsätta i en ny kontroll.");
      requireWorkflowPermission(ctx, subject, "reopen");
      if (task.status !== "COMPLETED") return NextResponse.json({ ok: true });
      // Roller med nivå (2026-10-07): a task above the person's level is not reopened to be worked on.
      await requireTaskLevel(ctx.organizationId, task, ctx.user, "reopen");
      if (task.projectId) {
        const project = await prisma.project.findFirst({ where: { id: task.projectId, organizationId: ctx.organizationId }, select: { archivedAt: true, closedAt: true } });
        if (project?.archivedAt) throw new ApiError(409, "Återställ projektet innan du återöppnar uppgiften.");
        if (project?.closedAt) throw new ApiError(409, "Projektet är avslutat. Återöppna projektet innan du återöppnar uppgiften.");
      }
      const nextVersion = task.version + 1;
      const data = resetWorkflowTaskApproval(workflowTaskDataSchema.parse(task.data));
      const reopenedInput = workflowTaskInputSchema.parse({ ...task, status: "NEEDS_ACTION", data });
      const progress = workflowTaskProgress(reopenedInput);
      const snapshot = json({ ...task, data, status: "NEEDS_ACTION", progress, completedAt: null, version: nextVersion });
      await prisma.$transaction([
        prisma.workflowTask.update({ where: { id: task.id, version: task.version, status: "COMPLETED" }, data: { data: json(data), status: "NEEDS_ACTION", progress, completedAt: null, version: { increment: 1 }, updatedBy: ctx.user.id } }),
        prisma.workflowTaskRevision.create({ data: { taskId: task.id, version: nextVersion, snapshot, createdBy: ctx.user.id } }),
        ...(task.projectId ? [prisma.projectEvent.create({ data: { organizationId: ctx.organizationId, projectId: task.projectId, kind: "TASK_REOPENED", summary: `Uppgiften ${task.title} återöppnades`, taskId: task.id, actorName: ctx.user.name || ctx.user.email, createdBy: ctx.user.id } })] : []),
      ]);
      publishTaskChange(task.id, { version: nextVersion, byUserId: ctx.user.id, byName: ctx.user.name || ctx.user.email, status: "NEEDS_ACTION", reason: "reopen" });
      await refillPlan(ctx.organization, task);
      return NextResponse.json({ ok: true });
    }

    if (input.action === "timer") {
      // Tid på jobbet (Fas 2): a task that belongs to a work order runs its time on the work order (lib/kfid/work-order-link-server.ts).
      // Företagets moduler (0.39.0): with Tid och lön off no time starts; a timer already running can always be stopped.
      if (input.command === "START") requireModule(ctx, "time");
      // Starta tid never loses the time to a save that landed just before it (kundresan 2026-11-07, M4: the autosave of the same
      // click took the version and the start got "Uppgiften har ändrats" in silence): the task is read again and the change made on
      // the newest version, at most three times. Every check below is made again on each read.
      for (let attempt = 1; ; attempt++) {
      try {
      const { clicked, owner: task } = await loadTimeOwner(ctx, input.id);
      requireWorkflowPermission(ctx, workflowSubjectForTask(clicked.kind, clicked.formArea), "edit");
      if (isTaskCancelled(task.status)) throw new ApiError(409, task.id === clicked.id ? "Jobbet har utgått. Återuppta det för att skriva tid." : `Tiden räknas på arbetsordern ${task.title}, som har utgått.`);
      if (task.status === "COMPLETED") throw new ApiError(409, task.id === clicked.id ? "En slutförd uppgift kan inte tidrapporteras." : `Tiden räknas på arbetsordern ${task.title}, som är färdigställd. Återöppna den för att skriva tid.`);
      // Roller med nivå (2026-10-07): starting the time is starting the work; pausing one's own time is always allowed.
      if (input.command === "START") await requireTaskLevel(ctx.organizationId, task, ctx.user, "start");
      // … and the linked task the person works in (Fas 2), when the time runs on its work order.
      if (input.command === "START" && clicked.id !== task.id) await requireTaskLevel(ctx.organizationId, clicked, ctx.user, "start");
      // Riskbedömning som steg (2026-10-08): the time starts once the job's risk step is done (lib/workflow/risk-step.ts).
      if (input.command === "START") await requireRiskStep(ctx.organizationId, task, "start");
      // Återkommande underhåll (2026-10-30): a vilande work order gets no time until its day or Aktivera.
      if (input.command === "START") await assertNotDormant(prisma, ctx.organizationId, task.id);
      // Säkerhetsavstämning (2026-10-27, punkt 4): a round occurrence's short check against the work order's risk assessment.
      if (input.command === "START" && clicked.id !== task.id) await requireRoundSafety(ctx.organizationId, clicked, "start");
      // … and pressed on the round's work order itself: its open occurrences' checks count, or the button would pass them.
      if (input.command === "START" && clicked.id === task.id) await requireOrderRoundSafety(ctx.organizationId, task);
      const now = new Date();
      // The timer is per person (2026-09-26): start and pause only touch the caller's own entry, a colleague's
      // running entry keeps going, and starting a new timer pauses the caller's timer on any other task.
      const stopped = await prisma.$transaction(async (tx) => {
        const running = await tx.workflowTimeEntry.findMany({ where: { taskId: task.id, endedAt: null } });
        const mine = running.filter((entry) => entry.userId === ctx.user.id);
        const othersRunning = running.length - mine.length;
        const start = input.command === "START";
        const nextStatus = start || othersRunning ? "IN_PROGRESS" : "PAUSED";
        // Starting time resumes the work, so a work order no longer waits for anything (Underhåll, 2026-10-06).
        const resumed = withoutStaleWaiting(nextStatus, task.data);
        // Serialize timer changes with completion using the task version/row lock.
        const changed = await tx.workflowTask.updateMany({
          where: { id: task.id, organizationId: ctx.organizationId, version: task.version, status: { notIn: [...CLOSED_TASK_STATUSES] } },
          data: { ...(resumed !== task.data ? { data: json(resumed) } : {}), status: nextStatus, startedAt: start ? task.startedAt ?? now : task.startedAt, progress: workflowTaskProgress({ ...task, data: workflowTaskDataSchema.parse(task.data) }), version: { increment: 1 }, updatedBy: ctx.user.id },
        });
        if (!changed.count) throw new TimerVersionConflict();
        const keep = { keepShort: Boolean(input.keepShort) };
        if (!start) return closeTimeEntries(tx, ctx, mine, { id: task.id, title: task.title }, now, keep);
        // Rapporterad från (2026-10-27): the task the person started the time in is remembered on the work order's entry.
        if (!mine.length) {
          // Tidsperiod (2026-10-30): no new time in a sent-in or approved month.
          await assertTimeOpen(tx, ctx.organizationId, [{ userId: ctx.user.id, startedAt: now }], ctx.user.id);
          await tx.workflowTimeEntry.create({ data: { taskId: task.id, userId: ctx.user.id, startedAt: now, sourceTaskId: clicked.id !== task.id ? clicked.id : null } });
        }
        // The caller's timer on any other task or control is paused (the client asked first, 2026-10-12).
        return pauseOtherOwnTimers(tx, ctx, { taskId: task.id }, now, keep);
      });
      publishTaskChange(task.id, { version: task.version + 1, byUserId: ctx.user.id, byName: ctx.user.name || ctx.user.email, reason: "timer" });
      if (task.id !== clicked.id) publishTaskChange(clicked.id, { version: clicked.version, byUserId: ctx.user.id, byName: ctx.user.name || ctx.user.email, reason: "timer" });
      return NextResponse.json({ ok: true, stopped });
      } catch (error) {
        if (!(error instanceof TimerVersionConflict)) throw error;
        if (attempt >= 3) throw new ApiError(409, "Uppgiften har ändrats. Läs in den senaste versionen.");
      }
      }
    }

    const task = input.task;
    // Idempotensnyckel (granskningen 2026-11-24): a new job sent again with the same Idempotency-Key gets the first answer.
    // The hash is taken of what was sent, before the save below fills in its own fields.
    const idempotency = task.id ? null : idempotencyClaim(request, { organizationId: ctx.organizationId, userId: ctx.user.id }, "workflow-task:create", { task, maintenance: input.maintenance ?? null });
    // A protocol always uses its stored form version (never a document sent by the client), and follows its form's
    // permission area – Kontroll före idrifttagning and Riskbedömning as forms keep their own (2026-09-27).
    const form = await bindFormTask(ctx.organizationId, task);
    const subject = workflowSubjectForTask(task.kind, form.formArea);
    requireWorkflowPermission(ctx, subject, task.id ? "edit" : "create");
    const replay = await replayedAnswer(idempotency);
    if (replay) return replay;
    // Driftrond i arbetsordern (2026-10-27, punkt 3): a protocol started from a round registers the occurrence in the
    // round's work order for the day – the one it came with, or the one whose period holds the day. Nothing is made here;
    // without such a work order the round is refused until a person has made it (lib/kfid/round-work-orders-server.ts).
    if (!task.id && task.kind === "FORM") {
      const round = roundOfProtocolValues(task.data);
      if (round) {
        requireModule(ctx, "rounds");
        task.workOrderId = await roundProtocolWorkOrder(ctx.organizationId, round, task.workOrderId);
        // Where the occurrence is done is the work order's (2026-10-27 kväll): the protocol takes its customer, place and
        // project below (verifyTaskReferences) and its temporary place here, unless the protocol has one of its own.
        const order = await prisma.workflowTask.findFirst({ where: { id: task.workOrderId, organizationId: ctx.organizationId }, select: { data: true } });
        task.data = withRoundOrderTempPlace(task.data, order?.data);
      }
    }
    // Customer, place, project and member within the company (lib/kfid/task-references-server.ts). A linked task takes its
    // work order's customer and project; a draft may have none yet (Arbetsordern styr, 2026-10-26/27).
    await verifyTaskReferences(ctx.organizationId, task, { canReadWorkOrders: ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "work-order", "read"), userId: ctx.user.id, formArea: form.formArea, subject });
    await fillPlaceField(ctx.organizationId, task);
    // Roller med nivå (2026-10-07): who is assigned, and who fills in, signs or completes, must reach the task's risk class.
    await requireSavedTaskLevels(ctx.organizationId, ctx.user, { task, formTemplateId: form.formTemplateId, documented: workflowTaskHasDocumentation(task) });
    const now = new Date();
    const current = task.id ? await prisma.workflowTask.findFirst({ where: { id: task.id, organizationId: ctx.organizationId } }) : null;
    // Företagets moduler (0.39.0): a job is never tied anew to a module that is off. What it already has stays, so it can still be
    // saved, and a linked task only takes what its work order holds. Without a customer, or on Eget företag, a job always works.
    if (!task.workOrderId) {
      if (task.projectId && task.projectId !== current?.projectId) requireModule(ctx, "projects");
      if (task.customerId && task.customerId !== current?.customerId) await requireCustomersOrOwn(ctx, task.customerId);
    }
    // Before the completion check: a judgement or verdict that no longer holds must not count (beslut 6 and 7).
    task.data = stampCustomerAndJudgements(task.data, current?.data, ctx.user.name || ctx.user.email || "", now.toISOString());
    if (task.status === "COMPLETED") {
      requireWorkflowPermission(ctx, subject, "complete");
      const completion = workflowTaskCompletion(task);
      if (!completion.ready) throw new ApiError(422, completion.issues.map((issue) => issue.message).join(" "));
    }
    // Riskbedömning som steg (2026-10-08): stamps the step and refuses completion until it is done.
    await applyRiskStepOnSave(ctx.organizationId, ctx.user, task, form);
    // Säkerhetsavstämning (2026-10-27, punkt 4): stamps the occurrence's check and refuses completion until it is done.
    await applyRoundSafetyOnSave(ctx.organizationId, ctx.user, task);
    task.data = stampWorkflowTaskApproval(task.data, now.toISOString());
    if (task.status === "COMPLETED" && current?.status !== "COMPLETED") await requireRoundSafety(ctx.organizationId, { ...task, status: current?.status ?? "PLANNED" }, "complete");
    // Driftrond i arbetsordern (punkt 3): the round a work order holds and its period (Start – Klart senast).
    const roundScheduleId = task.kind !== "WORK_ORDER" ? null : task.roundScheduleId === undefined ? current?.roundScheduleId ?? null : task.roundScheduleId;
    if (roundScheduleId && roundScheduleId !== current?.roundScheduleId) requireModule(ctx, "rounds");
    // Start and Uppskattad tid (projektförslaget steg 2): the same rules as the project's Tidplan (lib/workflow/schedule.ts).
    const scheduleFrame = task.projectId ? await prisma.project.findFirst({ where: { id: task.projectId, organizationId: ctx.organizationId }, select: { startDate: true, dueDate: true } }) : null;
    // Start på alla jobb (plan 1M): a new job without one starts today (inside the project's frame and not after Klart senast);
    // a saved Start is never cleared. An older job without one stays as it is (counted from the day it was created).
    if (!current) task.plannedStartDate = startForNewJob({ chosen: task.plannedStartDate, today: swedishDayKey(now), dueDate: task.dueDate, frame: scheduleFrame ? { startDate: scheduleFrame.startDate ?? "", dueDate: scheduleFrame.dueDate ?? "" } : null });
    else if (task.plannedStartDate === "" && current.plannedStartDate) task.plannedStartDate = current.plannedStartDate;
    const scheduleError = taskScheduleError(task, current, scheduleFrame);
    if (scheduleError) throw new ApiError(400, scheduleError);
    const schedule = { ...(task.plannedStartDate !== undefined ? { plannedStartDate: task.plannedStartDate } : {}), ...(task.estimatedMinutes !== undefined ? { estimatedMinutes: task.estimatedMinutes } : {}), ...(task.stage !== undefined ? { stage: normalizeStage(task.stage) } : {}) };
    // Priser på materialraden (2026-10-09): without the price right the stored prices are kept and a picked article is priced here.
    task.data = await applyMaterialPriceRules({ organizationId: ctx.organizationId, admin: ctx.admin, permissions: ctx.workflowPermissions, storageMode: ctx.organization.storageMode }, task.data, current?.kind === task.kind ? current.data : null);
    // Pågår and Pausad follow the time (2026-10-08): a save keeps them as they are (lib/workflow/task-status-rule.ts).
    const chosen = savedStatusForTask(task, current?.status);
    // Säkerhetsavstämning: the check comes before the work, so filling in waits for it and the protocol stays Planerad.
    const status = await roundSafetyOnSave(ctx.organizationId, task, { chosen, documented: workflowTaskHasDocumentation(task), stored: current ? { status: current.status, data: current.data } : null }) as typeof chosen;
    // Uppgifter får skapas först (2026-10-27): without a work order a task is saved only as a draft – Planerad, nothing
    // filled in or signed; the work starts once it is linked (the database refuses the rest too).
    const unlinked = workOrderRequiredError({ kind: task.kind, workOrderId: task.workOrderId, status });
    if (unlinked) throw new ApiError(409, unlinked);
    // Återkommande underhåll (2026-10-30): a vilande work order may be planned, moved or set to Utgår – not started or completed.
    if (current && status !== "PLANNED" && status !== CANCELLED_STATUS) await assertNotDormant(prisma, ctx.organizationId, current.id);
    if (task.kind === "WORK_ORDER" && (roundScheduleId || current?.roundScheduleId))
      await assertRoundHolder(ctx.organizationId, { id: task.id, roundScheduleId, plannedStartDate: task.plannedStartDate ?? current?.plannedStartDate ?? "", dueDate: task.dueDate, status }, current ? { roundScheduleId: current.roundScheduleId, roundOccurrence: current.roundOccurrence } : null);
    // "Väntar på …" belongs to a paused work order only (Underhåll, 2026-10-06).
    task.data = withoutStaleWaiting(status, task.data);
    const progress = workflowTaskProgress({ ...task, status });
    const snapshot = json({ ...task, status, progress });
    if (task.id) {
      if (!current) throw new ApiError(404, "Uppgiften hittades inte.");
      if (current.kind !== task.kind) throw new ApiError(409, "Uppgiftstypen kan inte ändras.");
      if (current.status === "COMPLETED") throw new ApiError(409, "Återöppna uppgiften innan du ändrar den.");
      if (isTaskCancelled(current.status)) throw new ApiError(409, "Jobbet har utgått. Återuppta det innan du ändrar det.");
      // After creation a work order changes project only through the project's Flytta, which always writes history; a task
      // follows its work order (moved to another order, it takes that order's project).
      if (current.kind === "WORK_ORDER" && current.projectId !== task.projectId) throw new ApiError(409, "Flytta arbetsordern via projektet, så att bytet hamnar i historiken.");
      const nextVersion = current.version + 1;
      // Grunduppgifter är gemensamma (2026-10-30): the work order's tasks take its customer, place, project, responsible
      // person and dates; a new responsible person must take each open task's class (Krävd nivå), checked before the save.
      const following = task.kind === "WORK_ORDER" && sharedBasicsChanged(current, { ...task, plannedStartDate: task.plannedStartDate ?? current.plannedStartDate, roundScheduleId: current.roundOccurrence ? current.roundScheduleId : roundScheduleId });
      if (following && task.assignedToUserId !== current.assignedToUserId) await requireFollowingLevels(ctx.organizationId, ctx.user, { id: task.id, assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName });
      let followed: { id: string; version: number }[] = [];
      const stopped = await prisma.$transaction(async (tx) => {
        let closed: StoppedTimer[] = [];
        const changed = await tx.workflowTask.updateMany({
          where: { id: task.id, organizationId: ctx.organizationId, version: task.version, status: { notIn: [...CLOSED_TASK_STATUSES] } },
          data: { projectId: task.projectId, customerId: task.customerId, facilityId: task.facilityId, workOrderId: task.workOrderId, ...(task.kind === "WORK_ORDER" && !current.roundOccurrence ? { roundScheduleId } : {}), title: task.title, description: task.description, status, progress, assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName, dueDate: task.dueDate, ...schedule, data: json(task.data), version: { increment: 1 }, completedAt: status === "COMPLETED" ? new Date() : null, updatedBy: ctx.user.id },
        });
        if (!changed.count) throw new ApiError(409, "Uppgiften har ändrats. Läs in den senaste versionen.");
        // The tasks of a work order follow its Grunduppgifter (Arbetsordern som hållare, 2026-10-30).
        if (following)
          followed = await followWorkOrder(tx, ctx.organizationId, { id: task.id!, kind: "WORK_ORDER", status, projectId: task.projectId, customerId: task.customerId, facilityId: task.facilityId, assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName, plannedStartDate: task.plannedStartDate ?? current.plannedStartDate, dueDate: task.dueDate, roundScheduleId: current.roundOccurrence ? current.roundScheduleId : roundScheduleId }, ctx.user.id);
        // "Tilldelad dig" (Fas 1B): a new responsible other than the person saving gets a notice in the bell.
        await recordAssignment(tx, { organizationId: ctx.organizationId, taskId: task.id!, previousUserId: current.assignedToUserId, nextUserId: task.assignedToUserId, actorId: ctx.user.id });
        if (status === "COMPLETED") {
          const running = await tx.workflowTimeEntry.findMany({ where: { taskId: task.id, endedAt: null } });
          closed = await closeRunningTimeEntries(tx, running, { id: task.id!, title: task.title }, now);
          // Avvikelse ↔ arbetsorder (2026-10-10): the entries this work order fixes become Åtgärdad, now, by this person.
          await linkDeviationsOnOrderSave(tx, { organizationId: ctx.organizationId, order: { id: task.id!, kind: task.kind, title: task.title, status, data: task.data }, created: false, by: { id: ctx.user.id, name: ctx.user.name?.trim() || ctx.user.email }, now });
          // Underhåll (2026-11-06): the order's open maintenance items are done with it, so the machine no longer says Pågår.
          // A plan's occurrence in a round (2026-11-27) is not: it is marked Klar by a person, else it follows to the round's next work order.
          if (task.kind === "WORK_ORDER") await tx.maintenanceItem.updateMany({ where: { organizationId: ctx.organizationId, workOrderId: task.id!, status: "OPEN", maintenancePlanId: null }, data: { status: "DONE", completedAt: now, updatedById: ctx.user.id, version: { increment: 1 } } });
        }
        // An autosave by the same person within ten minutes of their previous entry takes that entry's place, so the
        // history keeps one version per sitting rather than one per pause in the typing; a status change always gets its own.
        const merged = input.autosave && status === current.status
          ? await tx.workflowTaskRevision.updateMany({ where: { taskId: task.id!, version: current.version, createdBy: ctx.user.id, createdAt: { gte: new Date(now.getTime() - 10 * 60_000) } }, data: { version: nextVersion, snapshot } })
          : { count: 0 };
        if (!merged.count) await tx.workflowTaskRevision.create({ data: { taskId: task.id!, version: nextVersion, snapshot, createdBy: ctx.user.id } });
        return closed;
      });
      publishTaskChange(task.id, { version: nextVersion, byUserId: ctx.user.id, byName: ctx.user.name || ctx.user.email, status, reason: "save" });
      // An open task page of the order shows the shared fields at once.
      for (const item of followed) publishTaskChange(item.id, { version: item.version, byUserId: ctx.user.id, byName: ctx.user.name || ctx.user.email, reason: "save" });
      // A plan's work order closed, or its Start moved: the plan's coming work orders follow (done late moves the next one).
      if (current.maintenancePlanId && (status !== current.status || (task.plannedStartDate ?? current.plannedStartDate) !== current.plannedStartDate)) await refillPlan(ctx.organization, current);
      // A round's work order closed, got another period or another round (2026-11-27): the plans done in the round follow.
      if (task.kind === "WORK_ORDER" && !current.roundOccurrence && (roundScheduleId || current.roundScheduleId)
        && (status !== current.status || roundScheduleId !== current.roundScheduleId || (task.plannedStartDate ?? current.plannedStartDate) !== current.plannedStartDate || task.dueDate !== current.dueDate)) {
        await refillPlan(ctx.organization, { id: task.id!, roundScheduleId: roundScheduleId ?? current.roundScheduleId });
        if (current.roundScheduleId && roundScheduleId !== current.roundScheduleId) await refillPlan(ctx.organization, { id: task.id!, roundScheduleId: current.roundScheduleId });
      }
      // När något händer (Agenter, 2026-11-21): a work order completed by a person may start a mission (an agent never completes).
      if (task.kind === "WORK_ORDER" && status === "COMPLETED" && current.status !== "COMPLETED") void import("@/lib/agents/events").then(({ emitAgentEvent }) => emitAgentEvent({ organizationId: ctx.organizationId, key: "work_order_completed", id: `completed:${task.id}:${nextVersion}`, recordId: task.id!, title: task.title, href: `/?view=workflow_task&taskId=${encodeURIComponent(task.id!)}&taskType=WORK_ORDER`, actorId: ctx.user.id })).catch(() => undefined);
      return NextResponse.json({ id: task.id, version: nextVersion, stopped });
    }
    const created = await prisma.$transaction(async (tx) => {
      // First in the transaction: a second request with the same key waits here for this one (lib/security/idempotency-server.ts).
      await claimIdempotencyKey(tx, idempotency);
      const row = await tx.workflowTask.create({
        data: { organizationId: ctx.organizationId, projectId: task.projectId, customerId: task.customerId, facilityId: task.facilityId, workOrderId: task.workOrderId, roundScheduleId, kind: task.kind, ...form, title: task.title, description: task.description, status, progress, assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName, dueDate: task.dueDate, ...schedule, data: json(task.data), startedAt: status === "IN_PROGRESS" ? new Date() : null, completedAt: status === "COMPLETED" ? new Date() : null, createdBy: ctx.user.id, updatedBy: ctx.user.id, revisions: { create: { version: 1, snapshot, createdBy: ctx.user.id } } },
        select: { id: true, version: true },
      });
      // "Tilldelad dig" (Fas 1B): a task created for someone else tells them.
      await recordAssignment(tx, { organizationId: ctx.organizationId, taskId: row.id, previousUserId: null, nextUserId: task.assignedToUserId, actorId: ctx.user.id });
      // Avvikelse ↔ arbetsorder (2026-10-10): a work order made from a protocol row takes the row's log entries.
      await linkDeviationsOnOrderSave(tx, { organizationId: ctx.organizationId, order: { id: row.id, kind: task.kind, title: task.title, status, data: task.data }, created: true, by: { id: ctx.user.id, name: ctx.user.name?.trim() || ctx.user.email }, now });
      if (task.data.kind === "WORK_ORDER" && input.maintenance && ctx.organization.storageMode === "HINTEK_CLOUD" && organizationModuleOn(ctx.organization, "upkeep"))
        await deviationItem(tx, { organizationId: ctx.organizationId, userId: ctx.user.id, workOrderId: row.id, sourceTaskId: task.data.details.source?.taskId, facts: input.maintenance });
      await storeIdempotentAnswer(tx, idempotency, row);
      return row;
    }).catch((error) => { if (error instanceof IdempotencyTaken) return null; throw error; });
    // Another request with the same key made the job: its answer is this one's too.
    if (!created) return answerAfterTaken(idempotency!);
    // A new work order for a round (2026-11-27): a plan done in the round that waited for one gets its item now.
    if (task.kind === "WORK_ORDER" && roundScheduleId) await refillPlan(ctx.organization, { id: created.id, roundScheduleId });
    recordFeature(`task_created_${task.kind}`, ctx.analytics);
    return NextResponse.json(created);
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    requireControlDelete(ctx);
    const id = identifier.parse(new URL(request.url).searchParams.get("id"));
    const task = await prisma.workflowTask.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { id: true, kind: true, formArea: true, status: true, maintenancePlanId: true, attachments: { select: { storagePath: true } } } });
    if (!task) throw new ApiError(404, "Uppgiften hittades inte.");
    requireWorkflowPermission(ctx, workflowSubjectForTask(task.kind, task.formArea), "edit");
    // Återkommande underhåll (2026-10-30): an open occurrence of a plan is skipped with Utgår (the plan would make it again).
    if (task.maintenancePlanId && !(CLOSED_TASK_STATUSES as readonly string[]).includes(task.status)) throw new ApiError(409, "Arbetsordern hör till en underhållsplan. Sätt den till Utgår för att hoppa över tillfället, eller ändra planen under Underhåll.");
    // Ta bort arbetsorder (2026-10-26, svar 2b): its tasks go with it after the confirmation listed them; a completed
    // or signed protocol is never removed this way – the work order is completed or cancelled instead (history is kept).
    const inside = task.kind === "WORK_ORDER" ? await prisma.workflowTask.findMany({ where: { organizationId: ctx.organizationId, workOrderId: task.id }, select: { id: true, kind: true, formArea: true, title: true, status: true, data: true, attachments: { select: { storagePath: true } } } }) : [];
    const refusal = workOrderRemovalRefusal(inside.map((item) => ({ ...item, signed: taskIsSigned(item.data) })));
    if (refusal) throw new ApiError(409, refusal);
    // The tasks are removed with the same right as on their own.
    for (const item of inside) requireWorkflowPermission(ctx, workflowSubjectForTask(item.kind, item.formArea), "edit");
    const ids = [...inside.map((item) => item.id), task.id];
    await prisma.$transaction(async (tx) => {
      // Tidsperiod (2026-10-30): the time goes with the work order, so a sent-in or approved month keeps it from being removed.
      const entries = await tx.workflowTimeEntry.findMany({ where: { taskId: { in: ids } }, select: { userId: true, startedAt: true } });
      await assertTimeOpen(tx, ctx.organizationId, entries, ctx.user.id);
      await tx.plannedActivity.updateMany({
        where: { organizationId: ctx.organizationId, workflowTaskId: { in: ids } },
        data: { workflowTaskId: null, version: { increment: 1 }, updatedBy: ctx.user.id },
      });
      await tx.workflowTask.deleteMany({ where: { organizationId: ctx.organizationId, id: { in: inside.map((item) => item.id) } } });
      await tx.workflowTask.delete({ where: { id: task.id } });
    });
    await Promise.all([...inside.flatMap((item) => item.attachments), ...task.attachments].map((attachment) => remove(attachment.storagePath)));
    for (const removed of ids) publishTaskChange(removed, { version: 0, byUserId: ctx.user.id, byName: ctx.user.name || ctx.user.email, reason: "delete" });
    return NextResponse.json({ ok: true, removed: inside.length });
  } catch (error) {
    return failure(error);
  }
}
