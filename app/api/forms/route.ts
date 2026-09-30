import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, context, failure } from "@/lib/kfid/server";
import { formDocumentSchema } from "@/lib/workflow/form-document";
import { formMetaOf, visibleFormsWhere } from "@/lib/kfid/form-server";
import { publisherLabel } from "@/lib/kfid/form-share";
import { formDisplayName } from "@/lib/workflow/form-publish";

/** What Ny uppgift shows for a published version (never the internal note). */
const publishedCard = (templateId: string, template: { organizationId: string | null; origin: string; authorName: string }, row: { version: number; name: string; displayName: string; description: string; color: string; icon: string; category: string; allowStandalone: boolean; allowInProject: boolean; publisherName: string; importedFrom: unknown }, own: boolean, baseId: string | null = null, area = "forms") => {
  const meta = formMetaOf(row);
  return { id: templateId, version: row.version, name: formDisplayName(meta), description: meta.description, color: meta.color, icon: meta.icon, category: meta.category, allowStandalone: meta.allowStandalone, allowInProject: meta.allowInProject,
    // Utgivare (2026-09-27): HINTEK or the company, and where an imported form came from.
    publisher: publisherLabel(row.publisherName, row.importedFrom), own,
    // A company's version of a HINTEK original keeps the original's place under Ny uppgift.
    baseId,
    // Whose permission creates it: Formulär, or Kontroll före idrifttagning / Riskbedömning for those originals.
    area,
    // HINTEK Original (2026-09-28): HINTEK's own forms; later community forms carry their author.
    hintek: template.organizationId === null && template.origin === "HINTEK", source: template.origin, author: template.authorName };
};

export const dynamic = "force-dynamic";

/** The company's published versions of HINTEK originals, by original (2026-09-27, decision B). */
async function publishedCopies(organizationId: string) {
  const copies = await prisma.formTemplate.findMany({ where: { organizationId, status: "PUBLISHED", publishedVersion: { not: null }, baseTemplateId: { not: null } }, select: { id: true, baseTemplateId: true } });
  return new Map(copies.map((copy) => [copy.baseTemplateId!, copy.id]));
}

/**
 * The published forms (2026-09-26): the catalog for "Ny uppgift", and one published version to create a
 * protocol from. HINTEK's forms are shown to every signed-in member – also a Local workspace, which stores its protocols in
 * the file – and a company's own forms only to that company (2026-09-27). Where the company has published its own
 * version of a HINTEK original, that version is used instead of the original, also when the original is asked for.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    const copies = await publishedCopies(ctx.organizationId);
    const requested = new URL(request.url).searchParams.get("id");
    if (requested) {
      const id = z.string().min(1).max(100).parse(requested);
      const template = await prisma.formTemplate.findFirst({ where: { id: copies.get(id) ?? id, status: "PUBLISHED", ...visibleFormsWhere(ctx.organizationId) }, select: { id: true, publishedVersion: true, organizationId: true, baseTemplateId: true, permissionArea: true, origin: true, authorName: true } });
      if (!template?.publishedVersion) throw new ApiError(404, "Formuläret är inte publicerat.");
      const version = await prisma.formTemplateVersion.findUniqueOrThrow({ where: { templateId_version: { templateId: template.id, version: template.publishedVersion } } });
      return NextResponse.json({ templateId: template.id, ...publishedCard(template.id, template, version, template.organizationId === ctx.organizationId, template.baseTemplateId, template.permissionArea), document: formDocumentSchema.parse(version.document) });
    }
    // Only each form's published version is read, not its whole history; an original replaced by the company's version is left out.
    const templates = (await prisma.formTemplate.findMany({ where: { status: "PUBLISHED", publishedVersion: { not: null }, ...visibleFormsWhere(ctx.organizationId) }, take: 200, select: { id: true, publishedVersion: true, organizationId: true, baseTemplateId: true, permissionArea: true, origin: true, authorName: true } }))
      .filter((template) => !(template.organizationId === null && copies.has(template.id)));
    const own = new Set(templates.filter((template) => template.organizationId === ctx.organizationId).map((template) => template.id));
    const bases = new Map(templates.map((template) => [template.id, template.baseTemplateId]));
    const areas = new Map(templates.map((template) => [template.id, template.permissionArea]));
    const versions = templates.length ? await prisma.formTemplateVersion.findMany({ where: { OR: templates.map((template) => ({ templateId: template.id, version: template.publishedVersion! })) } }) : [];
    return NextResponse.json({
      forms: versions.map((version) => publishedCard(version.templateId, templates.find((template) => template.id === version.templateId)!, version, own.has(version.templateId), bases.get(version.templateId) ?? null, areas.get(version.templateId))).sort((a, b) => a.name.localeCompare(b.name, "sv")),
    });
  } catch (error) {
    return failure(error);
  }
}
