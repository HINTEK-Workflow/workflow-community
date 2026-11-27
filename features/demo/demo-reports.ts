import type { ReportSearchInput } from "@/lib/search/candidates";
import { archiveFilename, archivePeriodRange, archiveQuery, archiveSubjectFor, type ArchiveFormat, type ArchiveKind } from "@/lib/workflow/report-archive";
import { type WorkflowPermissionAction, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import type { DemoDatabase } from "./demo-data";
import { customerTitle } from "@/lib/kfid/customer-name";

/**
 * Rapportarkiv i demon (2026-10-12, simulation: "ej tillgängligt i demon"): the demo company's finished jobs and
 * projects have saved reports, so the list and Sök can be tried. They are worked out from the invented data on every call
 * (a PDF for each finished job, the closed projects' reports and one Excel file); the files themselves are not made in the
 * demo, so opening or fetching one says so, like every other report. The same rule as the server: a person lists the reports
 * of the areas they may read.
 */
export type DemoArchiveContext = { db: DemoDatabase; user: { id: string }; admin: boolean; can: (subject: WorkflowPermissionSubject, action: WorkflowPermissionAction) => boolean };
type Entry = { id: string; kind: ArchiveKind; subject: WorkflowPermissionSubject; title: string; format: ArchiveFormat; filename: string; size: number; createdAt: string; createdById: string; taskId: string | null; projectId: string | null };

/** A steady, plausible file size from the id (the demo has no files). */
const sizeOf = (id: string, format: ArchiveFormat) => {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 100_000;
  return (format === "XLSX" ? 24_000 : 180_000) + hash * 3;
};

export function demoArchiveEntries(db: DemoDatabase): Entry[] {
  const entries: Entry[] = [];
  const add = (entry: Omit<Entry, "filename" | "size">) => entries.push({ ...entry, filename: archiveFilename(entry.title, entry.kind, entry.format), size: sizeOf(entry.id, entry.format) });
  for (const task of db.tasks) {
    if (task.status !== "COMPLETED" || !task.completedAt) continue;
    add({ id: `demo-report-${task.id}`, kind: task.kind, subject: archiveSubjectFor(task.kind), title: task.title, format: "PDF", createdAt: task.completedAt, createdById: task.assignedToUserId ?? task.createdBy, taskId: task.id, projectId: task.projectId });
  }
  db.projects.forEach((project, index) => {
    if (!project.closedAt && index > 0) return;
    const stamp = project.closedAt ?? project.updatedAt;
    add({ id: `demo-report-project-${project.id}`, kind: "PROJECT", subject: "projects", title: project.name, format: index === 0 ? "XLSX" : "PDF", createdAt: stamp, createdById: project.responsibleUserId ?? "demo-elna", taskId: null, projectId: project.id });
  });
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

const readable = (ctx: DemoArchiveContext, entries: Entry[]) => entries.filter((entry) => ctx.admin || ctx.can(entry.subject, "read"));

/** GET /api/report-archive: the same page, scope and search as lib/workflow/report-archive-server.ts. */
export function demoReportArchive(ctx: DemoArchiveContext, params: URLSearchParams) {
  const query = archiveQuery(params);
  const needle = query.q.toLocaleLowerCase("sv");
  const { from, before } = archivePeriodRange(query.period);
  const everyFormat = readable(ctx, demoArchiveEntries(ctx.db)).filter((entry) => (query.scope === "all" || entry.createdById === ctx.user.id) && (!needle || entry.title.toLocaleLowerCase("sv").includes(needle))
    && (query.kind === "all" || entry.kind === query.kind) && (!from || new Date(entry.createdAt) >= from) && (!before || new Date(entry.createdAt) < before));
  const formatted = everyFormat.filter((entry) => query.format === "all" || entry.format === query.format);
  const all = query.sort === "title" ? [...formatted].sort((a, b) => a.title.localeCompare(b.title, "sv")) : formatted;
  const start = query.cursor ? all.findIndex((entry) => entry.id === query.cursor) + 1 : 0;
  const page = all.slice(start, start + query.limit);
  return {
    items: page.map((entry) => ({ id: entry.id, kind: entry.kind, title: entry.title, format: entry.format, filename: entry.filename, size: entry.size, createdAt: entry.createdAt, taskId: entry.taskId, projectId: entry.projectId, createdByName: ctx.db.users.find((user) => user.id === entry.createdById)?.name ?? "Medarbetare", mine: entry.createdById === ctx.user.id, canDelete: false })),
    hasMore: start + query.limit < all.length, total: all.length, retentionMonths: null,
    counts: { all: everyFormat.length, PDF: everyFormat.filter((entry) => entry.format === "PDF").length, XLSX: everyFormat.filter((entry) => entry.format === "XLSX").length },
  };
}

/** The reports Sök reads in the demo, with the names around them (customer, project, place), only for the areas the person may read. */
export function demoReportSearchItems(ctx: DemoArchiveContext): (ReportSearchInput & { subject: WorkflowPermissionSubject })[] {
  return readable(ctx, demoArchiveEntries(ctx.db)).map((entry) => {
    const task = entry.taskId ? ctx.db.tasks.find((item) => item.id === entry.taskId) : undefined;
    const project = ctx.db.projects.find((item) => item.id === (entry.projectId ?? task?.projectId));
    const customer = ctx.db.customers.find((item) => item.id === (task?.customerId ?? project?.customerId));
    return {
      id: entry.id, subject: entry.subject, kind: entry.kind, title: entry.title, format: entry.format, filename: entry.filename, size: entry.size, createdAt: entry.createdAt,
      createdByName: ctx.db.users.find((user) => user.id === entry.createdById)?.name ?? "", customerName: customerTitle(customer) || "", projectName: project?.name ?? "",
      placePath: task?.facilityId ? ctx.db.facilities.find((item) => item.id === task.facilityId)?.name ?? "" : "", mine: entry.createdById === ctx.user.id, guaranteed: true,
    };
  });
}
