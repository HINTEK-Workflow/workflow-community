import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, type Context } from "@/lib/kfid/server";
import { loadScheduleViews } from "@/lib/kfid/rounds-server";
import { roundAtPlaceToday } from "@/lib/workflow/place-scan";
import { visibleFormsWhere } from "@/lib/kfid/form-server";
import { loadPlaceSummaries } from "@/lib/kfid/facility-server";
import { placeAddress, placeChain, placeKindOf, placeName, placePath, placePosition, placeWithDescendants } from "@/lib/workflow/customer-facility";
import { canReadRounds, formPermissionArea, hasWorkflowPermission, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { readableTaskWhere } from "@/lib/workflow/task-access";
import { workflowTaskDataSchema, workflowTaskProgress } from "@/lib/workflow/task-model";
import { placeObjectOf } from "@/lib/workflow/maintenance";
import { PLACE_LEVELS, PLACE_REGISTER_PAGE, PLACE_STATE_FILTERS, placeStateLevel, type PlaceLevel, type PlaceRegisterFilter, type PlaceStateFilter } from "@/lib/workflow/place-register";
import { readMaintenance } from "@/lib/workflow/maintenance-setting";
import { swedishDayKey } from "@/lib/swedish-time";
import { CLOSED_TASK_STATUSES } from "@/lib/workflow/task-cancel";
import { customerTitle } from "@/lib/kfid/customer-name";
import { jobAtCustomerWhere, jobAtPlaceWhere, NO_JOB_AT_PLACE, ownJobsWhere } from "@/lib/kfid/job-access";

export const PLACE_HISTORY_PAGE = 20;
const objectSelect = { objectType: true, operatingState: true, manufacturer: true, model: true, serialNumber: true, installedOn: true, attributes: true } as const;
const placeSelect = { id: true, updatedAt: true, customerId: true, parentId: true, kind: true, name: true, address: true, postalCode: true, city: true, description: true, isActive: true, latitude: true, longitude: true, version: true, ...objectSelect } as const;

/** Open work orders per place, one grouped query (never one per card); only for a member who may read work orders. */
export async function openWorkOrderCounts(ctx: Context, facilityIds: string[]) {
  const counts = new Map<string, number>();
  const can = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
  if (!facilityIds.length || !can("work-order")) return null;
  const rows = await prisma.workflowTask.groupBy({
    by: ["facilityId"], _count: { _all: true },
    where: { organizationId: ctx.organizationId, kind: "WORK_ORDER", status: { notIn: [...CLOSED_TASK_STATUSES] }, facilityId: { in: facilityIds }, AND: [readableTaskWhere(can)] },
  });
  for (const row of rows) if (row.facilityId) counts.set(row.facilityId, row._count._all);
  return counts;
}

type ScheduleView = Awaited<ReturnType<typeof loadScheduleViews>>[number];
const placeRoundRow = (schedule: ScheduleView) => ({ id: schedule.id, title: schedule.title, templateId: schedule.templateId, templateName: schedule.templateName, workOrderId: schedule.holder?.id ?? null, workOrderTitle: schedule.holder?.title ?? "", facilityId: schedule.holder?.facilityId ?? null, facilityName: schedule.holder?.facilityName ?? "", tempPlace: schedule.holder?.tempPlace ?? null, active: schedule.active, ruleText: schedule.ruleText,
  assignedToUserId: schedule.assignedToUserId ?? null, assignedToName: schedule.assignedToName ?? "", templateMissing: Boolean(schedule.templateMissing), templateUnpublished: Boolean(schedule.templateUnpublished), current: schedule.overview.current ?? null, next: schedule.overview.next ?? null, started: schedule.overview.started });

/**
 * A place's page (2026-10-04, Platser etapp 3; 2026-10-06 in tabs, Underhåll stage 3): the place with its whole
 * way and object data, the places below it, everything done at it and below it, the rounds made there and its limit
 * profiles – the page a QR label opens. History is read a page at a time and only what the person may read.
 */
export async function placeView(ctx: Context, placeId: string, page = 1) {
  const place = await prisma.customerFacility.findFirst({ where: { id: placeId, organizationId: ctx.organizationId }, select: placeSelect });
  if (!place) throw new ApiError(404, "Platsen finns inte i ditt företag.");
  const [customer, places, maintenance] = await Promise.all([
    prisma.customer.findFirst({ where: { id: place.customerId, organizationId: ctx.organizationId }, select: { id: true, name: true, company: true, customerType: true, deletedAt: true } }),
    prisma.customerFacility.findMany({ where: { organizationId: ctx.organizationId, customerId: place.customerId }, select: placeSelect }),
    readMaintenance(ctx.organizationId),
  ]);
  const ids = [...placeWithDescendants(places, place.id)];
  const chainIds = placeChain(places, place.id).map((item) => item.id);
  const can = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
  const take = page * PLACE_HISTORY_PAGE;
  const kids = places.filter((item) => item.parentId === place.id && item.isActive);
  const [tasks, taskCount, projects, open, limitRows] = await Promise.all([
    prisma.workflowTask.findMany({ where: { organizationId: ctx.organizationId, facilityId: { in: ids }, AND: [readableTaskWhere(can)] }, orderBy: { updatedAt: "desc" }, take,
      select: { id: true, kind: true, title: true, status: true, data: true, updatedAt: true, facilityId: true, assignedToName: true } }),
    prisma.workflowTask.count({ where: { organizationId: ctx.organizationId, facilityId: { in: ids }, AND: [readableTaskWhere(can)] } }),
    can("projects") ? prisma.project.findMany({ where: { organizationId: ctx.organizationId, facilityId: { in: ids } }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, name: true, startDate: true, dueDate: true, closedAt: true, archivedAt: true, facilityId: true } }) : [],
    openWorkOrderCounts(ctx, [place.id, ...kids.map((item) => item.id)]),
    prisma.formLimitProfile.findMany({ where: { organizationId: ctx.organizationId, facilityId: place.id }, orderBy: [{ templateId: "asc" }, { objectName: "asc" }], take: 50,
      select: { id: true, templateId: true, objectName: true, values: true, updatedAt: true, updatedByName: true } }),
  ]);
  // Limit profiles of forms the member may read (a form's protocols follow its permission area).
  const templates = limitRows.length ? await prisma.formTemplate.findMany({ where: { id: { in: [...new Set(limitRows.map((row) => row.templateId))] }, ...visibleFormsWhere(ctx.organizationId) }, select: { id: true, name: true, permissionArea: true } }) : [];
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const limits = limitRows.filter((row) => { const template = templateById.get(row.templateId); return template ? can(formPermissionArea(template.permissionArea)) : ctx.admin; }).map((row) => ({
    id: row.id, templateId: row.templateId, templateName: templateById.get(row.templateId)?.name ?? "Formulär", objectName: row.objectName,
    count: row.values && typeof row.values === "object" ? Object.keys(row.values).length : 0, updatedAt: row.updatedAt.toISOString(), updatedByName: row.updatedByName,
  }));
  const at = (facilityId: string | null) => facilityId && facilityId !== place.id ? placePath(places, facilityId).split(" › ").slice(placeChain(places, place.id).length).join(" › ") : "";
  const history = tasks.map((task) => ({ id: task.id, kind: task.kind, title: task.title, status: task.status, progress: workflowTaskProgress({ ...task, data: workflowTaskDataSchema.parse(task.data) }), updatedAt: task.updatedAt.toISOString(), below: at(task.facilityId), assignedToName: task.assignedToName,
    href: `/?view=workflow_task&taskId=${encodeURIComponent(task.id)}&taskType=${task.kind}` }));
  // Rounds made at the place, above it (a round of the whole facility) or below it: since 2026-10-27 (kväll) the place is the
  // work order's, so a round is here when the work order that holds it today stands at one of these places.
  const today = swedishDayKey(new Date());
  const rounds = (await loadScheduleViews(ctx, today)).filter((schedule) => roundAtPlaceToday(schedule.holder, [...ids, ...chainIds], today));
  const childCount = (id: string) => places.filter((item) => item.parentId === id).length;
  const canEditPlaces = ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "customers", "edit");
  // The map on the page (2026-10-07): the place's own pin, or – when the position is inherited – the pin of the place above
  // that has one, and the pins of the active places below it that have positions of their own.
  const position = placePosition(places, place.id);
  const positionFrom = position && !position.own ? [...placeChain(places, place.id)].reverse().find((item) => typeof item.latitude === "number" && typeof item.longitude === "number") : undefined;
  const pins = places.filter((item) => item.id !== place.id && item.isActive && ids.includes(item.id) && typeof item.latitude === "number" && typeof item.longitude === "number")
    .map((item) => ({ id: item.id, latitude: item.latitude as number, longitude: item.longitude as number, label: at(item.id) || placeName(item) }));
  return {
    place: { ...place, ...placeObjectOf(place), kind: placeKindOf(place), path: placePath(places, place.id), ...placeAddress(places, place.id), ownAddress: { address: place.address, postalCode: place.postalCode, city: place.city }, position,
      positionFrom: positionFrom ? { id: positionFrom.id, name: placeName(positionFrom) } : null, openWorkOrders: open?.get(place.id) ?? null },
    pins,
    customer: customer ? { id: customer.id, name: customerTitle(customer), deleted: Boolean(customer.deletedAt) } : null,
    chain: placeChain(places, place.id).map((item) => ({ id: item.id, name: item.name })),
    children: kids.map((item) => ({ id: item.id, name: item.name, kind: placeKindOf(item), ...placeObjectOf(item), children: childCount(item.id), openWorkOrders: open?.get(item.id) ?? null })),
    history: { items: history, total: taskCount, page },
    projects: projects.map((project) => ({ ...project, below: at(project.facilityId) })),
    rounds: rounds.map(placeRoundRow),
    limits,
    maintenance,
    // The customer's places for the edit form's "Ligger under" (only for those who may change places).
    places: canEditPlaces ? places.map((item) => ({ ...item, ...placeObjectOf(item) })) : [],
    canCreate: { workOrder: ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "work-order", "create") },
    canEdit: canEditPlaces && !customer?.deletedAt,
  };
}

