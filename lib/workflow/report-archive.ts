import type { ListSortKey } from "@/lib/list-filter";
import { swedishDate, swedishParts } from "@/lib/swedish-time";
import { WORKFLOW_PERMISSION_SUBJECTS, workflowSubjectForTask, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";

/**
 * Rapportarkiv (2026-10-07): the PDF and Excel reports a person chose to keep when exporting ("Spara i
 * rapportarkivet"), found again under Rapportarkiv. Pure rules: what may be kept, how it is named, who may read it and how
 * a list is bounded. The files are the reports exactly as they were made – nothing here draws or changes a report, so the
 * reference-locked reports are untouched. The storage and the database are in lib/workflow/report-archive-server.ts.
 */
export const ARCHIVE_FORMATS = ["PDF", "XLSX"] as const;
export type ArchiveFormat = (typeof ARCHIVE_FORMATS)[number];
export const ARCHIVE_KINDS = ["WORK_ORDER", "RISK_ASSESSMENT", "FORM", "PROJECT"] as const;
export type ArchiveKind = (typeof ARCHIVE_KINDS)[number];

/** A page of the list (Visa fler adds one more) and the most the server ever sends at once. */
export const ARCHIVE_PAGE = 20;
export const ARCHIVE_MAX_PAGE = 100;
/** Safety limits, so one company cannot fill the storage: a report is a few megabytes at most. */
export const ARCHIVE_MAX_BYTES = 40_000_000;
export const ARCHIVE_MAX_ENTRIES = 5000;

export const ARCHIVE_MIME: Record<ArchiveFormat, string> = { PDF: "application/pdf", XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
export const ARCHIVE_EXTENSION: Record<ArchiveFormat, string> = { PDF: "pdf", XLSX: "xlsx" };
export const ARCHIVE_KIND_LABELS: Record<ArchiveKind, string> = { WORK_ORDER: "Arbetsorder", RISK_ASSESSMENT: "Riskbedömning", FORM: "Protokoll", PROJECT: "Projektrapport" };
export const archiveKindLabel = (kind: string) => ARCHIVE_KIND_LABELS[kind as ArchiveKind] ?? "Rapport";

/** What a report must be to be kept: a real PDF or a real Excel file, within the size limit. */
export function archiveProblem(bytes: Uint8Array, format: ArchiveFormat) {
  if (!bytes.length) return "Rapporten är tom.";
  if (bytes.length > ARCHIVE_MAX_BYTES) return "Rapporten är för stor för arkivet.";
  // The first bytes as text (no Buffer: the page also imports this module).
  const head = String.fromCharCode(...bytes.subarray(0, 5));
  if (format === "PDF" && head !== "%PDF-") return "Filen är ingen PDF.";
  if (format === "XLSX" && !head.startsWith("PK")) return "Filen är ingen Excel-fil.";
  return null;
}

/** The file name a report is kept and downloaded under: the title, what it is, no characters a file system refuses. */
export function archiveFilename(title: string, kind: ArchiveKind, format: ArchiveFormat) {
  const clean = title.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").replace(/^[\s.-]+|[\s.-]+$/g, "").slice(0, 120) || "Rapport";
  return `${clean}${format === "XLSX" ? "" : kind === "PROJECT" ? "-projektrapport" : "-rapport"}.${ARCHIVE_EXTENSION[format]}`;
}

/** The permission area a report belongs to: a project's report follows Projekt, a task's report follows the task's own area. */
export function archiveSubjectFor(kind: ArchiveKind, formArea?: string | null): WorkflowPermissionSubject {
  return kind === "PROJECT" ? "projects" : workflowSubjectForTask(kind, formArea);
}

/** The areas whose reports a person may read: the ones whose tasks (or projects) they may read. Admins may read every area. */
export const archiveReadableSubjects = (can: (subject: WorkflowPermissionSubject) => boolean) =>
  WORKFLOW_PERMISSION_SUBJECTS.filter((subject) => subject !== "customers" && subject !== "catalogue" && subject !== "staff-register" && subject !== "quotes" && subject !== "team" && subject !== "economy" && subject !== "maintenance" && subject !== "invoicing" && can(subject));

/**
 * The shared toppvisning (2026-10-31) and the plan's DO17: the format as chips with counts, the type and the period
 * as extra filters ("protokoll från förra månaden"), and the sort. The chips count every report the other filters leave.
 */
export const ARCHIVE_FILTERS = ["all", "PDF", "XLSX"] as const;
export type ArchiveFilter = (typeof ARCHIVE_FILTERS)[number];
export const ARCHIVE_FILTER_LABEL: Record<ArchiveFilter, string> = { all: "Alla", PDF: "PDF", XLSX: "Excel" };
export const ARCHIVE_SORTS = ["updated", "title"] as const satisfies readonly ListSortKey[];
export type ArchiveSort = (typeof ARCHIVE_SORTS)[number];
export const ARCHIVE_PERIODS = ["all", "this-month", "last-month", "this-year"] as const;
export type ArchivePeriod = (typeof ARCHIVE_PERIODS)[number];
export const ARCHIVE_PERIOD_LABEL: Record<ArchivePeriod, string> = { all: "Alla datum", "this-month": "Denna månad", "last-month": "Förra månaden", "this-year": "I år" };

/** A period as the moments it starts and ends (Swedish calendar months; the end is not included). */
export function archivePeriodRange(period: ArchivePeriod, now: Date = new Date()): { from?: Date; before?: Date } {
  const { year, month } = swedishParts(now);
  if (period === "this-month") return { from: swedishDate(year, month, 1) };
  if (period === "last-month") return { from: swedishDate(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1, 1), before: swedishDate(year, month, 1) };
  if (period === "this-year") return { from: swedishDate(year, 1, 1) };
  return {};
}

const oneOf = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T => value !== null && (allowed as readonly string[]).includes(value) ? value as T : fallback;

/** The list's filters from the address: Mina or Alla, a search in the title, the toppvisning's choices and how many to show. Never unbounded. */
export function archiveQuery(params: URLSearchParams) {
  const limit = Number(params.get("limit"));
  return {
    format: oneOf(params.get("format"), ARCHIVE_FILTERS, "all"),
    kind: oneOf(params.get("kind"), ["all", ...ARCHIVE_KINDS] as const, "all"),
    period: oneOf(params.get("period"), ARCHIVE_PERIODS, "all"),
    sort: oneOf(params.get("sort"), ARCHIVE_SORTS, "updated"),
    scope: params.get("scope") === "all" ? "all" as const : "mine" as const,
    q: (params.get("q") ?? "").trim().slice(0, 100),
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(ARCHIVE_MAX_PAGE, limit) : ARCHIVE_PAGE,
    cursor: (params.get("cursor") ?? "").slice(0, 60) || undefined,
  };
}

/** The line under a report in the list: what it is, the format and the size. */
export const archiveDetail = (entry: { kind: string; format: string; size: number }) => `${archiveKindLabel(entry.kind)} · ${entry.format === "XLSX" ? "Excel" : "PDF"} · ${entry.size < 1_000_000 ? `${Math.max(1, Math.round(entry.size / 1000))} kB` : `${(entry.size / 1_000_000).toFixed(1).replace(".", ",")} MB`}`;

/** How long a report is kept, in words: the company's chosen history time. */
export const archiveRetentionText = (months: number | null) =>
  months === null ? "Rapporterna sparas tills du tar bort dem för hand (Inställningar → Företag → Historik och lagring)."
    : `Rapporterna sparas i ${months === 12 ? "1 år" : months > 12 && months % 12 === 0 ? `${months / 12} år` : `${months} månader`}, lika länge som företagets historik (Inställningar → Företag → Historik och lagring), och raderas sedan av sig själva.`;
