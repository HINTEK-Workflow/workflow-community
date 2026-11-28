import { prisma } from "@/lib/db";
import { ApiError, requireWorkflowPermission, type Context } from "@/lib/kfid/server";
import { read, remove, store } from "@/lib/kfid/storage";
import { createItemAs, type Db } from "@/lib/maintenance/server";
import { itemInputSchema, PART_LIMIT, subtreeIds } from "@/lib/maintenance/model";
import { formDocumentSchema, formValuesSchema } from "@/lib/workflow/form-document";
import type { MaintenanceFacts } from "@/lib/workflow/maintenance";
import { organizationModuleOn } from "@/lib/workflow/modules";
import { hasWorkflowPermission, readableTaskScope, workflowSubjectForTask, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import {
  followUpRow, ROUND_FOLLOW_UP_CHANNEL, roundFindings, roundFollowUpCounts, roundFollowUpNoticeKey, roundFollowUpRecipients, sortFollowUpRows,
  type RoundFindingEntry, type RoundFollowUpInput, type RoundFollowUpKind, type RoundFollowUpRow,
} from "@/lib/workflow/round-follow-up";
import { roundOfProtocolValues } from "@/lib/workflow/round-work-orders";
import { readableTaskWhere } from "@/lib/workflow/task-access";
import { readWorkProfile } from "@/lib/workflow/work-profile";

/**
 * Driftronden som tillsyn on the server (2026-11-27; the rules: lib/workflow/round-follow-up.ts). A work order from a
 * round's brist is made by the ordinary save (app/api/workflow-tasks, which checks the session, the company, Origin, Cloud
 * write access, the test account's limits and the right to create work orders); this file checks what is the round's: the
 * protocol is the company's, a round protocol the person may read, and its brist has no work order yet; the machine part and
 * the photos are the company's and the protocol's. Then, in the save's transaction, it gives the order its maintenance item
 * (priority Akut, or the brist's) and tells arbetsledare and admin. Every query is bound to the caller's company.
 */

export type PreparedFollowUp = {
  kind: RoundFollowUpKind; roundOrderId: string; partId: string | null;
  images: { id: string; filename: string; storagePath: string; mimeType: string; size: number }[];
  recipients: string[];
};

const can = (ctx: Context) => (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
const upkeepOn = (ctx: Context) => ctx.organization.storageMode === "HINTEK_CLOUD" && organizationModuleOn(ctx.organization, "upkeep");

/** The round protocol a brist comes from: the company's, readable for the person, and held by the round's work order. */
async function roundProtocol(ctx: Context, protocolId: string) {
  const protocol = await prisma.workflowTask.findFirst({
    where: { id: protocolId, organizationId: ctx.organizationId, kind: "FORM" },
    select: { id: true, title: true, formArea: true, workOrderId: true, machinePartId: true, data: true },
  });
  if (!protocol) throw new ApiError(404, "Protokollet hittades inte.");
  requireWorkflowPermission(ctx, workflowSubjectForTask("FORM", protocol.formArea), "read");
  if (!roundOfProtocolValues(protocol.data) || !protocol.workOrderId) throw new ApiError(409, "Akut och planerad arbetsorder görs från en brist i en driftrond.");
  const order = await prisma.workflowTask.findFirst({ where: { id: protocol.workOrderId, organizationId: ctx.organizationId, kind: "WORK_ORDER" }, select: { id: true, title: true, machinePartId: true } });
  if (!order) throw new ApiError(409, "Rondens arbetsorder hittades inte.");
  return { protocol, order };
}

/** The stored row's machine part, if the protocol is saved with it. */
function storedRowPart(data: unknown, rowId: string) {
  const values = formValuesSchema.safeParse((data as { details?: { values?: unknown } } | null)?.details?.values ?? {});
  if (!values.success) return null;
  for (const rows of Object.values(values.data.tables)) for (const row of rows) if (row.id === rowId) return row.partId ?? null;
  return null;
}

/** The machine the round point is on: the row's own, else the protocol's, else the round's work order's. */
const defaultPart = (protocol: { data: unknown; machinePartId: string | null }, order: { machinePartId: string | null }, rowId: string | null) =>
  (rowId ? storedRowPart(protocol.data, rowId) : null) ?? protocol.machinePartId ?? order.machinePartId ?? null;

async function companyPart(organizationId: string, partId: string) {
  const part = await prisma.machinePart.findFirst({ where: { id: partId, organizationId }, select: { id: true, name: true } });
  if (!part) throw new ApiError(404, "Maskinen hittades inte.");
  return part;
}

/** Arbetsledare and admin of the company (active), never the person who made the order. */
export async function followUpRecipients(organizationId: string, actorId: string) {
  const members = await prisma.organizationMember.findMany({
    where: { organizationId, isActive: true, user: { isActive: true } }, select: { userId: true, role: true, workflowPermissions: true }, take: 2000,
  });
  return roundFollowUpRecipients({ actorId, members: members.map((member) => ({ userId: member.userId, admin: member.role === "OWNER" || member.role === "ADMIN", profile: readWorkProfile(member.workflowPermissions)?.profile ?? null })) });
}

/**
 * Before the save makes the work order: the order must be new, from a row of a round protocol (its `source`), and that row has
 * no work order yet. Returns what the transaction needs.
 */
export async function prepareRoundFollowUp(ctx: Context, task: { id?: string; kind: string; data: unknown }, input: RoundFollowUpInput): Promise<PreparedFollowUp> {
  const source = (task.data as { kind?: string; details?: { source?: { taskId?: string; rowId?: string; kind?: string } } } | null);
  if (task.id || task.kind !== "WORK_ORDER" || source?.kind !== "WORK_ORDER") throw new ApiError(400, "Akut och planerad arbetsorder gäller bara en ny arbetsorder.");
  const from = source.details?.source;
  if (!from?.taskId || !from.rowId || from.kind !== "FORM") throw new ApiError(400, "Arbetsordern måste skapas från en brist i protokollet.");
  const { protocol, order } = await roundProtocol(ctx, from.taskId);
  const made = await prisma.$queryRaw<{ id: string }[]>`
    select t.id from "WorkflowTask" t
    where t."organizationId" = ${ctx.organizationId} and t.kind = 'WORK_ORDER'
      and t.data #>> '{details,source,taskId}' = ${protocol.id} and t.data #>> '{details,source,rowId}' = ${from.rowId}
    limit 1`;
  if (made.length) throw new ApiError(409, "Bristen har redan en arbetsorder. Öppna den från protokollet.");
  let partId: string | null = null;
  if (upkeepOn(ctx)) {
    const wanted = input.partId === undefined ? defaultPart(protocol, order, from.rowId) : input.partId;
    if (wanted) partId = (await companyPart(ctx.organizationId, wanted)).id;
  }
  const images = input.imageIds.length ? await prisma.workflowTaskAttachment.findMany({
    where: { organizationId: ctx.organizationId, taskId: protocol.id, id: { in: [...new Set(input.imageIds)] }, mimeType: { startsWith: "image/" } },
    select: { id: true, filename: true, storagePath: true, mimeType: true, size: true }, take: 20,
  }) : [];
  return { kind: input.kind, roundOrderId: order.id, partId, images, recipients: await followUpRecipients(ctx.organizationId, ctx.user.id) };
}

/**
 * In the save's transaction, right after the order is made: the order is on the machine and holds a maintenance item with the
 * brist (avhjälpande, Felanmäld now, priority Akut for an Akut order, else the brist's own or Normal), and arbetsledare and admin
 * get their notice. Without a machine there is no item; an Akut order is then Akut by its mark (lib/maintenance/work-order-sql.ts).
 */
export async function applyRoundFollowUp(tx: Db, input: { organizationId: string; userId: string; workOrderId: string; prepared: PreparedFollowUp; facts?: Partial<MaintenanceFacts> | null; now?: Date }) {
  const { prepared } = input;
  if (prepared.partId) {
    await tx.workflowTask.updateMany({ where: { id: input.workOrderId, organizationId: input.organizationId, machinePartId: null }, data: { machinePartId: prepared.partId } });
    // A planned order is never Akut: the brist's highest severity is Hög there.
    const priority = prepared.kind === "URGENT" ? "URGENT" : input.facts?.priority === "URGENT" ? "HIGH" : input.facts?.priority || "NORMAL";
    await createItemAs(tx, { organizationId: input.organizationId, userId: input.userId }, itemInputSchema.parse({
      ...input.facts, type: "CORRECTIVE", priority, reportedAt: input.facts?.reportedAt ?? (input.now ?? new Date()).toISOString(), partId: prepared.partId, workOrderId: input.workOrderId,
    }), "MANUAL");
  }
  await recordFollowUpNotices(tx, input.organizationId, input.workOrderId, prepared.recipients);
}

/** The notice of a new work order from the round, one per recipient (lib/workflow/round-follow-up.ts). */
export async function recordFollowUpNotices(tx: Db, organizationId: string, workOrderId: string, recipients: readonly string[]) {
  for (const userId of recipients)
    await tx.noticeDelivery.create({ data: { organizationId, userId, key: roundFollowUpNoticeKey(workOrderId), channel: ROUND_FOLLOW_UP_CHANNEL }, select: { id: true } });
}

/**
 * Any other new work order made from a round protocol (Skapa arbetsorder on a point, 2026-11-27: "a new work order from
 * the round notifies arbetsledare and admin"): it is listed under Från ronden as planned and tells them in the app. Null when the
 * order does not come from a round protocol of the company; never refuses anything (the ordinary save has checked the rest).
 */
export async function roundOriginOf(ctx: Context, task: { id?: string; kind: string; data: unknown }) {
  if (task.id || task.kind !== "WORK_ORDER") return null;
  const from = (task.data as { details?: { source?: { taskId?: string; kind?: string } } } | null)?.details?.source;
  if (!from?.taskId || from.kind !== "FORM") return null;
  const protocol = await prisma.workflowTask.findFirst({ where: { id: from.taskId, organizationId: ctx.organizationId, kind: "FORM" }, select: { workOrderId: true, data: true } });
  if (!protocol?.workOrderId || !roundOfProtocolValues(protocol.data)) return null;
  return { roundOrderId: protocol.workOrderId, recipients: await followUpRecipients(ctx.organizationId, ctx.user.id) };
}

/** After the save: the brist's photos follow into the work order as its own files (a copy, so each can be removed on its own). */
export async function copyFollowUpImages(organizationId: string, workOrderId: string, images: PreparedFollowUp["images"]) {
  let copied = 0;
  for (const image of images) {
    let storagePath: string | undefined;
    try {
      const extension = image.storagePath.split(".").pop() || "jpg";
      storagePath = await store(await read(image.storagePath), extension);
      await prisma.workflowTaskAttachment.create({ data: { organizationId, taskId: workOrderId, filename: image.filename, storagePath, mimeType: image.mimeType, size: image.size }, select: { id: true } });
      copied += 1;
    } catch {
      // A photo that cannot be copied is left out; the brist keeps it in the protocol.
      if (storagePath) await remove(storagePath);
    }
  }
  return copied;
}

// ---------- the dialog and the box ----------

/** The dialog's machine: the round point's, if any (its name), and whether machines can be chosen at all (Underhåll on). */
export async function followUpChoices(ctx: Context, protocolId: string, rowId: string | null) {
  requireWorkflowPermission(ctx, "work-order", "create");
  const { protocol, order } = await roundProtocol(ctx, protocolId);
  if (!upkeepOn(ctx)) return { machines: false, partId: null, partName: "" };
  const partId = defaultPart(protocol, order, rowId);
  const part = partId ? await prisma.machinePart.findFirst({ where: { id: partId, organizationId: ctx.organizationId }, select: { id: true, name: true } }) : null;
  return { machines: true, partId: part?.id ?? null, partName: part?.name ?? "" };
}

/**
 * Från ronden: the round's work order lists the work orders made from its brister (only those the person may read), marked
 * Akut or Planerad and Öppen or Klar, and how many brister were fixed on the spot in its protocols.
 */
export async function roundFollowUpsOf(ctx: Context, workOrderId: string): Promise<{ rows: RoundFollowUpRow[]; fixedOnSite: number; open: number; truncated: boolean }> {
  requireWorkflowPermission(ctx, "work-order", "read");
  const readable = readableTaskScope(can(ctx)).any ? readableTaskWhere(can(ctx)) : null;
  if (!readable) return { rows: [], fixedOnSite: 0, open: 0, truncated: false };
  const order = await prisma.workflowTask.findFirst({ where: { id: workOrderId, organizationId: ctx.organizationId, kind: "WORK_ORDER", AND: [readable] }, select: { id: true, roundScheduleId: true } });
  if (!order) throw new ApiError(404, "Arbetsordern hittades inte.");
  const [orders, protocols] = await Promise.all([
    prisma.workflowTask.findMany({
      where: { organizationId: ctx.organizationId, kind: "WORK_ORDER", data: { path: ["details", "roundFollowUp", "roundOrderId"], equals: order.id }, AND: [readable] },
      orderBy: { createdAt: "asc" }, take: 101, select: { id: true, title: true, status: true, data: true },
    }),
    order.roundScheduleId ? prisma.workflowTask.findMany({ where: { organizationId: ctx.organizationId, kind: "FORM", workOrderId: order.id, AND: [readable] }, take: 200, select: { data: true } }) : [],
  ]);
  let fixedOnSite = 0, open = 0;
  for (const protocol of protocols) {
    const counts = roundFollowUpCounts(protocolFindings(protocol.data));
    fixedOnSite += counts.fixedOnSite; open += counts.open;
  }
  return { rows: sortFollowUpRows(orders.slice(0, 100).flatMap((row) => { const shown = followUpRow(row); return shown ? [shown] : []; })), fixedOnSite, open, truncated: orders.length > 100 };
}

/** A stored protocol's brister (nothing for a protocol that cannot be read). */
export function protocolFindings(data: unknown) {
  const details = (data as { details?: { document?: unknown; values?: unknown } } | null)?.details;
  const document = formDocumentSchema.safeParse(details?.document);
  const values = formValuesSchema.safeParse(details?.values ?? {});
  return document.success && values.success ? roundFindings(document.data, values.data) : [];
}

// ---------- the machine's Historik ----------

/**
 * The brister of the round protocols on a machine and everything under it (the row's machine, or the protocol's), newest first,
 * for Historik: Åtgärdad direkt with its comment and photo, and those that became a work order. Only protocols the person may
 * read; bounded.
 */
export async function partFindings(caller: { organizationId: string; admin: boolean; permissions: Parameters<typeof hasWorkflowPermission>[0] }, partId: string): Promise<RoundFindingEntry[]> {
  const check = (subject: WorkflowPermissionSubject) => caller.admin || hasWorkflowPermission(caller.permissions, subject, "read");
  if (!readableTaskScope(check).any) return [];
  const all = await prisma.machinePart.findMany({ where: { organizationId: caller.organizationId }, select: { id: true, parentId: true, name: true }, take: PART_LIMIT });
  if (!all.some((part) => part.id === partId)) return [];
  const ids = subtreeIds(all, partId);
  const names = new Map(all.map((part) => [part.id, part.name]));
  const candidates = await prisma.$queryRaw<{ id: string }[]>`
    select t.id from "WorkflowTask" t
    where t."organizationId" = ${caller.organizationId} and t.kind = 'FORM' and t.data #>> '{details,values,round,scheduleId}' is not null
      and (t."machinePartId" = any(${ids}::text[]) or exists (
        select 1 from jsonb_each(coalesce(t.data #> '{details,values,tables}', '{}'::jsonb)) tb, jsonb_array_elements(case when jsonb_typeof(tb.value) = 'array' then tb.value else '[]'::jsonb end) r
        where r->>'partId' = any(${ids}::text[])))
    order by t."updatedAt" desc limit 60`;
  if (!candidates.length) return [];
  const protocols = await prisma.workflowTask.findMany({
    where: { organizationId: caller.organizationId, id: { in: candidates.map((row) => row.id) }, AND: [readableTaskWhere(check)] },
    select: { id: true, title: true, machinePartId: true, updatedAt: true, data: true },
  });
  const entries: RoundFindingEntry[] = [];
  for (const protocol of protocols) {
    const round = roundOfProtocolValues(protocol.data);
    for (const finding of protocolFindings(protocol.data)) {
      const part = finding.partId ?? protocol.machinePartId;
      if (!part || !ids.includes(part)) continue;
      entries.push({ ...finding, protocolId: protocol.id, protocolTitle: protocol.title, partName: names.get(part) ?? "", day: round?.occurrence ?? protocol.updatedAt.toISOString().slice(0, 10), at: protocol.updatedAt.toISOString() });
    }
  }
  return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60);
}
