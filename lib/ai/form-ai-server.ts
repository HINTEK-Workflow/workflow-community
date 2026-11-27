import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import * as formsRoute from "@/app/api/forms/admin/route";
import { FORM_AI_KIND, FORM_AI_TOOL, formProposalFrom, metaForFile, readFormAiForm, type FormAiDraft, type FormAiSkill, type FormDraftPayload } from "@/lib/ai/form-ai";
import { FORM_AI_SKILL_DIR } from "@/lib/kfid/form-ai-skill";
import { formMetaOf, requireFormAdmin } from "@/lib/kfid/form-server";
import { ApiError, type Context } from "@/lib/kfid/server";
import { callRoute, ToolError } from "@/lib/tools/call-route";

type Row = Record<string, unknown>;

let skillText: Promise<FormAiSkill> | null = null;
/** The skill package's own files, read once per process: the model follows exactly what an external AI is given. */
export function readFormAiSkill(root = process.cwd()): Promise<FormAiSkill> {
  const read = (file: string) => readFile(path.join(root, FORM_AI_SKILL_DIR, ...file.split("/")), "utf8");
  skillText ??= Promise.all([read("SKILL.md"), read("references/format-reference.md"), read("assets/mall.json"), read("assets/exempel-egenkontroll.json")])
    .then(([skill, reference, template, example]) => ({ skill, reference, template, example }))
    .catch((error) => { skillText = null; throw error; });
  return skillText;
}

const draftSelect = { id: true, draftRevision: true, draft: true, name: true, displayName: true, description: true, internalNote: true, color: true, icon: true, category: true, allowStandalone: true, allowInProject: true, status: true, publishedVersion: true } as const;
/** The company's own form by id – never another company's and never a Workflow original. */
const ownTemplate = (ctx: Context, id: string) => prisma.formTemplate.findFirst({ where: { id, organizationId: ctx.organizationId }, select: draftSelect });

/**
 * The draft a form-mode question is about: the one open in the builder when it is the company's own, otherwise the draft this
 * conversation's last Skapa utkast made or changed. Only its id, revision and content go to the model.
 */
export async function formAiDraftFor(ctx: Context, input: { templateId?: string | null; conversationId: string }): Promise<(FormAiDraft & { draftRevision: number }) | null> {
  let id = input.templateId ?? null;
  if (!id) {
    const last = await prisma.aiProposal.findFirst({ where: { organizationId: ctx.organizationId, createdById: ctx.user.id, conversationId: input.conversationId, kind: FORM_AI_KIND, status: "APPLIED" }, orderBy: { reviewedAt: "desc" }, select: { result: true } });
    const made = (last?.result as { templateId?: unknown } | null)?.templateId;
    id = typeof made === "string" ? made : null;
  }
  if (!id) return null;
  const template = await ownTemplate(ctx, id);
  if (!template) return null;
  const meta = formMetaOf(template);
  return { templateId: template.id, draftRevision: template.draftRevision, meta: metaForFile(meta), document: template.draft };
}


/**
 * The tool's server side. Whatever the model wrote, the server checks it again: the person may build forms (the forms route's own
 * rule, mayBuildForms in lib/kfid/form-server.ts), a change is to the draft this answer was given and nothing else, and the form passes the import's own reading. Only
 * then is an `AiProposal` saved for the person, in the conversation; no form is touched.
 */
export function createFormProposer(options: { ctx: Context; conversationId: string; runId: string | null; draft: { templateId: string; draftRevision: number } | null }) {
  const { ctx } = options;
  const created: { id: string; kind: string; status: string; payload: unknown }[] = [];
  const refusal = (error: string): Row => ({ error });

  async function handle(name: string, raw: Row): Promise<Row> {
    if (name !== FORM_AI_TOOL) return refusal("Verktyget är inte tillåtet här.");
    let scope;
    try { scope = requireFormAdmin(ctx); } catch (error) { return refusal(error instanceof Error ? error.message : "Du saknar behörigheten Bygga formulär."); }
    const made = formProposalFrom(raw, { publisherName: scope.publisherName, draft: options.draft });
    if ("error" in made) return refusal(made.error);
    const { payload } = made;
    const proposal = await prisma.aiProposal.create({
      data: { organizationId: ctx.organizationId, createdById: ctx.user.id, conversationId: options.conversationId, runId: options.runId, moduleId: "workflow", kind: FORM_AI_KIND, resourceType: "FORM_TEMPLATE", resourceId: payload.templateId ?? options.conversationId, payload: payload as never },
      select: { id: true, kind: true, status: true, payload: true },
    });
    created.push(proposal);
    return { proposal: { id: proposal.id, kind: FORM_AI_KIND, summary: made.line }, note: "Förslaget visas för personen med Skapa utkast. Inget är sparat förrän personen klickar, och formuläret publiceras aldrig härifrån." };
  }

  return { handle: (name: string, raw: Row) => handle(name, raw), created };
}

