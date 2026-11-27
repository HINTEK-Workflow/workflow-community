import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { formDocumentSchema, type FormDocument } from "@/lib/workflow/form-document";
import { formDisplayName, formMetaSchema, type FormMeta } from "@/lib/workflow/form-publish";
import { formProgress, formValuesSchema, initialFormValues } from "@/lib/workflow/form-document";
import { createWorkflowPdfReport, defaultWorkflowReportOptions } from "@/lib/workflow/report";
import { workflowReportFont, workflowReportIdentity } from "@/lib/workflow/report-server";
import { sampleFormValues } from "@/lib/workflow/form-sample";

/**
 * The editor's PDF preview: the real report engine with example answers (or empty fields), in the company's look, marked as a preview.
 * Nothing is stored and no customer data is involved.
 */
export async function formPreviewPdf(ctx: Context, input: { meta: unknown; document: unknown; values?: unknown; blank?: boolean; sample?: boolean }) {
  const parsed = formDocumentSchema.safeParse(input.document);
  if (!parsed.success) throw new ApiError(400, "Formuläret kunde inte förhandsgranskas.");
  const document = parsed.data;
  const values = input.values !== undefined ? formValuesSchema.parse(input.values) : input.sample ? sampleFormValues(document) : initialFormValues(document);
  const name = formDisplayName(formMetaSchema.parse(input.meta ?? {}));
  // The company's own name, colours, logo and sender (PDF review 2026-11-03, finding 13): the preview looks like the real
  // document, and the mark after the code says that it is a preview – with example answers when none were sent.
  const identity = await workflowReportIdentity(ctx.organizationId, ctx.organization.name);
  const example = input.values === undefined && input.sample === true && input.blank !== true;
  const bytes = await createWorkflowPdfReport({
    ...identity, mark: example ? "FÖRHANDSGRANSKNING – EXEMPELDATA" : "FÖRHANDSGRANSKNING", fontBytes: await workflowReportFont(), options: defaultWorkflowReportOptions, blank: input.blank === true,
    tasks: [{ id: "preview", kind: "FORM", title: name, description: "", status: "IN_PROGRESS", progress: formProgress("IN_PROGRESS", document, values), assignedToName: "", dueDate: "", totalDurationSec: 0, attachments: [],
      data: { kind: "FORM", details: { templateName: name, templateVersion: 1, document, values } } }],
  });
  return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=\"forhandsgranskning.pdf\"", "Cache-Control": "no-store" } });
}
import type { Context } from "@/lib/kfid/server";
import { publisherLabel } from "@/lib/kfid/form-share";
import { publicInstance } from "@/lib/instance";
import { isHintekOrganization } from "@/lib/branding";
import { QA_ROLE_EMAILS, localRoleQaEnabled } from "@/lib/auth/access";
import { visibleFormsWhere } from "@/lib/kfid/form-scope";
import { mayBuildFormsWith } from "@/lib/workflow/permissions";

/**
 * Who builds forms, and whose forms (2026-09-27; 2026-10-06: Workflow is a company like the others). Every form
 * builder – the superadmin's too – works in the active organization with a company admin's rules, so nothing becomes
 * global by mistake (creating, importing, copying, publishing). Workflow's global originals (organizationId NULL) are
 * changed only through the explicit Workflow-original library or "Publicera som Workflow-original", see hintekFormsAllowed.
 * An employee builds forms only with the right Bygga formulär (2026-11-26, mayBuildForms below). Every query in the form builder is limited to the returned scope.
 */
export type FormScope = { organizationId: string | null; publisherName: string; hintek: boolean };
/**
 * Whether the person may build and change the company's forms in Skapa formulär. The one rule for everything that builds forms:
 * the forms routes (through requireFormAdmin) and Formulär med Workflow AI (2026-11-26: everyone who may edit forms, not a
 * rule of its own) – so the AI can never be offered to someone the forms route refuses, nor withheld from someone it lets in.
 * Bygga formulär (2026-11-26): an admin or owner always, an employee with the right form-builder:edit that the admin gives
 * under Användare (lib/workflow/permissions.ts, mayBuildFormsWith). An API key acts as its member, with the member's rights.
 */
export const mayBuildForms = (ctx: Pick<Context, "admin" | "organization" | "workflowPermissions">) =>
  mayBuildFormsWith({ admin: ctx.admin, workflowPermissions: ctx.workflowPermissions, cloud: ctx.organization.storageMode === "HINTEK_CLOUD" });
