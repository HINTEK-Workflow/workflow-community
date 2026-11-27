import { z } from "zod";
import { aiMay, sharesWork, type AiSharingPolicy } from "@/lib/ai/sharing-policy";
import type { ProviderTool } from "@/lib/ai/structured-provider";
import { TOOL_CATALOG } from "@/lib/tools/catalog";
import { formLeafBlocks, type FormDocument, type FormValues } from "@/lib/workflow/form-document";

/**
 * Förslag från chatten (2026-10-09, AI-beslut 1, 2 och 4: "Vad AI får göra är en admin-inställning, men ju mer
 * den kan desto bättre"). Workflow AI may answer a work request with a proposal – a work order, a work order filled in
 * with performed work and material rows, a time entry, planning, a quote, or hazards with measures for an extended risk
 * assessment. A proposal tool only creates an `AiProposal`; nothing is changed until the person clicks Använd, it is
 * carried out with the ordinary tool in the person's own session, and Ångra takes it back. Safety decisions are never
 * proposed: no completing, signing, confirming a risk assessment, approving a value, likelihood, consequence or
 * residual risk, and never an answer to the simplified risk step's questions.
 *
 * Pure: the tool definitions the model sees, the input checks and the payloads. No database, no provider.
 */
export const CHAT_PROPOSAL_TOOLS = ["propose_work_order", "propose_work_order_fill", "propose_time_entry", "propose_planning", "propose_quote", "propose_risk_hazards", "propose_place_nameplate", "propose_post_draft", "propose_agent_mission", "propose_action"] as const;
export type ChatProposalTool = (typeof CHAT_PROPOSAL_TOOLS)[number];
export const CHAT_PROPOSAL_KIND: Record<ChatProposalTool, string> = {
  propose_work_order: "WORK_ORDER", propose_work_order_fill: "WORK_ORDER_FILL", propose_time_entry: "TIME_ENTRY",
  propose_planning: "PROJECT_PLANNING", propose_quote: "QUOTE", propose_risk_hazards: "RISK_HAZARDS", propose_place_nameplate: "PLACE_NAMEPLATE",
  propose_post_draft: "POST_DRAFT", propose_agent_mission: "AGENT_MISSION", propose_action: "ACTION",
};

/**
 * Auto (2026-11-21): the kinds the chat's Auto saves at once, because Ångra takes each of them back – a work order (Planerad,
 * without owner), planning, a quote draft, a post draft and an agent mission. Everything else stays a proposal with Använd, also in
 * Auto. Auto never signs, completes, sends, publishes or deletes.
 */
// PLACE_NAMEPLATE (the branch ai-bild, merged separately): a place read from a nameplate photo, which its own Ångra takes back.
export const AUTO_KINDS = ["WORK_ORDER", "PROJECT_PLANNING", "QUOTE", "POST_DRAFT", "AGENT_MISSION", "PLACE_NAMEPLATE"] as const;
export const isAutoKind = (kind: string) => (AUTO_KINDS as readonly string[]).includes(kind);
export const CHAT_MODES = ["manual", "auto"] as const;
export type ChatMode = (typeof CHAT_MODES)[number];
export const isChatProposalTool = (name: string): name is ChatProposalTool => (CHAT_PROPOSAL_TOOLS as readonly string[]).includes(name);

/** How many tool calls an answer may make when the question is a work request and the company allows more (AI-beslut 2). */
export const ASSISTANT_WORK_MAX_TOOL_CALLS = 5;
/** The most nameplate ratings (märkdata) one proposal may hold. */
export const NAMEPLATE_MAX_RATINGS = 8;

/** The proposal tools this company's switches allow, in a fixed order (the provider's prompt cache). */
export function chatProposalToolNames(policy: AiSharingPolicy): ChatProposalTool[] {
  if (!sharesWork(policy)) return [];
  return CHAT_PROPOSAL_TOOLS.filter((name) => name === "propose_risk_hazards" ? aiMay(policy, "riskTogether") : aiMay(policy, "chatProposals"));
}

