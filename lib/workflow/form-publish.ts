import { z } from "zod";
import { formBlockVisible, formLeafBlocks, validateFormDocument, type FormDocument, type FormIssue, type FormLeafBlock, type FormSection } from "./form-document";
import { normalizeFormDocument } from "./form-editor";

/**
 * A form's basic details (grunduppgifter) and the checks before publishing (2026-09-26, the approved editor,
 * decision 2). The details are versioned with every publication, like the document.
 */
export const FORM_COLORS = ["green", "blue", "violet", "amber", "rose", "cyan"] as const;
export const FORM_ICONS = ["file-spreadsheet", "clipboard-check", "list-checks", "gauge", "zap", "plug", "wrench", "shield-check", "shield-alert", "flame", "thermometer", "camera", "building"] as const;
/**
 * The control library's categories under Ny uppgift (2026-09-28). The earlier categories are read as their nearest new
 * one, so published versions and companies' own forms keep working without being rewritten.
 */
export const FORM_CATEGORIES = [
  ["ELECTRICAL", "Elinstallation"],
  ["POWER", "Elkraft"],
  ["INDUSTRY", "Industri"],
  ["ROUNDS", "Underhåll och driftronder"],
  ["PROPERTY", "Fastigheter"],
  ["SAFETY", "Arbetsmiljö och säkerhet"],
  ["OTHER", "Övrigt"],
] as const;
export type FormCategory = (typeof FORM_CATEGORIES)[number][0];
const LEGACY_CATEGORIES: Record<string, FormCategory> = { INSPECTION: "ELECTRICAL", SERVICE: "ROUNDS", SELF_CHECK: "ELECTRICAL" };
export const formCategory = (category: unknown): FormCategory => { const value = typeof category === "string" ? LEGACY_CATEGORIES[category] ?? category : "OTHER"; return FORM_CATEGORIES.some(([item]) => item === value) ? value as FormCategory : "OTHER"; };
export const formCategoryLabel = (category: string) => FORM_CATEGORIES.find(([value]) => value === formCategory(category))?.[1] ?? "Övrigt";

export const formMetaSchema = z.object({
  name: z.string().trim().max(120).default(""),
  /** The name under Ny uppgift; empty means the same as the name. */
  displayName: z.string().trim().max(120).default(""),
  /** The short description under Ny uppgift. */
  description: z.string().trim().max(500).default(""),
  /** For HINTEK only; never shown to customers. */
  internalNote: z.string().trim().max(2000).default(""),
  color: z.enum(FORM_COLORS).catch("green").default("green"),
  icon: z.enum(FORM_ICONS).catch("file-spreadsheet").default("file-spreadsheet"),
  category: z.preprocess((value) => value === undefined ? undefined : formCategory(value), z.enum(FORM_CATEGORIES.map(([value]) => value) as [FormCategory, ...FormCategory[]]).catch("OTHER").default("OTHER")),
  allowStandalone: z.boolean().default(true),
  allowInProject: z.boolean().default(true),
});
export type FormMeta = z.infer<typeof formMetaSchema>;
export const emptyFormMeta = (): FormMeta => formMetaSchema.parse({});
export const formDisplayName = (meta: Pick<FormMeta, "name" | "displayName">) => meta.displayName.trim() || meta.name.trim() || "Namnlöst formulär";

export type PublishIssue = FormIssue & { meta?: keyof FormMeta };
export type PublishChecks = { errors: PublishIssue[]; warnings: PublishIssue[] };

const VALUE_TYPES = new Set<FormLeafBlock["type"]>(["field", "checklist", "table", "computed", "images", "signature"]);
const blockName = (block: FormLeafBlock) => "label" in block ? block.label : block.type === "heading" || block.type === "text" ? block.text.slice(0, 60) : "Sidbrytning";
const needsInput = (block: FormLeafBlock) => (block.type === "field" || block.type === "checklist" || block.type === "table" || block.type === "signature") && block.required
  || (block.type === "images" && block.minCount > 0);

