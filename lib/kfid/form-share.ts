import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { formDocumentSchema } from "@/lib/workflow/form-document";
import { FORM_CATEGORIES, FORM_COLORS, FORM_ICONS, formCategory, formMetaSchema } from "@/lib/workflow/form-publish";
import { issueText } from "@/lib/validation/zod-swedish";
import { FormFileError, formFilePlace, inspectFormFile, rejectUnknownFormFileKeys, removedSettingPlace, unknownFormFileKeys } from "./form-import-guard";

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
/**
 * The same bytes as `canonical`, but with each form's meta and document exactly as they stand in the file (2026-11-24). A newer
 * version signs its own reading of a form, settings this version does not know included; the exported file holds that reading
 * as it is, so this is what the newer version signed. Keys outside meta and document are not part of it.
 */
type RawForm = { sourceTemplateId?: unknown; sourceVersion?: unknown; publisherName?: unknown; meta?: unknown; document?: unknown };
const rawCanonical = (input: { format?: unknown; formatVersion?: unknown; exportedAt?: unknown; exportedBy?: { name?: unknown; hintek?: unknown }; forms?: RawForm[] }) => JSON.stringify({
  format: input.format, formatVersion: input.formatVersion, exportedAt: input.exportedAt,
  exportedBy: { name: input.exportedBy?.name, hintek: input.exportedBy?.hintek },
  forms: (input.forms ?? []).map((form) => ({ sourceTemplateId: form.sourceTemplateId, sourceVersion: form.sourceVersion, publisherName: form.publisherName, meta: form.meta, document: form.document })),
});
const key = () => createHmac("sha256", env.AUTH_SECRET).update("hintek-workflow-form-share-v1").digest();
const hmac = (text: string) => createHmac("sha256", key()).update(text).digest("hex");
const sign = (pkg: Omit<FormSharePackage, "signature">) => hmac(canonical(pkg));
const sameSignature = (expectedHex: string, signature: string) => {
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(signature, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

export function signFormPackage(pkg: Omit<FormSharePackage, "signature">): FormSharePackage {
  return { ...pkg, signature: sign(pkg) };
}

// The basic details a file names must be ones the builder offers; when read from storage an unknown one falls back
// quietly (formMetaSchema's catch), but a file that asks for a colour that does not exist is told so.
const STRICT_META: [key: "color" | "icon" | "category", allowed: readonly string[], name: string][] = [
  ["color", FORM_COLORS, "Färgen"], ["icon", FORM_ICONS, "Ikonen"], ["category", FORM_CATEGORIES.map(([value]) => value), "Kategorin"],
];
function checkMeta(input: object) {
  const forms = (input as { forms?: unknown }).forms;
  if (!Array.isArray(forms)) return;
  forms.forEach((form, index) => {
    const meta = form && typeof form === "object" ? (form as { meta?: unknown }).meta : undefined;
    if (!meta || typeof meta !== "object") return;
    for (const [key, allowed, name] of STRICT_META) {
      const value = (meta as Record<string, unknown>)[key];
      if (value === undefined || (typeof value === "string" && (allowed.includes(value) || (key === "category" && formCategory(value) !== "OTHER")))) continue;
      throw new FormFileError(`${name} ”${String(value).slice(0, 40)}” i formulär ${index + 1} finns inte. Välj en av: ${allowed.join(", ")}.`);
    }
  });
}

/**
 * A block is one of several shapes (a section, a field, a table …), so the schema reports a wrong value inside one as
 * "matches none of them". The real reason is in the shape whose `type` matched: that issue is told, with its full path.
 */
function innermostIssue(issue: z.core.$ZodIssue | undefined): z.core.$ZodIssue | undefined {
  for (let depth = 0; issue?.code === "invalid_union" && "errors" in issue && issue.errors.length && depth < 20; depth++) {
    const branches = issue.errors.filter((branch) => branch.length && !branch.some((inner) => inner.path.length === 1 && inner.path[0] === "type"));
    const chosen = (branches.length === 1 ? branches[0] : null)?.[0];
    if (!chosen) break;
    issue = { ...chosen, path: [...issue.path, ...chosen.path] } as z.core.$ZodIssue;
  }
  return issue;
}

/**
 * The first id used twice in a form: the builder finds sections and blocks by id, a table its columns and a checklist its
 * points, so a file made by hand or by an AI must keep them apart.
 */
export function duplicateFormId(document: FormSharePackage["forms"][number]["document"]): string | null {
  const blocks = new Set<string>();
  type Item = FormSharePackage["forms"][number]["document"]["blocks"][number];
  const leaves: Item[] = document.blocks.flatMap((block): Item[] => block.type === "section" ? [block, ...block.blocks] : block.type === "columns" ? [block, ...block.columns.flat()] : [block]);
  for (const block of leaves) {
    if (blocks.has(block.id)) return block.id;
    blocks.add(block.id);
    const inner = block.type === "table" ? block.columns.map((column) => column.id) : block.type === "checklist" ? block.items.map((item) => item.id) : [];
    const own = new Set<string>();
    for (const id of inner) { if (own.has(id)) return id; own.add(id); }
  }
  return null;
}

/** At most this many removed settings are named in the warning; the count is always the full one. */
const REMOVED_NAMED = 5;

/** The warning for a signed file from a newer version whose unknown settings were removed (2026-11-24). */
export function newerVersionWarning(places: readonly string[], count = places.length) {
  const named = places.slice(0, REMOVED_NAMED).join(", ");
  const more = count > REMOVED_NAMED ? ` och ${count - REMOVED_NAMED} till` : "";
  return `Filen kommer från en nyare version av Workflow. ${count === 1 ? "1 inställning" : `${count} inställningar`} som den här versionen inte känner till togs bort: ${named}${more}.`;
}

/**
 * Reads an uploaded file. Throws a readable message for anything that is not a valid form file: the wrong kind of
 * file, HTML or script in a text, a key that reaches a prototype, too much or too deep, a setting the format does not
 * know, or a value the schema refuses (lib/kfid/form-import-guard.ts). Nothing is stored before all of it has passed.
 *
 * A file from a newer version (2026-11-24): when the signature is genuine over the file's own meta and documents, the
 * settings in them that this version does not know are removed and listed in `warning` instead of refused. Only there: an
 * unknown key anywhere else, or in a file that is not signed (one an AI wrote), is still refused. Every other check is the same.
 */
export function readFormPackage(input: unknown): { pkg: FormSharePackage; verified: boolean; warning?: string } {
  if (!input || typeof input !== "object" || Array.isArray(input) || (input as { format?: unknown }).format !== FORM_SHARE_FORMAT) throw new Error("Filen är inte en formulärfil från Workflow.");
  inspectFormFile(input);
  checkMeta(input);
  const parsed = formSharePackageSchema.safeParse(input);
  if (!parsed.success) {
    const issue = innermostIssue(parsed.error.issues[0]);
    const reason = issue?.path.at(-1) === "type" && issue.code === "invalid_union" ? "Blocktypen finns inte. Använd en av typerna i formatbeskrivningen." : issueText(issue);
    throw new Error(`Formulärfilen kunde inte läsas vid ${formFilePlace(issue?.path ?? [])}: ${reason}`);
  }
  const { signature, ...rest } = parsed.data;
  const unknown = unknownFormFileKeys(input, parsed.data);
  // Signed over the file as it stands: the unknown settings are the signer's own, so they may be removed with a warning.
  const signedAsWritten = Boolean(signature) && sameSignature(hmac(rawCanonical(input as Parameters<typeof rawCanonical>[0])), signature!);
  const insideForms = (path: PropertyKey[]) => path[0] === "forms" && typeof path[1] === "number" && (path[2] === "meta" || path[2] === "document") && path.length > 3;
  let warning: string | undefined;
  if (unknown.length && signedAsWritten && unknown.every(insideForms)) warning = newerVersionWarning(unknown.map(removedSettingPlace), unknown.length);
  else rejectUnknownFormFileKeys(input, parsed.data);
  const nameless = parsed.data.forms.findIndex((form) => !form.meta.name);
  if (nameless >= 0) throw new FormFileError(`Formulär ${nameless + 1} i filen saknar namn (meta.name).`);
  parsed.data.forms.forEach((form, index) => {
    const twice = duplicateFormId(form.document);
    if (twice) throw new FormFileError(`Formulär ${index + 1} i filen använder id ”${twice}” mer än en gång. Varje avsnitt, block, kolumn och punkt behöver ett eget id.`);
  });
  const verified = Boolean(signature) && (signedAsWritten || sameSignature(sign(rest), signature!));
  return { pkg: parsed.data, verified, ...(warning ? { warning } : {}) };
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
  return `${publisherName} · från ${origin.data.publisherName}${origin.data.verified ? "" : " (inte verifierad)"}`;
}