const WORK_REQUEST = /(^|[\s,.!?])(skapa|gör (en|ett|om|klart)|lägg (till|in)|fyll i|fyll på|registrera|rapportera|skriv (in |upp )?tid|skriv in|planera|boka|ändra|uppdatera|flytta|ta fram|föreslå|offert|riskbedöm|faror|material(rader)?|skriv (ett|en) |varje (dag|vecka|månad|måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)|inlägg|uppdrag)/;
/** Whether the question asks Workflow AI to do something (it then may use up to five tool calls and propose). */
export function isWorkRequest(question: string) {
  return WORK_REQUEST.test(` ${question.toLocaleLowerCase("sv")}`);
}

// ---------- What the model sees ----------
const str = { type: "string" } as const;
const nullableStr = { type: ["string", "null"] } as const;
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const SAFETY = "Föreslå aldrig att färdigställa, signera, bekräfta en riskbedömning eller godkänna ett mätvärde.";

export const CHAT_PROPOSAL_DEFINITIONS: Record<ChatProposalTool, ProviderTool> = {
  propose_work_order: { name: "propose_work_order",
    description: `Föreslå en ny arbetsorder som personen bekräftar med Använd. title högst 80 tecken, description som korta punkter, dueDate ÅÅÅÅ-MM-DD eller null. Koppla den med sourceTaskId (uppgiften den följer upp), projectId eller customerId – bara id du har fått från ett verktyg eller currentPage, aldrig gissade. ${SAFETY}`,
    parameters: obj({ title: str, description: str, dueDate: nullableStr, sourceTaskId: nullableStr, projectId: nullableStr, customerId: nullableStr }) },
  propose_work_order_fill: { name: "propose_work_order_fill",
    description: "Föreslå ifyllnad av en arbetsorder ur det personen skrev: executionNotes (utfört arbete), deviations (avvikelser) och materialrader (benämning, antal, enhet). Ta bara med det som står i personens text eller verktygens svar – hitta aldrig på material, antal eller priser. Fält som inte ska ändras: null, och materials tom lista.",
    parameters: obj({ taskId: str, executionNotes: nullableStr, deviations: nullableStr, materials: { type: "array", items: obj({ name: str, quantity: str, unit: str }) } }) },
  propose_time_entry: { name: "propose_time_entry",
    description: "Föreslå en tidpost för personens egen tid på en arbetsorder (taskId: arbetsordern, eller en uppgift – tiden hamnar då på uppgiftens arbetsorder). startedAt och endedAt som ISO-tid med svensk tidszon (t.ex. 2026-10-09T07:00:00+02:00), räknat från today. Starta tid spärras som vanligt om riskbedömningen inte är gjord.",
    parameters: obj({ taskId: str, startedAt: str, endedAt: str, note: nullableStr }) },
  propose_planning: { name: "propose_planning",
    description: "Föreslå när ett projekts oplanerade, öppna uppgifter ska göras: en rad per uppgift (taskId från get_project), day ÅÅÅÅ-MM-DD en vardag från i morgon, startHour 7–15, hours 1–8; inte två uppgifter samma tid samma dag. note: en mening eller tom. Ingen ansvarig sätts.",
    parameters: obj({ projectId: str, activities: { type: "array", items: obj({ taskId: str, day: str, startHour: { type: "integer" }, hours: { type: "integer" } }) }, note: str }) },
  propose_quote: { name: "propose_quote",
    description: "Föreslå ett offertutkast ur projektets material. Du skriver bara title och description (kort beskrivning av arbetet); raderna och beloppen tar Workflow själv ur projektets material och priser – ange aldrig belopp. Att skicka offerten till kund gör personen alltid själv.",
    parameters: obj({ projectId: str, title: str, description: str }) },
  propose_risk_hazards: { name: "propose_risk_hazards",
    description: "Bara för en utökad riskbedömning (riskbedömningsformuläret): föreslå faror utifrån jobbets beskrivning och plats, med en konkret skyddsåtgärd per fara (högst två meningar). En fara per rad. Ange aldrig sannolikhet, konsekvens eller kvarvarande risk – det bedömer personen. Den förenklade riskbedömningens frågor svarar du aldrig på; där förklarar du bara vad frågorna menar så att personen svarar själv.",
    parameters: obj({ taskId: str, hazards: { type: "array", items: obj({ hazard: str, measure: str }) } }) },
  // Märkskylt (2026-11-21): what a nameplate says, for the object on the work order's place – usually read from a photo.
  propose_place_nameplate: { name: "propose_place_nameplate",
    description: "Föreslå märkskyltens uppgifter för objektet på arbetsorderns plats (taskId: arbetsordern, den öppna eller en du har hämtat). manufacturer (fabrikat), model (modell) och serialNumber (serienummer) ordagrant som de står, null för det som inte syns eller är oläsligt. ratings: övrig märkdata som label och value med enhet, t.ex. Märkspänning, 400 V. Bara det som står på skylten eller i personens text – aldrig gissat, aldrig gränsvärden, mätvärden eller bedömningar.",
    parameters: obj({ taskId: str, manufacturer: nullableStr, model: nullableStr, serialNumber: nullableStr, ratings: { type: "array", items: obj({ label: str, value: str }) } }) },
  propose_post_draft: { name: "propose_post_draft",
    description: "Föreslå ett utkast till inlägg under Inlägg (sparas alltid som utkast, publiceras aldrig härifrån). heading högst 60 tecken, body en kort mening, caption 2–4 korta meningar. Skriv bara det personen bad om eller som står i verktygens svar; nämn aldrig kunder, adresser, personer, priser eller elsäkerhet och lova aldrig något.",
    parameters: obj({ heading: str, body: str, caption: str }) },
  propose_agent_mission: { name: "propose_agent_mission",
    description: "När personen vill att något ska göras återkommande (varje vecka, varje månad …): föreslå ett agentuppdrag under Agenter. text: personens egna ord om vad, när, vad agenten skapar och hur resultatet ska komma, oförändrat. Servern tolkar och kontrollerar uppdraget; saknas något svarar den med frågor som du ställer till personen, ordagrant.",
    parameters: obj({ text: str }) },
  propose_action: { name: "propose_action",
    description: "Föreslå en ändring i Workflow med ett av katalogens verktyg (till exempel update_task för att sätta ansvarig eller ändra datum, create_planned_activity för att boka, create_customer, update_project, cancel_task, add_material_rows, report_obstacle). tool: verktygets namn. input: verktygets indata som JSON-text, bara med id du har fått från ett verktyg. Signera, färdigställ, ta bort, skicka till kund och ändra inställningar finns inte. Personen ser förslaget med Använd; i Auto sparas det direkt när det går att ångra.",
    parameters: obj({ tool: str, input: str }) },
};

