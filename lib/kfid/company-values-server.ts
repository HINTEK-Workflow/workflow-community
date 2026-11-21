import { prisma } from "@/lib/db";
import { formDocumentSchema } from "@/lib/workflow/form-document";
import { formDisplayName } from "@/lib/workflow/form-publish";
import { formMetaOf, visibleFormsWhere } from "@/lib/kfid/form-server";
import { companyValueCatalog, type CompanyValue } from "@/lib/workflow/company-values";

type Row = { key: string; low: number | null; high: number | null; warnLow: number | null; warnHigh: number | null; source: string; reference: string; version: number; updatedAt: Date; updatedByName: string };
export const companyValueView = (row: Row): CompanyValue => ({
  key: row.key, low: row.low, high: row.high, warnLow: row.warnLow, warnHigh: row.warnHigh, source: row.source, reference: row.reference,
  version: row.version, updatedAt: row.updatedAt.toISOString(), updatedByName: row.updatedByName,
});

/** The company's values (Värden och referenser, 2026-10-06): only its own rows, never another company's. */
export async function companyValues(organizationId: string): Promise<CompanyValue[]> {
  const rows = await prisma.companyReferenceValue.findMany({ where: { organizationId }, orderBy: { key: "asc" }, take: 800 });
  return rows.map(companyValueView);
}

/**
 * The limits the company's forms declare (2026-10-06): every published form it can use – Workflow's originals, or the
 * company's own version of one in its place, and its own forms – read at their published version.
 */
export async function companyValueForms(organizationId: string) {
  const copies = new Set((await prisma.formTemplate.findMany({ where: { organizationId, status: "PUBLISHED", publishedVersion: { not: null }, baseTemplateId: { not: null } }, select: { baseTemplateId: true } })).map((copy) => copy.baseTemplateId!));
  const templates = (await prisma.formTemplate.findMany({ where: { status: "PUBLISHED", publishedVersion: { not: null }, ...visibleFormsWhere(organizationId) }, take: 200, select: { id: true, publishedVersion: true, organizationId: true, baseTemplateId: true } }))
    .filter((template) => !(template.organizationId === null && copies.has(template.id)));
  if (!templates.length) return [];
  const baseOf = new Map(templates.map((template) => [template.id, template.baseTemplateId]));
  const versions = await prisma.formTemplateVersion.findMany({ where: { OR: templates.map((template) => ({ templateId: template.id, version: template.publishedVersion! })) } });
  return versions.flatMap((version) => {
    const document = formDocumentSchema.safeParse(version.document);
    return document.success && document.data.limits.length ? [{ id: version.templateId, baseId: baseOf.get(version.templateId) ?? null, name: formDisplayName(formMetaOf(version)), document: document.data }] : [];
  });
}

export async function companyValueCatalogFor(organizationId: string) {
  return companyValueCatalog(await companyValueForms(organizationId));
}
