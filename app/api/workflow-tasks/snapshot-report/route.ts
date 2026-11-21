import { prisma } from "@/lib/db";
import { ApiError, checkOrigin, context, failureFor, requireCloudStorage, requireCloudWriteAccess, requireWorkflowPermission } from "@/lib/kfid/server";
import { archiveAfterExport } from "@/lib/workflow/report-archive-server";
import { bindFormTask } from "@/lib/kfid/form-server";
import { facilitySummarySelect, loadPlaceSummary } from "@/lib/kfid/facility-server";
import { workflowSubjectForTask } from "@/lib/workflow/permissions";
import { createWorkflowPdfReport, type WorkflowReportTask } from "@/lib/workflow/report";
import { createFormExcel } from "@/lib/workflow/form-excel";
import { workflowTaskInputSchema, workflowTaskProgress } from "@/lib/workflow/task-model";
import { projectFieldRows } from "@/lib/workflow/project-frame";
import { facilityLabel } from "@/lib/workflow/customer-facility";
import { cloudWorkflowReportTask, workflowReportFont, workflowReportHourlyRate, workflowReportIdentity, workflowReportOptionsFromUrl } from "@/lib/workflow/report-server";
import { readLimitedFormData } from "@/lib/security/limited-body";
import { canSeePrices } from "@/lib/workflow/material-prices";
import { customerTitle } from "@/lib/kfid/customer-name";

/**
 * A snapshot report (2026-09-30): the PDF or Excel of exactly what is on screen, also for a protocol that is not
 * saved or not finished – nothing is saved, so taking out a report never leaves a draft behind. The form version always
 * comes from the server, references are looked up within the company, and a saved task lends its pictures and reported
 * time. Sent as a form post so the PDF can open in a new tab.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    // A report by POST: it works for a paused company too (beslut 11); keeping it in the archive asks for write access below.
    const ctx = await context({ allowedWhenPaused: true }); requireCloudStorage(ctx);
    const form = await readLimitedFormData(request, 2_200_000);
    // `archive` (Rapportarkiv, 2026-10-07): keep a copy of the PDF or Excel that is made; a preview is never kept.
    const payload = JSON.parse(String(form.get("payload") ?? "{}")) as { task?: unknown; format?: string; inline?: boolean; sections?: string; archive?: boolean };
    const task = workflowTaskInputSchema.parse(payload.task);
    const saved = task.id ? await cloudWorkflowReportTask(ctx.organizationId, task.id) : null;
    if (task.id && !saved) throw new ApiError(404, "Uppgiften hittades inte.");
    const bound = await bindFormTask(ctx.organizationId, task);
    const subject = workflowSubjectForTask(task.kind, saved ? saved.formArea : bound.formArea);
    requireWorkflowPermission(ctx, subject, "report");

    const organizationId = ctx.organizationId;
    const [project, customer, facility, workOrder] = await Promise.all([
      task.projectId ? prisma.project.findFirst({ where: { id: task.projectId, organizationId }, select: { id: true, name: true, client: true, contactPerson: true, reference: true, workSite: true, staffRegister: true, description: true, facility: { select: facilitySummarySelect }, customer: { select: { name: true, company: true, customerType: true } } } }) : null,
      task.customerId ? prisma.customer.findFirst({ where: { id: task.customerId, organizationId, deletedAt: null }, select: { name: true, company: true, customerType: true } }) : null,
      // The place's whole way with the facility's address (Platser, 2026-10-04).
      loadPlaceSummary(organizationId, task.facilityId),
      // Hör till arbetsorder (Fas 4B): the work order's title on the report, inside the company.
      task.workOrderId ? prisma.workflowTask.findFirst({ where: { id: task.workOrderId, organizationId, kind: "WORK_ORDER" }, select: { title: true } }) : null,
    ]);
    const report: WorkflowReportTask = {
      // Kommentarer (beslut 14): those chosen "Med i kundrapporten", read from the saved order within the company.
      customerComments: saved?.customerComments,
      id: task.id ?? "ogonblicksbild",
      kind: task.kind,
      formArea: saved?.formArea ?? bound.formArea,
      title: task.title,
      description: task.description,
      status: task.status,
      progress: workflowTaskProgress(task),
      projectId: project?.id ?? null,
      projectName: project?.name,
      workOrderTitle: workOrder?.title || undefined,
      // Protokollmallen (beslut 6, 2026-11-01): the saved protocol's number and the receipt; an unsaved one has neither yet.
      protocolNumber: saved?.protocolNumber,
      completedAt: saved?.completedAt,
      customerReceipt: saved?.customerReceipt,
      projectFields: project ? projectFieldRows({ ...project, facility: (await loadPlaceSummary(organizationId, project.facility?.id)) ?? project.facility }) : undefined,
      customerName: customerTitle(customer),
      facilityName: facility ? facilityLabel(facility) : undefined,
      assignedToName: task.assignedToName,
      dueDate: task.dueDate,
      totalDurationSec: saved?.totalDurationSec ?? 0,
      // The saved task's time as the company bills it (beslut 8), the same as the report from the task itself.
      billedLabour: saved?.billedLabour,
      data: task.data,
      // The saved order's maintenance items (they are saved on their own, never part of the snapshot).
      maintenanceItems: saved?.maintenanceItems,
      attachments: saved?.attachments ?? [],
    };
    const identity = await workflowReportIdentity(organizationId, ctx.organization.name);
    const fileTitle = task.title.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-");
    if (payload.format === "xlsx" && report.data.kind === "FORM") {
      const workbook = await createFormExcel({ company: identity.company, branding: identity.branding, task: report, blank: false });
      const kept = await archiveAfterExport(ctx, { wanted: payload.archive === true && !payload.inline, writeAccess: () => requireCloudWriteAccess(ctx), kind: task.kind, subject, taskId: task.id ?? null, title: task.title, format: "XLSX", bytes: workbook });
      return new Response(new Uint8Array(workbook), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${fileTitle}.xlsx`)}`, "Cache-Control": "private, no-store", ...kept } });
    }
    const url = new URL(request.url);
    if (payload.sections) url.searchParams.set("sections", payload.sections);
    // Priser (2026-10-09): only for someone who may see prices, and then never kept in the shared report archive.
    const options = workflowReportOptionsFromUrl(url.toString(), canSeePrices({ admin: ctx.admin, permissions: ctx.workflowPermissions }));
    const bytes = await createWorkflowPdfReport({ ...identity, blank: false, tasks: [report], options, hourlyRate: await workflowReportHourlyRate(ctx.organizationId, options), fontBytes: await workflowReportFont() });
    const kept = await archiveAfterExport(ctx, { wanted: payload.archive === true && !payload.inline && !options.prices, writeAccess: () => requireCloudWriteAccess(ctx), kind: task.kind, subject, taskId: task.id ?? null, title: task.title, format: "PDF", bytes });
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${payload.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(`${fileTitle}-rapport.pdf`)}`, "Cache-Control": "private, no-store", ...kept } });
  } catch (error) { return failureFor(request, error); }
}
