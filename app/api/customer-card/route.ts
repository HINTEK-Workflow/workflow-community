import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure, requireAdmin, requireCloudStorage, requireCloudWriteAccess, requireWorkflowPermission } from "@/lib/kfid/server";
import { normalizeControl, validateForCompletion } from "@/lib/kfid/model";
import { hasWorkflowPermission, readableTaskScope } from "@/lib/workflow/permissions";
import { readableTaskWhere } from "@/lib/workflow/task-access";
import { summarizeProjectStatus } from "@/lib/workflow/project-status";
import { controlProgress } from "@/lib/workflow/project-progress";
import { customerFacilityInputSchema } from "@/lib/workflow/customer-facility";
import { workflowTaskDataSchema, workflowTaskProgress } from "@/lib/workflow/task-model";

export const dynamic = "force-dynamic";

const id = z.string().min(1).max(100);
const TASK_PAGE_SIZE = 12;
const TASK_KINDS = ["WORK_ORDER", "RISK_ASSESSMENT", "FORM", "COMMISSIONING_CONTROL"] as const;
const subjectOf = (kind: "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM") => kind === "WORK_ORDER" ? "work-order" as const : kind === "FORM" ? "forms" as const : "risk-assessment" as const;
const querySchema = z.object({
  id,
  kind: z.enum(["all", ...TASK_KINDS]).default("all"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
const facilitySelect = { id: true, customerId: true, name: true, address: true, postalCode: true, city: true, description: true, isActive: true, version: true } as const;

/**
 * The customer card (2026-09-26, decision 12B/D10 B): the customer, its facilities, its projects and one bounded
 * page of all its tasks (work orders, risk assessments and controls), filtered by the member's read permission per
 * module. Reading a customer stays open to every member; editing it needs the customers permission (2026-10-02).
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const can = (subject: "projects" | "kfid" | "work-order" | "risk-assessment" | "forms" | "customers") => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
    const customer = await prisma.customer.findFirst({
      where: { id: query.id, organizationId: ctx.organizationId },
      select: { id: true, name: true, company: true, address: true, postalCode: true, city: true, email: true, phone: true, mobile: true, notes: true, version: true, deletedAt: true, lat: true, lng: true },
    });
    if (!customer) throw new ApiError(404, "Kunden hittades inte.");
    // Protocols are listed when any form area is readable; each row is then filtered by its own area (2026-09-27).
    const taskKinds = (["WORK_ORDER", "RISK_ASSESSMENT", "FORM"] as const).filter((kind) => (kind === "FORM" ? readableTaskScope(can).areas.length > 0 : can(subjectOf(kind))) && (query.kind === "all" || query.kind === kind));
    const withControls = can("kfid") && (query.kind === "all" || query.kind === "COMMISSIONING_CONTROL");
    const take = query.page * TASK_PAGE_SIZE;
    const taskWhere = { organizationId: ctx.organizationId, customerId: customer.id };
    const controlWhere = { organizationId: ctx.organizationId, customerId: customer.id, deletedAt: null };
    const [facilities, projects, tasks, controls, taskCounts, controlCount] = await Promise.all([
      prisma.customerFacility.findMany({
        where: { organizationId: ctx.organizationId, customerId: customer.id },
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        select: { ...facilitySelect, _count: { select: { projects: true, workflowTasks: true, controls: { where: { deletedAt: null } } } } },
      }),
      can("projects") ? prisma.project.findMany({
        where: { organizationId: ctx.organizationId, customerId: customer.id },
        orderBy: { updatedAt: "desc" },
        take: 100,
        select: {
          id: true, name: true, startDate: true, dueDate: true, archivedAt: true, closedAt: true, facilityId: true, updatedAt: true,
          workflowTasks: { select: { status: true } },
          controls: { where: { deletedAt: null }, select: { status: true } },
          plannedActivities: { where: { deletedAt: null }, select: { status: true, endsAt: true } },
        },
      }) : Promise.resolve([]),
      taskKinds.length ? prisma.workflowTask.findMany({
        where: { ...taskWhere, kind: { in: [...taskKinds] }, AND: [readableTaskWhere(can)] },
        orderBy: { updatedAt: "desc" },
        take,
        select: { id: true, kind: true, title: true, status: true, progress: true, data: true, updatedAt: true, facilityId: true, project: { select: { name: true } } },
      }) : Promise.resolve([]),
      withControls ? prisma.control.findMany({
        where: controlWhere,
        orderBy: { updatedAt: "desc" },
        take,
        select: { id: true, number: true, title: true, status: true, updatedAt: true, facilityId: true, workflowProject: { select: { name: true } } },
      }) : Promise.resolve([]),
      prisma.workflowTask.groupBy({ by: ["kind"], where: { ...taskWhere, AND: [readableTaskWhere(can)] }, _count: { _all: true } }),
      can("kfid") ? prisma.control.count({ where: controlWhere }) : Promise.resolve(0),
    ]);
    const merged = [
      ...tasks.map((task) => ({ id: task.id, kind: task.kind, title: task.title, status: task.status, progress: workflowTaskProgress({ ...task, data: workflowTaskDataSchema.parse(task.data) }), updatedAt: task.updatedAt, facilityId: task.facilityId, projectName: task.project?.name ?? "" })),
      ...controls.map((control) => ({ id: control.id, number: control.number, kind: "COMMISSIONING_CONTROL", title: control.title, status: control.status, progress: 0, updatedAt: control.updatedAt, facilityId: control.facilityId, projectName: control.workflowProject?.name ?? "" })),
    ].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()).slice((query.page - 1) * TASK_PAGE_SIZE, take);
    // Control progression is computed only for the controls on this page.
    const pageControlIds = merged.filter((item) => item.kind === "COMMISSIONING_CONTROL").map((item) => item.id);
    const controlData = pageControlIds.length ? await prisma.control.findMany({ where: { id: { in: pageControlIds }, organizationId: ctx.organizationId }, select: { id: true, status: true, data: true, _count: { select: { attachments: true } } } }) : [];
    const controlPercent = new Map(controlData.map((control) => [control.id, controlProgress(control.status, validateForCompletion(normalizeControl(control.data), { attachmentCount: control._count.attachments }).progress.percent)]));
    const counts = {
      WORK_ORDER: taskCounts.find((row) => row.kind === "WORK_ORDER")?._count._all ?? 0,
      RISK_ASSESSMENT: taskCounts.find((row) => row.kind === "RISK_ASSESSMENT")?._count._all ?? 0,
      FORM: taskCounts.find((row) => row.kind === "FORM")?._count._all ?? 0,
      COMMISSIONING_CONTROL: controlCount,
    };
    const total = query.kind === "all" ? counts.WORK_ORDER + counts.RISK_ASSESSMENT + counts.FORM + counts.COMMISSIONING_CONTROL : counts[query.kind];
    return NextResponse.json({
      customer,
      facilities: facilities.map(({ _count, ...facility }) => ({ ...facility, links: _count.projects + _count.workflowTasks + _count.controls })),
      projects: projects.map(({ workflowTasks, controls: projectControls, plannedActivities, ...project }) => ({
        ...project,
        status: summarizeProjectStatus({ ...project, tasks: [...workflowTasks, ...projectControls], activities: plannedActivities }),
      })),
      canReadProjects: can("projects"),
      tasks: {
        items: merged.map((item) => ({ ...item, progress: item.kind === "COMMISSIONING_CONTROL" ? controlPercent.get(item.id) ?? 0 : item.progress, updatedAt: item.updatedAt.toISOString() })),
        total, page: query.page, pages: Math.max(1, Math.ceil(total / TASK_PAGE_SIZE)), counts: { all: counts.WORK_ORDER + counts.RISK_ASSESSMENT + counts.FORM + counts.COMMISSIONING_CONTROL, ...counts },
      },
      canManageFacilities: ctx.admin,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

/** Facilities are saved by any member, like customers; pausing and reactivating is for the company admin. */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("facility_save"), customerId: id, id: id.optional(), version: z.number().int().positive().optional(), facility: customerFacilityInputSchema }),
      z.object({ action: z.literal("facility_status"), id, isActive: z.boolean() }),
    ]).parse(await body(request));
    if (input.action === "facility_status") {
      requireAdmin(ctx);
      const changed = await prisma.customerFacility.updateMany({ where: { id: input.id, organizationId: ctx.organizationId }, data: { isActive: input.isActive, version: { increment: 1 }, updatedBy: ctx.user.id } });
      if (!changed.count) throw new ApiError(404, "Anläggningen hittades inte.");
      return NextResponse.json({ ok: true });
    }
    // A customer's facility is also governed by the customers permission (2026-10-02, decision 2.2).
    requireWorkflowPermission(ctx, "customers", input.id ? "edit" : "create");
    const customer = await prisma.customer.findFirst({ where: { id: input.customerId, organizationId: ctx.organizationId, deletedAt: null }, select: { id: true } });
    if (!customer) throw new ApiError(404, "Kunden hittades inte.");
    if (input.id) {
      const changed = await prisma.customerFacility.updateMany({
        where: { id: input.id, organizationId: ctx.organizationId, customerId: customer.id, ...(input.version ? { version: input.version } : {}) },
        data: { ...input.facility, version: { increment: 1 }, updatedBy: ctx.user.id },
      });
      if (!changed.count) throw new ApiError(409, "Anläggningen har ändrats eller finns inte längre. Läs in kundkortet igen.");
      return NextResponse.json({ id: input.id });
    }
    const created = await prisma.customerFacility.create({
      data: { organizationId: ctx.organizationId, customerId: customer.id, ...customerFacilityInputSchema.parse(input.facility), createdBy: ctx.user.id, updatedBy: ctx.user.id },
      select: { id: true },
    });
    return NextResponse.json(created);
  } catch (error) {
    return failure(error);
  }
}
