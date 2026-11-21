import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import type { Context } from "@/lib/kfid/server";
import { boardsAccess } from "./access";
import { boardSourceOptions } from "./cards/options-server";
import { boardFeed, forgetBoardFeeds, layoutImageIds } from "./feed-server";
import { metricOption, metricsFor } from "./metrics";
import type { MetricCaller } from "./metrics-server";
import { BOARD_PRESETS, boardNameSchema, layoutSchema, presetLayout, readLayout, type BoardLayout, type BoardPreset } from "./model";
import { BOARD_TEMPLATE_KEYS, boardTemplate, type BoardTemplateKey } from "./templates";
import { cleanVisibility, layoutHasPersonalData, visibilitySchema, visibilitySummary, type Visibility } from "./privacy";
import { receiversOfBoard } from "./receivers-server";
import { MAX_ROWS, rowValues, tableColumnsSchema, type TableColumn } from "./table";

/**
 * Tavlor på servern (Tavlor och skärmar etapp 1, 2026-11-18): the company's boards, their drafts and published versions, and the
 * boards' own tables. Every function takes the caller from the request's context (session, company, membership, rights – checked
 * in lib/kfid/server.ts) and reads and writes only rows of the caller's company; the rights are checked here (lib/boards/access.ts).
 */
export type BoardsCaller = MetricCaller & { userName: string };

export function boardsCallerOf(ctx: Context): BoardsCaller {
  return {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    userName: ctx.user.name?.trim() || ctx.user.email,
    admin: ctx.admin,
    workflowPermissions: ctx.workflowPermissions,
    organization: { disabledModules: ctx.organization.disabledModules, weeklyWorkMinutes: ctx.organization.weeklyWorkMinutes },
  };
}

const access = (caller: BoardsCaller) => boardsAccess(caller);
export function requireBoardsRead(caller: BoardsCaller) { if (!access(caller).read) throw new ApiError(403, "Du saknar behörighet att se tavlor."); }
export function requireBoardsEdit(caller: BoardsCaller) { if (!access(caller).edit) throw new ApiError(403, "Du saknar behörighet att ändra tavlor."); }
export function requireBoardsPublish(caller: BoardsCaller) { if (!access(caller).publish) throw new ApiError(403, "Du saknar behörighet att publicera tavlor."); }

const audit = (caller: BoardsCaller, action: string, detail: string) =>
  prisma.administrationEvent.create({ data: { organizationId: caller.organizationId, actorId: caller.userId, action, detail: detail.slice(0, 500) } }).catch(() => undefined);

async function boardRow(caller: BoardsCaller, id: string) {
  const row = await prisma.board.findFirst({ where: { id, organizationId: caller.organizationId, deletedAt: null } });
  if (!row) throw new ApiError(404, "Tavlan finns inte.");
  return row;
}

async function publishedOf(caller: BoardsCaller, versionId: string | null) {
  if (!versionId) return null;
  const version = await prisma.boardVersion.findFirst({ where: { id: versionId, organizationId: caller.organizationId } });
  return version ? { id: version.id, number: version.number, publishedAt: version.publishedAt.toISOString(), layout: readLayout(version.layout), visibility: visibilitySchema.parse(version.visibility ?? {}) } : null;
}

const names = async (ids: readonly string[]) => {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((user) => [user.id, user.name?.trim() || user.email]));
};

// ---------- boards ----------

export async function listBoards(caller: BoardsCaller) {
  requireBoardsRead(caller);
  const rights = access(caller);
  const rows = await prisma.board.findMany({
    where: { organizationId: caller.organizationId, deletedAt: null, ...(rights.edit ? {} : { publishedVersionId: { not: null } }) },
    orderBy: { updatedAt: "desc" }, take: 500,
    select: { id: true, name: true, description: true, draft: true, publishedVersionId: true, createdById: true, updatedById: true, updatedAt: true },
  });
  const versions = await prisma.boardVersion.findMany({ where: { organizationId: caller.organizationId, id: { in: rows.flatMap((row) => row.publishedVersionId ? [row.publishedVersionId] : []) } }, select: { id: true, number: true, publishedAt: true, layout: true } });
  const version = new Map(versions.map((item) => [item.id, item]));
  const who = await names(rows.map((row) => row.updatedById));
  return {
    items: rows.map((row) => {
      const published = row.publishedVersionId ? version.get(row.publishedVersionId) : null;
      const layout = readLayout(rights.edit ? row.draft : published?.layout);
      return {
        id: row.id, name: row.name, description: row.description, updatedAt: row.updatedAt.toISOString(), updatedBy: who.get(row.updatedById) ?? "",
        mine: row.createdById === caller.userId, cards: layout.cards.length, orientation: layout.orientation,
        published: published ? { number: published.number, publishedAt: published.publishedAt.toISOString() } : null,
      };
    }),
    canEdit: rights.edit, canPublish: rights.publish,
  };
}

