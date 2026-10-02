import { kfidFormDocument } from "./builtin-kfid-form";
import { riskFormDocument } from "./builtin-risk-form";
import { formLeafBlocks, type FormColumn, type FormFieldBlock, type FormLeafBlock, type FormSection, type FormTableBlock } from "./form-document";
import { newColumn, newId, noCondition, uniqueKey, type EditorDocument } from "./form-editor";

/**
 * Ready-made control blocks in the field ribbon (2026-10-01: "jag hittar inte kontroll före idrifttagnings
 * kontroller i ikonmenyn, t.ex. JFB-test"). The moments of HINTEK's Kontroll före idrifttagning – Isolation,
 * Kontinuitet, Spänningsprovning, Jordfelsbrytarprov, Automatisk frånkoppling and Visuell kontroll – and the risk
 * assessment's risk cards are inserted exactly as in the originals, with fresh ids and unique short names, so a form
 * builder starts from the real thing and refines it. Two generic blocks, measurement rows and object cards, give the
 * same look for one's own measurements. Pure functions: the data comes from the originals, nothing is published.
 */
export const PRESET_TYPES = ["kfid_iso", "kfid_cont", "kfid_volt", "kfid_rcd", "kfid_zs", "kfid_vis", "risk_table", "measurement_rows", "object_cards"] as const;
export type PresetType = (typeof PRESET_TYPES)[number];
export const PRESET_GROUP = "Kontroll" as const;

export const PRESET_LIBRARY: { type: PresetType; label: string; hint: string; group: typeof PRESET_GROUP }[] = [
  { type: "kfid_iso", label: "Isolation", hint: "moment med mätrader för isolationsresistans, som i Kontroll före idrifttagning", group: PRESET_GROUP },
  { type: "kfid_cont", label: "Kontinuitet", hint: "moment med mätrader för skyddsledarkontinuitet", group: PRESET_GROUP },
  { type: "kfid_volt", label: "Spänning", hint: "moment med mätrader för spänningsprovning och rotation", group: PRESET_GROUP },
  { type: "kfid_rcd", label: "JFB-prov", hint: "moment med jordfelsbrytarprovets tvåradiga mätrader och profilens gränser", group: PRESET_GROUP },
  { type: "kfid_zs", label: "Frånkoppling", hint: "moment med mätrader för felslingeimpedans (Zs)", group: PRESET_GROUP },
  { type: "kfid_vis", label: "Visuell", hint: "moment med kryssrutor för visuell kontroll", group: PRESET_GROUP },
  { type: "risk_table", label: "Risker", hint: "riskbedömningens riskkort med sannolikhet och konsekvens före och efter åtgärd", group: PRESET_GROUP },
  { type: "measurement_rows", label: "Mätrader", hint: "egna mätrader med gräns, Godkänd och bild, som kontrollens", group: PRESET_GROUP },
  { type: "object_cards", label: "Objektkort", hint: "ett kort per objekt med fält, resultat och bilder", group: PRESET_GROUP },
];

export const isPresetType = (value: string): value is PresetType => (PRESET_TYPES as readonly string[]).includes(value);

const KFID_SECTION: Partial<Record<PresetType, string>> = { kfid_iso: "kfid-iso", kfid_cont: "kfid-cont", kfid_volt: "kfid-volt", kfid_rcd: "kfid-rcd", kfid_zs: "kfid-zs", kfid_vis: "kfid-vis" };

export type PresetResult = { kind: "section"; section: FormSection } | { kind: "block"; block: FormLeafBlock };

/** The Ja/nej switch among the moments (the control's Autobedömning) that a preset's Godkänd column can follow. */
function momentSwitch(document: Pick<EditorDocument, "blocks">): FormFieldBlock | undefined {
  const fields = formLeafBlocks(document).filter((block): block is FormFieldBlock => block.type === "field" && block.input === "yesno" && block.momentSwitch);
  return fields.find((field) => field.key === "auto") ?? fields[0];
}

/**
 * A copy of a block with fresh ids and a short name that is unique in the form. A Godkänd column that follows the
 * control's Autobedömning follows the form's own switch when it has one; without one it is decided by its rule.
 */
function cloneLeaf(block: FormLeafBlock, document: Pick<EditorDocument, "blocks">, taken: Set<string>, switchField: FormFieldBlock | undefined): FormLeafBlock {
  const copy = structuredClone(block) as FormLeafBlock;
  copy.id = newId();
  if ("key" in copy) {
    let key = uniqueKey(document, copy.key);
    for (let index = 2; taken.has(key); index++) key = `${copy.key.slice(0, 26)}_${index}`;
    taken.add(key);
    copy.key = key;
  }
  if (copy.type === "table") copy.columns = copy.columns.map((column): FormColumn => {
    const next = { ...column, id: newId() };
    if (next.mode === "switch") { if (switchField) next.switchKey = switchField.key; else { next.mode = "auto"; next.switchKey = ""; } }
    if (next.requiredIf) next.requiredIf = switchField ? switchField.key : "";
    return next;
  });
  return copy;
}