export function requireFormAdmin(ctx: Context): FormScope {
  if (mayBuildForms(ctx)) return { organizationId: ctx.organizationId, publisherName: ctx.organization.name, hintek: false };
  throw new ApiError(403, FORM_BUILDER_REFUSAL);
}
/** The refusal when the right is missing: what it is and who gives it. */
export const FORM_BUILDER_REFUSAL = "Du saknar behörigheten Bygga formulär. Företagets administratör kan ge den under Användare.";

/**
 * Whether the person may work on Workflow's global originals: the superadmin in Workflow's own organization (or the
 * synthetic QA superadmin on loopback QA), never under "Visa som" and never through an API key.
 */
export function hintekFormsAllowed(ctx: Context, viewAs: string | null | undefined) {
  if (ctx.user.role !== "SUPERADMIN" || viewAs || ctx.integration) return false;
  return isHintekOrganization(ctx.organization) || ctx.testAdmin || (localRoleQaEnabled() && ctx.user.email === QA_ROLE_EMAILS.superadmin);
}
/** The scope of Workflow's global originals. */
export const hintekFormScope = (): FormScope => ({ organizationId: null, publisherName: publicInstance().operator, hintek: true });
export function requireHintekForms(ctx: Context, viewAs: string | null | undefined): FormScope {
  if (!hintekFormsAllowed(ctx, viewAs)) throw new ApiError(403, viewAs ? "Workflow-original kan inte ändras under Visa som." : "Bara installationens superadmin ändrar Workflow-original.");
  return hintekFormScope();
}
/** The forms a company may use: Workflow's and its own. */
export { visibleFormsWhere, visibleFormVersionWhere } from "@/lib/kfid/form-scope";

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
 * It also gives the protocol's permission area (2026-09-27): the form's for a new protocol, the stored one after.
 */
export async function bindFormTask(organizationId: string, task: FormTask): Promise<{ formTemplateId: string | null; formTemplateVersion: number | null; formArea: string | null }> {
  if (task.kind !== "FORM" || task.data.kind !== "FORM") return { formTemplateId: null, formTemplateVersion: null, formArea: null };
  const details = task.data.details as { templateId: string; templateVersion: number; templateName: string; document: FormDocument; values: unknown };
  const existing = task.id ? await prisma.workflowTask.findFirst({ where: { id: task.id, organizationId }, select: { kind: true, formTemplateId: true, formTemplateVersion: true, formArea: true, data: true } }) : null;
  // A protocol whose form was deleted keeps the copy of the form it was stored with (2026-09-26); the client's
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
  if (!existing && (row.template.status !== "PUBLISHED" || row.template.publishedVersion !== version)) {
    // A round is never started on a form that is not published (2026-10-24): the refusal says what to do.
    const round = (details.values as { round?: unknown } | null | undefined)?.round;
    if (round && row.template.status !== "PUBLISHED") throw new ApiError(409, "Rondens formulär är inte publicerat. Ronden kan startas när formuläret publiceras eller byts under Driftronder.");
    throw new ApiError(409, "Formuläret finns inte längre i den här versionen. Välj formuläret på nytt under Ny uppgift.");
  }
  // Where the form may be used is part of its version (decision 2): standalone, in a project, or both.
  if (task.projectId && !row.allowInProject) throw new ApiError(422, `${row.displayName || row.name} kan inte kopplas till ett projekt.`);
  if (!task.projectId && !row.allowStandalone) throw new ApiError(422, `${row.displayName || row.name} måste kopplas till ett projekt.`);
  task.data.details = { ...details, templateId, templateVersion: version, templateName: row.displayName || row.name, publisherName: publisherLabel(row.publisherName, row.importedFrom), document: formDocumentSchema.parse(row.document) };
  return { formTemplateId: templateId, formTemplateVersion: version, formArea: existing ? existing.formArea : row.template.permissionArea };
}

/**
 * A form's family (2026-09-28): a Workflow original and the company's own version of it are one form for limit profiles,
 * trends and rounds, so the values and history follow when a company publishes its version. `family` is the
 * original's id; `ids` are every template the company's protocols of the family may come from.
 */
export async function formFamily(organizationId: string, templateId: string): Promise<{ family: string; ids: string[]; permissionArea: string }> {
  const template = await prisma.formTemplate.findFirst({ where: { id: templateId, ...visibleFormsWhere(organizationId) }, select: { id: true, baseTemplateId: true, permissionArea: true } });
  const family = template?.baseTemplateId ?? template?.id ?? templateId;
  const copies = await prisma.formTemplate.findMany({ where: { organizationId, baseTemplateId: family }, select: { id: true } });
  return { family, ids: [...new Set([family, templateId, ...copies.map((copy) => copy.id)])], permissionArea: template?.permissionArea ?? "forms" };
}
