import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { formDocumentSchema, type FormDocument } from "@/lib/workflow/form-document";
import { formDisplayName, formMetaSchema, type FormMeta } from "@/lib/workflow/form-publish";
import { formProgress, formValuesSchema, initialFormValues } from "@/lib/workflow/form-document";
import { createWorkflowPdfReport, defaultWorkflowReportOptions } from "@/lib/workflow/report";
import { workflowReportFont } from "@/lib/workflow/report-server";
import { sampleFormValues } from "@/lib/workflow/form-sample";

/**
 * The editor's PDF preview: the real report engine with example answers (or empty fields), marked as a preview.
 * Nothing is stored and no customer data is involved.
 */
export async function formPreviewPdf(input: { meta: unknown; document: unknown; values?: unknown; blank?: boolean; sample?: boolean }) {
  const parsed = formDocumentSchema.safeParse(input.document);
  if (!parsed.success) throw new ApiError(400, "Formuläret kunde inte förhandsgranskas.");
  const document = parsed.data;
  const values = input.values !== undefined ? formValuesSchema.parse(input.values) : input.sample ? sampleFormValues(document) : initialFormValues(document);
  const name = formDisplayName(formMetaSchema.parse(input.meta ?? {}));
  const bytes = await createWorkflowPdfReport({
    company: "Förhandsgranskning – exempeldata", fontBytes: await workflowReportFont(), options: defaultWorkflowReportOptions, blank: input.blank === true,
    tasks: [{ id: "preview", kind: "FORM", title: name, description: "", status: "IN_PROGRESS", progress: formProgress("IN_PROGRESS", document, values), assignedToName: "", dueDate: "", totalDurationSec: 0, attachments: [],
      data: { kind: "FORM", details: { templateName: name, templateVersion: 1, document, values } } }],
  });
  return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=\"forhandsgranskning.pdf\"", "Cache-Control": "no-store" } });
}
import type { Context } from "@/lib/kfid/server";
import { publisherLabel } from "@/lib/kfid/form-share";
import { publicInstance } from "@/lib/instance";

/**
 * Who builds forms, and whose forms (Daniel 2026-09-27, replacing "HINTEK only"): HINTEK's superadmin builds HINTEK's
 * forms, shown to every company; a company admin in HINTEK Cloud builds the company's own forms, shown only there.
 * Employees never build forms. Every query in the form builder is limited to the returned scope.
 */
export type FormScope = { organizationId: string | null; publisherName: string; hintek: boolean };
export function requireFormAdmin(ctx: Context): FormScope {
  if (ctx.user.role === "SUPERADMIN") return { organizationId: null, publisherName: publicInstance().operator, hintek: true };
  if (ctx.admin && ctx.organization.storageMode === "HINTEK_CLOUD") return { organizationId: ctx.organizationId, publisherName: ctx.organization.name, hintek: false };
  throw new ApiError(403, "Bara företagets administratör kan skapa och publicera formulär.");
}
/** The forms a company may use: HINTEK's and its own. */
export const visibleFormsWhere = (organizationId: string) => ({ OR: [{ organizationId: null }, { organizationId }] });

export const formDocumentHash = (document: FormDocument) => createHash("sha256").update(JSON.stringify(document)).digest("hex");

/**
 * The hash of a stored document read with today's schema. Published versions keep the hash they were stored with, but
 * new optional properties get defaults when read, so comparisons always hash both sides the same way.
 */
export const currentDocumentHash = (document: unknown) => formDocumentHash(formDocumentSchema.parse(document));

type MetaRow = { name: string; displayName?: string; description: string; internalNote?: string; color: string; icon?: string; category?: string; allowStandalone?: boolean; allowInProject?: boolean };
/** The basic details of a template or a version row. A version has no internal note: it is never shown to customers. */
export const formMetaOf = (row: MetaRow): FormMeta => formMetaSchema.parse({ ...row, internalNote: row.internalNote ?? "" });
/** The details that are published with a version (everything but the internal note). */
export const publishedMetaEqual = (a: FormMeta, b: FormMeta) => (["name", "displayName", "description", "color", "icon", "category", "allowStandalone", "allowInProject"] as const).every((key) => a[key] === b[key]);

