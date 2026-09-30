import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { currentDocumentHash, formDocumentHash, formMetaOf, formPreviewPdf, publishedMetaEqual, requireFormAdmin, type FormScope } from "@/lib/kfid/form-server";
import { FORM_SHARE_FORMAT, FORM_SHARE_MAX_FORMS, importedFromSchema, publisherLabel, readFormPackage, signFormPackage, type SharedForm } from "@/lib/kfid/form-share";
import { formDocumentSchema, validateFormDocument } from "@/lib/workflow/form-document";
import { formPublishChecks, FORM_CATEGORIES, FORM_COLORS, FORM_ICONS, type FormMeta } from "@/lib/workflow/form-publish";
import { TASK_TYPE_OF_ORIGINAL } from "@/lib/workflow/builtin-originals";

export const dynamic = "force-dynamic";

const id = z.string().min(1).max(100);
const json = (value: unknown) => value as Prisma.InputJsonValue;
const actorName = (ctx: Awaited<ReturnType<typeof context>>) => ctx.user.name || ctx.user.email;
const PAGE_SIZE = 20;
const STATUSES = ["DRAFT", "PUBLISHED", "UNPUBLISHED"] as const;

const templateSelect = {
  id: true, name: true, displayName: true, description: true, internalNote: true, color: true, icon: true, category: true, allowStandalone: true, allowInProject: true,
  status: true, publishedVersion: true, draftRevision: true, updatedAt: true, draft: true, publisherName: true, importedFrom: true, baseTemplateId: true, baseVersion: true,
} as const;
type TemplateRow = Prisma.FormTemplateGetPayload<{ select: typeof templateSelect }>;
type LatestVersion = { version: number; document: Prisma.JsonValue; name: string; displayName: string; description: string; color: string; icon: string; category: string; allowStandalone: boolean; allowInProject: boolean } | null;

/** Whether the draft differs from the latest published version (or was never published). */
function hasDraftChanges(template: TemplateRow, latest: LatestVersion) {
  if (!latest) return true;
  return currentDocumentHash(template.draft) !== currentDocumentHash(latest.document) || !publishedMetaEqual(formMetaOf(template), formMetaOf(latest));
}

async function latestVersions(templateIds: string[]) {
  if (!templateIds.length) return new Map<string, NonNullable<LatestVersion>>();
  const rows = await prisma.formTemplateVersion.findMany({ where: { templateId: { in: templateIds } }, orderBy: { version: "desc" }, distinct: ["templateId"],
    select: { templateId: true, version: true, document: true, name: true, displayName: true, description: true, color: true, icon: true, category: true, allowStandalone: true, allowInProject: true } });
  return new Map(rows.map((row) => [row.templateId, row]));
}

/** Protocols counted for a scope: HINTEK sees the use of its forms everywhere (a count only), a company only its own. */
const usageWhere = (scope: FormScope) => (scope.organizationId ? { organizationId: scope.organizationId } : {});
const fileSlug = (name: string) => name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "formular";
/** What a scope may export: its own forms and, for a company, HINTEK's published ones. */
const exportableWhere = (scope: FormScope): Prisma.FormTemplateWhereInput => ({ OR: [{ organizationId: scope.organizationId }, ...(scope.organizationId ? [{ organizationId: null, status: "PUBLISHED" }] : [])] });

/**
 * Export (2026-09-27): the chosen forms as a signed file – the published version, or the draft of a form that
 * was never published.
 */