export function chatProposalDefinitions(policy: AiSharingPolicy): ProviderTool[] {
  return chatProposalToolNames(policy).map((name) => CHAT_PROPOSAL_DEFINITIONS[name]);
}

// ---------- The server's checks of what the model asked for ----------
const id = z.string().trim().min(1).max(100);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((value) => value || null);
export const chatProposalInput = {
  propose_work_order: z.object({ title: z.string().trim().min(1).max(200), description: z.string().trim().max(5_000).default(""), dueDate: day.nullish(), sourceTaskId: id.nullish(), projectId: id.nullish(), customerId: id.nullish() }),
  propose_work_order_fill: z.object({ taskId: id, executionNotes: optionalText(10_000), deviations: optionalText(10_000),
    materials: z.array(z.object({ name: z.string().trim().min(1).max(200), quantity: z.string().trim().max(40).default(""), unit: z.string().trim().max(40).default("") })).max(50).default([]) })
    .refine((value) => value.executionNotes || value.deviations || value.materials.length, "Förslaget innehåller inget att fylla i."),
  propose_time_entry: z.object({ taskId: id, startedAt: z.iso.datetime({ offset: true }), endedAt: z.iso.datetime({ offset: true }), note: optionalText(1_000) }),
  propose_planning: z.object({ projectId: id, activities: z.array(z.object({ taskId: id, day: z.string().max(10), startHour: z.number().int().min(0).max(23), hours: z.number().int().min(1).max(12) })).min(1).max(30), note: z.string().trim().max(300).default("") }),
  propose_quote: z.object({ projectId: id, title: z.string().trim().min(1).max(200), description: z.string().trim().max(5_000).default("") }),
  propose_risk_hazards: z.object({ taskId: id, hazards: z.array(z.object({ hazard: z.string().trim().min(1).max(500), measure: z.string().trim().min(1).max(500) })).min(1).max(20) }),
  propose_place_nameplate: z.object({ taskId: id, manufacturer: optionalText(120), model: optionalText(120), serialNumber: optionalText(120),
    ratings: z.array(z.object({ label: z.string().trim().min(1).max(60), value: z.string().trim().min(1).max(200) })).max(NAMEPLATE_MAX_RATINGS).default([]) })
    .refine((value) => value.manufacturer || value.model || value.serialNumber || value.ratings.length, "Förslaget innehåller inget från märkskylten."),
  propose_post_draft: z.object({ heading: z.string().trim().min(1).max(120), body: z.string().trim().max(300).default(""), caption: z.string().trim().max(2_000).default("") }),
  propose_agent_mission: z.object({ text: z.string().trim().min(5).max(1_000) }),
  propose_action: z.object({ tool: z.string().trim().min(3).max(40), input: z.string().max(20_000) }),
} satisfies Record<ChatProposalTool, z.ZodType>;

