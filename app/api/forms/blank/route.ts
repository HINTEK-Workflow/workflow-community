import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, context, failure, requireCloudStorage, requireWorkflowPermission } from "@/lib/kfid/server";
import { formDocumentSchema, initialFormValues } from "@/lib/workflow/form-document";
import { createFormExcel } from "@/lib/workflow/form-excel";
import { workflowSubjectForTask } from "@/lib/workflow/permissions";
import { createWorkflowPdfReport, defaultWorkflowReportOptions, type WorkflowReportTask } from "@/lib/workflow/report";
import { workflowReportFont, workflowReportIdentity } from "@/lib/workflow/report-server";

export const dynamic = "force-dynamic";
const identifier = z.string().min(1).max(100);

/**
 * The empty form to fill in by hand, as PDF or Excel (Daniel 2026-09-28: a template needs no saved protocol – the
 * conditions belong to sending, not to the template). Any member who may take out reports for the form's area gets
 * the published version's blank form with the company's report colours and logo; nothing is stored.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context(); requireCloudStorage(ctx);
    const query = new URL(request.url).searchParams;
    const templateId = identifier.parse(query.get("id"));
    const version = z.coerce.number().int().positive().parse(query.get("version"));
    const row = await prisma.formTemplateVersion.findUnique({ where: { templateId_version: { templateId, version } }, include: { template: { select: { organizationId: true, permissionArea: true } } } });
    if (!row || (row.template.organizationId && row.template.organizationId !== ctx.organizationId)) throw new ApiError(404, "Formuläret hittades inte.");
    requireWorkflowPermission(ctx, workflowSubjectForTask("FORM", row.template.permissionArea), "report");
    const document = formDocumentSchema.parse(row.document);
    const name = row.displayName || row.name;
    const task: WorkflowReportTask = {
      id: "blank", kind: "FORM", formArea: row.template.permissionArea, title: name, description: "", status: "PLANNED", progress: 0, assignedToName: "", dueDate: "", totalDurationSec: 0, attachments: [],
      data: { kind: "FORM", details: { templateName: name, templateVersion: version, document, values: initialFormValues(document) } },
    };
    const identity = await workflowReportIdentity(ctx.organizationId, ctx.organization.name);
    const filename = `${name}-tom-mall`;
    if (query.get("format") === "xlsx") {
      const workbook = await createFormExcel({ company: identity.company, branding: identity.branding, task, blank: true });
      return new Response(new Uint8Array(workbook), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${filename}.xlsx`)}`, "Cache-Control": "private, no-store" } });
    }
    const bytes = await createWorkflowPdfReport({ ...identity, blank: true, tasks: [task], options: defaultWorkflowReportOptions, fontBytes: await workflowReportFont() });
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${query.get("inline") === "1" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(`${filename}.pdf`)}`, "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
