import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { PDF_DOCUMENTS, PDF_TEMPLATES_EDITION, pdfDocumentDef } from "./catalog";
import { blockArea, blockMax, blockMayEdit, blockMayHide, blockMultiline, blockVersion, resolvePdfDocument, textVersion, validateOverride, type PdfDocumentDef, type PdfTemplateOverride } from "./model";

/**
 * PDF-mallar on the server (2026-11-03; the model is ./model.ts): the product owner's overrides in the table
 * PdfTemplateOverride, product-wide (every company's documents read them; each company keeps its own logo and report
 * colours). Read through parameterised SQL, so the generated client needs no new delegate; a database without the table
 * (an installation before the migration) reads as "no overrides" and every document keeps its defaults.
 */
type Row = { id: string; documentType: string; blockId: string; text: string | null; visible: boolean | null; orderIndex: number | null; basedOnVersion: string; basedOnText: string | null; updatedAt: Date; archivedAt: Date | null };

const missingTable = (error: unknown) => /PdfTemplateOverride/.test(String((error as { message?: string })?.message ?? "")) && /does not exist|42P01/.test(String((error as { message?: string; code?: string })?.message ?? "") + String((error as { code?: string })?.code ?? ""));
const toOverride = (row: Row): PdfTemplateOverride => ({ documentType: row.documentType, blockId: row.blockId, text: row.text, visible: row.visible, orderIndex: row.orderIndex, basedOnVersion: row.basedOnVersion });