// ---------- Märkskylt till platsens objekt ----------
export type PlaceNameplate = { manufacturer: string | null; model: string | null; serialNumber: string | null; ratings: { label: string; value: string }[] };
type PlaceAttribute = { label: string; value: string };
type PlaceObjectFields = { manufacturer: string; model: string; serialNumber: string; attributes: PlaceAttribute[] };
/**
 * The place's object data with the nameplate put in: a field the plate gave replaces the old value, every other field stays; a
 * rating replaces the attribute with the same label (case ignored) or is added last, within the place's limit of 30. `before` is
 * what Ångra puts back.
 */
export function applyNameplate(place: PlaceObjectFields, plate: PlaceNameplate, limit = 30) {
  const attributes = [...place.attributes];
  for (const rating of plate.ratings) {
    const at = attributes.findIndex((item) => item.label.trim().toLocaleLowerCase("sv") === rating.label.trim().toLocaleLowerCase("sv"));
    if (at >= 0) attributes[at] = { label: attributes[at].label, value: rating.value };
    else if (attributes.length < limit) attributes.push({ label: rating.label, value: rating.value });
  }
  return {
    next: { manufacturer: plate.manufacturer ?? place.manufacturer, model: plate.model ?? place.model, serialNumber: plate.serialNumber ?? place.serialNumber, attributes },
    before: { manufacturer: place.manufacturer, model: place.model, serialNumber: place.serialNumber, attributes: place.attributes },
  };
}
/** Whether the place still holds exactly what the proposal put there (only then does Ångra put the old values back). */
export const nameplateUntouched = (place: PlaceObjectFields, applied: PlaceObjectFields) =>
  JSON.stringify([place.manufacturer, place.model, place.serialNumber, place.attributes]) === JSON.stringify([applied.manufacturer, applied.model, applied.serialNumber, applied.attributes]);

/** The longest time entry a proposal may hold, and how far back it may reach. */
export const TIME_PROPOSAL_MAX_HOURS = 16;
export const TIME_PROPOSAL_MAX_DAYS_BACK = 31;
/** What is wrong with a proposed time entry, or null. Times are compared as instants. */
export function timeProposalProblem(startedAt: string, endedAt: string, now = new Date()): string | null {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "Tiden gick inte att läsa.";
  if (end <= start) return "Sluttiden måste vara efter starttiden.";
  if (end - start > TIME_PROPOSAL_MAX_HOURS * 3_600_000) return `En tidpost är högst ${TIME_PROPOSAL_MAX_HOURS} timmar.`;
  if (end > now.getTime() + 15 * 60_000) return "Tid i framtiden rapporteras inte. Planera den i stället.";
  if (start < now.getTime() - TIME_PROPOSAL_MAX_DAYS_BACK * 86_400_000) return `Tid äldre än ${TIME_PROPOSAL_MAX_DAYS_BACK} dagar rapporteras i tidrapporten.`;
  return null;
}

/** The work order the model proposed, as the input of `create_work_order`; the links are the server's (`links`). */
export function chatWorkOrderPayload(output: z.output<typeof chatProposalInput.propose_work_order>, links: { projectId?: string | null; customerId?: string | null; facilityId?: string | null; sourceTaskId?: string | null }) {
  return TOOL_CATALOG.create_work_order.input.parse({
    title: output.title.slice(0, 200), description: output.description,
    ...(output.dueDate ? { dueDate: output.dueDate } : {}),
    ...Object.fromEntries(Object.entries(links).filter(([, value]) => value)),
  });
}