/**
 * Errors stop publishing; warnings can be accepted. The same checks run in the editor and on the server.
 * `previous` is the latest published version, used to warn when a short name changes between versions.
 */
export function formPublishChecks(metaInput: unknown, documentInput: unknown, previous?: FormDocument | null): PublishChecks {
  const meta = formMetaSchema.parse(metaInput ?? {});
  const errors: PublishIssue[] = [];
  const warnings: PublishIssue[] = [];
  if (!meta.name) errors.push({ meta: "name", message: "Ange formulärets namn." });
  if (!meta.allowStandalone && !meta.allowInProject) errors.push({ meta: "allowStandalone", message: "Välj om formuläret får användas fristående, i projekt eller båda." });
  const { document, issues } = validateFormDocument(documentInput);
  errors.push(...issues);
  if (!document) return { errors, warnings };
  const leaves = formLeafBlocks(document);
  if (!leaves.some((block) => VALUE_TYPES.has(block.type))) errors.push({ message: "Lägg till minst ett fält att fylla i." });
  for (const block of leaves) {
    if (needsInput(block) && !formBlockVisible(block, "task")) errors.push({ blockId: block.id, message: `${blockName(block)}: ett obligatoriskt block måste visas i uppgiften.` });
    if (block.type === "signature" && block.required && !formBlockVisible(block, "pdf")) errors.push({ blockId: block.id, message: `${blockName(block)}: en obligatorisk signatur måste visas i PDF:en.` });
    if (block.type !== "pagebreak" && !formBlockVisible(block, "task") && !formBlockVisible(block, "pdf")) warnings.push({ blockId: block.id, message: `${blockName(block)} visas varken i uppgiften eller i PDF:en.` });
  }
  if (!leaves.some((block) => block.type === "signature")) warnings.push({ message: "Formuläret har ingen signatur." });
  // Page breaks: first, last or two in a row do nothing useful.
  const flow = document.blocks.flatMap((block) => block.type === "section" ? [...(block.newPage ? [{ id: block.id, pagebreak: true }] : []), ...block.blocks.map((leaf) => ({ id: leaf.id, pagebreak: leaf.type === "pagebreak" }))]
    : block.type === "columns" ? block.columns.flat().map((leaf) => ({ id: leaf.id, pagebreak: false })) : [{ id: block.id, pagebreak: block.type === "pagebreak" }]);
  flow.forEach((item, index) => {
    if (!item.pagebreak) return;
    if (index === 0 || index === flow.length - 1) warnings.push({ blockId: item.id, message: `En sidbrytning ${index === 0 ? "först" : "sist"} i formuläret gör ingen skillnad.` });
    else if (flow[index - 1].pagebreak) warnings.push({ blockId: item.id, message: "Två sidbrytningar i rad ger en tom sida." });
  });
  for (const section of document.blocks.filter((block): block is FormSection => block.type === "section"))
    if (!section.blocks.length && document.blocks.length > 1) warnings.push({ blockId: section.id, message: `Avsnittet ${section.title || "utan rubrik"} är tomt.` });
  if (previous) {
    const before = new Map(formLeafBlocks(previous).flatMap((block) => "key" in block ? [[block.id, block.key] as const] : []));
    for (const block of leaves) if ("key" in block && before.has(block.id) && before.get(block.id) !== block.key)
      warnings.push({ blockId: block.id, message: `${blockName(block)}: den interna koden ändras från ${before.get(block.id)} till ${block.key}. Värden kan inte jämföras mellan versionerna.` });
  }
  return { errors, warnings };
}

// ---------- what changed since the latest published version ----------
export type FormChange = { kind: "added" | "removed" | "changed" | "order" | "meta"; blockId?: string; text: string };