export async function getBoard(caller: BoardsCaller, id: string) {
  requireBoardsRead(caller);
  const rights = access(caller);
  const row = await boardRow(caller, id);
  const published = await publishedOf(caller, row.publishedVersionId);
  if (!rights.edit && !published) throw new ApiError(404, "Tavlan är inte publicerad.");
  return {
    id: row.id, name: row.name, description: row.description, revision: row.revision, updatedAt: row.updatedAt.toISOString(),
    draft: rights.edit ? readLayout(row.draft) : null,
    published,
    canEdit: rights.edit, canPublish: rights.publish,
    metrics: rights.edit ? metricsFor(caller).map(metricOption) : [],
  };
}

const createSchema = z.object({ name: boardNameSchema, preset: z.enum(BOARD_PRESETS.map((item) => item.key) as [BoardPreset, ...BoardPreset[]]).default("empty"), copyOf: z.string().trim().max(60).optional(), template: z.enum(BOARD_TEMPLATE_KEYS as unknown as [BoardTemplateKey, ...BoardTemplateKey[]]).optional() });

export async function createBoard(caller: BoardsCaller, input: unknown) {
  requireBoardsEdit(caller);
  const data = createSchema.parse(input);
  let layout: BoardLayout = presetLayout(data.preset);
  let description = "";
  if (data.template && !data.copyOf) {
    const template = boardTemplate(data.template);
    layout = template.layout;
    description = template.description;
  }
  if (data.copyOf) {
    const source = await boardRow(caller, data.copyOf);
    layout = readLayout(source.draft);
    description = source.description;
  }
  const row = await prisma.board.create({ data: { organizationId: caller.organizationId, name: data.name, description, draft: layout as unknown as Prisma.InputJsonValue, createdById: caller.userId, updatedById: caller.userId }, select: { id: true } });
  return { id: row.id };
}

const saveSchema = z.object({ name: boardNameSchema.optional(), description: z.string().trim().max(300).optional(), layout: layoutSchema.optional() });

/** Autosave of the draft, with the board's revision as the version check (two editors never write over each other in silence). */
export async function saveBoard(caller: BoardsCaller, id: string, revision: number, input: unknown) {
  requireBoardsEdit(caller);
  const data = saveSchema.parse(input);
  await boardRow(caller, id);
  const result = await prisma.board.updateMany({
    where: { id, organizationId: caller.organizationId, deletedAt: null, revision },
    data: { ...(data.name !== undefined ? { name: data.name } : {}), ...(data.description !== undefined ? { description: data.description } : {}), ...(data.layout ? { draft: data.layout as unknown as Prisma.InputJsonValue } : {}), revision: { increment: 1 }, updatedById: caller.userId },
  });
  if (!result.count) throw new ApiError(409, "Tavlan har ändrats av någon annan. Ladda om sidan för att se den senaste versionen.");
  const row = await prisma.board.findFirstOrThrow({ where: { id, organizationId: caller.organizationId }, select: { revision: true, updatedAt: true } });
  return { revision: row.revision, updatedAt: row.updatedAt.toISOString() };
}

export async function deleteBoard(caller: BoardsCaller, id: string) {
  requireBoardsEdit(caller);
  const row = await boardRow(caller, id);
  await prisma.board.updateMany({ where: { id, organizationId: caller.organizationId }, data: { deletedAt: new Date(), updatedById: caller.userId } });
  forgetBoardFeeds({ boardId: id });
  await audit(caller, "board_deleted", `Tavlan ${row.name} togs bort.`);
  return { ok: true };
}

/** "Det här syns" before publishing: the cards, which of them have names, and the choice for each (hidden unless chosen before). */
export async function publishPreview(caller: BoardsCaller, id: string) {
  requireBoardsPublish(caller);
  const row = await boardRow(caller, id);
  const layout = readLayout(row.draft);
  const published = await publishedOf(caller, row.publishedVersionId);
  return { layout, cards: visibilitySummary(layout, published?.visibility ?? {}), personal: layoutHasPersonalData(layout), receivers: await boardReceivers(caller, id) };
}