// ---------- Work order fill and material rows ----------
type MaterialLike = { id: string; name: string; quantity: string; unit: string } & Record<string, unknown>;
const newId = () => globalThis.crypto.randomUUID();

/** New rows last in a work order's material; the existing rows are left as they are. */
export function appendMaterialRows<T extends Record<string, unknown>>(existing: readonly T[], rows: readonly { name: string; quantity?: string; unit?: string }[], makeId = newId) {
  const added = rows.map((row) => ({ id: makeId(), name: row.name.trim().slice(0, 300), quantity: (row.quantity ?? "").trim().slice(0, 40), unit: (row.unit ?? "").trim().slice(0, 40), kind: "material" as const }));
  return { materials: [...existing, ...added] as (T | MaterialLike)[], rowIds: added.map((row) => row.id) };
}

const joined = (before: unknown, added: string | null) => {
  const old = typeof before === "string" ? before.trim() : "";
  if (!added) return typeof before === "string" ? before : "";
  return old ? `${old}\n${added}` : added;
};
export type WorkOrderFill = { executionNotes: string | null; deviations: string | null; materials: { name: string; quantity: string; unit: string }[] };
/** A work order's details with the proposed text added after what is already there, and the rows last. */
export function fillWorkOrderDetails(details: Record<string, unknown>, fill: WorkOrderFill, makeId = newId) {
  const rows = appendMaterialRows((details.materials as Record<string, unknown>[] | undefined) ?? [], fill.materials, makeId);
  return {
    details: { ...details, executionNotes: joined(details.executionNotes, fill.executionNotes), deviations: joined(details.deviations, fill.deviations), materials: rows.materials },
    undo: { executionNotes: typeof details.executionNotes === "string" ? details.executionNotes : "", deviations: typeof details.deviations === "string" ? details.deviations : "", rowIds: rows.rowIds },
  };
}
/** The details as they were before the fill: the texts back, the added rows removed (other rows stay). */
export function undoWorkOrderFill(details: Record<string, unknown>, undo: { executionNotes: string; deviations: string; rowIds: string[] }) {
  const removed = new Set(undo.rowIds);
  return { ...details, executionNotes: undo.executionNotes, deviations: undo.deviations, materials: ((details.materials as { id?: string }[] | undefined) ?? []).filter((row) => !removed.has(String(row.id))) };
}

// ---------- Hazards for the extended risk assessment ----------
/** The risk form's table of hazards (a column fara and a column atgard), or null when the task has none. */
export function riskTableKey(document: FormDocument | null | undefined): string | null {
  if (!document) return null;
  try {
    const table = formLeafBlocks(document).find((block) => block.type === "table" && ["fara", "atgard"].every((key) => (block as { columns: { key: string }[] }).columns.some((column) => column.key === key)));
    return table ? (table as { key: string }).key : null;
  } catch { return null; }
}

const cellEmpty = (value: unknown) => value === undefined || value === null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && !value.length);
type TableRow = FormValues["tables"][string][number];
/**
 * The hazards in the risk table: empty rows are used first, then new rows last. Only Fara and Åtgärd are filled –
 * likelihood, consequence and residual risk stay empty for the person to judge.
 */
export function addHazardRows(values: FormValues, key: string, hazards: readonly { hazard: string; measure: string }[], makeId = newId) {
  const rows = [...(values.tables[key] ?? [])] as TableRow[];
  const filled: string[] = [];
  const appended: string[] = [];
  const queue = [...hazards];
  for (let index = 0; index < rows.length && queue.length; index += 1) {
    const row = rows[index];
    if (row.example || Object.values(row.cells ?? {}).some((cell) => !cellEmpty(cell))) continue;
    const next = queue.shift()!;
    rows[index] = { ...row, cells: { ...row.cells, fara: next.hazard, atgard: next.measure } };
    filled.push(row.id);
  }
  for (const next of queue) {
    const rowId = makeId();
    rows.push({ id: rowId, label: "", cells: { fara: next.hazard, atgard: next.measure } });
    appended.push(rowId);
  }
  return { values: { ...values, tables: { ...values.tables, [key]: rows } }, undo: { key, filled, appended } };
}
/** Takes the proposed hazards back: new rows removed, rows that were empty emptied again. */
export function undoHazardRows(values: FormValues, undo: { key: string; filled: string[]; appended: string[] }) {
  const appended = new Set(undo.appended);
  const filled = new Set(undo.filled);
  const rows = (values.tables[undo.key] ?? []).filter((row) => !appended.has(row.id)).map((row) => filled.has(row.id) ? { ...row, cells: { ...row.cells, fara: "", atgard: "" } } : row);
  return { ...values, tables: { ...values.tables, [undo.key]: rows } };
}

