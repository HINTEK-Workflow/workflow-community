import { prisma } from "@/lib/db";
import { ApiError, checkOrigin, context, failure, requireCloudStorage, requireWorkflowPermission } from "@/lib/kfid/server";
import { bindFormTask } from "@/lib/kfid/form-server";
import { facilitySummarySelect } from "@/lib/kfid/facility-server";
import { workflowSubjectForTask } from "@/lib/workflow/permissions";
import { createWorkflowPdfReport, type WorkflowReportTask } from "@/lib/workflow/report";
import { createFormExcel } from "@/lib/workflow/form-excel";
import { workflowTaskInputSchema, workflowTaskProgress } from "@/lib/workflow/task-model";
import { projectFieldRows } from "@/lib/workflow/project-frame";
import { facilityLabel } from "@/lib/workflow/customer-facility";
import { cloudWorkflowReportTask, workflowReportFont, workflowReportIdentity, workflowReportOptionsFromUrl } from "@/lib/workflow/report-server";

/**
 * A snapshot report (2026-09-30): the PDF or Excel of exactly what is on screen, also for a protocol that is not
 * saved or not finished – nothing is saved, so taking out a report never leaves a draft behind. The form version always
 * comes from the server, references are looked up within the company, and a saved task lends its pictures and reported
 * time. Sent as a form post so the PDF can open in a new tab.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context(); requireCloudStorage(ctx);
    const form = await request.formData();
    const payload = JSON.parse(String(form.get("payload") ?? "{}")) as { task?: unknown; format?: string; inline?: boolean; sections?: string };
    const task = workflowTaskInputSchema.parse(payload.task);
    const saved = task.id ? await cloudWorkflowReportTask(ctx.organizationId, task.id) : null;
    if (task.id && !saved) throw new ApiError(404, "Uppgiften hittades inte.");
    const bound = await bindFormTask(ctx.organizationId, task);
    const subject = workflowSubjectForTask(task.kind, saved ? saved.formArea : bound.formArea);
    requireWorkflowPermission(ctx, subject, "report");

    const organizationId = ctx.organizationId;
    const [project, customer, facility, site] = await Promise.all([
      task.projectId ? prisma.project.findFirst({ where: { id: task.projectId, organizationId }, select: { id: true, name: true, client: true, contactPerson: true, reference: true, workSite: true, description: true, facility: { select: facilitySummarySelect } } }) : null,
      task.customerId ? prisma.customer.findFirst({ where: { id: task.customerId, organizationId, deletedAt: null }, select: { name: true, company: true } }) : null,
      task.facilityId ? prisma.customerFacility.findFirst({ where: { id: task.facilityId, organizationId }, select: facilitySummarySelect }) : null,
      task.siteId ? prisma.site.findFirst({ where: { id: task.siteId, organizationId }, select: { name: true } }) : null,
    ]);
    const report: WorkflowReportTask = {
      id: task.id ?? "ogonblicksbild",
      kind: task.kind,
      formArea: saved?.formArea ?? bound.formArea,
      title: task.title,
      description: task.description,
      status: task.status,
      progress: workflowTaskProgress(task),
      projectId: project?.id ?? null,
      projectName: project?.name,
      projectFields: project ? projectFieldRows(project) : undefined,
      customerName: customer?.company || customer?.name,
      siteName: site?.name,
      facilityName: facility ? facilityLabel(facility) : undefined,
      assignedToName: task.assignedToName,
      dueDate: task.dueDate,
      totalDurationSec: saved?.totalDurationSec ?? 0,
      data: task.data,
      attachments: saved?.attachments ?? [],
    };
    const identity = await workflowReportIdentity(organizationId, ctx.organization.name);
    const fileTitle = task.title.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-");
    if (payload.format === "xlsx" && report.data.kind === "FORM") {
      const workbook = await createFormExcel({ company: identity.company, branding: identity.branding, task: report, blank: false });
      return new Response(new Uint8Array(workbook), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${fileTitle}.xlsx`)}`, "Cache-Control": "private, no-store" } });
    }
    const url = new URL(request.url);
    if (payload.sections) url.searchParams.set("sections", payload.sections);
    const bytes = await createWorkflowPdfReport({ ...identity, blank: false, tasks: [report], options: workflowReportOptionsFromUrl(url.toString()), fontBytes: await workflowReportFont() });
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${payload.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(`${fileTitle}-rapport.pdf`)}`, "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