/** The screens and links that show the board (etapp 2 fills it; until then only the app). */
export const boardReceivers = (caller: BoardsCaller, boardId: string) => receiversOfBoard(caller.organizationId, boardId);

const publishSchema = z.object({ visibility: visibilitySchema });

/** Publicera: the draft becomes a new locked version, shown everywhere the board is shown; the old version stays for going back. */
export async function publishBoard(caller: BoardsCaller, id: string, revision: number, input: unknown) {
  requireBoardsPublish(caller);
  const { visibility } = publishSchema.parse(input);
  const row = await boardRow(caller, id);
  if (row.revision !== revision) throw new ApiError(409, "Tavlan har ändrats sedan du öppnade den. Kontrollera ändringarna och publicera igen.");
  const layout = readLayout(row.draft);
  const clean: Visibility = cleanVisibility(layout, visibility);
  const version = await prisma.$transaction(async (tx) => {
    const last = await tx.boardVersion.findFirst({ where: { boardId: id, organizationId: caller.organizationId }, orderBy: { number: "desc" }, select: { number: true } });
    const created = await tx.boardVersion.create({ data: { organizationId: caller.organizationId, boardId: id, number: (last?.number ?? 0) + 1, layout: layout as unknown as Prisma.InputJsonValue, visibility: clean, publishedById: caller.userId } });
    const updated = await tx.board.updateMany({ where: { id, organizationId: caller.organizationId, revision, deletedAt: null }, data: { publishedVersionId: created.id } });
    if (!updated.count) throw new ApiError(409, "Tavlan har ändrats sedan du öppnade den. Kontrollera ändringarna och publicera igen.");
    return created;
  });
  forgetBoardFeeds({ boardId: id });
  const shown = Object.entries(clean).filter(([, choice]) => choice !== "hidden").length;
  await audit(caller, "board_published", `Tavlan ${row.name} publicerades (version ${version.number}).${shown ? ` Namn eller initialer visas utanför appen på ${shown} kort.` : ""}`);
  return { number: version.number, publishedAt: version.publishedAt.toISOString() };
}

/** The figures of a board inside the app, counted as the signed-in person (a card of Ekonomi needs Ekonomi here too). */
export async function boardFeedInApp(caller: BoardsCaller, id: string, which: "published" | "draft") {
  requireBoardsRead(caller);
  const row = await boardRow(caller, id);
  let layout: BoardLayout;
  if (which === "draft") { requireBoardsEdit(caller); layout = readLayout(row.draft); }
  else {
    const published = await publishedOf(caller, row.publishedVersionId);
    if (!published) throw new ApiError(404, "Tavlan är inte publicerad.");
    layout = published.layout;
  }
  return { at: new Date().toISOString(), cards: await boardFeed(caller, layout, { outside: false }) };
}

// ---------- the boards' own tables ----------

async function tableRow(caller: BoardsCaller, id: string) {
  const row = await prisma.boardDataSource.findFirst({ where: { id, organizationId: caller.organizationId, deletedAt: null } });
  if (!row) throw new ApiError(404, "Tabellen finns inte.");
  return row;
}
const columnsOf = (value: unknown): TableColumn[] => { const parsed = tableColumnsSchema.safeParse(value); return parsed.success ? parsed.data : []; };

export async function listTables(caller: BoardsCaller) {
  requireBoardsRead(caller);
  const rows = await prisma.boardDataSource.findMany({ where: { organizationId: caller.organizationId, deletedAt: null, kind: "table" }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true, description: true, columns: true, updatedAt: true, updatedById: true, _count: { select: { rows: true } } } });
  const who = await names(rows.map((row) => row.updatedById));
  return { items: rows.map((row) => ({ id: row.id, name: row.name, description: row.description, columns: columnsOf(row.columns), rows: row._count.rows, updatedAt: row.updatedAt.toISOString(), updatedBy: who.get(row.updatedById) ?? "" })), canEdit: access(caller).edit };
}

export async function getTable(caller: BoardsCaller, id: string) {
  requireBoardsRead(caller);
  const row = await tableRow(caller, id);
  const rows = await prisma.boardDataRow.findMany({ where: { organizationId: caller.organizationId, sourceId: id }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: MAX_ROWS, select: { id: true, values: true } });
  return { id: row.id, name: row.name, description: row.description, revision: row.revision, columns: columnsOf(row.columns), rows: rows.map((item) => ({ id: item.id, values: item.values as Record<string, string | number | null> })), canEdit: access(caller).edit };
}