/**
 * Platsen utan rätten Kunder (beslut 10, 2026-11-01): the place is opened only for someone with an open job at exactly
 * this place, or with a round at it today (a QR label opens the place to start the round). Then its name and address, the
 * person's own jobs there and those rounds. Never the places below or beside it, its object data, pins, projects, limit
 * profiles or anybody else's history. The customer's name only for someone with a job at the customer.
 */
export async function limitedPlaceView(ctx: Context, placeId: string) {
  const refused = new ApiError(403, NO_JOB_AT_PLACE);
  const place = await prisma.customerFacility.findFirst({ where: { id: placeId, organizationId: ctx.organizationId }, select: { id: true, customerId: true, kind: true, name: true, isActive: true } });
  if (!place) throw refused;
  const own = ownJobsWhere(ctx.organizationId, ctx.user.id);
  const [places, jobs, atCustomer] = await Promise.all([
    prisma.customerFacility.findMany({ where: { organizationId: ctx.organizationId, customerId: place.customerId }, select: { id: true, parentId: true, name: true, address: true, postalCode: true, city: true, latitude: true, longitude: true } }),
    prisma.workflowTask.findMany({ where: { AND: [own, jobAtPlaceWhere(place.id)] }, orderBy: { updatedAt: "desc" }, take: PLACE_HISTORY_PAGE, select: { id: true, kind: true, title: true, status: true } }),
    prisma.workflowTask.findFirst({ where: { AND: [own, jobAtCustomerWhere(place.customerId)] }, select: { id: true } }),
  ]);
  const today = swedishDayKey(new Date());
  const reach = [...placeWithDescendants(places, place.id), ...placeChain(places, place.id).map((item) => item.id)];
  const rounds = canReadRounds(ctx.admin, ctx.workflowPermissions) ? (await loadScheduleViews(ctx, today)).filter((schedule) => roundAtPlaceToday(schedule.holder, reach, today)) : [];
  if (!jobs.length && !rounds.length) throw refused;
  const customer = atCustomer ? await prisma.customer.findFirst({ where: { id: place.customerId, organizationId: ctx.organizationId }, select: { id: true, name: true, company: true, customerType: true, deletedAt: true } }) : null;
  return {
    limited: true as const,
    place: { id: place.id, customerId: customer?.id ?? "", kind: placeKindOf(place), name: place.name, isActive: place.isActive, path: placeName(place), ...placeAddress(places, place.id), position: jobs.length ? placePosition(places, place.id) : null },
    customer: customer ? { id: customer.id, name: customerTitle(customer), deleted: Boolean(customer.deletedAt) } : null,
    jobs: jobs.map((job) => ({ id: job.id, kind: job.kind, title: job.title, status: job.status, href: `/?view=workflow_task&taskId=${encodeURIComponent(job.id)}&taskType=${job.kind}` })),
    rounds: rounds.map(placeRoundRow),
  };
}