async function exportForms(scope: FormScope, ids: string[]) {
  const templates = await prisma.formTemplate.findMany({
    where: { id: { in: ids }, ...exportableWhere(scope) },
    select: { id: true, publishedVersion: true, draft: true, publisherName: true, importedFrom: true, name: true, displayName: true, description: true, color: true, icon: true, category: true, allowStandalone: true, allowInProject: true },
  });
  if (templates.length !== ids.length) throw new ApiError(404, "Ett eller flera formulär hittades inte.");
  const published = templates.filter((template) => template.publishedVersion);
  const versions = published.length ? await prisma.formTemplateVersion.findMany({ where: { OR: published.map((template) => ({ templateId: template.id, version: template.publishedVersion! })) } }) : [];
  const forms: SharedForm[] = ids.map((templateId) => {
    const template = templates.find((item) => item.id === templateId)!;
    const version = versions.find((item) => item.templateId === templateId);
    const source = version ?? template;
    const origin = importedFromSchema.safeParse(source.importedFrom);
    const meta = formMetaOf(source);
    return {
      sourceTemplateId: template.id, sourceVersion: version?.version ?? null,
      publisherName: origin.success ? origin.data.publisherName : source.publisherName,
      meta: { name: meta.name, displayName: meta.displayName, description: meta.description, color: meta.color, icon: meta.icon, category: meta.category, allowStandalone: meta.allowStandalone, allowInProject: meta.allowInProject },
      document: formDocumentSchema.parse(version ? version.document : template.draft),
    };
  });
  const pkg = signFormPackage({ format: FORM_SHARE_FORMAT, formatVersion: 1, exportedAt: new Date().toISOString(), exportedBy: { name: scope.publisherName, hintek: scope.hintek }, forms });
  const name = forms.length === 1 ? fileSlug(forms[0].meta.name) : `${forms.length}-formular`;
  return new Response(JSON.stringify(pkg, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="workflow-${name}-${pkg.exportedAt.slice(0, 10)}.json"`, "Cache-Control": "private, no-store" } });
}

/** A HINTEK original a company may make its own version of: published by HINTEK. */
const hintekOriginal = (id: string) => prisma.formTemplate.findFirst({ where: { id, organizationId: null, status: "PUBLISHED", publishedVersion: { not: null } }, select: { id: true, name: true, publishedVersion: true, permissionArea: true } });

/** What a company copy is based on: the original's name and whether HINTEK has published a newer version since. */
async function baseOf(template: { baseTemplateId: string | null; baseVersion: number | null }) {
  if (!template.baseTemplateId) return null;
  const original = await prisma.formTemplate.findUnique({ where: { id: template.baseTemplateId }, select: { id: true, name: true, publishedVersion: true, permissionArea: true } });
  return original ? { id: original.id, name: original.name, version: template.baseVersion, latest: original.publishedVersion, updated: Boolean(original.publishedVersion && template.baseVersion && original.publishedVersion > template.baseVersion) } : null;
}

/**
 * "Skapa formulär" (2026-09-26, companies since 2026-09-27): HINTEK's superadmin works on HINTEK's forms and a
 * company admin on the company's own forms – never another company's. Protocol counts are numbers, never content.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    const scope = requireFormAdmin(ctx);
    const params = new URL(request.url).searchParams;
    const exportIds = params.get("export");
    if (exportIds !== null) {
      const ids = [...new Set(exportIds.split(",").map((item) => item.trim()).filter(Boolean).map((item) => id.parse(item)))];
      if (!ids.length || ids.length > FORM_SHARE_MAX_FORMS) throw new ApiError(400, `Välj 1–${FORM_SHARE_MAX_FORMS} formulär att exportera.`);
      return await exportForms(scope, ids);
    }
    if (params.get("exportable")) {
      const rows = await prisma.formTemplate.findMany({
        where: exportableWhere(scope), orderBy: [{ name: "asc" }], take: 200,
        select: { id: true, name: true, displayName: true, status: true, organizationId: true, publisherName: true, importedFrom: true },
      });
      return NextResponse.json({ forms: rows.map((row) => ({ id: row.id, name: row.displayName || row.name, status: row.status, own: row.organizationId === scope.organizationId, publisher: publisherLabel(row.publisherName, row.importedFrom) })) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    // HINTEK's originals (2026-09-27, decision B): a company admin sees the published ones it has not yet made its
    // own version of, and opens one to change it; the first save becomes the company's copy.
    if (params.get("originals")) {
      if (!scope.organizationId) return NextResponse.json({ originals: [] });
      const copied = new Set((await prisma.formTemplate.findMany({ where: { organizationId: scope.organizationId, baseTemplateId: { not: null } }, select: { baseTemplateId: true } })).map((row) => row.baseTemplateId));
      const rows = await prisma.formTemplate.findMany({ where: { organizationId: null, status: "PUBLISHED", publishedVersion: { not: null } }, orderBy: { name: "asc" }, take: 100, select: { id: true, name: true, displayName: true, description: true, icon: true, color: true, publishedVersion: true } });
      return NextResponse.json({ originals: rows.filter((row) => !copied.has(row.id)) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const originalId = params.get("original");
    if (originalId) {
      if (!scope.organizationId) throw new ApiError(400, "HINTEK ändrar sina original direkt.");
      const original = await hintekOriginal(id.parse(originalId));
      if (!original) throw new ApiError(404, "Formuläret hittades inte.");
      const [version, copy] = await Promise.all([
        prisma.formTemplateVersion.findUniqueOrThrow({ where: { templateId_version: { templateId: original.id, version: original.publishedVersion! } } }),
        prisma.formTemplate.findFirst({ where: { organizationId: scope.organizationId, baseTemplateId: original.id }, select: { id: true } }),
      ]);
      return NextResponse.json({ original: { id: original.id, version: version.version, meta: formMetaOf(version), document: formDocumentSchema.parse(version.document), copyId: copy?.id ?? null } });
    }
    const templateId = params.get("id");
    if (templateId) {
      const template = await prisma.formTemplate.findFirst({
        where: { id: id.parse(templateId), organizationId: scope.organizationId },
        include: { versions: { orderBy: { version: "desc" }, select: { version: true, name: true, hash: true, publishedBy: true, createdAt: true } }, events: { orderBy: { createdAt: "desc" }, take: 25 } },
      });
      if (!template) throw new ApiError(404, "Formuläret hittades inte.");
      const [usage, latest] = await Promise.all([
        prisma.workflowTask.groupBy({ by: ["formTemplateVersion"], where: { formTemplateId: template.id, ...usageWhere(scope) }, _count: { _all: true } }),
        latestVersions([template.id]).then((map) => map.get(template.id) ?? null),
      ]);
      return NextResponse.json({
        template: {
          ...template, meta: formMetaOf(template), publisher: publisherLabel(template.publisherName, template.importedFrom), draftHash: currentDocumentHash(template.draft), hasDraftChanges: hasDraftChanges(template, latest),
          versions: template.versions.map((version) => ({ ...version, protocols: usage.find((row) => row.formTemplateVersion === version.version)?._count._all ?? 0 })),
          // The latest publication, so the editor can show what changed and warn about changed short names.
          latest: latest ? { version: latest.version, meta: formMetaOf(latest), document: formDocumentSchema.parse(latest.document) } : null,
          base: await baseOf(template),
        },
        issues: validateFormDocument(template.draft).issues,
      });
    }
    // The ongoing draft to open when the editor starts: the most recently changed form with unpublished changes.
    // HINTEK's originals and a company's version of one are opened from Mina formulär only, never by themselves
    // (2026-09-27: Skapa formulär must not land in Riskbedömning).
    if (params.get("resume")) {
      const recent = await prisma.formTemplate.findMany({ where: { organizationId: scope.organizationId, id: { notIn: Object.keys(TASK_TYPE_OF_ORIGINAL) }, baseTemplateId: null }, orderBy: { updatedAt: "desc" }, take: PAGE_SIZE, select: templateSelect });
      const latest = await latestVersions(recent.map((item) => item.id));
      return NextResponse.json({ id: recent.find((item) => item.status !== "UNPUBLISHED" && hasDraftChanges(item, latest.get(item.id) ?? null))?.id ?? null });
    }
    // Mina formulär: bounded pages with search and a status filter.
    const status = z.enum(STATUSES).optional().catch(undefined).parse(params.get("status") || undefined);
    const query = z.string().trim().max(120).catch("").parse(params.get("q") ?? "");
    const page = z.coerce.number().int().min(0).max(1000).catch(0).parse(params.get("page") ?? 0);
    const where: Prisma.FormTemplateWhereInput = {
      organizationId: scope.organizationId,
      ...(status ? { status } : {}),
      ...(query ? { OR: [{ name: { contains: query, mode: "insensitive" } }, { displayName: { contains: query, mode: "insensitive" } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.formTemplate.findMany({ where, orderBy: { updatedAt: "desc" }, skip: page * PAGE_SIZE, take: PAGE_SIZE, select: templateSelect }),
      prisma.formTemplate.count({ where }),
    ]);
    const [usage, latest] = await Promise.all([
      rows.length ? prisma.workflowTask.groupBy({ by: ["formTemplateId"], where: { formTemplateId: { in: rows.map((row) => row.id) }, ...usageWhere(scope) }, _count: { _all: true } }) : [],
      latestVersions(rows.map((row) => row.id)),
    ]);
    return NextResponse.json({
      total, page, hasMore: (page + 1) * PAGE_SIZE < total,
      templates: rows.map(({ draft: _draft, ...template }) => ({
        ...template, publisher: publisherLabel(template.publisherName, template.importedFrom), hasDraftChanges: hasDraftChanges({ ...template, draft: _draft }, latest.get(template.id) ?? null),
        protocols: usage.find((row) => row.formTemplateId === template.id)?._count._all ?? 0,
      })),
    });
  } catch (error) {
    return failure(error);
  }
}

const meta = {
  name: z.string().trim().min(1, "Ange formulärets namn.").max(120),
  displayName: z.string().trim().max(120).default(""),
  description: z.string().trim().max(500).default(""),
  internalNote: z.string().trim().max(2000).default(""),
  color: z.enum(FORM_COLORS).default("green"),
  icon: z.enum(FORM_ICONS).default("file-spreadsheet"),
  category: z.enum(FORM_CATEGORIES.map(([value]) => value) as [FormMeta["category"], ...FormMeta["category"][]]).default("OTHER"),
  allowStandalone: z.boolean().default(true),
  allowInProject: z.boolean().default(true),
};
const starterDocument = () => ({ schema: 2 as const, blocks: [{ id: "avsnitt-1", type: "section" as const, title: "", description: "", newPage: false, blocks: [] }] });
const inputSchema = z.discriminatedUnion("action", [
  // A new form: from the editor's local draft (with content) or just a name.
  // `baseTemplateId`: the company's own version of a HINTEK original, made by the first save (2026-09-27).
  z.object({ action: z.literal("create"), ...meta, document: z.unknown().optional(), baseTemplateId: id.optional() }),
  // Removes the company's version so the company uses HINTEK's original again; protocols keep their own copy.
  z.object({ action: z.literal("reset_to_original"), id }),
  z.object({ action: z.literal("save"), id, draftRevision: z.number().int().positive(), ...meta, document: z.unknown(), autosave: z.boolean().default(false) }),
  z.object({ action: z.literal("publish"), id, draftRevision: z.number().int().positive(), acceptWarnings: z.boolean().default(false) }),
  z.object({ action: z.literal("restore_version"), id, draftRevision: z.number().int().positive(), version: z.number().int().positive() }),
  z.object({ action: z.literal("preview_pdf"), ...meta, name: z.string().trim().max(120).default(""), document: z.unknown(), values: z.unknown().optional() }),
  z.object({ action: z.literal("unpublish"), id }),
  z.object({ action: z.literal("republish"), id }),
  z.object({ action: z.literal("delete"), id }),
  // Import (2026-09-27): a form file from another company or from HINTEK becomes drafts here.
  z.object({ action: z.literal("import"), file: z.unknown(), duplicates: z.enum(["skip", "copy"]).default("skip") }),
]);

function parseDocument(input: unknown, verb: string) {
  const parsed = formDocumentSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, `Formuläret kunde inte ${verb}: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}
const metaData = (input: FormMeta) => ({ name: input.name, displayName: input.displayName, description: input.description, internalNote: input.internalNote, color: input.color, icon: input.icon, category: input.category, allowStandalone: input.allowStandalone, allowInProject: input.allowInProject });

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    const scope = requireFormAdmin(ctx);
    const input = inputSchema.parse(await body(request));
    const event = (tx: Prisma.TransactionClient, templateId: string, action: string, summary: string) =>
      tx.formTemplateEvent.create({ data: { templateId, action, summary, actorUserId: ctx.user.id, actorName: actorName(ctx) } });

    if (input.action === "preview_pdf") return formPreviewPdf({ meta: input, document: input.document, values: input.values });
    if (input.action === "create") {
      const document = input.document === undefined ? starterDocument() : parseDocument(input.document, "sparas");
      const original = input.baseTemplateId ? await hintekOriginal(input.baseTemplateId) : null;
      if (input.baseTemplateId && (!original || !scope.organizationId)) throw new ApiError(400, "Bara ett företag kan göra en egen version av HINTEK:s formulär.");
      if (original && await prisma.formTemplate.findFirst({ where: { organizationId: scope.organizationId, baseTemplateId: original.id }, select: { id: true } }))
        throw new ApiError(409, "Ert företag har redan en egen version av formuläret. Öppna den under Mina formulär.");
      const created = await prisma.$transaction(async (tx) => {
        const template = await tx.formTemplate.create({ data: {
          ...metaData(input), organizationId: scope.organizationId, publisherName: scope.publisherName, draft: json(document), createdBy: ctx.user.id, updatedBy: ctx.user.id,
          // Who made it (2026-09-28): HINTEK's own forms are HINTEK Original; a company's forms and versions are its own.
          origin: scope.hintek ? "HINTEK" : "COMPANY", authorName: scope.publisherName,
          ...(original ? { baseTemplateId: original.id, baseVersion: original.publishedVersion, permissionArea: original.permissionArea } : {}),
        }, select: { id: true, draftRevision: true, updatedAt: true } });
        await event(tx, template.id, original ? "COPIED" : "CREATED", original ? `Ert företags version av HINTEK:s ${original.name} skapades (från version ${original.publishedVersion})` : `Formuläret ${input.name} skapades`);
        return template;
      });
      return NextResponse.json({ ...created, issues: validateFormDocument(document).issues });
    }
    if (input.action === "import") {
      let read: ReturnType<typeof readFormPackage>;
      try { read = readFormPackage(input.file); } catch (issue) { throw new ApiError(400, (issue as Error).message); }
      const { pkg, verified } = read;
      const importedAt = new Date().toISOString();
      const unverified = verified ? "" : " (ej verifierad)";
      const skipped: { id: string; name: string }[] = [];
      const imported = await prisma.$transaction(async (tx) => {
        const rows: { id: string; name: string }[] = [];
        for (const form of pkg.forms) {
          // A form that is already here – the same form, a HINTEK original the company already has, or an earlier import
          // of it – is skipped unless the admin asks for a copy (totalkontrollen F18, 2026-09-29).
          const existing = await tx.formTemplate.findFirst({
            where: { OR: [
              { id: form.sourceTemplateId, OR: [{ organizationId: scope.organizationId }, { organizationId: null }] },
              { organizationId: scope.organizationId, importedFrom: { path: ["sourceTemplateId"], equals: form.sourceTemplateId } },
            ] },
            select: { id: true, name: true, displayName: true, organizationId: true },
          });
          if (existing && input.duplicates === "skip") {
            skipped.push({ id: existing.organizationId === scope.organizationId ? existing.id : "", name: existing.displayName || existing.name });
            continue;
          }
          const importedFrom = { publisherName: form.publisherName, exportedBy: pkg.exportedBy.name, verified, sourceTemplateId: form.sourceTemplateId, sourceVersion: form.sourceVersion, importedAt };
          const template = await tx.formTemplate.create({ data: {
            ...metaData({ ...form.meta, internalNote: `Importerad ${importedAt.slice(0, 10)} från ${pkg.exportedBy.name}${unverified}.` }),
            organizationId: scope.organizationId, publisherName: scope.publisherName, importedFrom: json(importedFrom), origin: "COMPANY", authorName: pkg.exportedBy.name.slice(0, 120),
            draft: json(form.document), createdBy: ctx.user.id, updatedBy: ctx.user.id,
          }, select: { id: true } });
          await event(tx, template.id, "IMPORTED", `Importerades från ${form.publisherName}${unverified}`);
          rows.push({ id: template.id, name: form.meta.name });
        }
        return rows;
      }, { timeout: 15000 });
      return NextResponse.json({ imported, skipped, verified, exportedBy: pkg.exportedBy.name });
    }
    const template = await prisma.formTemplate.findFirst({ where: { id: input.id, organizationId: scope.organizationId } });
    if (!template) throw new ApiError(404, "Formuläret hittades inte.");
    if (input.action === "save") {
      // A draft may be saved with issues (work in progress); only publishing requires a valid form.
      const document = parseDocument(input.document, "sparas");
      const result = await prisma.$transaction(async (tx) => {
        const changed = await tx.formTemplate.updateMany({ where: { id: template.id, draftRevision: input.draftRevision }, data: { ...metaData(input), draft: json(document), draftRevision: { increment: 1 }, updatedBy: ctx.user.id } });
        if (!changed.count) throw new ApiError(409, "Formuläret har ändrats i en annan flik. Läs in det igen.");
        // Autosaves write no history row; saving by hand and publishing do (decision 3).
        if (!input.autosave) await event(tx, template.id, "SAVED", "Utkastet sparades");
        return tx.formTemplate.findUniqueOrThrow({ where: { id: template.id }, select: { draftRevision: true, updatedAt: true } });
      });
      return NextResponse.json({ ...result, issues: validateFormDocument(document).issues });
    }
    if (input.action === "restore_version") {
      const version = await prisma.formTemplateVersion.findUnique({ where: { templateId_version: { templateId: template.id, version: input.version } } });
      if (!version) throw new ApiError(404, "Versionen hittades inte.");
      const result = await prisma.$transaction(async (tx) => {
        const changed = await tx.formTemplate.updateMany({ where: { id: template.id, draftRevision: input.draftRevision }, data: {
          name: version.name, displayName: version.displayName, description: version.description, color: version.color, icon: version.icon, category: version.category,
          allowStandalone: version.allowStandalone, allowInProject: version.allowInProject, draft: json(formDocumentSchema.parse(version.document)), draftRevision: { increment: 1 }, updatedBy: ctx.user.id,
        } });
        if (!changed.count) throw new ApiError(409, "Formuläret har ändrats i en annan flik. Läs in det igen.");
        await event(tx, template.id, "RESTORED", `Utkastet återställdes från version ${version.version}`);
        return tx.formTemplate.findUniqueOrThrow({ where: { id: template.id }, select: { draftRevision: true, updatedAt: true } });
      });
      return NextResponse.json(result);
    }
    if (input.action === "publish") {
      if (template.draftRevision !== input.draftRevision) throw new ApiError(409, "Spara utkastet innan du publicerar.");
      const latest = (await latestVersions([template.id])).get(template.id) ?? null;
      const draftMeta = formMetaOf(template);
      const checks = formPublishChecks(draftMeta, template.draft, latest ? formDocumentSchema.parse(latest.document) : null);
      if (checks.errors.length) throw new ApiError(422, `Formuläret kan inte publiceras: ${checks.errors[0].message}`);
      if (checks.warnings.length && !input.acceptWarnings) throw new ApiError(422, `Godkänn varningarna först: ${checks.warnings[0].message}`);
      const document = formDocumentSchema.parse(template.draft);
      const hash = formDocumentHash(document);
      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "FormTemplate" WHERE id=${template.id} FOR UPDATE`;
        // An unchanged draft republishes the latest version instead of creating an identical new one.
        const same = latest && currentDocumentHash(latest.document) === hash && publishedMetaEqual(formMetaOf(latest), draftMeta);
        const version = same ? latest.version : (latest?.version ?? 0) + 1;
        if (!same) await tx.formTemplateVersion.create({ data: {
          templateId: template.id, version, name: draftMeta.name, displayName: draftMeta.displayName, description: draftMeta.description, color: draftMeta.color, icon: draftMeta.icon,
          category: draftMeta.category, allowStandalone: draftMeta.allowStandalone, allowInProject: draftMeta.allowInProject, document: json(document), hash, publishedBy: ctx.user.id,
          publisherName: template.publisherName, importedFrom: template.importedFrom ?? Prisma.JsonNull,
        } });
        await tx.formTemplate.update({ where: { id: template.id }, data: { status: "PUBLISHED", publishedVersion: version, updatedBy: ctx.user.id } });
        await event(tx, template.id, "PUBLISHED", `Version ${version} publicerades`);
        return { version };
      });
      return NextResponse.json(result);
    }
    if (input.action === "unpublish" || input.action === "republish") {
      if (input.action === "republish" && !template.publishedVersion) throw new ApiError(409, "Formuläret har ingen publicerad version.");
      await prisma.$transaction(async (tx) => {
        await tx.formTemplate.update({ where: { id: template.id }, data: { status: input.action === "unpublish" ? "UNPUBLISHED" : "PUBLISHED", updatedBy: ctx.user.id } });
        await event(tx, template.id, input.action === "unpublish" ? "UNPUBLISHED" : "REPUBLISHED", input.action === "unpublish"
          ? "Formuläret avpublicerades. Befintliga protokoll finns kvar." : `Version ${template.publishedVersion} publicerades igen`);
      });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "reset_to_original" && !template.baseTemplateId) throw new ApiError(409, "Formuläret är inte en version av HINTEK:s original.");
    // Permanent deletion (2026-09-26), also of a published form and of a form with protocols: its versions,
    // history and the form itself. Protocols are never deleted – each keeps its own copy of the form in its data, and
    // the database sets its reference to NULL – so their answers, history and PDF stay intact.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('hintek.allow_form_delete', 'on', true)`;
      await tx.formTemplateVersion.deleteMany({ where: { templateId: template.id } });
      await tx.formTemplate.delete({ where: { id: template.id } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
