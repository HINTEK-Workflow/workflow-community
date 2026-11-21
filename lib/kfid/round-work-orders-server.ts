import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { loadPlaceSummaries } from "@/lib/kfid/facility-server";
import { ApiError } from "@/lib/kfid/errors";
import type { RoundOrderRef } from "@/lib/workflow/form-schedule";
import { roundHolderChangeError, roundOrderRef, roundPeriodError, roundPeriodOverlapError, roundProtocolOrder } from "@/lib/workflow/round-work-orders";
import { customerTitle } from "@/lib/kfid/customer-name";

/**
 * Driftrond i arbetsordern in Cloud (2026-10-27, punkt 3; the rules: lib/workflow/round-work-orders.ts). A person
 * makes the work order that holds a round for a period; starting the round registers the occurrence (the protocol) in
 * it. Nothing is made by itself any more – 0.24.0's daily job and the round page no longer make a work order per
 * occurrence; the ones they made are still read. Everything is read within the company.
 */
type Db = Prisma.TransactionClient | typeof prisma;
const orderSelect = { id: true, status: true, title: true, roundScheduleId: true, roundOccurrence: true, plannedStartDate: true, dueDate: true, customerId: true, facilityId: true, projectId: true } as const;
type OrderRow = { id: string; status: string; title: string; roundScheduleId: string | null; roundOccurrence: string | null; plannedStartDate: string; dueDate: string; customerId: string | null; facilityId: string | null; projectId: string | null };
const refs = (rows: OrderRow[], tempPlaces: Map<string, unknown> = new Map()) =>
  rows.flatMap((row) => { const ref = roundOrderRef({ ...row, tempPlace: tempPlaces.get(row.id) ?? null }); return ref ? [ref] : []; });

/**
 * Where the round is done, from its work orders (2026-10-27 kväll): their temporary places (read from the data, only
 * that key) and the names of their customers, places (with the whole way and the position) and projects, for the lists.
 */
async function withPlaces(organizationId: string, rows: OrderRow[], db: Db): Promise<RoundOrderRef[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const customerIds = [...new Set(rows.flatMap((row) => row.customerId ? [row.customerId] : []))];
  const projectIds = [...new Set(rows.flatMap((row) => row.projectId ? [row.projectId] : []))];
  const [temps, customers, projects, places] = await Promise.all([
    db.$queryRaw<{ id: string; tempPlace: unknown }[]>`select t.id, t.data -> 'tempPlace' as "tempPlace" from "WorkflowTask" t where t."organizationId" = ${organizationId} and t.id in (${Prisma.join(ids)}) and t.data -> 'tempPlace' is not null`,
    customerIds.length ? db.customer.findMany({ where: { id: { in: customerIds }, organizationId }, select: { id: true, name: true, company: true, customerType: true } }) : [],
    projectIds.length ? db.project.findMany({ where: { id: { in: projectIds }, organizationId }, select: { id: true, name: true } }) : [],
    loadPlaceSummaries(organizationId, rows.map((row) => row.facilityId)),
  ]);
  const tempPlaces = new Map(temps.map((row) => [row.id, row.tempPlace]));
  return refs(rows, tempPlaces).map((ref) => {
    const customer = customers.find((item) => item.id === ref.customerId);
    const place = ref.facilityId ? places.get(ref.facilityId) : undefined;
    return { ...ref, customerName: customer ? customerTitle(customer) : "", facilityName: place?.name ?? "", facilityPosition: place?.position ?? null,
      projectName: projects.find((item) => item.id === ref.projectId)?.name ?? "" };
  });
}

/**
 * The work orders of some rounds that touch the window from `since`: those holding a period that ends on or after it, and
 * 0.24.0's for an occurrence on or after it. For the round views, the planning and the bell.
 */
export async function loadRoundWorkOrders(organizationId: string, scheduleIds: string[], since: string, db: Db = prisma, options: { until?: string; places?: boolean } = {}): Promise<RoundOrderRef[]> {
  if (!scheduleIds.length) return [];
  const rows = await db.workflowTask.findMany({
    where: { organizationId, kind: "WORK_ORDER", roundScheduleId: { in: scheduleIds }, OR: [{ roundOccurrence: null, dueDate: { gte: since }, ...(options.until ? { plannedStartDate: { lte: options.until } } : {}) }, { roundOccurrence: { gte: since, ...(options.until ? { lte: options.until } : {}) } }] },
    select: orderSelect, take: 5000,
  });
  // The lists show where each occurrence is done (2026-10-27 kväll): the work orders' places, unless only the ids are wanted.
  return options.places === false ? refs(rows) : withPlaces(organizationId, rows, db);
}