/**
 * Alla objekt (2026-10-06, decision B5): the company's places across every customer, filtered and paged in
 * PostgreSQL with the same rules as lib/workflow/place-register.ts. Read like the customer register; counts per page
 * with grouped queries.
 */
export async function placeRegisterView(ctx: Context, filter: PlaceRegisterFilter, page = 1) {
  const like = filter.q ? `%${filter.q.replace(/[\\%_]/g, "\\$&")}%` : "";
  const whereFor = (level: PlaceLevel, state: PlaceRegisterFilter["state"]): Prisma.CustomerFacilityWhereInput => ({
    organizationId: ctx.organizationId,
    customer: { deletedAt: null },
    ...(level === "top" ? { parentId: null } : level === "objects" ? { kind: "OBJECT" } : {}),
    ...(filter.objectType ? { objectType: { equals: filter.objectType, mode: "insensitive" as const } } : {}),
    ...(state ? { operatingState: state } : {}),
    ...(like ? { OR: (["name", "objectType", "manufacturer", "model", "serialNumber", "description"] as const).map((field) => ({ [field]: { contains: filter.q, mode: "insensitive" as const } })) } : {}),
  });
  const where = whereFor(filter.level, filter.state);
  const take = Math.max(1, page) * PLACE_REGISTER_PAGE;
  // The chips (2026-10-31) count with the same where as the list, for the whole company, not the page that was read.
  const [total, rows, types, levels, states, everyState] = await Promise.all([
    prisma.customerFacility.count({ where }),
    prisma.customerFacility.findMany({ where, take, orderBy: filter.sort === "updated" ? [{ updatedAt: "desc" }, { id: "asc" }] : [{ isActive: "desc" }, { name: "asc" }, { id: "asc" }],
      select: { ...placeSelect, customer: { select: { name: true, company: true, customerType: true } } } }),
    prisma.customerFacility.findMany({ where: { organizationId: ctx.organizationId, objectType: { not: "" } }, distinct: ["objectType"], select: { objectType: true }, orderBy: { objectType: "asc" }, take: 200 }),
    Promise.all(PLACE_LEVELS.map((level) => prisma.customerFacility.count({ where: whereFor(level, filter.state) }))),
    prisma.customerFacility.groupBy({ by: ["operatingState"], where: whereFor(placeStateLevel(filter.level), ""), _count: { _all: true } }),
    prisma.customerFacility.count({ where: whereFor(filter.level, "") }),
  ]);
  const ordered = rows;
  const ids = ordered.map((row) => row.id);
  const [paths, children, open] = await Promise.all([
    loadPlaceSummaries(ctx.organizationId, ids),
    ids.length ? prisma.customerFacility.groupBy({ by: ["parentId"], where: { organizationId: ctx.organizationId, parentId: { in: ids } }, _count: { _all: true } }) : [],
    openWorkOrderCounts(ctx, ids),
  ]);
  const childCount = new Map(children.map((row) => [row.parentId, row._count._all]));
  return {
    items: ordered.map(({ customer, ...row }) => ({
      place: { ...row, ...placeObjectOf(row), kind: placeKindOf(row) }, customerName: customerTitle(customer),
      path: paths.get(row.id)?.name ?? row.name, children: childCount.get(row.id) ?? 0, openWorkOrders: open?.get(row.id) ?? null,
    })),
    total, page: Math.max(1, page), pages: Math.max(1, Math.ceil(total / PLACE_REGISTER_PAGE)),
    objectTypes: types.map((row) => row.objectType),
    counts: {
      level: Object.fromEntries(PLACE_LEVELS.map((level, index) => [level, levels[index]])) as Record<PlaceLevel, number>,
      state: Object.fromEntries(PLACE_STATE_FILTERS.map((state) => [state, state === "all" ? everyState : states.find((row) => row.operatingState === state)?._count._all ?? 0])) as Record<PlaceStateFilter, number>,
    },
  };
}
