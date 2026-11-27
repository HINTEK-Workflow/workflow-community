import { z } from "zod";

/**
 * Dokument (0.87.0): the shared rules of a customer's and a place's files – the names, the scan statuses and what each allows, the
 * list's filters and sorting, and the view the pages and the tools get. No database or route code, so the pages, the demo and the
 * tests use the same rules as the server (lib/documents/server.ts).
 */
export const DOCUMENT_SCAN_STATUSES = ["pending", "clean", "infected", "unscanned"] as const;
export type DocumentScanStatus = (typeof DOCUMENT_SCAN_STATUSES)[number];
export const DOCUMENT_SCAN_LABEL: Record<DocumentScanStatus, string> = {
  pending: "Väntar på virussökning",
  clean: "Virussökt",
  infected: "Smittad, borttagen",
  unscanned: "Inte virussökt",
};
/** The short word of a pill. */
export const DOCUMENT_SCAN_PILL: Record<DocumentScanStatus, string> = { pending: "Väntar", clean: "Ren", infected: "Smittad", unscanned: "Ej sökt" };
export const DOCUMENT_SCAN_TONE: Record<DocumentScanStatus, "neutral" | "success" | "danger" | "warning"> = { pending: "neutral", clean: "success", infected: "danger", unscanned: "warning" };

/** Only a clean file – or, on an installation without a scanner, an unscanned one – is ever given out. */
export const documentDownloadable = (status: string, stored: boolean) => stored && (status === "clean" || status === "unscanned");

export const DOCUMENT_NAME_MAX = 200;
export const DOCUMENT_PAGE = 25;
/** The few documents a customer's or a place's panel shows before Visa alla. */
export const DOCUMENT_PREVIEW = 6;

/** A name as it is kept: no path, no control characters, at most 200 characters; empty is refused by the caller. */
export function cleanDocumentName(raw: string) {
  const base = raw.split(/[\\/]/).pop() ?? "";
  return base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, DOCUMENT_NAME_MAX);
}
const extensionOf = (name: string) => /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase() ?? "";
/**
 * The name a stored file gets: the person's own, with the extension the stored file really has (a picture is kept as JPEG, so
 * "skylt.png" becomes "skylt.jpg"); a name without one gets it added.
 */
export function storedDocumentName(original: string, extension: string) {
  const name = cleanDocumentName(original) || `dokument.${extension}`;
  const current = extensionOf(name);
  if (current === extension || (extension === "jpg" && current === "jpeg")) return name;
  const stem = current ? name.slice(0, -(current.length + 1)) : name;
  return `${stem || "dokument"}.${extension}`.slice(-DOCUMENT_NAME_MAX);
}
/** A renamed document keeps its extension, so it is still opened by the right program. */
export function renamedDocumentName(next: string, current: string) {
  const name = cleanDocumentName(next);
  if (!name) return "";
  const extension = extensionOf(current);
  return extension && extensionOf(name) !== extension ? `${name}.${extension}`.slice(0, DOCUMENT_NAME_MAX) : name;
}

export const DOCUMENT_SORTS = ["newest", "oldest", "name", "customer"] as const;
export type DocumentSort = (typeof DOCUMENT_SORTS)[number];
export const DOCUMENT_SORT_LABEL: Record<DocumentSort, string> = { newest: "Senast uppladdade", oldest: "Äldst först", name: "Namn A–Ö", customer: "Kund A–Ö" };
export const DOCUMENT_FILTERS = ["all", "pending", "trash"] as const;
export type DocumentFilter = (typeof DOCUMENT_FILTERS)[number];
export const DOCUMENT_FILTER_LABEL: Record<DocumentFilter, string> = { all: "Alla", pending: "Väntar på virussökning", trash: "Papperskorg" };

const id = z.string().trim().min(1).max(100);
export const documentListQuerySchema = z.object({
  customerId: id.optional(),
  placeId: id.optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(DOCUMENT_SORTS).default("newest"),
  filter: z.enum(DOCUMENT_FILTERS).default("all"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(DOCUMENT_PAGE),
});
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;

export const documentChangeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rename"), name: z.string().max(DOCUMENT_NAME_MAX * 2) }),
  z.object({ action: z.literal("restore") }),
  z.object({ action: z.literal("move"), placeId: id.nullable() }),
]);

/** A document as the pages, the demo and the tools see it. */
export type DocumentView = {
  id: string; name: string; mimeType: string; size: number;
  customerId: string; customerName: string; placeId: string | null; placeName: string | null;
  scanStatus: DocumentScanStatus; scanLabel: string; downloadable: boolean;
  uploadedBy: string; createdAt: string; deletedAt: string | null;
  /** Ladda ner; null while the file may not be given out. */
  href: string | null;
};
export type DocumentRow = {
  id: string; name: string; mimeType: string; size: number; customerId: string; placeId: string | null; storagePath: string | null;
  scanStatus: string; createdAt: Date; deletedAt: Date | null;
};
export const documentHref = (id: string) => `/api/documents/${encodeURIComponent(id)}`;
const scanStatusOf = (value: string): DocumentScanStatus => (DOCUMENT_SCAN_STATUSES as readonly string[]).includes(value) ? value as DocumentScanStatus : "pending";

export function documentView(row: DocumentRow, names: { customer: string; place: string | null; uploadedBy: string }): DocumentView {
  const status = scanStatusOf(row.scanStatus);
  const downloadable = !row.deletedAt && documentDownloadable(status, Boolean(row.storagePath));
  return {
    id: row.id, name: row.name, mimeType: row.mimeType, size: row.size,
    customerId: row.customerId, customerName: names.customer, placeId: row.placeId, placeName: names.place,
    scanStatus: status, scanLabel: DOCUMENT_SCAN_LABEL[status], downloadable,
    uploadedBy: names.uploadedBy, createdAt: row.createdAt.toISOString(), deletedAt: row.deletedAt?.toISOString() ?? null,
    href: downloadable ? documentHref(row.id) : null,
  };
}

/** "1,2 MB", "340 kB": the size as the lists show it. */
export function documentSizeLabel(bytes: number) {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} kB`;
}

/** The kind of file in a word, from its name (the icon's and the list's). */
export function documentKindLabel(name: string) {
  const extension = extensionOf(name);
  return extension === "pdf" ? "PDF" : extension === "jpg" || extension === "jpeg" ? "Bild" : extension === "docx" ? "Word" : extension === "xlsx" ? "Excel" : extension === "txt" ? "Text" : "Fil";
}

export const DOCUMENTS_VIEW = "/?view=documents";
export const DOCUMENT_UPLOAD_REFUSAL = "Du saknar behörighet att ändra kundens dokument.";
export const DOCUMENT_MISSING = "Dokumentet hittades inte.";
export const DOCUMENT_NOT_READY = "Dokumentet väntar på virussökning och kan laddas ner när det är klart.";
export const DOCUMENT_INFECTED = "Filen innehöll skadlig kod och har tagits bort. Den kan inte laddas ner.";