const DEFAULT_COLUMNS: TableColumn[] = [{ key: "namn", label: "Namn", type: "text" }, { key: "varde", label: "Värde", type: "number" }];
const tableCreateSchema = z.object({ name: z.string().trim().min(1, "Ge tabellen ett namn.").max(80), columns: tableColumnsSchema.optional() });

export async function createTable(caller: BoardsCaller, input: unknown) {
  requireBoardsEdit(caller);
  const data = tableCreateSchema.parse(input);
  const row = await prisma.boardDataSource.create({ data: { organizationId: caller.organizationId, kind: "table", name: data.name, columns: (data.columns ?? DEFAULT_COLUMNS) as unknown as Prisma.InputJsonValue, createdById: caller.userId, updatedById: caller.userId }, select: { id: true } });
  await audit(caller, "board_table_created", `Tabellen ${data.name} skapades.`);
  return { id: row.id };
}

const tableSaveSchema = z.object({
  name: z.string().trim().min(1, "Ge tabellen ett namn.").max(80),
  description: z.string().trim().max(300).default(""),
  columns: tableColumnsSchema,
  rows: z.array(z.object({ values: z.record(z.string(), z.unknown()) })).max(MAX_ROWS, `En tabell kan ha högst ${MAX_ROWS} rader.`),
});

/** The whole table at once (its columns and rows), with the revision as the version check. */
export async function saveTable(caller: BoardsCaller, id: string, revision: number, input: unknown) {
  requireBoardsEdit(caller);
  const data = tableSaveSchema.parse(input);
  await tableRow(caller, id);
  const saved = await prisma.$transaction(async (tx) => {
    const updated = await tx.boardDataSource.updateMany({ where: { id, organizationId: caller.organizationId, revision, deletedAt: null }, data: { name: data.name, description: data.description, columns: data.columns as unknown as Prisma.InputJsonValue, revision: { increment: 1 }, updatedById: caller.userId } });
    if (!updated.count) throw new ApiError(409, "Tabellen har ändrats av någon annan. Ladda om sidan för att se den senaste versionen.");
    await tx.boardDataRow.deleteMany({ where: { organizationId: caller.organizationId, sourceId: id } });
    if (data.rows.length) await tx.boardDataRow.createMany({ data: data.rows.map((row, position) => ({ organizationId: caller.organizationId, sourceId: id, position, values: rowValues(data.columns, row.values) as Prisma.InputJsonValue })) });
    return tx.boardDataSource.findFirstOrThrow({ where: { id, organizationId: caller.organizationId }, select: { revision: true, updatedAt: true } });
  });
  forgetBoardFeeds({ sourceId: id });
  return { revision: saved.revision, updatedAt: saved.updatedAt.toISOString() };
}

export async function deleteTable(caller: BoardsCaller, id: string) {
  requireBoardsEdit(caller);
  const row = await tableRow(caller, id);
  await prisma.boardDataSource.updateMany({ where: { id, organizationId: caller.organizationId }, data: { deletedAt: new Date(), updatedById: caller.userId } });
  forgetBoardFeeds({ sourceId: id });
  await audit(caller, "board_table_deleted", `Tabellen ${row.name} togs bort.`);
  return { ok: true };
}

/** What the properties panel offers for the newer cards: files, a sheet's columns, machines and signals (lib/boards/cards). */
export async function boardSources(caller: BoardsCaller, kind: string | null, id: string | null) {
  requireBoardsEdit(caller);
  return boardSourceOptions(caller, kind, id);
}

// ---------- pictures ----------

export async function addBoardImage(caller: BoardsCaller, file: { filename: string; storagePath: string; mimeType: string; size: number }) {
  requireBoardsEdit(caller);
  const row = await prisma.boardImage.create({ data: { organizationId: caller.organizationId, ...file, createdById: caller.userId }, select: { id: true } });
  return { id: row.id };
}

/** A picture for the app: the caller's company and the read right. */
export async function boardImageInApp(caller: BoardsCaller, id: string) {
  requireBoardsRead(caller);
  const row = await prisma.boardImage.findFirst({ where: { id, organizationId: caller.organizationId } });
  if (!row) throw new ApiError(404, "Bilden finns inte.");
  return row;
}

/** A picture for a screen or a link: only one that is on the layout it shows. */
export async function boardImageFor(organizationId: string, layouts: readonly BoardLayout[], id: string) {
  if (!layouts.some((layout) => layoutImageIds(layout).includes(id))) return null;
  return prisma.boardImage.findFirst({ where: { id, organizationId } });
}