type FormTask = { id?: string; kind: string; projectId?: string | null; data: { kind: string; details: unknown } };

/**
 * Binds a protocol to its template version before it is validated or stored. The server never trusts the document a
 * client sends: it always uses the stored, immutable version. A new protocol may only use the currently published
 * version; an existing one keeps the version it was created from, even after the form was changed or unpublished.
 * It also gives the protocol's permission area (Daniel 2026-09-27): the form's for a new protocol, the stored one after.
 */
export async function bindFormTask(organizationId: string, task: FormTask): Promise<{ formTemplateId: string | null; formTemplateVersion: number | null; formArea: string | null }> {
  if (task.kind !== "FORM" || task.data.kind !== "FORM") return { formTemplateId: null, formTemplateVersion: null, formArea: null };
  const details = task.data.details as { templateId: string; templateVersion: number; templateName: string; document: FormDocument; values: unknown };
  const existing = task.id ? await prisma.workflowTask.findFirst({ where: { id: task.id, organizationId }, select: { kind: true, formTemplateId: true, formTemplateVersion: true, formArea: true, data: true } }) : null;
  // A protocol whose form was deleted keeps the copy of the form it was stored with (Daniel 2026-09-26); the client's
  // document is still never trusted.
  if (existing?.kind === "FORM" && !existing.formTemplateId) {
    const stored = (existing.data as { details?: { document?: unknown; templateId?: string; templateVersion?: number; templateName?: string } } | null)?.details;
    task.data.details = { ...details, templateId: stored?.templateId ?? details.templateId, templateVersion: stored?.templateVersion ?? details.templateVersion, templateName: stored?.templateName ?? details.templateName, document: formDocumentSchema.parse(stored?.document) };
    return { formTemplateId: null, formTemplateVersion: null, formArea: existing.formArea };
  }
  const templateId = existing?.formTemplateId ?? details.templateId;
  const version = existing?.formTemplateVersion ?? details.templateVersion;
  const row = await prisma.formTemplateVersion.findUnique({ where: { templateId_version: { templateId, version } }, include: { template: { select: { status: true, publishedVersion: true, organizationId: true, permissionArea: true } } } });
  // Another company's form is never usable, even with a guessed id (tenant isolation).
  if (!row || (row.template.organizationId && row.template.organizationId !== organizationId)) throw new ApiError(400, "Formuläret hittades inte.");
  if (!existing && (row.template.status !== "PUBLISHED" || row.template.publishedVersion !== version))
    throw new ApiError(409, "Formuläret finns inte längre i den här versionen. Välj formuläret på nytt under Ny uppgift.");
  // Where the form may be used is part of its version (decision 2): standalone, in a project, or both.
  if (task.projectId && !row.allowInProject) throw new ApiError(422, `${row.displayName || row.name} kan inte kopplas till ett projekt.`);
  if (!task.projectId && !row.allowStandalone) throw new ApiError(422, `${row.displayName || row.name} måste kopplas till ett projekt.`);
  task.data.details = { ...details, templateId, templateVersion: version, templateName: row.displayName || row.name, publisherName: publisherLabel(row.publisherName, row.importedFrom), document: formDocumentSchema.parse(row.document) };
  return { formTemplateId: templateId, formTemplateVersion: version, formArea: existing ? existing.formArea : row.template.permissionArea };
}

/**
 * A form's family (2026-09-28): a HINTEK original and the company's own version of it are one form for limit profiles,
 * trends and rounds, so the values and history follow when a company publishes its version. `family` is the
 * original's id; `ids` are every template the company's protocols of the family may come from.
 */
export async function formFamily(organizationId: string, templateId: string): Promise<{ family: string; ids: string[]; permissionArea: string }> {
  const template = await prisma.formTemplate.findFirst({ where: { id: templateId, ...visibleFormsWhere(organizationId) }, select: { id: true, baseTemplateId: true, permissionArea: true } });
  const family = template?.baseTemplateId ?? template?.id ?? templateId;
  const copies = await prisma.formTemplate.findMany({ where: { organizationId, baseTemplateId: family }, select: { id: true } });
  return { family, ids: [...new Set([family, templateId, ...copies.map((copy) => copy.id)])], permissionArea: template?.permissionArea ?? "forms" };
}
