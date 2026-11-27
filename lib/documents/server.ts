import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { ApiError, requireCloudStorage, requireCloudWriteAccess, requireModule, type Context } from "@/lib/kfid/server";
import { read, remove, store } from "@/lib/kfid/storage";
import { prepareAttachmentFile } from "@/lib/workflow/attachment-file";
import { hasWorkflowPermission } from "@/lib/workflow/permissions";
import { customerTitle } from "@/lib/kfid/customer-name";
import { clamScan } from "./clamav";
import { scanSettingOf, scanUpdate, SCAN_MAX_ATTEMPTS, type ScanSetting } from "./scan-config";
import {
  DOCUMENT_INFECTED, DOCUMENT_MISSING, DOCUMENT_NOT_READY, DOCUMENT_UPLOAD_REFUSAL, documentDownloadable, documentView, renamedDocumentName, storedDocumentName,
  type DocumentListQuery, type DocumentView,
} from "./model";

/**
 * Dokument (0.87.0): a customer's and its places' files. Every call: the session, the company and the membership (context()), the
 * company's data on Workflow's server (requireCloudStorage), the customers right (read lists and downloads, edit uploads, renames
 * and the papperskorg), the module Kunder and Cloud's write right on every change, and the Origin in the route. The bytes are kept
 * as every other attachment (lib/kfid/storage.ts) and given out only once the virus scan says clean (lib/documents/scan-config.ts).
 * The company's own record (Eget företag) has no documents here: its places are changed under other rights.
 */
export const scanSetting = (): ScanSetting => scanSettingOf(env);

export function documentsAccess(ctx: Pick<Context, "admin" | "workflowPermissions">) {
  return {
    read: ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "customers", "read"),
    edit: ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "customers", "edit"),
  };
}
function requireRead(ctx: Context) {
  requireCloudStorage(ctx);
  if (!documentsAccess(ctx).read) throw new ApiError(403, "Du saknar behörighet att se kundens dokument.");
}
async function requireEdit(ctx: Context) {
  requireCloudStorage(ctx);
  await requireCloudWriteAccess(ctx);
  requireModule(ctx, "customers");
  if (!documentsAccess(ctx).edit) throw new ApiError(403, DOCUMENT_UPLOAD_REFUSAL);
}

const include = {
  customer: { select: { name: true, company: true, customerType: true } },
  place: { select: { name: true } },
} as const;
type Loaded = Prisma.CustomerDocumentGetPayload<{ include: typeof include }>;

async function uploaderNames(organizationId: string, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const members = await prisma.organizationMember.findMany({ where: { organizationId, userId: { in: [...new Set(ids)] } }, select: { userId: true, user: { select: { name: true, email: true } } } });
  return new Map(members.map((member) => [member.userId, member.user.name || member.user.email]));
}
const viewOf = (row: Loaded, names: Map<string, string>): DocumentView =>
  documentView(row, { customer: customerTitle(row.customer), place: row.place?.name ?? null, uploadedBy: names.get(row.uploadedById) ?? "Tidigare medlem" });

/** The customer a document is filed on: the company's own, not removed (unless only read), never the company's own record. */
async function customerFor(ctx: Context, customerId: string, options: { writing: boolean }) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, organizationId: ctx.organizationId, ...(options.writing ? { deletedAt: null } : {}) }, select: { id: true, ownCompany: true } });
  if (!customer || customer.ownCompany) throw new ApiError(404, "Kunden hittades inte.");
  return customer;
}
async function placeFor(ctx: Context, customerId: string, placeId: string | null | undefined) {
  if (!placeId) return null;
  const place = await prisma.customerFacility.findFirst({ where: { id: placeId, organizationId: ctx.organizationId, customerId }, select: { id: true } });
  if (!place) throw new ApiError(404, "Platsen hittades inte hos kunden.");
  return place.id;
}

