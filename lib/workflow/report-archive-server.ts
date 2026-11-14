import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { read, remove, store } from "@/lib/kfid/storage";
import { hasWorkflowPermission, WORKFLOW_PERMISSION_SUBJECTS, type WorkflowPermissionProfile, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import {
  ARCHIVE_EXTENSION,
  ARCHIVE_MAX_ENTRIES,
  ARCHIVE_MIME,
  archiveFilename,
  archiveProblem,
  archiveReadableSubjects,
  type archiveQuery,
  type ArchiveFormat,
  type ArchiveKind,
  archivePeriodRange,
} from "@/lib/workflow/report-archive";
import { customerTitle } from "@/lib/kfid/customer-name";

/**
 * Rapportarkiv (2026-10-07): the server side. A report is kept as an ordinary file in the storage and a row that
 * says what it reports, who made it and which permission area may read it. Everything is bound to one company; a report is
 * read by those who may read what it is a report of (checked again at every read, so a person who loses the permission
 * loses the reports too), and removed by the person who kept it or an admin. The company's history time decides how long
 * it is kept (history:retention).
 */
export type ArchiveContext = { organizationId: string; admin: boolean; workflowPermissions: WorkflowPermissionProfile; user: { id: string } };

const canRead = (ctx: ArchiveContext, subject: string) =>
  ctx.admin || ((WORKFLOW_PERMISSION_SUBJECTS as readonly string[]).includes(subject) && hasWorkflowPermission(ctx.workflowPermissions, subject as WorkflowPermissionSubject, "read"));

export type ArchiveInput = { kind: ArchiveKind; subject: WorkflowPermissionSubject; taskId?: string | null; projectId?: string | null; title: string; format: ArchiveFormat; bytes: Uint8Array };

/** Keeps a report: the file first, then its row; a row that cannot be written takes the file with it. */
export async function archiveReport(ctx: Pick<ArchiveContext, "organizationId" | "user">, input: ArchiveInput) {
  const problem = archiveProblem(input.bytes, input.format);
  if (problem) throw new ApiError(400, problem);
  if (await prisma.reportArchiveEntry.count({ where: { organizationId: ctx.organizationId } }) >= ARCHIVE_MAX_ENTRIES)
    throw new ApiError(409, "Rapportarkivet är fullt. Ta bort äldre rapporter först.");
  const storagePath = await store(input.bytes, ARCHIVE_EXTENSION[input.format]);
  try {
    return await prisma.reportArchiveEntry.create({
      data: {
        organizationId: ctx.organizationId, kind: input.kind, subject: input.subject, taskId: input.taskId ?? null, projectId: input.projectId ?? null,
        title: input.title.slice(0, 200), format: input.format, filename: archiveFilename(input.title, input.kind, input.format), storagePath,
        mimeType: ARCHIVE_MIME[input.format], size: input.bytes.length, createdById: ctx.user.id,
      },
      select: { id: true },
    });
  } catch (error) {
    await remove(storagePath);
    throw error;
  }
}

/**
 * Keeps the report an export just made, if the person asked for it, and says so in headers the page can read: the id of
 * the new entry, or why it was not kept. Never stops the export itself – the file is returned either way.
 */
export async function archiveAfterExport(ctx: Pick<ArchiveContext, "organizationId" | "user">, input: ArchiveInput & { wanted: boolean; writeAccess: () => Promise<unknown> }): Promise<Record<string, string>> {
  if (!input.wanted) return {};
  try {
    await input.writeAccess();
    return { "X-Report-Archive": (await archiveReport(ctx, input)).id };
  } catch (error) {
    return { "X-Report-Archive-Error": encodeURIComponent(error instanceof ApiError ? error.message : "Rapporten kunde inte sparas i arkivet.") };
  }
}

/** The reports the person may read, newest first, a page at a time. Mina = the ones they kept themselves. */
export async function listArchive(ctx: ArchiveContext, query: ReturnType<typeof archiveQuery>) {
  const subjects = archiveReadableSubjects((subject) => canRead(ctx, subject));
  if (!subjects.length) return { items: [], hasMore: false, total: 0, counts: { all: 0, PDF: 0, XLSX: 0 } };
  const { from, before } = archivePeriodRange(query.period);
  // Everything but the format: the chips count from this, with the same permission and company as the list.
  const everyFormat = {
    organizationId: ctx.organizationId, subject: { in: subjects },
    ...(query.scope === "mine" ? { createdById: ctx.user.id } : {}),
    ...(query.q ? { title: { contains: query.q, mode: "insensitive" as const } } : {}),
    ...(query.kind !== "all" ? { kind: query.kind } : {}),
    ...(from || before ? { createdAt: { ...(from ? { gte: from } : {}), ...(before ? { lt: before } : {}) } } : {}),
  };
  const where = { ...everyFormat, ...(query.format !== "all" ? { format: query.format } : {}) };
  const [rows, total, formats] = await Promise.all([
    prisma.reportArchiveEntry.findMany({
      where, orderBy: query.sort === "title" ? [{ title: "asc" }, { id: "desc" }] : [{ createdAt: "desc" }, { id: "desc" }], take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: { id: true, kind: true, title: true, format: true, filename: true, size: true, createdAt: true, createdById: true, taskId: true, projectId: true },
    }),
    prisma.reportArchiveEntry.count({ where }),
    prisma.reportArchiveEntry.groupBy({ by: ["format"], where: everyFormat, _count: { _all: true } }),
  ]);
  const page = rows.slice(0, query.limit);
  const people = page.length ? await prisma.user.findMany({ where: { id: { in: [...new Set(page.map((row) => row.createdById))] } }, select: { id: true, name: true } }) : [];
  const names = new Map(people.map((person) => [person.id, person.name?.trim() || "Medarbetare"]));
  // The customer and the project (the plan's DO17), read for the page only and only within the company; the report the
  // person may read already says them.
  const taskIds = [...new Set(page.flatMap((row) => row.taskId ? [row.taskId] : []))];
  const projectIds = [...new Set(page.flatMap((row) => row.projectId ? [row.projectId] : []))];
  const customer = { select: { name: true, company: true, customerType: true } } as const;
  const [tasks, projects] = await Promise.all([
    taskIds.length ? prisma.workflowTask.findMany({ where: { id: { in: taskIds }, organizationId: ctx.organizationId }, select: { id: true, customer, project: { select: { name: true, customer } } } }) : [],
    projectIds.length ? prisma.project.findMany({ where: { id: { in: projectIds }, organizationId: ctx.organizationId }, select: { id: true, name: true, customer } }) : [],
  ]);
  const taskOf = new Map(tasks.map((task) => [task.id, task]));
  const projectOf = new Map(projects.map((project) => [project.id, project]));
  return {
    items: page.map(({ createdById, createdAt, ...row }) => ({
      ...row, createdAt: createdAt.toISOString(), createdByName: names.get(createdById) ?? "Medarbetare",
      customerName: customerTitle((row.taskId ? taskOf.get(row.taskId)?.customer ?? taskOf.get(row.taskId)?.project?.customer : null) ?? (row.projectId ? projectOf.get(row.projectId)?.customer : null)),
      projectName: (row.taskId ? taskOf.get(row.taskId)?.project?.name : null) ?? (row.projectId ? projectOf.get(row.projectId)?.name : null) ?? "",
      mine: createdById === ctx.user.id, canDelete: ctx.admin || createdById === ctx.user.id,
    })),
    hasMore: rows.length > query.limit, total,
    counts: { all: formats.reduce((sum, row) => sum + row._count._all, 0), PDF: formats.find((row) => row.format === "PDF")?._count._all ?? 0, XLSX: formats.find((row) => row.format === "XLSX")?._count._all ?? 0 },
  };
}

/** A report's file, for the person who may read it; anyone else (another company, another area) is told it does not exist. */
export async function readArchive(ctx: ArchiveContext, id: string) {
  const entry = await prisma.reportArchiveEntry.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!entry || !canRead(ctx, entry.subject)) throw new ApiError(404, "Rapporten finns inte.");
  const bytes = await read(entry.storagePath).catch(() => null);
  if (!bytes) throw new ApiError(404, "Filen finns inte längre.");
  return { entry, bytes };
}

/** Removes a report: by the person who kept it, or an admin. The row and the file go together. */
export async function removeArchive(ctx: ArchiveContext, id: string) {
  const entry = await prisma.reportArchiveEntry.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!entry || !canRead(ctx, entry.subject)) throw new ApiError(404, "Rapporten finns inte.");
  if (!ctx.admin && entry.createdById !== ctx.user.id) throw new ApiError(403, "Du kan bara ta bort rapporter som du själv har sparat.");
  await prisma.reportArchiveEntry.delete({ where: { id: entry.id } });
  await remove(entry.storagePath);
  return entry;
}

/** The company's reports older than the cutoff, with their files (history:retention: as long as the company's history). */
export async function purgeReportArchive(organizationId: string, before: Date) {
  let removed = 0;
  for (;;) {
    const batch = await prisma.reportArchiveEntry.findMany({ where: { organizationId, createdAt: { lt: before } }, select: { id: true, storagePath: true }, take: 200 });
    if (!batch.length) return removed;
    await prisma.reportArchiveEntry.deleteMany({ where: { id: { in: batch.map((row) => row.id) } } });
    for (const row of batch) await remove(row.storagePath);
    removed += batch.length;
  }
}