const PROPERTY_NAMES: Record<string, string> = {
  label: "etikett", text: "text", title: "rubrik", description: "beskrivning", key: "intern kod", required: "obligatoriskt", help: "hjälptext", unit: "enhet",
  min: "godkänt intervall", max: "godkänt intervall", allowedMin: "tillåtet intervall", allowedMax: "tillåtet intervall", decimals: "decimaler", maxLength: "längsta text",
  options: "alternativ", multiple: "flerval", deviationOn: "avvikelse", deviationOptions: "avvikelse", defaultValue: "standardvärde", input: "fälttyp",
  formula: "formel", passCondition: "villkor för godkänt", columns: "kolumner", rowMode: "rader", fixedRows: "rader", items: "punkter", minCount: "minsta antal",
  accept: "filtyper", width: "bredd", visibility: "visning", level: "rubriknivå", newPage: "ny sida i PDF", allowNotApplicable: "Ej aktuellt",
};
const META_NAMES: Record<keyof FormMeta, string> = {
  name: "Namn", displayName: "Namn under Ny uppgift", description: "Kort beskrivning", internalNote: "Intern beskrivning", color: "Färg", icon: "Ikon",
  category: "Kategori", allowStandalone: "Fristående användning", allowInProject: "Användning i projekt",
};

/** Plain-language changes from `before` (null: never published) to `after`, for the publish dialog. */
export function diffFormVersions(before: { meta: unknown; document: unknown } | null, after: { meta: unknown; document: unknown }): FormChange[] {
  if (!before) return [{ kind: "added", text: "Första versionen av formuläret." }];
  const changes: FormChange[] = [];
  const metaBefore = formMetaSchema.parse(before.meta ?? {});
  const metaAfter = formMetaSchema.parse(after.meta ?? {});
  for (const key of Object.keys(META_NAMES) as (keyof FormMeta)[])
    if (key !== "internalNote" && JSON.stringify(metaBefore[key]) !== JSON.stringify(metaAfter[key])) changes.push({ kind: "meta", text: `${META_NAMES[key]} ändrad.` });
  const a = normalizeFormDocument(before.document);
  const b = normalizeFormDocument(after.document);
  type Item = { id: string; name: string; value: Record<string, unknown> };
  const items = (document: typeof a): Item[] => document.blocks.flatMap((section) => [
    { id: section.id, name: `Avsnittet ${section.title || "utan rubrik"}`, value: { title: section.title, description: section.description, newPage: section.newPage } },
    ...section.blocks.map((block) => ({ id: block.id, name: blockName(block), value: block as unknown as Record<string, unknown> })),
  ]);
  const beforeItems = items(a);
  const afterItems = items(b);
  const beforeById = new Map(beforeItems.map((item) => [item.id, item]));
  const afterIds = new Set(afterItems.map((item) => item.id));
  for (const item of afterItems) {
    const old = beforeById.get(item.id);
    if (!old) { changes.push({ kind: "added", blockId: item.id, text: `Nytt: ${item.name}.` }); continue; }
    const changed = [...new Set(Object.keys({ ...old.value, ...item.value }).filter((key) => key !== "id" && key !== "type" && JSON.stringify(old.value[key]) !== JSON.stringify(item.value[key])).map((key) => PROPERTY_NAMES[key] ?? "inställningar"))];
    if (changed.length) changes.push({ kind: "changed", blockId: item.id, text: `Ändrat: ${item.name} (${changed.join(", ")}).` });
  }
  for (const item of beforeItems) if (!afterIds.has(item.id)) changes.push({ kind: "removed", text: `Borttaget: ${item.name}.` });
  const commonBefore = beforeItems.filter((item) => afterIds.has(item.id)).map((item) => item.id);
  const commonAfter = afterItems.filter((item) => beforeById.has(item.id)).map((item) => item.id);
  if (commonBefore.join() !== commonAfter.join()) changes.push({ kind: "order", text: "Ordningen har ändrats." });
  return changes;
}