/**
 * The work order a protocol started from a round goes into: the one it came with when that holds the round for the day,
 * else the round's work order for the day. A round of another company, or a day without a work order, is refused.
 */
export async function roundProtocolWorkOrder(organizationId: string, round: { scheduleId: string; occurrence: string }, chosen: string | null, db: Db = prisma) {
  const schedule = await db.formSchedule.findFirst({ where: { id: round.scheduleId, organizationId }, select: { id: true } });
  if (!schedule) throw new ApiError(404, "Ronden hittades inte.");
  const rows = await db.workflowTask.findMany({
    where: { organizationId, kind: "WORK_ORDER", roundScheduleId: round.scheduleId, OR: [{ roundOccurrence: round.occurrence }, { roundOccurrence: null, plannedStartDate: { lte: round.occurrence }, dueDate: { gte: round.occurrence } }, ...(chosen ? [{ id: chosen }] : [])] },
    select: orderSelect, take: 20,
  });
  const result = roundProtocolOrder(round, chosen, refs(rows));
  if (result.error !== undefined) throw new ApiError(409, result.error);
  return result.id;
}

/**
 * The save of a work order that holds a round (or did): the round is the company's, the period is valid, it does not
 * overlap another work order of the round, and once occurrences are registered the round stays and the period still
 * holds them. Throws the refusal; the database's CHECK and trigger refuse the same even if this were bypassed.
 */
export async function assertRoundHolder(organizationId: string, input: { id?: string | null; roundScheduleId: string | null; plannedStartDate: string; dueDate: string; status: string }, previous: { roundScheduleId: string | null; roundOccurrence: string | null } | null, db: Db = prisma) {
  // 0.24.0's work order for one occurrence keeps its round and day as they are.
  if (previous?.roundOccurrence) {
    if (input.roundScheduleId !== previous.roundScheduleId) throw new ApiError(409, "Rondens arbetsorder för ett tillfälle kan inte byta rond.");
    return;
  }
  const occurrences = input.id ? await registeredOccurrences(organizationId, input.id, db) : [];
  const change = roundHolderChangeError({ scheduleId: previous?.roundScheduleId ?? null }, { scheduleId: input.roundScheduleId, from: input.plannedStartDate, to: input.dueDate }, occurrences);
  if (change) throw new ApiError(409, change);
  if (!input.roundScheduleId) return;
  if (input.roundScheduleId !== previous?.roundScheduleId) {
    const schedule = await db.formSchedule.findFirst({ where: { id: input.roundScheduleId, organizationId, deletedAt: null }, select: { id: true } });
    if (!schedule) throw new ApiError(400, "Ronden hittades inte.");
  }
  const period = { from: input.plannedStartDate, to: input.dueDate };
  const periodError = roundPeriodError(period);
  if (periodError) throw new ApiError(400, periodError);
  if (input.status === "CANCELLED") return;
  const others = await db.workflowTask.findMany({ where: { organizationId, kind: "WORK_ORDER", roundScheduleId: input.roundScheduleId, roundOccurrence: null, ...(input.id ? { id: { not: input.id } } : {}) }, select: orderSelect, take: 500 });
  const overlap = roundPeriodOverlapError(period, refs(others));
  if (overlap) throw new ApiError(409, overlap);
}

/** The days of the occurrences registered in a work order (its protocols' `values.round`). */
export async function registeredOccurrences(organizationId: string, workOrderId: string, db: Db = prisma) {
  const rows = await db.$queryRaw<{ occurrence: string | null }[]>`
    select t.data #>> '{details,values,round,occurrence}' as occurrence from "WorkflowTask" t
    where t."organizationId" = ${organizationId} and t."workOrderId" = ${workOrderId} and t.kind = 'FORM'
      and t.data #>> '{details,values,round,occurrence}' is not null
    limit 5000`;
  return rows.flatMap((row) => row.occurrence && /^\d{4}-\d{2}-\d{2}$/.test(row.occurrence) ? [row.occurrence] : []);
}
