import { facilitySummarySelect } from "@/lib/kfid/facility-server";
import { PDFDocument, rgb } from "pdf-lib";
import { stampContinuousFooter } from "@/lib/workflow/report-merge";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, context, failure, requireCloudStorage, requireWorkflowPermission } from "@/lib/kfid/server";
import { workflowSubjectForTask } from "@/lib/workflow/permissions";
import { normalizeControl } from "@/lib/kfid/model";
import { pdfReport } from "@/lib/kfid/reports";
import { createWorkflowPdfReport } from "@/lib/workflow/report";
import { projectFieldRows } from "@/lib/workflow/project-frame";
import { cloudWorkflowReportTask, workflowReportFont, workflowReportIdentity, workflowReportOptionsFromUrl } from "@/lib/workflow/report-server";

const selections = z.object({
  taskIds: z.string().max(10_000).optional().transform((value) => value?.split(",").filter(Boolean).slice(0, 100) ?? []),
  controlIds: z.string().max(10_000).optional().transform((value) => value?.split(",").filter(Boolean).slice(0, 100) ?? []),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await context(); requireCloudStorage(ctx);
    requireWorkflowPermission(ctx, "projects", "report");
    const { id } = await params;
    const query = selections.parse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.taskIds.length && !query.controlIds.length) throw new ApiError(400, "Välj minst en uppgift till rapporten.");
    const project = await prisma.project.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { id: true, name: true, client: true, contactPerson: true, reference: true, workSite: true, description: true, facility: { select: facilitySummarySelect } } });
    if (!project) throw new ApiError(404, "Projektet hittades inte.");
    const [tasks, controls, settings, fontBytes] = await Promise.all([
      Promise.all(query.taskIds.map((taskId) => cloudWorkflowReportTask(ctx.organizationId, taskId))),
      prisma.control.findMany({ where: { id: { in: query.controlIds }, projectId: project.id, organizationId: ctx.organizationId, deletedAt: null }, include: { attachments: true } }),
      prisma.workspaceSettings.findUnique({ where: { organizationId: ctx.organizationId } }),
      workflowReportFont(),
    ]);
    const workflowTasks = tasks.filter((task): task is NonNullable<typeof task> => Boolean(task?.projectId === project.id));
    if (workflowTasks.length !== query.taskIds.length || controls.length !== query.controlIds.length) throw new ApiError(400, "En vald uppgift tillhör inte projektet.");
    for (const task of workflowTasks) requireWorkflowPermission(ctx, workflowSubjectForTask(task.kind, task.formArea), "report");
    if (controls.length) requireWorkflowPermission(ctx, "kfid", "report");
    const result = await PDFDocument.create();
    // Protocols follow as their own PDFs in the control's look, like the controls (Daniel 2026-09-27).
    const protocols = workflowTasks.filter((task) => task.kind === "FORM");
    // The cover lists every chosen task and draws the work orders; the protocols follow as their own parts. Both in the
    // company's report colours and logo (2026-09-30).
    const identity = await workflowReportIdentity(ctx.organizationId, ctx.organization.name);
    const options = workflowReportOptionsFromUrl(request.url);
    const workflowBytes = await createWorkflowPdfReport({ ...identity, title: "Projektrapport", projectName: project.name, projectFields: projectFieldRows(project), taskCount: workflowTasks.length, tasks: workflowTasks, options, fontBytes });
    const workflowPdf = await PDFDocument.load(workflowBytes);
    for (const page of await result.copyPages(workflowPdf, workflowPdf.getPageIndices())) result.addPage(page);
    for (const task of protocols) {
      const source = await PDFDocument.load(await createWorkflowPdfReport({ ...identity, tasks: [task], options, fontBytes }));
      for (const page of await result.copyPages(source, source.getPageIndices())) result.addPage(page);
    }
    for (const control of controls.sort((a, b) => query.controlIds.indexOf(a.id) - query.controlIds.indexOf(b.id))) {
      const bytes = await pdfReport(normalizeControl(control.data), { company: settings?.companyName || ctx.organization.name, branding: { primary: settings?.reportPrimary, accent: settings?.reportAccent, soft: settings?.reportSoft }, logoPath: settings?.logoPath }, control.attachments);
      const source = await PDFDocument.load(bytes);
      const copied = await result.copyPages(source, source.getPageIndices());
      if (control.status !== "COMPLETED") for (const page of copied) page.drawText("UTKAST – EJ SLUTFÖRD", { x: 390, y: 812, size: 9, color: rgb(0.65, 0.35, 0.02) });
      copied.forEach((page) => result.addPage(page));
    }
    await stampContinuousFooter(result, { fontBytes, left: `HINTEK Workflow · Projektrapport · ${project.name}`, company: settings?.companyName || ctx.organization.name });
    const bytes = await result.save();
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${project.name}-projektrapport.pdf`)}`, "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