export async function listDocuments(ctx: Context, query: DocumentListQuery) {
  requireRead(ctx);
  const access = documentsAccess(ctx);
  if (query.customerId) await customerFor(ctx, query.customerId, { writing: false });
  const trash = query.filter === "trash";
  if (trash && !access.edit) throw new ApiError(403, "Du saknar behörighet att se papperskorgen.");
  const term = query.q?.trim();
  const base: Prisma.CustomerDocumentWhereInput = {
    organizationId: ctx.organizationId,
    ...(query.customerId ? { customerId: query.customerId } : { customer: { deletedAt: null, ownCompany: false } }),
    ...(query.placeId ? { placeId: query.placeId } : {}),
  };
  const search: Prisma.CustomerDocumentWhereInput = term ? { OR: [
    { name: { contains: term, mode: "insensitive" } },
    { customer: { name: { contains: term, mode: "insensitive" } } },
    { customer: { company: { contains: term, mode: "insensitive" } } },
    { place: { name: { contains: term, mode: "insensitive" } } },
  ] } : {};
  const where: Prisma.CustomerDocumentWhereInput = { AND: [base, search, trash ? { deletedAt: { not: null } } : { deletedAt: null }, query.filter === "pending" ? { scanStatus: "pending" } : {}] };
  const orderBy: Prisma.CustomerDocumentOrderByWithRelationInput[] = query.sort === "oldest" ? [{ createdAt: "asc" }, { id: "asc" }]
    : query.sort === "name" ? [{ name: "asc" }, { id: "asc" }]
    : query.sort === "customer" ? [{ customer: { name: "asc" } }, { createdAt: "desc" }, { id: "asc" }]
    : [{ createdAt: "desc" }, { id: "asc" }];
  const [rows, total, all, pending, trashed] = await Promise.all([
    prisma.customerDocument.findMany({ where, include, orderBy, skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.customerDocument.count({ where }),
    prisma.customerDocument.count({ where: { AND: [base, search, { deletedAt: null }] } }),
    prisma.customerDocument.count({ where: { AND: [base, search, { deletedAt: null, scanStatus: "pending" }] } }),
    access.edit ? prisma.customerDocument.count({ where: { AND: [base, search, { deletedAt: { not: null } }] } }) : Promise.resolve(0),
  ]);
  const names = await uploaderNames(ctx.organizationId, rows.map((row) => row.uploadedById));
  // Waiting documents are tried again in the background when a list is read (no scheduled job: lib/documents/scan.ts's rule).
  if (pending || scanSetting().mode === "clamav") void retryWaitingScans(ctx.organizationId).catch(() => undefined);
  return {
    items: rows.map((row) => viewOf(row, names)),
    total, page: query.page, pages: Math.max(1, Math.ceil(total / query.limit)),
    counts: { all, pending, trash: trashed },
    canEdit: access.edit,
    /** Ta bort för gott från papperskorgen: the company's admin only. */
    canPurge: access.edit && ctx.admin,
    scan: scanSetting().mode,
  };
}

/** The customers and places that have documents, for Mer › Dokument's filter (at most 200 of each). */
export async function documentFacets(ctx: Context, customerId?: string | null) {
  requireRead(ctx);
  const customers = await prisma.customer.findMany({
    where: { organizationId: ctx.organizationId, deletedAt: null, ownCompany: false, documents: { some: { deletedAt: null } } },
    select: { id: true, name: true, company: true, customerType: true }, orderBy: { name: "asc" }, take: 200,
  });
  const places = customerId ? await prisma.customerFacility.findMany({
    where: { organizationId: ctx.organizationId, customerId, documents: { some: { deletedAt: null } } }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 200,
  }) : [];
  return { customers: customers.map((customer) => ({ id: customer.id, name: customerTitle(customer) })), places };
}

export async function uploadDocument(ctx: Context, input: { customerId: string; placeId?: string | null; file: File }) {
  await requireEdit(ctx);
  const customer = await customerFor(ctx, input.customerId, { writing: true });
  const placeId = await placeFor(ctx, customer.id, input.placeId);
  // The same file types and checks as every other attachment: a picture is turned upright and kept as JPEG.
  const { buffer, mimeType, extension } = await prepareAttachmentFile(input.file);
  const storagePath = await store(buffer, extension);
  const setting = scanSetting();
  let created: Loaded;
  try {
    created = await prisma.customerDocument.create({
      data: { organizationId: ctx.organizationId, customerId: customer.id, placeId, name: storedDocumentName(input.file.name, extension), storagePath, mimeType, size: buffer.length, scanStatus: setting.mode === "off" ? "unscanned" : "pending", uploadedById: ctx.user.id },
      include,
    });
  } catch (error) { await remove(storagePath); throw error; }
  // Scanned before the answer, so a clean file can be downloaded at once; a scanner that is down leaves it waiting.
  const scanned = setting.mode === "clamav" ? await scanDocument(created.id, setting, buffer) : null;
  const row = scanned ?? created;
  return viewOf(row, await uploaderNames(ctx.organizationId, [row.uploadedById]));
}

/** The file itself, only clean (or unscanned on an installation without a scanner), never from the papperskorg. */
export async function documentFile(ctx: Context, id: string) {
  requireRead(ctx);
  const row = await prisma.customerDocument.findFirst({ where: { id, organizationId: ctx.organizationId, deletedAt: null, customer: { ownCompany: false } } });
  if (!row) throw new ApiError(404, DOCUMENT_MISSING);
  if (row.scanStatus === "infected") throw new ApiError(410, DOCUMENT_INFECTED);
  if (!documentDownloadable(row.scanStatus, Boolean(row.storagePath))) throw new ApiError(409, DOCUMENT_NOT_READY);
  return { name: row.name, mimeType: row.mimeType, bytes: new Uint8Array(await read(row.storagePath!)) };
}

async function findForChange(ctx: Context, id: string, where: Prisma.CustomerDocumentWhereInput = {}) {
  const row = await prisma.customerDocument.findFirst({ where: { id, organizationId: ctx.organizationId, customer: { ownCompany: false }, ...where }, include });
  if (!row) throw new ApiError(404, DOCUMENT_MISSING);
  return row;
}

export async function changeDocument(ctx: Context, id: string, input: { action: "rename"; name: string } | { action: "restore" } | { action: "move"; placeId: string | null }) {
  await requireEdit(ctx);
  if (input.action === "restore") {
    const row = await findForChange(ctx, id, { deletedAt: { not: null } });
    await customerFor(ctx, row.customerId, { writing: true });
    const updated = await prisma.customerDocument.update({ where: { id: row.id }, data: { deletedAt: null, deletedById: null }, include });
    return viewOf(updated, await uploaderNames(ctx.organizationId, [updated.uploadedById]));
  }
  const row = await findForChange(ctx, id, { deletedAt: null });
  await customerFor(ctx, row.customerId, { writing: true });
  if (input.action === "move") {
    const placeId = await placeFor(ctx, row.customerId, input.placeId);
    const updated = await prisma.customerDocument.update({ where: { id: row.id }, data: { placeId }, include });
    return viewOf(updated, await uploaderNames(ctx.organizationId, [updated.uploadedById]));
  }
  const name = renamedDocumentName(input.name, row.name);
  if (!name) throw new ApiError(400, "Skriv ett namn på dokumentet.");
  const updated = await prisma.customerDocument.update({ where: { id: row.id }, data: { name }, include });
  return viewOf(updated, await uploaderNames(ctx.organizationId, [updated.uploadedById]));
}

/**
 * Ta bort moves the document to the papperskorg, where it can be restored. Töm (`permanent`) removes it for good with its bytes; only
 * a company admin, and only from the papperskorg.
 */
export async function removeDocument(ctx: Context, id: string, permanent: boolean) {
  await requireEdit(ctx);
  if (!permanent) {
    const row = await findForChange(ctx, id, { deletedAt: null });
    await prisma.customerDocument.update({ where: { id: row.id }, data: { deletedAt: new Date(), deletedById: ctx.user.id } });
    return { ok: true, trashed: true };
  }
  if (!ctx.admin) throw new ApiError(403, "Bara en företagsadministratör kan ta bort ett dokument för gott.");
  const row = await findForChange(ctx, id, { deletedAt: { not: null } });
  await prisma.customerDocument.delete({ where: { id: row.id } });
  if (row.storagePath) await remove(row.storagePath);
  return { ok: true, removed: true };
}

/** The stored files of documents of customers about to be removed for good (the papperskorg's Töm), to be removed after the commit. */
export async function documentFilesOfCustomers(tx: Pick<Prisma.TransactionClient, "customerDocument">, organizationId: string, customerIds: readonly string[]) {
  if (!customerIds.length) return [];
  const rows = await tx.customerDocument.findMany({ where: { organizationId, customerId: { in: [...customerIds] }, storagePath: { not: null } }, select: { storagePath: true } });
  return rows.map((row) => row.storagePath!);
}
export async function removeStoredFiles(paths: readonly string[]) {
  for (const path of paths) await remove(path);
}

// ---------- the scan ----------

/**
 * Scans one document and records the verdict. An infected file's bytes are removed at once and its row keeps what was found, so
 * the file can never be given out; an answer that could not be had leaves the document as it was, to be tried again.
 */
export async function scanDocument(id: string, setting: ScanSetting = scanSetting(), bytes?: Uint8Array) {
  if (setting.mode !== "clamav") return null;
  const row = await prisma.customerDocument.findUnique({ where: { id } });
  if (!row?.storagePath || (row.scanStatus !== "pending" && row.scanStatus !== "unscanned")) return null;
  const current = row.scanStatus as "pending" | "unscanned";
  const content = bytes ?? new Uint8Array(await read(row.storagePath).catch(() => Buffer.alloc(0)));
  const verdict = await clamScan(setting.clam, content);
  const change = scanUpdate(verdict, current, new Date());
  // Only while the row is still the one read: a document removed for good meanwhile is not brought back.
  const updated = await prisma.customerDocument.updateMany({ where: { id, storagePath: row.storagePath, scanStatus: current }, data: { ...change.data, scanAttempts: { increment: 1 } } });
  if (change.removeFile && updated.count) {
    await remove(row.storagePath);
    // Fixed words and ids only: never the file's name or the company's data in the log.
    console.warn("Document scan found malware", JSON.stringify({ documentId: id, organizationId: row.organizationId, signature: verdict.result === "infected" ? verdict.signature : "" }));
  }
  return prisma.customerDocument.findUnique({ where: { id }, include });
}

const lastRetry = new Map<string, number>();
const RETRY_EVERY_MS = 60_000;
/**
 * Waiting documents of the company (and, once a scanner is set up, the unscanned ones) are scanned again, a few at a time, at most
 * once a minute per company and server process – from the list's read, so no scheduled job is needed. A document tried
 * SCAN_MAX_ATTEMPTS times is left waiting (never served) for a person to look at.
 */
export async function retryWaitingScans(organizationId: string, now = Date.now()) {
  const setting = scanSetting();
  if (setting.mode !== "clamav") return 0;
  if ((lastRetry.get(organizationId) ?? 0) > now - RETRY_EVERY_MS) return 0;
  lastRetry.set(organizationId, now);
  const due = await prisma.customerDocument.findMany({
    where: { organizationId, deletedAt: null, storagePath: { not: null }, scanStatus: { in: ["pending", "unscanned"] }, scanAttempts: { lt: SCAN_MAX_ATTEMPTS }, updatedAt: { lt: new Date(now - 30_000) } },
    select: { id: true }, orderBy: { updatedAt: "asc" }, take: 5,
  });
  for (const { id } of due) await scanDocument(id, setting);
  return due.length;
}
