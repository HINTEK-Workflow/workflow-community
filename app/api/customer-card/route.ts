import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure, requireAdmin, requireCloudStorage, requireCloudWriteAccess, requireWorkflowPermission } from "@/lib/kfid/server";
import { customerForMember, mayReadCustomerRegister } from "@/lib/kfid/customer-access";
import { jobCustomerCard } from "@/lib/kfid/job-access";
import { hasWorkflowPermission, readableTaskScope, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { readableTaskWhere } from "@/lib/workflow/task-access";
import { summarizeProjectStatus } from "@/lib/workflow/project-status";
import { customerFacilityInputSchema, DUPLICATE_PLACE_MESSAGE, duplicatePlace, normalizeFacilityInput, placeInUseMessage, placeParentError } from "@/lib/workflow/customer-facility";
import { workflowTaskDataSchema, workflowTaskProgress } from "@/lib/workflow/task-model";
import { placeObjectOf } from "@/lib/workflow/maintenance";
import { readMaintenance } from "@/lib/workflow/maintenance-setting";
import { withoutObjectData } from "@/lib/workflow/feature-settings";
import { openWorkOrderCounts } from "@/lib/kfid/place-server";
import { quoteAccess } from "@/lib/quotes/server";
import { requireCustomersOrOwn, requireOwnPlaceEdit } from "@/lib/kfid/own-company-server";
import { organizationModuleOn } from "@/lib/workflow/modules";

export const dynamic = "force-dynamic";

const id = z.string().min(1).max(100);
const TASK_PAGE_SIZE = 12;
const TASK_KINDS = ["WORK_ORDER", "RISK_ASSESSMENT", "FORM"] as const;
const subjectOf = (kind: "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM") => kind === "WORK_ORDER" ? "work-order" as const : kind === "FORM" ? "forms" as const : "risk-assessment" as const;
const querySchema = z.object({
  id,
  kind: z.enum(["all", ...TASK_KINDS]).default("all"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
const facilitySelect = { id: true, customerId: true, parentId: true, kind: true, latitude: true, longitude: true, name: true, address: true, postalCode: true, city: true, description: true, isActive: true, version: true,
  objectType: true, operatingState: true, manufacturer: true, model: true, serialNumber: true, installedOn: true, attributes: true } as const;

/**
 * The customer card (2026-09-26, decision 12B/D10 B): the customer, its facilities, its projects and one bounded
 * page of all its tasks (work orders, risk assessments and protocols), filtered by the member's read permission per
 * module. Editing it needs the customers permission (2026-10-02). Without the right Kunder the answer is only the limited
 * card of someone with a job at the customer, and otherwise a refusal (beslut 10, 2026-11-01; lib/kfid/job-access.ts).
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    if (!mayReadCustomerRegister(ctx)) return NextResponse.json(await jobCustomerCard(ctx, query.id), { headers: { "Cache-Control": "private, no-store" } });
    const can = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
    const customer = await prisma.customer.findFirst({
      where: { id: query.id, organizationId: ctx.organizationId },
      select: { id: true, ownCompany: true, name: true, company: true, customerType: true, address: true, postalCode: true, city: true, email: true, phone: true, mobile: true, notes: true, specialRequirements: true, accountingCustomerNumber: true, version: true, deletedAt: true, lat: true, lng: true },
    });
    if (!customer) throw new ApiError(404, "Kunden hittades inte.");
    // Protocols are listed when any form area is readable; each row is then filtered by its own area (2026-09-27).
    const taskKinds = (["WORK_ORDER", "RISK_ASSESSMENT", "FORM"] as const).filter((kind) => (kind === "FORM" ? readableTaskScope(can).areas.length > 0 : can(subjectOf(kind))) && (query.kind === "all" || query.kind === kind));
    const taskWhere = { organizationId: ctx.organizationId, customerId: customer.id };
    // Kundkortets offerter (2026-10-10): the number of the customer's quotes (latest version of each) for those who
    // may read quotes; the list itself is read from /api/quotes?customerId=, with the same right.
    const quotes = quoteAccess({ admin: ctx.admin, permissions: ctx.workflowPermissions });
    const [facilities, projects, tasks, taskCounts, quoteCount] = await Promise.all([
      prisma.customerFacility.findMany({
        where: { organizationId: ctx.organizationId, customerId: customer.id },
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        // A place's link count holds only what the member may read (quality check 2026-10-05: a member saw 37 where
        // 30 were readable – a small team aggregate).
        select: { ...facilitySelect, _count: { select: {
          projects: { where: can("projects") ? {} : { id: { in: [] } } },
          workflowTasks: { where: readableTaskWhere(can) },
        } } },
      }),
      can("projects") ? prisma.project.findMany({
        where: { organizationId: ctx.organizationId, customerId: customer.id },
        orderBy: { updatedAt: "desc" },
        take: 100,
        select: {
          id: true, name: true, startDate: true, dueDate: true, archivedAt: true, closedAt: true, facilityId: true, updatedAt: true,
          workflowTasks: { select: { id: true, status: true } },
          plannedActivities: { where: { deletedAt: null }, select: { status: true, endsAt: true, workflowTaskId: true } },
        },
      }) : Promise.resolve([]),
      taskKinds.length ? prisma.workflowTask.findMany({
        where: { ...taskWhere, kind: { in: [...taskKinds] }, AND: [readableTaskWhere(can)] },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: (query.page - 1) * TASK_PAGE_SIZE,
        take: TASK_PAGE_SIZE,
        select: { id: true, kind: true, title: true, status: true, progress: true, data: true, updatedAt: true, facilityId: true, project: { select: { name: true } } },
      }) : Promise.resolve([]),
      prisma.workflowTask.groupBy({ by: ["kind"], where: { ...taskWhere, AND: [readableTaskWhere(can)] }, _count: { _all: true } }),
      quotes.read ? prisma.quote.count({ where: { organizationId: ctx.organizationId, customerId: customer.id, supersededAt: null } }) : Promise.resolve(null),
    ]);
    const items = tasks.map((task) => ({ id: task.id, kind: task.kind, title: task.title, status: task.status, progress: workflowTaskProgress({ ...task, data: workflowTaskDataSchema.parse(task.data) }), updatedAt: task.updatedAt.toISOString(), facilityId: task.facilityId, projectName: task.project?.name ?? "" }));
    // Open work orders per place for the Anläggningar cards (Underhåll stage 3): one grouped query for the customer.
    const [open, maintenance] = await Promise.all([openWorkOrderCounts(ctx, facilities.map((facility) => facility.id)), readMaintenance(ctx.organizationId)]);
    const counts = {
      WORK_ORDER: taskCounts.find((row) => row.kind === "WORK_ORDER")?._count._all ?? 0,
      RISK_ASSESSMENT: taskCounts.find((row) => row.kind === "RISK_ASSESSMENT")?._count._all ?? 0,
      FORM: taskCounts.find((row) => row.kind === "FORM")?._count._all ?? 0,
    };
    const total = query.kind === "all" ? counts.WORK_ORDER + counts.RISK_ASSESSMENT + counts.FORM : counts[query.kind];
    return NextResponse.json({
      // Without Kunder the register's own notes are left out (2026-10-24).
      customer: customerForMember(ctx, customer),
      facilities: facilities.map(({ _count, ...facility }) => ({ ...facility, ...placeObjectOf(facility), links: _count.projects + _count.workflowTasks, openWorkOrders: open?.get(facility.id) ?? null })),
      maintenance,
      projects: projects.map(({ workflowTasks, plannedActivities, ...project }) => ({
        ...project,
        status: summarizeProjectStatus({ ...project, tasks: workflowTasks, activities: plannedActivities }),
      })),
      canReadProjects: can("projects"),
      // Without Kunder the register's own notes are withheld (blank): the card leaves their rows out instead of showing "–".
      registerNotes: mayReadCustomerRegister(ctx),
      quotes: quoteCount === null ? null : { total: quoteCount, canCreate: quotes.edit && !customer.deletedAt },
      tasks: {
        items,
        total, page: query.page, pages: Math.max(1, Math.ceil(total / TASK_PAGE_SIZE)), counts: { all: counts.WORK_ORDER + counts.RISK_ASSESSMENT + counts.FORM, ...counts },
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
      z.object({ action: z.literal("facility_delete"), id }),
    ]).parse(await body(request));
    // Ta bort (2026-10-14): only a place nothing points to – no object under it, no project, job, control, round,
    // quote or limit value. One that is in use is paused instead, so reports keep their way.
    if (input.action === "facility_delete") {
      requireWorkflowPermission(ctx, "customers", "edit");
      // Eget företag (2026-10-24): the company's own places are changed by those who may edit the company.
      const placeCustomer = (await prisma.customerFacility.findFirst({ where: { id: input.id, organizationId: ctx.organizationId }, select: { customerId: true } }))?.customerId;
      await requireOwnPlaceEdit(ctx, placeCustomer);
      // Företagets moduler (0.39.0): with Kunder off only the company's own places change.
      await requireCustomersOrOwn(ctx, placeCustomer);
      const place = await prisma.customerFacility.findFirst({ where: { id: input.id, organizationId: ctx.organizationId }, select: { id: true, _count: { select: { children: true, projects: true, workflowTasks: true, controls: true, formSchedules: true, limitProfiles: true } } } });
      if (!place) throw new ApiError(404, "Platsen hittades inte.");
      const quotes = await prisma.quote.count({ where: { organizationId: ctx.organizationId, facilityId: place.id } });
      const message = placeInUseMessage({ ...place._count, quotes });
      if (message) throw new ApiError(409, message);
      await prisma.customerFacility.deleteMany({ where: { id: place.id, organizationId: ctx.organizationId } });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "facility_status") {
      requireAdmin(ctx);
      if (!organizationModuleOn(ctx.organization, "customers")) await requireCustomersOrOwn(ctx, (await prisma.customerFacility.findFirst({ where: { id: input.id, organizationId: ctx.organizationId }, select: { customerId: true } }))?.customerId);
      const changed = await prisma.customerFacility.updateMany({ where: { id: input.id, organizationId: ctx.organizationId }, data: { isActive: input.isActive, version: { increment: 1 }, updatedBy: ctx.user.id } });
      if (!changed.count) throw new ApiError(404, "Platsen hittades inte.");
      return NextResponse.json({ ok: true });
    }
    // A customer's facility is also governed by the customers permission (2026-10-02, decision 2.2).
    requireWorkflowPermission(ctx, "customers", input.id ? "edit" : "create");
    await requireOwnPlaceEdit(ctx, input.customerId);
    await requireCustomersOrOwn(ctx, input.customerId);
    const customer = await prisma.customer.findFirst({ where: { id: input.customerId, organizationId: ctx.organizationId, deletedAt: null }, select: { id: true } });
    if (!customer) throw new ApiError(404, "Kunden hittades inte.");
    // A place under another one (2026-10-04): the parent is the same customer's, never the place itself or below it.
    // The database checks the same; the address belongs to the top level only.
    // Objektdata på platser is optional (2026-10-07): while it is off the object fields of a request are left out, so
    // what is saved stays as it is and no new object data is written.
    const normalized = normalizeFacilityInput(input.facility);
    const facility = (await readMaintenance(ctx.organizationId)) ? normalized : { ...withoutObjectData(normalized), parentId: normalized.parentId };
    const places = await prisma.customerFacility.findMany({ where: { organizationId: ctx.organizationId, customerId: customer.id }, select: { id: true, customerId: true, parentId: true, name: true, isActive: true } });
    if (facility.parentId) {
      const parentError = placeParentError(places, { id: input.id, customerId: customer.id, parentId: facility.parentId });
      if (parentError) throw new ApiError(400, parentError);
    }
    // Dubbletter (2026-10-08): the same name on the same level under the customer is refused with the existing place's
    // id, so the Plats field can offer it instead.
    const duplicate = duplicatePlace(places, { id: input.id, customerId: customer.id, parentId: facility.parentId, name: facility.name });
    if (duplicate) return NextResponse.json({ error: DUPLICATE_PLACE_MESSAGE, existingId: duplicate.id }, { status: 409 });
    if (input.id) {
      const changed = await prisma.customerFacility.updateMany({
        where: { id: input.id, organizationId: ctx.organizationId, customerId: customer.id, ...(input.version ? { version: input.version } : {}) },
        data: { ...facility, version: { increment: 1 }, updatedBy: ctx.user.id },
      });
      if (!changed.count) throw new ApiError(409, "Platsen har ändrats eller finns inte längre. Läs in kundkortet igen.");
      return NextResponse.json({ id: input.id });
    }
    const created = await prisma.customerFacility.create({
      data: { organizationId: ctx.organizationId, customerId: customer.id, ...facility, createdBy: ctx.user.id, updatedBy: ctx.user.id },
      select: { id: true },
    });
    return NextResponse.json(created);
  } catch (error) {
    return failure(error);
  }
}
