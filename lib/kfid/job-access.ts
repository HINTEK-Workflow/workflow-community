import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, type Context } from "@/lib/kfid/server";
import { customerReference, mayPickCustomer, pickerCustomer, PICKER_CHOICE_LIMIT } from "@/lib/kfid/customer-picker-fields";
import { hasWorkflowPermission, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { placeAddress, placeChain } from "@/lib/workflow/customer-facility";
import { ownCompanyFirst } from "@/lib/workflow/own-company";
import { bookedActivityWhere } from "@/lib/workflow/project-filters";
import { readableTaskWhere } from "@/lib/workflow/task-access";
import { CLOSED_TASK_STATUSES } from "@/lib/workflow/task-cancel";

/**
 * Medarbetare via jobbet (beslut 10, 2026-11-01). Whoever has a job at a customer or on a machine sees a limited card:
 * the customer's contact and the job's place, or the machine's history and spare parts. Never the register, the tree or the
 * lists, and never the customer's notes, projects or other jobs. A job means a task that is still open and is the person's:
 * assigned to them, unassigned and made by them, or planned for them, by the same rule as Mina projekt; when it is closed the
 * card closes with it. The server decides on every read; the page only draws what it is given.
 */
export const NO_JOB_AT_CUSTOMER = "Du har inget jobb hos kunden och saknar rätten Kunder.";
export const NO_JOB_AT_PLACE = "Du har inget jobb på platsen och saknar rätten Kunder.";
export const NO_JOB_ON_MACHINE = "Du har inget jobb på maskinen och saknar rätten Underhåll.";

type Member = Pick<Context, "organizationId" | "user" | "admin" | "workflowPermissions">;

export function ownJobsWhere(organizationId: string, userId: string): Prisma.WorkflowTaskWhereInput {
  return {
    organizationId,
    status: { notIn: [...CLOSED_TASK_STATUSES] },
    OR: [
      { assignedToUserId: userId },
      { assignedToUserId: null, createdBy: userId },
      { plannedActivities: { some: { organizationId, ...bookedActivityWhere(userId) } } },
    ],
  };
}

/** A job at the customer: its own link, its project's, or its place's. */
export const jobAtCustomerWhere = (customerId: string): Prisma.WorkflowTaskWhereInput => ({
  OR: [{ customerId }, { project: { customerId } }, { facility: { customerId } }],
});

/** A job at exactly this place: the job's own place, or its project's. */
export const jobAtPlaceWhere = (placeId: string): Prisma.WorkflowTaskWhereInput => ({
  OR: [{ facilityId: placeId }, { project: { facilityId: placeId } }],
});

/** Exactly the machine part the job is on: its own part, or a maintenance item it holds. Nothing above or below it. */
export const jobOnPartWhere = (organizationId: string, userId: string, partId: string): Prisma.WorkflowTaskWhereInput => ({
  AND: [ownJobsWhere(organizationId, userId), { OR: [{ machinePartId: partId }, { maintenanceItems: { some: { organizationId, partId } } }] }],
});

/** The words a customer choice is searched on: never the register's notes. */
export const customerChoiceSearch = (query: string): Prisma.CustomerWhereInput =>
  query ? { OR: ["name", "company", "email", "city", "phone"].map((field) => ({ [field]: { contains: query, mode: "insensitive" as const } })) } : {};

const choicePlaceSelect = { id: true, customerId: true, parentId: true, kind: true, name: true, address: true, postalCode: true, city: true, isActive: true, latitude: true, longitude: true } as const;
type ChoicePlace = Prisma.CustomerFacilityGetPayload<{ select: typeof choicePlaceSelect }>;

/** The places as they are sent: the chosen ones with the way down to them, or all; a position only on the way to the person's own job, never a description. */
function placesForChoice(rows: readonly ChoicePlace[], input: { all: boolean; chosen: ReadonlySet<string>; positions: boolean }) {
  const way = new Set(rows.filter((row) => input.chosen.has(row.id)).flatMap((row) => placeChain(rows, row.id).map((item) => item.id)));
  return rows.filter((row) => input.all || way.has(row.id)).map((row) => ({ ...row, description: "", ...(input.positions && way.has(row.id) ? {} : { latitude: null, longitude: null }) }));
}

/** The customers and places of the person's open jobs, bounded. */
async function ownJobReach(ctx: Member) {
  const rows = await prisma.workflowTask.findMany({
    where: ownJobsWhere(ctx.organizationId, ctx.user.id), orderBy: { updatedAt: "desc" }, take: 200,
    select: { customerId: true, facilityId: true, facility: { select: { customerId: true } }, project: { select: { customerId: true, facilityId: true } } },
  });
  const customers = rows.flatMap((row) => [row.customerId, row.project?.customerId, row.facility?.customerId]).filter((id): id is string => Boolean(id));
  const places = rows.flatMap((row) => [row.facilityId, row.project?.facilityId]).filter((id): id is string => Boolean(id));
  return { customers: new Set(customers), places: new Set(places) };
}

/**
 * The customer choices without the right Kunder: someone who may make or change a job picks from a short page that a search
 * reaches past (`truncated`), with only the picker's fields (2026-10-24); anyone gets the customers of their own open
 * jobs. Nobody else gets a list, whatever `limit` asks for.
 */
export async function customerChoices(ctx: Member, input: { query: string; limit: number; activeOnly: boolean }) {
  const pick = mayPickCustomer(ctx);
  const reach = await ownJobReach(ctx);
  const take = Math.min(input.limit, PICKER_CHOICE_LIMIT);
  const include = { facilities: { orderBy: { name: "asc" as const }, select: choicePlaceSelect } };
  const searched = customerChoiceSearch(input.query);
  const [page, own] = await Promise.all([
    pick ? prisma.customer.findMany({ where: { organizationId: ctx.organizationId, deletedAt: null, ...searched }, orderBy: [{ ownCompany: "desc" }, { name: "asc" }], take: take + 1, include }) : [],
    reach.customers.size ? prisma.customer.findMany({ where: { organizationId: ctx.organizationId, id: { in: [...reach.customers] }, ...(input.activeOnly ? { deletedAt: null } : {}), ...searched }, orderBy: { name: "asc" }, include }) : [],
  ]);
  const shown = new Map([...page.slice(0, take), ...own].map((row) => [row.id, row]));
  const customers = ownCompanyFirst([...shown.values()].sort((a, b) => a.name.localeCompare(b.name, "sv"))).map(({ facilities, ...row }) => ({
    ...pickerCustomer(row as unknown as Record<string, unknown>),
    facilities: placesForChoice(facilities, { all: pick, chosen: reach.places, positions: true }),
  }));
  return { customers, truncated: page.length > take };
}

/**
 * One customer without the right Kunder: the picker's fields and the job's places for someone with a job there; only the name
 * for someone who may read a job or project there, so that job can say who it is for. Everyone else is refused, the same
 * way as on the customer card.
 */
export async function customerForOwnWork(ctx: Member, customer: { id: string } & Record<string, unknown>) {
  const can = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
  const atCustomer = jobAtCustomerWhere(customer.id);
  const placesOf = (rows: readonly { facilityId: string | null; project: { facilityId: string | null } | null }[]) => new Set(rows.flatMap((row) => [row.facilityId, row.project?.facilityId]).filter((id): id is string => Boolean(id)));
  const select = { facilityId: true, project: { select: { facilityId: true } } } as const;
  const rows = () => prisma.customerFacility.findMany({ where: { organizationId: ctx.organizationId, customerId: customer.id }, orderBy: { name: "asc" }, select: choicePlaceSelect });
  const jobs = await prisma.workflowTask.findMany({ where: { AND: [ownJobsWhere(ctx.organizationId, ctx.user.id), atCustomer] }, orderBy: { updatedAt: "desc" }, take: 20, select });
  if (jobs.length) return { ...pickerCustomer(customer), facilities: placesForChoice(await rows(), { all: false, chosen: placesOf(jobs), positions: true }) };
  const [readable, project] = await Promise.all([
    prisma.workflowTask.findMany({ where: { organizationId: ctx.organizationId, AND: [readableTaskWhere(can), atCustomer] }, orderBy: { updatedAt: "desc" }, take: 100, select }),
    can("projects") ? prisma.project.findMany({ where: { organizationId: ctx.organizationId, customerId: customer.id }, orderBy: { updatedAt: "desc" }, take: 100, select: { facilityId: true } }) : [],
  ]);
  if (!readable.length && !project.length) throw new ApiError(403, NO_JOB_AT_CUSTOMER);
  const chosen = new Set([...placesOf(readable), ...project.flatMap((row) => row.facilityId ? [row.facilityId] : [])]);
  return { ...customerReference(customer), facilities: placesForChoice(await rows(), { all: false, chosen, positions: false }) };
}

export type JobCustomerCardData = {
  limited: true;
  customer: Record<string, unknown>;
  places: { id: string; name: string; address: string; postalCode: string; city: string }[];
  jobs: { id: string; kind: string; title: string; status: string }[];
};

/** The limited card, or a refusal that says the same whether the customer exists or not. */
export async function jobCustomerCard(ctx: Pick<Context, "organizationId" | "user">, customerId: string): Promise<JobCustomerCardData> {
  const refused = new ApiError(403, NO_JOB_AT_CUSTOMER);
  const jobs = await prisma.workflowTask.findMany({
    where: { AND: [ownJobsWhere(ctx.organizationId, ctx.user.id), jobAtCustomerWhere(customerId)] }, orderBy: { updatedAt: "desc" }, take: 20,
    select: { id: true, kind: true, title: true, status: true, facilityId: true, project: { select: { facilityId: true } } },
  });
  if (!jobs.length) throw refused;
  const customer = await prisma.customer.findFirst({ where: { id: customerId, organizationId: ctx.organizationId } });
  if (!customer) throw refused;
  const placeIds = new Set(jobs.flatMap((job) => [job.facilityId, job.project?.facilityId]).filter((id): id is string => Boolean(id)));
  const rows = placeIds.size ? await prisma.customerFacility.findMany({
    where: { organizationId: ctx.organizationId, customerId }, orderBy: { name: "asc" },
    select: { id: true, parentId: true, name: true, address: true, postalCode: true, city: true },
  }) : [];
  return {
    limited: true,
    customer: pickerCustomer(customer as unknown as Record<string, unknown>),
    // The address the place shows: its own, or the one it inherits from the place above.
    places: rows.filter((row) => placeIds.has(row.id)).map((row) => ({ id: row.id, name: row.name, ...placeAddress(rows, row.id) })),
    jobs: jobs.map((job) => ({ id: job.id, kind: job.kind, title: job.title, status: job.status })),
  };
}
