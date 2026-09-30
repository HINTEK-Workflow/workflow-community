import { ApiError, context, failure, requireCloudStorage, requireWorkflowPermission } from "@/lib/kfid/server";
import { workflowSubjectForTask } from "@/lib/workflow/permissions";
import { createWorkflowPdfReport } from "@/lib/workflow/report";
import { createFormExcel } from "@/lib/workflow/form-excel";
import { cloudWorkflowReportTask, workflowReportFont, workflowReportIdentity, workflowReportOptionsFromUrl } from "@/lib/workflow/report-server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await context(); requireCloudStorage(ctx);
    const { id } = await params;
    const task = await cloudWorkflowReportTask(ctx.organizationId, id);
    if (!task) throw new ApiError(404, "Uppgiften hittades inte.");
    requireWorkflowPermission(ctx, workflowSubjectForTask(task.kind, task.formArea), "report");
    const identity = await workflowReportIdentity(ctx.organizationId, ctx.organization.name);
    // A protocol can also be taken out as Excel or as the empty form to fill in by hand, like the control (2026-09-27).
    const query = new URL(request.url).searchParams;
    const blank = query.get("blank") === "1" && task.data.kind === "FORM";
    if (query.get("format") === "xlsx" && task.data.kind === "FORM") {
      const workbook = await createFormExcel({ company: identity.company, branding: identity.branding, task, blank });
      return new Response(new Uint8Array(workbook), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${blank ? `${task.data.details.templateName}-tom-mall` : task.title}.xlsx`)}`, "Cache-Control": "private, no-store" } });
    }
    const bytes = await createWorkflowPdfReport({ ...identity, blank, tasks: [task], options: workflowReportOptionsFromUrl(request.url), fontBytes: await workflowReportFont() });
    // "Förhandsgranska / skriv ut" shows the PDF in the browser's own viewer (inline=1), like the control; otherwise it downloads.
    const disposition = query.get("inline") === "1" ? "inline" : "attachment";
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(`${task.title}-${blank ? "tom-mall" : "rapport"}.pdf`)}`, "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
