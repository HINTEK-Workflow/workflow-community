import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, body, checkOrigin, context, failure, requireCloudStorage, requireWorkflowPermission } from "@/lib/kfid/server";
import { prisma } from "@/lib/db";
import { mailConfig } from "@/lib/mail/settings-server";
import { sendSystemEmail } from "@/lib/mail/mailer";
import { workflowSubjectForTask } from "@/lib/workflow/permissions";
import { createWorkflowPdfReport, defaultWorkflowReportOptions } from "@/lib/workflow/report";
import { cloudWorkflowReportTask, workflowReportFont, workflowReportIdentity } from "@/lib/workflow/report-server";

// One mail per task and minute (per process): a protection against a double click, not a quota.
const lastSent = new Map<string, number>();
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Skicka med e-post (2026-10-02): the saved task's report as a PDF to one recipient, from the foot of every
 * control. The same report right as taking the PDF out; the recipient needs no account. What was sent to whom is
 * written to the administration history, never the content.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const ctx = await context(); requireCloudStorage(ctx);
    const { id } = await params;
    const input = z.object({ email: z.email().max(254), message: z.string().trim().max(2000).optional() }).parse(await body(request));
    const task = await cloudWorkflowReportTask(ctx.organizationId, id);
    if (!task) throw new ApiError(404, "Uppgiften hittades inte.");
    requireWorkflowPermission(ctx, workflowSubjectForTask(task.kind, task.formArea), "report");
    const config = await mailConfig();
    if (config.blockedReason) throw new ApiError(409, config.blockedReason);
    const key = `${ctx.organizationId}:${id}`;
    if (Date.now() - (lastSent.get(key) ?? 0) < 60_000) throw new ApiError(429, "Vänta en minut innan du skickar igen.");
    const identity = await workflowReportIdentity(ctx.organizationId, ctx.organization.name);
    const bytes = await createWorkflowPdfReport({ ...identity, blank: false, tasks: [task], options: defaultWorkflowReportOptions, fontBytes: await workflowReportFont() });
    const kind = task.data.kind === "FORM" ? task.data.details.templateName : task.kind === "WORK_ORDER" ? "Arbetsorder" : "Riskbedömning";
    const draft = task.status === "COMPLETED" ? "" : "\n\nObservera: uppgiften är inte slutförd. Rapporten är märkt som ej slutförd.";
    const sender = ctx.user.name?.trim() || "En medarbetare";
    const text = `${sender} på ${identity.company} skickar ${kind}: ${task.title}.${input.message ? `\n\n${input.message}` : ""}\n\nRapporten är bifogad som PDF.${draft}`;
    lastSent.set(key, Date.now());
    await sendSystemEmail({
      to: input.email,
      subject: `${kind}: ${task.title} – ${identity.company}`.slice(0, 200),
      text,
      html: `<p>${escape(text).replace(/\n/g, "<br>")}</p>`,
      attachments: [{ filename: `${task.title.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").slice(0, 120) || "rapport"}-rapport.pdf`, content: Buffer.from(bytes), contentType: "application/pdf" }],
    });
    await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "task_report_sent", detail: `Skickade rapporten för ${kind} till ${input.email}`.slice(0, 500) } });
    return NextResponse.json({ ok: true });
  } catch (error) { return failure(error); }
}