async function activeRows(): Promise<Row[]> {
  try {
    return await prisma.$queryRaw<Row[]>`SELECT "id", "documentType", "blockId", "text", "visible", "orderIndex", "basedOnVersion", "basedOnText", "updatedAt", "archivedAt" FROM "PdfTemplateOverride" WHERE "archivedAt" IS NULL ORDER BY "documentType", "blockId"`;
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

// The generators read the overrides on every document; a short cache keeps that one query off the hot path. A save in
// this process clears it at once; another process sees the change within the cache time.
const CACHE_MS = 30_000;
let cache: { at: number; rows: readonly PdfTemplateOverride[] } | null = null;
export function clearPdfTemplateCache() { cache = null; }

/** The overrides every document is drawn with (workflowReportIdentity). A failing read never stops a document: it gets the defaults. */
export async function pdfTemplateOverrides(): Promise<readonly PdfTemplateOverride[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  try {
    const rows = (await activeRows()).map(toOverride);
    cache = { at: Date.now(), rows };
    return rows;
  } catch (error) {
    console.warn("PDF-mallarna kunde inte läsas; förvalen används.", (error as Error)?.name ?? "fel");
    return [];
  }
}

/** The concurrency token of one document's overrides: changes whenever a row is written, added or removed. */
export function documentToken(rows: readonly Pick<Row, "blockId" | "updatedAt">[]) {
  return textVersion(rows.map((row) => `${row.blockId}@${new Date(row.updatedAt).toISOString()}`).sort().join("|") || "none");
}

/** Overrides of blocks that no longer exist are archived, never deleted (an upgrade removed the block). */
export async function archiveRemovedOverrides(): Promise<number> {
  const known = PDF_DOCUMENTS.flatMap((doc) => doc.blocks.map((block) => `${doc.type}:${block.id}`));
  try {
    return await prisma.$executeRaw`UPDATE "PdfTemplateOverride" SET "archivedAt" = now() WHERE "archivedAt" IS NULL AND ("documentType" || ':' || "blockId") <> ALL(${known})`;
  } catch (error) {
    if (missingTable(error)) return 0;
    throw error;
  }
}

export type PdfEditorBlock = {
  id: string; kind: string; name: string; area: string; when: string | null; elsewhere: string | null; required: boolean; always: boolean; locked: boolean; mayHide: boolean; mayEdit: boolean; multiline: boolean; group: string | null; max: number;
  placeholders: string[]; needs: string[]; defaultText: string; version: string; text: string; visible: boolean; order: number; state: string;
  override: { text: string | null; visible: boolean | null; orderIndex: number | null; basedOnVersion: string; basedOnText: string | null } | null;
};
export type PdfEditorDocument = { type: string; name: string; description: string; contentIn: PdfDocumentDef["contentIn"] | null; placeholders: Record<string, string>; groups: Record<string, string>; token: string; flagged: number; legal: number; custom: number; blocks: PdfEditorBlock[] };

function editorDocument(def: PdfDocumentDef, rows: readonly Row[]): PdfEditorDocument {
  const own = rows.filter((row) => row.documentType === def.type);
  const byId = new Map(own.map((row) => [row.blockId, row]));
  const resolved = resolvePdfDocument(def, own.map(toOverride));
  return {
    type: def.type, name: def.name, description: def.description, contentIn: def.contentIn ?? null, placeholders: { ...def.placeholders }, groups: { ...(def.groups ?? {}) },
    token: documentToken(own), flagged: resolved.flagged, legal: resolved.legal, custom: own.length,
    blocks: resolved.blocks.map((block) => {
      const row = byId.get(block.def.id);
      return {
        id: block.def.id, kind: block.def.kind, name: block.def.name, area: blockArea(block.def), when: block.def.when ?? null, elsewhere: block.def.elsewhere ?? null, required: Boolean(block.def.required), always: Boolean(block.def.always), locked: Boolean(block.def.locked),
        mayHide: blockMayHide(block.def), mayEdit: blockMayEdit(block.def), multiline: blockMultiline(block.def), group: block.def.group ?? null, max: blockMax(block.def),
        placeholders: [...(block.def.placeholders ?? [])], needs: [...(block.def.needs ?? [])], defaultText: block.def.text, version: block.version,
        text: block.text, visible: block.visible, order: block.order, state: block.state,
        override: row ? { text: row.text, visible: row.visible, orderIndex: row.orderIndex, basedOnVersion: row.basedOnVersion, basedOnText: row.basedOnText } : null,
      };
    }),
  };
}

/** The editor's view: every document type with its blocks, the owner's changes and the flags. Templates only – never a company's data. */
export async function pdfTemplatesEditorView() {
  await archiveRemovedOverrides();
  const rows = await activeRows();
  const documents = PDF_DOCUMENTS.map((def) => editorDocument(def, rows));
  return { edition: PDF_TEMPLATES_EDITION, documents, flagged: documents.reduce((sum, doc) => sum + doc.flagged + doc.legal, 0) };
}

/** Blocks whose default changed under the owner's text (Förvalet ändrades, Lagkrav uppdaterades): Installation's count. */
export async function pdfTemplatesFlagged(): Promise<number> {
  const rows = (await activeRows()).map(toOverride);
  return PDF_DOCUMENTS.reduce((sum, def) => { const resolved = resolvePdfDocument(def, rows); return sum + resolved.flagged + resolved.legal; }, 0);
}

export type PdfTemplateBlockInput = { blockId: string; text: string | null; visible: boolean | null; orderIndex: number | null; /** Keep my text: the owner confirms it against the current default. */ confirm?: boolean };

/**
 * Checks a document's wanted overrides against its blocks and turns them into rows to store: every block's rules
 * (required, locked, placeholders, length, group). `current` gives the stored rows, so an unchanged text keeps the
 * version it was made against until the owner confirms it.
 */
export function plannedOverrides(def: PdfDocumentDef, input: readonly PdfTemplateBlockInput[], current: readonly (Pick<Row, "blockId" | "text" | "basedOnVersion" | "basedOnText"> & Partial<Pick<Row, "visible" | "orderIndex">>)[]) {
  const blocks = new Map(def.blocks.map((block) => [block.id, block]));
  const seen = new Set<string>();
  const errors: { blockId: string; error: string }[] = [];
  const rows: { blockId: string; text: string | null; visible: boolean | null; orderIndex: number | null; basedOnVersion: string; basedOnText: string }[] = [];
  for (const item of input) {
    const block = blocks.get(item.blockId);
    if (!block) { errors.push({ blockId: item.blockId, error: "Blocket finns inte i mallen." }); continue; }
    if (seen.has(item.blockId)) { errors.push({ blockId: item.blockId, error: "Blocket står två gånger." }); continue; }
    seen.add(item.blockId);
    // A text set in the document's own editor: what is already stored stays, unread by the documents, and any change is refused.
    if (block.elsewhere) {
      const kept = current.find((row) => row.blockId === item.blockId);
      if (kept && kept.text === item.text && (kept.visible ?? null) === item.visible && (kept.orderIndex ?? null) === item.orderIndex) {
        rows.push({ blockId: item.blockId, text: item.text, visible: item.visible, orderIndex: item.orderIndex, basedOnVersion: kept.basedOnVersion, basedOnText: kept.basedOnText ?? block.text });
        continue;
      }
    }
    const groupSize = block.group ? def.blocks.filter((other) => other.group === block.group).length : 0;
    // A text equal to the default is no change; it is stored as following the default.
    const text = item.text !== null && item.text === block.text ? null : item.text;
    const visible = item.visible === true && !block.hidden ? null : item.visible;
    const error = validateOverride(block, { text, visible, orderIndex: item.orderIndex }, groupSize);
    if (error) { errors.push({ blockId: item.blockId, error }); continue; }
    if (text === null && visible === null && item.orderIndex === null) continue;
    const stored = current.find((row) => row.blockId === item.blockId);
    const keep = text !== null && stored && stored.text === text && !item.confirm;
    rows.push({ blockId: item.blockId, text, visible, orderIndex: item.orderIndex, basedOnVersion: keep ? stored.basedOnVersion : blockVersion(block), basedOnText: keep ? stored.basedOnText ?? block.text : block.text });
  }
  // An order only counts as a whole group: the places must be a permutation of the group.
  for (const group of Object.keys(def.groups ?? {})) {
    const members = def.blocks.filter((block) => block.group === group).map((block) => block.id);
    const placed = rows.filter((row) => members.includes(row.blockId) && row.orderIndex !== null);
    if (placed.length && (placed.length !== members.length || new Set(placed.map((row) => row.orderIndex)).size !== members.length))
      errors.push({ blockId: members[0]!, error: "Ordningen i gruppen är ofullständig." });
  }
  return { rows, errors };
}

/**
 * Saves one document's overrides as a whole (the editor sends every changed block; what is left out follows the default)
 * with optimistic concurrency: `basedOn` must be the token the editor read, or nothing is written (409). The change and
 * the audit event are one transaction; the event names the document and the block ids, never the texts.
 */
export async function savePdfTemplate(actor: { userId: string; organizationId: string }, input: { documentType: string; basedOn: string; blocks: readonly PdfTemplateBlockInput[] }) {
  const def = pdfDocumentDef(input.documentType);
  if (!def) throw new ApiError(404, "Dokumenttypen finns inte.");
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pdf-template:${def.type}`}))`;
    const current = await tx.$queryRaw<Row[]>`SELECT "id", "documentType", "blockId", "text", "visible", "orderIndex", "basedOnVersion", "basedOnText", "updatedAt", "archivedAt" FROM "PdfTemplateOverride" WHERE "documentType" = ${def.type} AND "archivedAt" IS NULL`;
    if (documentToken(current) !== input.basedOn) throw new ApiError(409, "Mallen har ändrats sedan du öppnade den. Ladda om och gör om ändringen.");
    const planned = plannedOverrides(def, input.blocks, current);
    if (planned.errors.length) {
      const first = planned.errors[0]!;
      throw Object.assign(new ApiError(400, `${def.blocks.find((block) => block.id === first.blockId)?.name ?? first.blockId}: ${first.error}`), { blocks: planned.errors });
    }
    const changed: string[] = [];
    const now = new Date();
    for (const row of planned.rows) {
      const stored = current.find((item) => item.blockId === row.blockId);
      if (stored && stored.text === row.text && stored.visible === row.visible && stored.orderIndex === row.orderIndex && stored.basedOnVersion === row.basedOnVersion) continue;
      changed.push(row.blockId);
      // An archived row of the same block (removed and brought back by an upgrade) is taken up again.
      await tx.$executeRaw`INSERT INTO "PdfTemplateOverride" ("id", "documentType", "blockId", "text", "visible", "orderIndex", "basedOnVersion", "basedOnText", "updatedById", "createdAt", "updatedAt", "archivedAt")
        VALUES (${randomUUID()}, ${def.type}, ${row.blockId}, ${row.text}, ${row.visible}, ${row.orderIndex}, ${row.basedOnVersion}, ${row.basedOnText}, ${actor.userId}, ${now}, ${now}, NULL)
        ON CONFLICT ("documentType", "blockId") DO UPDATE SET "text" = EXCLUDED."text", "visible" = EXCLUDED."visible", "orderIndex" = EXCLUDED."orderIndex", "basedOnVersion" = EXCLUDED."basedOnVersion", "basedOnText" = EXCLUDED."basedOnText", "updatedById" = EXCLUDED."updatedById", "updatedAt" = EXCLUDED."updatedAt", "archivedAt" = NULL`;
    }
    const kept = new Set(planned.rows.map((row) => row.blockId));
    const reset = current.filter((row) => !kept.has(row.blockId)).map((row) => row.blockId);
    if (reset.length) await tx.$executeRaw`DELETE FROM "PdfTemplateOverride" WHERE "documentType" = ${def.type} AND "archivedAt" IS NULL AND "blockId" = ANY(${reset})`;
    changed.push(...reset);
    if (changed.length) {
      const ids = changed.slice(0, 20).join(", ") + (changed.length > 20 ? ` … (${changed.length} block)` : "");
      await tx.administrationEvent.create({ data: { actorId: actor.userId, organizationId: actor.organizationId, action: "pdf_template_save",
        detail: `PDF-mallen ${def.name}: ${changed.length === 1 ? "ett block" : `${changed.length} block`} ${reset.length && reset.length === changed.length ? "återställda" : "ändrade"} (${ids}).` } });
    }
    const after = await tx.$queryRaw<Row[]>`SELECT "id", "documentType", "blockId", "text", "visible", "orderIndex", "basedOnVersion", "basedOnText", "updatedAt", "archivedAt" FROM "PdfTemplateOverride" WHERE "documentType" = ${def.type} AND "archivedAt" IS NULL`;
    return { changed, document: editorDocument(def, after) };
  });
  clearPdfTemplateCache();
  return result;
}