// ---------- A quote from the project's material ----------
type MaterialLine = { name: string; unit: string; quantity: string; total: number | null; price?: { sale: number; unpriced: number } };
const decimal = (value: number) => (Math.round(value * 100) / 100).toString().replace(".", ",");
/**
 * The quote's lines from Material i projektet, by the rules: name, summed quantity and unit; the price per unit only
 * when every row of the line had a price the person may see. Lines whose quantity is not a number are left out and
 * counted. The model writes only the title and the description – never an amount.
 */
export function quoteFromProjectMaterials(project: Record<string, unknown>, text: { title: string; description: string }) {
  const lines = ((project.materials as { lines?: MaterialLine[] } | undefined)?.lines ?? []).filter((line) => line.name?.trim());
  const usable = lines.filter((line) => line.total !== null && line.total > 0).slice(0, 300);
  const quoteLines = usable.map((line) => {
    const priced = line.price && line.price.unpriced === 0 && line.price.sale > 0 && line.total ? decimal(line.price.sale / line.total) : "";
    return { kind: "MATERIAL" as const, name: line.name.trim().slice(0, 300), quantity: decimal(line.total!), unit: (line.unit || "st").slice(0, 40), unitPrice: priced, markupPercent: "" };
  });
  return {
    quote: { title: text.title.slice(0, 200), description: text.description.slice(0, 5_000), projectId: String(project.id), customerId: project.customerId ? String(project.customerId) : null, facilityId: project.facilityId ? String(project.facilityId) : null, validUntil: "", terms: "", lines: quoteLines },
    unpriced: quoteLines.filter((line) => !line.unitPrice).length,
    skipped: lines.length - usable.length,
  };
}

// ---------- What the card and the model are told ----------
type Payload = Record<string, unknown>;
/** One line about a proposal, for the model's tool answer (data, never instructions). */
export function chatProposalSummary(kind: string, payload: Payload): string {
  if (kind === "WORK_ORDER") return `Arbetsorder ”${String(payload.title ?? "")}”${payload.dueDate ? `, klart senast ${String(payload.dueDate)}` : ""}.`;
  if (kind === "WORK_ORDER_FILL") { const rows = (payload.materials as unknown[] | undefined)?.length ?? 0; return `Ifyllnad av arbetsordern${payload.executionNotes ? ": utfört arbete" : ""}${payload.deviations ? ", avvikelser" : ""}${rows ? `, ${rows} materialrader` : ""}.`; }
  if (kind === "TIME_ENTRY") return `Tidpost ${String(payload.startedAt ?? "")} – ${String(payload.endedAt ?? "")}.`;
  if (kind === "PROJECT_PLANNING") return `Planering av ${(payload.activities as unknown[] | undefined)?.length ?? 0} uppgifter.`;
  if (kind === "QUOTE") { const quote = payload.quote as Payload | undefined; return `Offertutkast ”${String(quote?.title ?? "")}” med ${(quote?.lines as unknown[] | undefined)?.length ?? 0} rader${Number(payload.unpriced ?? 0) ? `, ${Number(payload.unpriced)} utan pris` : ""}.`; }
  if (kind === "RISK_HAZARDS") return `${(payload.hazards as unknown[] | undefined)?.length ?? 0} faror med skyddsåtgärder till den utökade riskbedömningen.`;
  if (kind === "PLACE_NAMEPLATE") return `Märkskyltens uppgifter till ${String(payload.placeName ?? "objektet")}.`;
  if (kind === "POST_DRAFT") return `Utkast till inlägg ”${String(payload.heading ?? "")}”.`;
  if (kind === "ACTION") return `${String(payload.title ?? "Ändring")}.`;
  if (kind === "AGENT_MISSION") { const draft = payload.draft as Payload | undefined; return `Agentuppdrag ”${String(draft?.name ?? "")}”, ${String(payload.scheduleText ?? "")}.`; }
  return "Förslag.";
}
