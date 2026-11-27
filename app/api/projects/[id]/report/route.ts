import { facilitySummarySelect, loadPlaceSummary } from "@/lib/kfid/facility-server";
import { PDFDocument } from "pdf-lib";
import { projectReportFooterLeft, projectReportMetadata, stampContinuousFooter } from "@/lib/workflow/report-merge";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, context, failureFor, requireCloudStorage, requireCloudWriteAccess, requireWorkflowPermission } from "@/lib/kfid/server";
import { archiveAfterExport } from "@/lib/workflow/report-archive-server";
import { workflowSubjectForTask } from "@/lib/workflow/permissions";
import { createWorkflowPdfReport } from "@/lib/workflow/report";
import { customerComments } from "@/lib/comments/server";
import { projectFieldRows } from "@/lib/workflow/project-frame";
import { recordFeature } from "@/lib/analytics/record";
import { canSeePrices } from "@/lib/workflow/material-prices";
import { cloudWorkflowReportTask, workflowReportFont, workflowReportHourlyRate, workflowReportIdentity, workflowReportOptionsFromUrl } from "@/lib/workflow/report-server";

const selections = z.object({
  taskIds: z.string().max(10_000).optional().transform((value) => value?.split(",").filter(Boolean).slice(0, 100) ?? []),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await context(); requireCloudStorage(ctx);
    requireWorkflowPermission(ctx, "projects", "report");
    const { id } = await params;
    const query = selections.parse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.taskIds.length) throw new ApiError(400, "Välj minst en uppgift till rapporten.");
    const project = await prisma.project.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { id: true, name: true, client: true, contactPerson: true, reference: true, workSite: true, staffRegister: true, description: true, facility: { select: facilitySummarySelect }, customer: { select: { name: true, company: true, customerType: true } } } });
    if (!project) throw new ApiError(404, "Projektet hittades inte.");
    // The project's place with its whole way (Platser, 2026-10-04).
    if (project.facility) project.facility = (await loadPlaceSummary(ctx.organizationId, project.facility.id)) ?? project.facility;
    const [tasks, settings, fontBytes] = await Promise.all([
      Promise.all(query.taskIds.map((taskId) => cloudWorkflowReportTask(ctx.organizationId, taskId))),
      prisma.workspaceSettings.findUnique({ where: { organizationId: ctx.organizationId } }),
      workflowReportFont(),
    ]);
    const workflowTasks = tasks.filter((task): task is NonNullable<typeof task> => Boolean(task?.projectId === project.id));
    if (workflowTasks.length !== query.taskIds.length) throw new ApiError(400, "En vald uppgift tillhör inte projektet.");
    for (const task of workflowTasks) requireWorkflowPermission(ctx, workflowSubjectForTask(task.kind, task.formArea), "report");
    recordFeature("report_pdf", ctx.analytics);
    const result = await PDFDocument.create();
    // Protocols follow as their own PDFs in the control's look (2026-09-27).
    const protocols = workflowTasks.filter((task) => task.kind === "FORM");
    // The cover lists every chosen task and draws the work orders; the protocols follow as their own parts. Both in the
    // company's report colours and logo (2026-09-30).
    const identity = await workflowReportIdentity(ctx.organizationId, ctx.organization.name);
    // Priser (2026-10-09): only for someone who may see prices, and then never kept in the shared report archive.
    const options = workflowReportOptionsFromUrl(request.url, canSeePrices({ admin: ctx.admin, permissions: ctx.workflowPermissions }));
    const hourlyRate = await workflowReportHourlyRate(ctx.organizationId, options);
    // The title is the PDF template's ("Projektrapport" by default).
    const workflowBytes = await createWorkflowPdfReport({ ...identity, projectName: project.name, projectFields: projectFieldRows(project), projectComments: await customerComments(ctx.organizationId, { type: "PROJECT", id: project.id }), taskCount: workflowTasks.length, tasks: workflowTasks, options, hourlyRate, fontBytes });
    const workflowPdf = await PDFDocument.load(workflowBytes);
    for (const page of await result.copyPages(workflowPdf, workflowPdf.getPageIndices())) result.addPage(page);
    // The sender box stands once, on the cover; the protocols inside the project report leave it out (PDF review
    // 2026-11-03, finding 7). A protocol taken out on its own keeps it.
    for (const task of protocols) {
      const source = await PDFDocument.load(await createWorkflowPdfReport({ ...identity, sender: null, tasks: [task], options, hourlyRate, fontBytes }));
      for (const page of await result.copyPages(source, source.getPageIndices())) result.addPage(page);
    }
    projectReportMetadata(result, { projectName: project.name, company: identity.company });
    await stampContinuousFooter(result, { fontBytes, left: projectReportFooterLeft(project.name, new Date(), identity.templates), templates: identity.templates, company: settings?.companyName || ctx.organization.name });
    const bytes = await result.save();
    // Rapportarkiv (2026-10-07): `archive=1` keeps a copy of the report that is made.
    const kept = await archiveAfterExport(ctx, { wanted: new URL(request.url).searchParams.get("archive") === "1" && !options.prices, writeAccess: () => requireCloudWriteAccess(ctx), kind: "PROJECT", subject: "projects", projectId: project.id, title: project.name, format: "PDF", bytes });
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${project.name}-projektrapport.pdf`)}`, "Cache-Control": "private, no-store", ...kept } });
  } catch (error) { return failureFor(request, error); }
}
