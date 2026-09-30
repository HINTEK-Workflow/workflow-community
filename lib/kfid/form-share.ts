import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { formDocumentSchema } from "@/lib/workflow/form-document";
import { formMetaSchema } from "@/lib/workflow/form-publish";

/**
 * Sharing forms between companies (2026-09-27): a JSON file with one or more forms, their publisher and a
 * signature made by this Workflow server. An imported form becomes a draft in the importing company; the signature
 * only tells whether the publisher named in the file is genuine (made here and unchanged), it never grants anything.
 * Forms are data – fields, tables, formulas and texts – never scripts, styles or pictures.
 */
export const FORM_SHARE_FORMAT = "hintek-workflow-forms";
export const FORM_SHARE_MAX_FORMS = 20;

const sharedMetaSchema = formMetaSchema.pick({ name: true, displayName: true, description: true, color: true, icon: true, category: true, allowStandalone: true, allowInProject: true });
const sharedFormSchema = z.object({
  sourceTemplateId: z.string().min(1).max(100),
  sourceVersion: z.number().int().positive().nullable(),
  /** Who published the form; for a form that was itself imported, its original publisher. */
  publisherName: z.string().trim().min(1).max(200),
  meta: sharedMetaSchema,
  document: formDocumentSchema,
});
export const formSharePackageSchema = z.object({
  format: z.literal(FORM_SHARE_FORMAT),
  formatVersion: z.literal(1),
  exportedAt: z.iso.datetime(),
  exportedBy: z.object({ name: z.string().trim().min(1).max(200), hintek: z.boolean() }),
  forms: z.array(sharedFormSchema).min(1).max(FORM_SHARE_MAX_FORMS),
  signature: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});
export type FormSharePackage = z.infer<typeof formSharePackageSchema>;
export type SharedForm = z.infer<typeof sharedFormSchema>;

// Fixed key order, so the same content always gives the same bytes to sign.
const canonical = (pkg: Omit<FormSharePackage, "signature">) => JSON.stringify({
  format: pkg.format, formatVersion: pkg.formatVersion, exportedAt: pkg.exportedAt,
  exportedBy: { name: pkg.exportedBy.name, hintek: pkg.exportedBy.hintek },
  forms: pkg.forms.map((form) => ({
    sourceTemplateId: form.sourceTemplateId, sourceVersion: form.sourceVersion, publisherName: form.publisherName,
    meta: sharedMetaSchema.parse(form.meta), document: formDocumentSchema.parse(form.document),
  })),
});
const key = () => createHmac("sha256", env.AUTH_SECRET).update("hintek-workflow-form-share-v1").digest();
const sign = (pkg: Omit<FormSharePackage, "signature">) => createHmac("sha256", key()).update(canonical(pkg)).digest("hex");

export function signFormPackage(pkg: Omit<FormSharePackage, "signature">): FormSharePackage {
  return { ...pkg, signature: sign(pkg) };
}

/** Reads an uploaded file. Throws a readable message for anything that is not a valid form file. */
export function readFormPackage(input: unknown): { pkg: FormSharePackage; verified: boolean } {
  const parsed = formSharePackageSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(issue?.path[0] === "format" ? "Filen är inte en formulärfil från HINTEK Workflow." : `Formulärfilen kunde inte läsas: ${issue?.path.join(".")} ${issue?.message}`);
  }
  const { signature, ...rest } = parsed.data;
  let verified = false;
  if (signature) {
    const expected = Buffer.from(sign(rest), "hex");
    const actual = Buffer.from(signature, "hex");
    verified = expected.length === actual.length && timingSafeEqual(expected, actual);
  }
  return { pkg: parsed.data, verified };
}

/** Where an imported form came from, kept on the form and each published version. */
export const importedFromSchema = z.object({
  publisherName: z.string(),
  exportedBy: z.string(),
  verified: z.boolean(),
  sourceTemplateId: z.string(),
  sourceVersion: z.number().nullable(),
  importedAt: z.string(),
});
export type ImportedFrom = z.infer<typeof importedFromSchema>;

/** "HINTEK" or "Elbolaget AB", with the original publisher of an imported form. */
export function publisherLabel(publisherName: string, importedFrom: unknown) {
  const origin = importedFromSchema.safeParse(importedFrom);
  if (!origin.success || origin.data.publisherName === publisherName) return publisherName;
  return `${publisherName} · från ${origin.data.publisherName}${origin.data.verified ? "" : " (ej verifierad)"}`;
}