function cloneSection(source: FormSection, document: Pick<EditorDocument, "blocks">): FormSection {
  const taken = new Set<string>();
  const switchField = momentSwitch(document);
  return { ...structuredClone(source), id: newId(), blocks: source.blocks.map((block) => cloneLeaf(block, document, taken, switchField)) };
}

const layout = { width: "full" as const, visibility: { task: true, pdf: true }, showIf: noCondition() };

function measurementRows(document: Pick<EditorDocument, "blocks">): FormTableBlock {
  // Plain ASCII keys, so the rule reads the same in every form ([uppmatt] >= [grans]).
  const columns = [
    { ...newColumn("Mätpunkt", "text", []), key: "matpunkt", required: true, exampleValue: "Mätpunkt 1", screenWidth: "2.3fr" },
    { ...newColumn("Uppmätt", "number", []), key: "uppmatt", required: true, exampleValue: 5, screenWidth: "1fr" },
    { ...newColumn("Gräns", "number", []), key: "grans", required: true, defaultValue: 1, exampleValue: 1, screenWidth: "1fr" },
    { ...newColumn("Kommentar", "textarea", []), key: "kommentar", screenWidth: "2.4fr" },
    { ...newColumn("Godkänd", "assessment", []), key: "ok", formula: "[uppmatt] >= [grans]", pdfWidth: 54, help: "Bedöms av regeln; bocka i själv när Autobedömning är av." },
    { ...newColumn("Bild", "images", []), key: "bild", pdf: "hide" as const, help: "Bild på raden. Den kommer som bilaga efter protokollet." },
  ];
  return { id: newId(), type: "table", key: uniqueKey(document, "Mätrader"), label: "Mätrader", rowMode: "free", fixedRows: [], required: true, help: "", columns, layout: "rows", itemLabel: "", allowExample: true, cardTitle: "", taskLayout: "same", copyRows: false, emptyTitle: "Inga mätningar ännu. Lägg till din första rad.", emptyAction: "", itemLabelPlural: "", startEmpty: true, emptyIcon: "", workOrders: false, ...layout };
}

function objectCards(document: Pick<EditorDocument, "blocks">): FormTableBlock {
  const columns = [
    { ...newColumn("Objekt", "text", []), key: "objekt", required: true, cardWidth: "half" as const, exampleValue: "Objekt 1" },
    { ...newColumn("Status", "choice", []), key: "status", options: ["OK", "Anmärkning", "Ej kontrollerad"], deviationOptions: ["Anmärkning"], cardWidth: "quarter" as const, exampleValue: "OK" },
    { ...newColumn("Kommentar", "textarea", []), key: "kommentar", cardWidth: "full" as const },
    { ...newColumn("Bilder", "images", []), key: "bilder" },
  ];
  return { id: newId(), type: "table", key: uniqueKey(document, "Objekt"), label: "Objekt", rowMode: "free", fixedRows: [], required: false, help: "Ett kort per objekt med fält, resultat och bilder.", columns, layout: "cards", itemLabel: "Objekt", allowExample: false, cardTitle: "{objekt}", taskLayout: "same", copyRows: true, emptyTitle: "", emptyAction: "", itemLabelPlural: "objekt", startEmpty: true, emptyIcon: "", workOrders: false, ...layout };
}

/** The block or moment a preset inserts, made for this form (fresh ids, unique short names). */
export function createPreset(type: PresetType, document: Pick<EditorDocument, "blocks">): PresetResult {
  const kfidSectionId = KFID_SECTION[type];
  if (kfidSectionId) {
    const source = kfidFormDocument.blocks.find((block): block is FormSection => block.type === "section" && block.id === kfidSectionId);
    if (!source) throw new Error(`Momentet ${type} finns inte i originalet.`);
    return { kind: "section", section: cloneSection(source, document) };
  }
  if (type === "risk_table") {
    const source = riskFormDocument.blocks.find((block): block is FormSection => block.type === "section" && block.id === "risk-risker");
    const table = source?.blocks.find((block) => block.type === "table");
    if (!table) throw new Error("Riskkorten finns inte i originalet.");
    return { kind: "block", block: cloneLeaf(table, document, new Set(), undefined) };
  }
  if (type === "measurement_rows") return { kind: "block", block: measurementRows(document) };
  return { kind: "block", block: objectCards(document) };
}
