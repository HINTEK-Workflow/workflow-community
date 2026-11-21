import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, requireAdmin, requireCloudStorage, requireCloudWriteAccess, type Context } from "@/lib/kfid/server";
import { canSeePrices } from "@/lib/workflow/material-prices";
import { movedTimeTypeOrder, orderedTimeTypes, STARTING_TIME_TYPES, TIME_TYPE_BILLING_LABELS, timeBillingLookup, timeCountsAsWork, timeTypeChoiceProblem, timeTypeInputSchema, timeTypePoliciesOf, timeTypeRemoveProblem, timeTypeSaveProblem, timeTypesWithPolicy, unbilledTimeTypes, type TimeTypePolicies, type TimeTypeView } from "@/lib/workflow/time-types";

/**
 * Tidstyper on the server (2026-10-29): the company's list, created with the neutral starting list the first time it is
 * read, and the administrator's changes. Every function is bound to the caller's company; the routes check the session,
 * membership and Origin first. Only admins change the list; everyone in the company reads it (to choose a type for their time).
 */
const SELECT = { id: true, name: true, payrollCode: true, active: true, isDefault: true, sortOrder: true } as const;

/** The company's types in order; a company without any gets the starting list (safe to call at the same time twice). */
export async function loadTimeTypes(organizationId: string): Promise<TimeTypeView[]> {
  const found = await prisma.timeType.findMany({ where: { organizationId }, select: SELECT });
  if (found.length) return orderedTimeTypes(found);
  await prisma.timeType.createMany({ data: STARTING_TIME_TYPES.map((type, sortOrder) => ({ organizationId, name: type.name, isDefault: type.isDefault, sortOrder })), skipDuplicates: true })
    .catch(() => undefined); // another request made the list at the same moment (the unique indexes stop a second one)
  return orderedTimeTypes(await prisma.timeType.findMany({ where: { organizationId }, select: SELECT }));
}

/** What the company has decided per type (beslut 8), from its JSON settings; read for one company only. */
export async function loadTimeTypePolicies(organizationId: string): Promise<TimeTypePolicies> {
  const row = await prisma.workspaceSettings.findUnique({ where: { organizationId }, select: { priceSettings: true } });
  return timeTypePoliciesOf(row?.priceSettings);
}

/** The list for a page in the company: the billing and the working time for everyone, the price only with the right to see prices. */
export async function timeTypesForMember(ctx: Pick<Context, "organizationId" | "admin" | "workflowPermissions">) {
  const [types, policies] = await Promise.all([loadTimeTypes(ctx.organizationId), loadTimeTypePolicies(ctx.organizationId)]);
  return timeTypesWithPolicy(types, policies, canSeePrices({ admin: ctx.admin, permissions: ctx.workflowPermissions }));
}

/** What the invoice basis, the overview and the pay basis need to know about the company's types. */
export async function timeTypeRules(organizationId: string) {
  const [types, policies] = await Promise.all([loadTimeTypes(organizationId), loadTimeTypePolicies(organizationId)]);
  return { billing: timeBillingLookup(types, policies), countsAsWork: (id: string | null | undefined) => timeCountsAsWork(types, policies, id), neverBilled: unbilledTimeTypes(types, policies) };
}

/** Changes one type's stored policy (null removes it), leaving the company's other price settings as they are. */
async function storePolicy(organizationId: string, typeId: string, policy: TimeTypePolicies[string] | null) {
  await prisma.$transaction(async (tx) => {
    const row = await tx.workspaceSettings.findUnique({ where: { organizationId }, select: { priceSettings: true } });
    const stored = row?.priceSettings && typeof row.priceSettings === "object" && !Array.isArray(row.priceSettings) ? row.priceSettings as Record<string, unknown> : {};
    const others = Object.fromEntries(Object.entries(timeTypePoliciesOf(stored)).filter(([id]) => id !== typeId));
    const priceSettings = { ...stored, timeTypePolicies: policy ? { ...others, [typeId]: policy } : others } as Prisma.InputJsonObject;
    await tx.workspaceSettings.upsert({ where: { organizationId }, create: { organizationId, priceSettings }, update: { priceSettings } });
  });
}

/** The type a person picked for an entry, checked against the company's list (a type of another company is "not found"). */
export async function checkedTimeTypeId(organizationId: string, chosen: string | null | undefined, current?: string | null): Promise<string | null | undefined> {
  if (chosen === undefined) return undefined;
  if (!chosen) return null;
  const types = await loadTimeTypes(organizationId);
  const problem = timeTypeChoiceProblem(types, chosen, current);
  if (problem) throw new ApiError(422, problem);
  return chosen;
}

const adminWrite = async (ctx: Context) => { requireCloudStorage(ctx); requireAdmin(ctx); await requireCloudWriteAccess(ctx); };
const log = (ctx: Context, detail: string) => prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "time_types", detail: detail.slice(0, 300) } });

export async function saveTimeType(ctx: Context, raw: unknown) {
  await adminWrite(ctx);
  const input = timeTypeInputSchema.parse(raw);
  const types = await loadTimeTypes(ctx.organizationId);
  const problem = timeTypeSaveProblem(types, input);
  if (problem) throw new ApiError(422, problem);
  const data = { name: input.name, payrollCode: input.payrollCode, active: input.active };
  let savedId = input.id;
  if (input.id) await prisma.timeType.update({ where: { id: input.id, organizationId: ctx.organizationId }, data });
  else savedId = (await prisma.timeType.create({ data: { ...data, organizationId: ctx.organizationId, sortOrder: types.length ? Math.max(...types.map((type) => type.sortOrder)) + 1 : 0 } })).id;
  if (input.policy && savedId) await storePolicy(ctx.organizationId, savedId, input.policy);
  await log(ctx, `Tidstyp ${input.id ? "ändrad" : "ny"}: ${input.name}${input.payrollCode ? ` (kod ${input.payrollCode})` : ""}${input.active ? "" : ", avstängd"}.${input.policy ? ` Fakturering: ${TIME_TYPE_BILLING_LABELS[input.policy.billing]}. Arbetstid: ${input.policy.workingTime ? "ja" : "nej"}.` : ""}`);
}

export async function moveTimeType(ctx: Context, id: string, step: -1 | 1) {
  await adminWrite(ctx);
  const types = await loadTimeTypes(ctx.organizationId);
  if (!types.some((type) => type.id === id)) throw new ApiError(404, "Tidstypen finns inte.");
  const order = movedTimeTypeOrder(types, id, step);
  await prisma.$transaction(order.map((item) => prisma.timeType.update({ where: { id: item.id, organizationId: ctx.organizationId }, data: { sortOrder: item.sortOrder } })));
}

export async function removeTimeType(ctx: Context, id: string) {
  await adminWrite(ctx);
  const types = await loadTimeTypes(ctx.organizationId);
  const type = types.find((item) => item.id === id);
  const usedBy = type ? await prisma.workflowTimeEntry.count({ where: { timeTypeId: id } }) : 0;
  const problem = timeTypeRemoveProblem(type, usedBy);
  if (problem) throw new ApiError(type ? 409 : 404, problem);
  await prisma.timeType.delete({ where: { id, organizationId: ctx.organizationId } });
  await storePolicy(ctx.organizationId, id, null);
  await log(ctx, `Tidstyp borttagen: ${type!.name}.`);
}