/** The forms route's own refusal in its own words (the same checks as the builder's own save). */
async function route<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (error) {
    if (error instanceof ToolError) throw new ApiError(error.status, error.message);
    throw error;
  }
}
const formUrl = (id: string) => `/?view=forms&form=${encodeURIComponent(id)}`;

/**
 * Skapa utkast: the form read once more by the import's checks, then saved with the forms route itself – a new draft, or the open
 * draft's next revision. A change waits for the revision the proposal was made on: a draft changed since is never overwritten.
 */
export async function applyFormDraft(ctx: Context, payload: FormDraftPayload) {
  const scope = requireFormAdmin(ctx);
  let form;
  try { form = readFormAiForm(JSON.stringify({ meta: payload.meta, document: payload.document }), scope.publisherName); } catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "Formuläret kunde inte läsas."); }
  const meta = metaForFile(form.meta);
  if (!payload.templateId) {
    const created = await route(() => callRoute(formsRoute.POST, "POST", "/api/forms/admin", { action: "create", ...meta, internalNote: "Skapat med Workflow AI.", document: form.document })) as { id: string; draftRevision: number };
    return { templateId: created.id, draftRevision: created.draftRevision, created: true, url: formUrl(created.id), issues: form.issues.length, message: `Utkastet ”${meta.name}” är sparat. Granska det och publicera när du är klar.` };
  }
  const template = await ownTemplate(ctx, payload.templateId);
  if (!template) throw new ApiError(404, "Formuläret hittades inte.");
  if (template.draftRevision !== payload.draftRevision) throw new ApiError(409, "Utkastet har ändrats sedan förslaget togs fram. Be Workflow AI om ett nytt förslag.");
  const before = { meta: metaForFile(formMetaOf(template)), document: template.draft };
  const saved = await route(() => callRoute(formsRoute.POST, "POST", "/api/forms/admin", { action: "save", id: template.id, draftRevision: template.draftRevision, ...meta, internalNote: template.internalNote, document: form.document, autosave: false })) as { draftRevision: number };
  return { templateId: template.id, draftRevision: saved.draftRevision, created: false, before, url: formUrl(template.id), issues: form.issues.length, message: "Utkastet är ändrat. Granska ändringen och publicera när du är klar." };
}

/** Ångra: only while nobody has touched the draft since (every save raises its revision), and never a published form. */
export async function undoFormDraft(ctx: Context, result: { templateId?: string; draftRevision?: number; created?: boolean; before?: { meta: ReturnType<typeof metaForFile>; document: unknown } }) {
  requireFormAdmin(ctx);
  if (!result.templateId) return;
  const template = await ownTemplate(ctx, result.templateId);
  if (!template) return;
  if (template.draftRevision !== result.draftRevision) throw new ApiError(409, "Utkastet har ändrats sedan det sparades och ångras inte automatiskt. Ändra det i Skapa formulär.");
  if (result.created) {
    if (template.publishedVersion) throw new ApiError(409, "Formuläret är publicerat och tas inte bort härifrån.");
    await route(() => callRoute(formsRoute.POST, "POST", "/api/forms/admin", { action: "delete", id: template.id }));
    return;
  }
  if (!result.before) throw new ApiError(409, "Ändringen går inte att ångra automatiskt. Ändra utkastet i Skapa formulär.");
  await route(() => callRoute(formsRoute.POST, "POST", "/api/forms/admin", { action: "save", id: template.id, draftRevision: template.draftRevision, ...result.before!.meta, internalNote: template.internalNote, document: result.before!.document, autosave: false }));
}
