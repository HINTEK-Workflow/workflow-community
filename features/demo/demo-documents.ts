import { customerTitle } from "@/lib/kfid/customer-name";
import {
  DOCUMENT_MISSING, DOCUMENT_PAGE, documentListQuerySchema, documentChangeSchema, documentView, renamedDocumentName, type DocumentRow, type DocumentView,
} from "@/lib/documents/model";
import type { DemoDatabase } from "./demo-data";

/**
 * Dokument i demon (0.87.0): /api/documents answered from memory with the same rules as the server (lib/documents/server.ts). Kopplingsbyrån
 * AB's first customers have a few invented documents; renaming, the papperskorg and restoring work in this browser only. Nothing is
 * uploaded (handleDemoRequest refuses every file) and nothing is downloaded: the demo keeps no files, so the rows have no link.
 */
export class DemoDocumentsError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
type Context = { db: DemoDatabase; user: { id: string; name: string }; admin: boolean; can: (subject: "customers", action: "read" | "edit") => boolean; now: Date };
type Request = { method: string; url: URL; body: unknown };
type Row = DocumentRow & { uploadedBy: string };

const stores = new WeakMap<DemoDatabase, Row[]>();
const NAMES = ["Ritning elcentral.pdf", "Egenkontroll vid överlämning.pdf", "Serviceavtal 2026.docx", "Mätvärden jordtag.xlsx", "Foto mätartavla.jpg", "Driftinstruktion.pdf"];

function rowsOf(ctx: Context): Row[] {
  let rows = stores.get(ctx.db);
  if (!rows) {
    const customers = ctx.db.customers.filter((customer) => !customer.deletedAt && !customer.ownCompany).slice(0, 3);
    const uploader = ctx.db.users.find((user) => user.role === "ADMIN")?.name ?? ctx.db.users[0]?.name ?? "";
    rows = customers.flatMap((customer, index) => {
      const place = ctx.db.facilities.find((facility) => facility.customerId === customer.id) ?? null;
      return NAMES.slice(index * 2, index * 2 + 2).map((name, offset): Row => {
        const at = new Date(ctx.now.getTime() - (index * 2 + offset + 1) * 26 * 3_600_000);
        return { id: `demo-document-${index}-${offset}`, name, mimeType: name.endsWith(".pdf") ? "application/pdf" : name.endsWith(".jpg") ? "image/jpeg" : "application/octet-stream", size: 180_000 + index * 95_000 + offset * 41_000,
          customerId: customer.id, placeId: offset === 1 && place ? place.id : null, storagePath: null, scanStatus: "clean", createdAt: at, deletedAt: null, uploadedBy: uploader };
      });
    });
    stores.set(ctx.db, rows);
  }
  return rows;
}

function viewOf(ctx: Context, row: Row): DocumentView {
  const customer = ctx.db.customers.find((item) => item.id === row.customerId);
  const place = row.placeId ? ctx.db.facilities.find((item) => item.id === row.placeId) : null;
  // The demo keeps no files: the row has no link, and Ladda ner says so.
  return { ...documentView(row, { customer: customerTitle(customer), place: place?.name ?? null, uploadedBy: row.uploadedBy }), downloadable: false, href: null };
}

export function demoDocuments(ctx: Context, request: Request) {
  if (!ctx.can("customers", "read")) throw new DemoDocumentsError(403, "Du saknar behörighet att se kundens dokument.");
  const rows = rowsOf(ctx);
  const path = request.url.pathname.replace(/\/+$/, "");
  const id = path.startsWith("/api/documents/") ? decodeURIComponent(path.slice("/api/documents/".length)) : null;
  if (request.method === "GET" && !id) {
    const params = Object.fromEntries(request.url.searchParams);
    if (params.facets === "1") {
      const customers = ctx.db.customers.filter((customer) => rows.some((row) => row.customerId === customer.id && !row.deletedAt)).map((customer) => ({ id: customer.id, name: customerTitle(customer) }));
      const places = params.customerId ? ctx.db.facilities.filter((place) => rows.some((row) => row.placeId === place.id && !row.deletedAt)).map((place) => ({ id: place.id, name: place.name })) : [];
      return { customers, places };
    }
    const query = documentListQuerySchema.parse(params);
    const term = query.q?.toLocaleLowerCase("sv-SE");
    const base = rows.filter((row) => (!query.customerId || row.customerId === query.customerId) && (!query.placeId || row.placeId === query.placeId))
      .filter((row) => !term || viewOf(ctx, row).name.toLocaleLowerCase("sv-SE").includes(term) || viewOf(ctx, row).customerName.toLocaleLowerCase("sv-SE").includes(term));
    const trash = query.filter === "trash";
    const shown = base.filter((row) => trash ? row.deletedAt : !row.deletedAt).filter((row) => query.filter !== "pending" || row.scanStatus === "pending")
      .sort((a, b) => query.sort === "oldest" ? a.createdAt.getTime() - b.createdAt.getTime() : query.sort === "name" ? a.name.localeCompare(b.name, "sv-SE") : b.createdAt.getTime() - a.createdAt.getTime());
    const limit = query.limit ?? DOCUMENT_PAGE;
    return {
      items: shown.slice((query.page - 1) * limit, query.page * limit).map((row) => viewOf(ctx, row)), total: shown.length, page: query.page, pages: Math.max(1, Math.ceil(shown.length / limit)),
      counts: { all: base.filter((row) => !row.deletedAt).length, pending: 0, trash: ctx.can("customers", "edit") ? base.filter((row) => row.deletedAt).length : 0 },
      canEdit: ctx.can("customers", "edit"), canPurge: ctx.admin, scan: "clamav",
    };
  }
  if (!id) throw new DemoDocumentsError(403, "Filer kan inte laddas upp i demon.");
  const row = rows.find((item) => item.id === id);
  if (!row) throw new DemoDocumentsError(404, DOCUMENT_MISSING);
  if (request.method === "GET") throw new DemoDocumentsError(404, "Demon sparar inga filer att ladda ner.");
  if (!ctx.can("customers", "edit")) throw new DemoDocumentsError(403, "Du saknar behörighet att ändra kundens dokument.");
  if (request.method === "DELETE") {
    if (request.url.searchParams.get("permanent") === "1") { rows.splice(rows.indexOf(row), 1); return { ok: true, removed: true }; }
    row.deletedAt = new Date(); return { ok: true, trashed: true };
  }
  const change = documentChangeSchema.parse(request.body);
  if (change.action === "restore") row.deletedAt = null;
  else if (change.action === "move") row.placeId = change.placeId;
  else { const name = renamedDocumentName(change.name, row.name); if (!name) throw new DemoDocumentsError(400, "Skriv ett namn på dokumentet."); row.name = name; }
  return { document: viewOf(ctx, row) };
}
