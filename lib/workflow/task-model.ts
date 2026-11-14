import { z } from "zod";
import { purchaseRefSchema } from "@/lib/purchases/ref";
import { storeRefSchema } from "./store-ref";
import { productInfoSchema } from "@/lib/catalogue/product-info";
import { formCompletion, formDocumentSchema, formFieldFilledIn, formLeafBlocks, formRowMeasure, formRowStarted, formValuesSchema, formVerdictBasis, type FormDocument, type FormValues } from "./form-document";
import { waitingOnSchema } from "./maintenance";
import { tempPlaceSchema } from "./temp-place";
import { workOrderLinkShapeError } from "./work-order-link";
import { riskCheckSchema } from "./risk-step";
import { roundSafetySchema } from "./round-safety";
import { obstacleSchema } from "./obstacles";
import { STAGE_MAX_LENGTH } from "./job-planning";
import { rowWholesaleSchema, WHOLESALERS } from "@/lib/wholesale/model";

export const workflowTaskKinds = ["WORK_ORDER", "RISK_ASSESSMENT", "FORM"] as const;
// CANCELLED is Utgår (2026-10-09): set and lifted only through the cancel/restore action (lib/workflow/task-cancel.ts).
export const workflowTaskStatuses = ["PLANNED", "IN_PROGRESS", "PAUSED", "NEEDS_ACTION", "COMPLETED", "CANCELLED"] as const;
export type WorkflowTaskKind = (typeof workflowTaskKinds)[number];
export type WorkflowTaskStatus = (typeof workflowTaskStatuses)[number];
/**
 * Attachments per task. A protocol places pictures per object (a thermography round has a thermal image and a photo
 * for every object), so it may hold more than a work order or a risk assessment (2026-09-26).
 */
export const workflowTaskAttachmentLimit = (kind: string) => kind === "FORM" ? 60 : 15;

const text = (max: number) => z.string().trim().max(max).default("");
// Material och utgifter (2026-10-08): a material row is unchanged; an expense row adds `kind`, a unit price and an
// amount in SEK excluding VAT as free decimal text, and a car cost its structured facts. All additive and optional, so
// older rows parse as before (see lib/workflow/expenses.ts).
const amountText = z.string().trim().max(40);
const carCostMetaSchema = z.object({
  distanceKm: z.number().min(0).max(100_000),
  roundTrip: z.boolean(),
  pricePerKm: z.number().min(0).max(100_000),
  basis: z.enum(["straight_line", "road", "manual"]),
});
// Artiklar och priser (2026-10-08, steg 1): a copy of the picked article's price, unit, supplier, article number,
// source and price date. Copied values only, so a saved work order never changes with the catalogue (lib/catalogue/snapshot.ts).
const catalogueSnapshotSchema = z.object({
  articleId: z.string().trim().max(100).default(""),
  supplierName: z.string().trim().max(200).default(""),
  supplierArticleNo: z.string().trim().max(60).default(""),
  eNumber: z.string().trim().max(20).default(""),
  manufacturerArticleNo: z.string().trim().max(60).optional(),
  unitPrice: amountText.default(""),
  unit: z.string().trim().max(40).default(""),
  source: z.string().trim().max(200).default(""),
  priceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Pris ändrat (2026-10-08): the latest import that found the same price, when later than the price date.
  confirmedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  importId: z.string().trim().max(100).optional(),
  // Grundpris (2026-10-13 natt): the wholesaler's price before the company's discount.
  priceKind: z.literal("BASE").optional(),
  wholesaler: z.enum(WHOLESALERS).optional(),
  // Rabattbrev (2026-10-14): the base price and the discount, or an agreed net price, copied with the price.
  rebate: z.object({ basePrice: z.string().trim().max(40), percent: z.string().trim().max(12).optional(), fixedNet: z.literal(true).optional() }).optional(),
});
const materialSchema = z.object({
  // Benämning may be empty while the row is being filled in (2026-10-09: a new empty row stopped the autosave
  // of the whole work order); reports and Material i projektet leave rows without a name out.
  id: z.uuid(), name: z.string().trim().max(300).default(""), quantity: z.string().trim().max(40).default(""), unit: z.string().trim().max(40).default(""),
  kind: z.enum(["material", "expense"]).optional(),
  unitPrice: amountText.optional(),
  amount: amountText.optional(),
  carCost: carCostMetaSchema.optional(),
  catalogue: catalogueSnapshotSchema.optional(),
  // Priser på materialraden (2026-10-09, steg A): the row's own copy of the markup, and an article picked by someone
  // without the price right, priced by the server on save (lib/workflow/material-prices-server.ts). Additive and optional.
  markupPercent: amountText.optional(),
  pickedArticleId: z.string().trim().max(100).optional(),
  // Artikelnummer with its source and Tillverkarens artikelnummer (2026-10-09); additive and optional.
  articleNo: z.string().trim().max(60).optional(),
  articleSource: z.string().trim().max(200).optional(),
  manufacturerArticleNo: z.string().trim().max(60).optional(),
  // Grossistexport (2026-10-12): the number to order with at a wholesaler and the order unit conversion; additive and optional.
  wholesale: rowWholesaleSchema.optional(),
  // Offert → arbetsorder (steg C, 2026-10-09): a copy of the accepted quote line the row came from; additive.
  quoteRef: z.object({ quoteId: z.string().trim().min(1).max(100), quoteLabel: z.string().trim().max(40), version: z.number().int().positive(), lineId: z.string().trim().max(100), unitPrice: amountText }).optional(),
  // Inköp (2026-10-16): the purchase the row came from or was added to; additive and optional.
  purchaseRef: purchaseRefSchema.optional(),
  // Produktens uppgifter (2026-10-16): a copy of the picked product's facts; additive and optional.
  product: productInfoSchema.optional(),
  // Uttag ur förrådet (2026-10-30): the store's log row; only the store writes such a row (lib/workflow/store-rows.ts).
  storeRef: storeRefSchema.optional(),
});
const riskSchema = z.object({
  id: z.uuid(),
  hazard: text(500),
  likelihood: z.number().int().min(1).max(5),
  consequence: z.number().int().min(1).max(5),
  protectiveMeasure: text(1000),
  residualLikelihood: z.number().int().min(1).max(5),
  residualConsequence: z.number().int().min(1).max(5),
});

/** The longest Utfört arbete and Avvikelser (A2, review 2026-10-20): the page stops typing there and counts down. */
export const WORK_ORDER_NOTES_MAX = 10_000;

/**
 * Underhåll (2026-10-30): the maintenance facts moved from the work order (`details.maintenance`) to maintenance
 * items (lib/maintenance), migration 20261031110000_work_order_maintenance_to_items. An older file or revision still read
 * here keeps only what it waited for: `maintenance.waitingOn` becomes `waitingOn`, the rest is dropped (Local and the demo
 * have no maintenance items).
 */
const liftWaiting = (value: unknown) => {
  if (!value || typeof value !== "object" || !("maintenance" in value)) return value;
  const { maintenance, ...rest } = value as { maintenance?: { waitingOn?: unknown }; waitingOn?: unknown };
  const waiting = maintenance && typeof maintenance === "object" ? maintenance.waitingOn : undefined;
  return rest.waitingOn === undefined && typeof waiting === "string" && waiting ? { ...rest, waitingOn: waiting } : rest;
};

export const workOrderDataSchema = z.preprocess(liftWaiting, z.object({
  executionNotes: text(WORK_ORDER_NOTES_MAX),
  deviations: text(WORK_ORDER_NOTES_MAX),
  materials: z.array(materialSchema).max(200).default([]),
  signature: z.object({ name: text(160), confirmed: z.boolean().default(false), signedAt: z.iso.datetime().nullable().default(null) }).default({ name: "", confirmed: false, signedAt: null }),
  closeNotes: text(5000),
  // Kundens kvittens (2026-11-01, beslut 6): the customer's name, typed on the spot, and the time; a drawn signature
  // comes later. The time is set by the persistence boundary (stampCustomerAndJudgements), never by the client.
  customerReceipt: z.object({ name: text(160), at: z.iso.datetime().nullable().default(null) }).optional(),
  // The task a work order was made from (2026-09-30, the guided flow): a protocol's deviation row or another task.
  // Only a link for "Tillbaka till …"; the server reads it within the company and the reader's permissions.
  source: z.object({ taskId: z.string().min(1).max(100), title: z.string().trim().max(200).default(""), kind: z.enum(["WORK_ORDER", "RISK_ASSESSMENT", "FORM"]).optional(), rowId: z.string().max(100).optional() }).optional(),
  // What the paused order waits for (2026-10-06; on the order itself since 2026-10-30): "Väntar på material".
  // Only meaningful while the order is paused; saving with another status clears it (maintenance.ts withoutStaleWaiting).
  waitingOn: waitingOnSchema.optional(),
  // Arbetsorder från offert (plan 1K, 2026-10-11): the accepted quote the order was made from, so its guided flow asks
  // for Ansvarig and Klart senast first (lib/workflow/task-flow.ts). Additive; the rows' `quoteRef` stay as they are.
  quote: z.object({ quoteId: z.string().min(1).max(100), label: z.string().trim().max(40).default(""), version: z.number().int().min(1).optional() }).optional(),
}));

export const riskAssessmentDataSchema = z.object({
  risks: z.array(riskSchema).max(200).default([]),
  generalMeasures: text(10_000),
  approval: z.object({ name: text(160), confirmed: z.boolean().default(false), approvedAt: z.iso.datetime().nullable().default(null) }).default({ name: "", confirmed: false, approvedAt: null }),
});

/**
 * A protocol from a published form (2026-09-26): the template version it was created from, a copy of that
 * version's document (so it opens offline and never changes with the template; the server always replaces the copy
 * with the stored version) and the answers.
 */
export const formTaskDataSchema = z.object({
  templateId: z.string().min(1).max(100),
  templateVersion: z.number().int().positive(),
  templateName: text(200),
  /** The form's publisher as shown on the protocol (2026-09-27); set by the server from the stored version. */
  publisherName: z.string().max(300).optional(),
  document: formDocumentSchema,
  values: formValuesSchema,
});

export type FormTaskDetails = z.infer<typeof formTaskDataSchema>;

// Tillfällig plats (2026-10-08): one optional extra place on the job, beside the kind's details. Additive in the
// JSON data, so older tasks and .hwf files parse unchanged and no migration is needed (lib/workflow/temp-place.ts).
const tempPlace = tempPlaceSchema.optional();
// Riskbedömning som steg (2026-10-08): the job's risk check and the flag set on tasks created since the step exists
// (lib/workflow/risk-step.ts). Additive, so older tasks and .hwf files parse unchanged and are never locked.
// Rapportera hinder (plan 1M, 2026-10-11): `obstacle` is what the job waits for while an obstacle is reported (lib/workflow/obstacles.ts).
// Säkerhetsavstämning (2026-10-27, punkt 4): a round occurrence's short check against the work order's risk assessment
// (lib/workflow/round-safety.ts), and the flag the persistence boundary sets on a protocol created in a round's work order.
const riskStepFields = { riskCheck: riskCheckSchema.optional(), riskStep: z.boolean().optional(), obstacle: obstacleSchema.optional(), roundSafety: roundSafetySchema.optional(), roundSafetyStep: z.boolean().optional() };
export const workflowTaskDataSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("WORK_ORDER"), details: workOrderDataSchema, tempPlace, ...riskStepFields }),
  z.object({ kind: z.literal("RISK_ASSESSMENT"), details: riskAssessmentDataSchema, tempPlace, ...riskStepFields }),
  z.object({ kind: z.literal("FORM"), details: formTaskDataSchema, tempPlace, ...riskStepFields }),
]);

export const workflowTaskInputSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  version: z.number().int().nonnegative().default(0),
  kind: z.enum(workflowTaskKinds),
  title: z.string().trim().min(1).max(200),
  description: text(5000),
  status: z.enum(workflowTaskStatuses).default("PLANNED"),
  projectId: z.string().min(1).max(100).nullable().default(null),
  customerId: z.string().min(1).max(100).nullable().default(null),
  // Optional customer facility (decision 11); it must belong to the task's customer. Additive for older files.
  facilityId: z.string().min(1).max(100).nullable().default(null),
  // Kontor och avdelningar were removed (2026-10-24): an older caller's or file's siteId and departmentId are
  // left out by the parse (unknown keys are stripped), so they are ignored without an error.
  assignedToUserId: z.string().min(1).max(100).nullable().default(null),
  assignedToName: text(160),
  dueDate: z.union([z.literal(""), z.iso.date()]).default(""),
  // Tidplan (projektförslaget steg 2, 2026-10-09): Start and Uppskattad tid (minutes). Left out = unchanged on a save
  // (a new job gets "" / none), so older callers and .hwf files parse and save as before (lib/workflow/schedule.ts).
  plannedStartDate: z.union([z.literal(""), z.iso.date()]).optional(),
  estimatedMinutes: z.number().int().min(0).max(600_000).nullable().optional(),
  // Etapp (plan 1M, 2026-10-11): an optional label that groups a project's jobs; "" = none, left out = unchanged on a save.
  stage: z.string().trim().max(STAGE_MAX_LENGTH, `Etappen får vara högst ${STAGE_MAX_LENGTH} tecken.`).optional(),
  // Arbetsorder (2026-10-26/27): optional, so older callers and .hwf files parse as before; a task without one is a draft
  // that is linked before the work starts (lib/workflow/work-order-link.ts).
  workOrderId: z.string().min(1).max(100).nullable().default(null),
  // Driftrond i arbetsordern (2026-10-27, punkt 3): a work order that holds a round for its period (Start – Klart
  // senast). Left out = unchanged on a save; only a work order may have it.
  roundScheduleId: z.string().min(1).max(100).nullable().optional(),
  data: workflowTaskDataSchema,
}).superRefine((value, context) => {
  if (value.kind !== value.data.kind) context.addIssue({ code: "custom", path: ["data", "kind"], message: "Uppgiftstypen stämmer inte." });
  const linkIssue = workOrderLinkShapeError(value);
  if (linkIssue) context.addIssue({ code: "custom", path: ["workOrderId"], message: linkIssue });
  if (value.roundScheduleId && value.kind !== "WORK_ORDER") context.addIssue({ code: "custom", path: ["roundScheduleId"], message: "Bara en arbetsorder kan hålla en driftrond." });
});

type TaskData = z.infer<typeof workflowTaskDataSchema>;
type CompletionTask = {
  title: string;
  status: string;
  data: {
    kind: "WORK_ORDER";
    details: Pick<z.infer<typeof workOrderDataSchema>, "executionNotes" | "signature">;
  } | {
    kind: "RISK_ASSESSMENT";
    details: Omit<z.infer<typeof riskAssessmentDataSchema>, "risks"> & {
      risks: Omit<z.infer<typeof riskSchema>, "id">[];
    };
  } | {
    kind: "FORM";
    details: { document: FormDocument; values: FormValues };
  };
};

/** One set of requirements for completion, guidance, progress and reports. */
export function workflowTaskCompletion(input: CompletionTask) {
  const requirements: { field: string; message: string; met: boolean; weight: number }[] = [];
  const add = (field: string, message: string, met: boolean, weight: number) => requirements.push({ field, message, met, weight });
  const filled = (value: string) => Boolean(value.trim());
  const rating = (value: number) => Number.isInteger(value) && value >= 1 && value <= 5;
  add("task-title", "Ange en rubrik.", filled(input.title), 0);
  if (input.data.kind === "FORM") {
    // Forms use their own requirements from the template: filled required blocks, signatures and a deviation comment.
    const form = formCompletion(input.data.details.document, input.data.details.values);
    const all = [...requirements, ...form.requirements.map((item) => ({ field: `form-${item.blockId}`, message: item.message, met: item.met, weight: 0 }))];
    const issues = all.filter((item) => !item.met);
    // Preset values (today's date, the user) are not progress: a protocol nobody has touched says 0 % (KTR-02).
    return { requirements: all, issues, ready: issues.length === 0, pendingText: form.pendingText, progress: formHasDocumentation(input.data.details.document, input.data.details.values) ? Math.min(95, form.percent) : 0 };
  }
  if (input.data.kind === "WORK_ORDER") {
    const { executionNotes, signature } = input.data.details;
    // One share each (kundresan 2026-11-07, M7: "2 av 4 krav" beside 70 %): the count, the list and the percentage say the same.
    const share = 95 / 3;
    add("task-execution", "Beskriv det utförda arbetet.", filled(executionNotes), share);
    // The signer's name is only shown prefilled by the editor and written once the person types or confirms, so it counts when set.
    add("task-signature-name", "Ange namn på den som signerar.", filled(signature.name), share);
    add("task-signature-confirmed", "Bekräfta signeringen av arbetsordern.", signature.confirmed, share);
  } else {
    const { risks, approval } = input.data.details;
    if (!risks.length) add("task-add-risk", "Lägg till minst en dokumenterad risk.", false, 70);
    risks.forEach((risk, index) => {
      const weight = 17.5 / risks.length;
      add(`task-risk-${index}-hazard`, `Risk ${index + 1}: beskriv risken eller faran.`, filled(risk.hazard), weight);
      add(`task-risk-${index}-measure`, `Risk ${index + 1}: beskriv skyddsåtgärden.`, filled(risk.protectiveMeasure), weight);
      add(`task-risk-${index}-before`, `Risk ${index + 1}: bedöm sannolikhet och konsekvens före åtgärd (1–5).`, rating(risk.likelihood) && rating(risk.consequence), weight);
      add(`task-risk-${index}-after`, `Risk ${index + 1}: bedöm sannolikhet och konsekvens efter åtgärd (1–5).`, rating(risk.residualLikelihood) && rating(risk.residualConsequence), weight);
    });
    add("task-approval-name", "Ange namn på den som godkänner.", filled(approval.name), 10);
    add("task-approval-confirmed", "Bekräfta godkännandet av riskbedömningen.", approval.confirmed, 15);
  }
  const issues = requirements.filter((item) => !item.met);
  return { requirements, issues, ready: issues.length === 0, pendingText: "", progress: Math.min(95, Math.round(requirements.reduce((sum, item) => sum + (item.met ? item.weight : 0), 0))) };
}

/** The form's completion as shown to a person: the same requirements, but 0 % until something is documented (KTR-02). */
export function formCompletionShown(document: FormDocument, values: FormValues) {
  const completion = formCompletion(document, values);
  return formHasDocumentation(document, values) ? completion : { ...completion, percent: 0 };
}

export function workflowTaskProgress(input: CompletionTask) {
  // Completed historical records retain their original status until reopened.
  return input.status === "COMPLETED" ? 100 : workflowTaskCompletion(input).progress;
}

/**
 * Whether a protocol holds something the person filled in (simulation 2026-10-10: a new protocol was "Pågår" in the
 * lists at once because its preset values counted). What the protocol starts with or fills in by itself does not count:
 * a field's default value, the fields filled from the task (customer, contact, place, project, responsible person,
 * user, today, inspector, instrument), the field the protocol's name follows, the choice of moments, and rows that are
 * added but not started (their default and limit values, fixed row labels). Answers, measurements, signatures, remarks,
 * pictures and the deviation comment do.
 */
export function formHasDocumentation(document: FormDocument, values: FormValues) {
  for (const block of formLeafBlocks(document)) {
    if (block.type === "field") {
      if (formFieldFilledIn(document, block, values.fields[block.key])) return true;
    } else if (block.type === "table") {
      if ((values.tables[block.key] ?? []).some((row) => !row.example && (formRowStarted(block, row) || Boolean(row.workOrderId)))) return true;
    }
  }
  return Object.values(values.checklists).some((items) => Object.values(items).some((item) => item.state || item.comment.trim() || (item.images?.length ?? 0) > 0))
    || Object.values(values.signatures).some((item) => item.name.trim() || item.confirmed)
    || Object.values(values.remarks).some((item) => item.comment.trim() || item.deviation)
    || Object.values(values.images).some((items) => items.length > 0)
    || Boolean(values.deviationComment.trim());
}

// The description is the order text, written when the task is made: it is not documentation of work done, so a new
// work order stays Planerad (2026-10-02, the simulation: "Planerade (0)" on the morning of a full plan). The signer's
// name is only SHOWN prefilled by the editor and written when the person types or confirms (Fas 2, 2026-10-11), so a name
// that is set counts as documentation again.
export function workflowTaskHasDocumentation(input: Pick<z.infer<typeof workflowTaskInputSchema>, "data">) {
  if (input.data.kind === "FORM") return formHasDocumentation(input.data.details.document, input.data.details.values);
  const details = input.data.details;
  return Boolean(("executionNotes" in details
    ? details.executionNotes.trim() || details.signature.confirmed || details.signature.name.trim()
    : details.risks.length || details.approval.confirmed || details.approval.name.trim()));
}

/** The customer's receipt stored on a work order's data, read tolerantly; null when there is none. */
export function customerReceiptOf(data: unknown): { name: string; at: string | null } | null {
  const details = data && typeof data === "object" ? (data as { details?: { customerReceipt?: { name?: unknown; at?: unknown } } }).details : null;
  const name = typeof details?.customerReceipt?.name === "string" ? details.customerReceipt.name.trim() : "";
  if (!name) return null;
  const at = details?.customerReceipt?.at;
  return { name, at: typeof at === "string" ? at : null };
}

/**
 * A person's word on what the protocol says (a judged row, the final verdict). The same word on the same values keeps its
 * own name and time. Otherwise a word that already carries a time is an old one, given on other values, and it goes: the
 * person has to give it again. A new word has no time, and gets the name and time of the one saving.
 */
function stampWord<Word extends { by: string; at: string | null }>(word: Word, before: Word | undefined, sameWord: boolean, sameValues: boolean, actor: string, now: string): Word | null {
  if (before?.at && sameWord && sameValues) return { ...word, by: before.by, at: before.at };
  return word.at ? null : { ...word, by: actor, at: now };
}

/**
 * Who and when, set where the task is saved and never trusted from a client (beslut 6 and 7, 2026-11-01): the customer's
 * receipt gets the time it was given, and a row the technician judged and the final verdict get the person's name and the
 * time. A judgement or verdict lasts only as long as what it was given on (stampWord). A receipt without a name is no
 * receipt. Runs before the completion check, which must not count a word that goes here.
 */
export function stampCustomerAndJudgements(data: TaskData, previous: unknown, actor: string, now: string): TaskData {
  if (data.kind === "WORK_ORDER") {
    const { customerReceipt, ...rest } = data.details;
    const name = customerReceipt?.name.trim() ?? "";
    if (!name) return { ...data, details: rest };
    const before = customerReceiptOf(previous);
    return { ...data, details: { ...rest, customerReceipt: { name, at: before?.name === name && before.at ? before.at : now } } };
  }
  if (data.kind !== "FORM") return data;
  const parsed = formValuesSchema.safeParse(previous && typeof previous === "object" ? (previous as { details?: { values?: unknown } }).details?.values : undefined);
  const stored = parsed.success ? parsed.data : undefined;
  const tables = Object.fromEntries(Object.entries(data.details.values.tables).map(([key, rows]) => [key, rows.map((row) => {
    if (!row.judged) return row;
    const storedRow = stored?.tables[key]?.find((item) => item.id === row.id);
    const judged = stampWord(row.judged, storedRow?.judged, storedRow?.judged?.approved === row.judged.approved, Boolean(storedRow) && formRowMeasure(storedRow!) === formRowMeasure(row), actor, now);
    const { judged: _word, ...rest } = row;
    void _word;
    return judged ? { ...rest, judged } : rest;
  })]));
  const { finalVerdict: verdict, ...values } = data.details.values;
  const sameValues = Boolean(stored) && formVerdictBasis(stored!) === formVerdictBasis({ ...values, tables });
  const finalVerdict = verdict ? stampWord(verdict, stored?.finalVerdict, stored?.finalVerdict?.choice === verdict.choice, sameValues, actor, now) : null;
  return { ...data, details: { ...data.details, values: { ...values, tables, ...(finalVerdict ? { finalVerdict } : {}) } } };
}

/** Timestamps are assigned by the persistence boundary, never trusted from a client. */
export function stampWorkflowTaskApproval(data: TaskData, now: string): TaskData {
  if (data.kind === "FORM") return { ...data, details: { ...data.details, values: { ...data.details.values, signatures: Object.fromEntries(Object.entries(data.details.values.signatures).map(([key, signature]) => [key, { ...signature, signedAt: signature.confirmed ? now : null }])) } } };
  return data.kind === "WORK_ORDER"
    ? { ...data, details: { ...data.details, signature: { ...data.details.signature, signedAt: data.details.signature.confirmed ? now : null } } }
    : { ...data, details: { ...data.details, approval: { ...data.details.approval, approvedAt: data.details.approval.confirmed ? now : null } } };
}

export function resetWorkflowTaskApproval(data: TaskData): TaskData {
  // A reopened work order is no longer what the customer signed for: the receipt goes with the signature (beslut 6).
  if (data.kind === "WORK_ORDER") {
    const { customerReceipt: _receipt, ...details } = data.details;
    void _receipt;
    return { ...data, details: { ...details, signature: { ...details.signature, confirmed: false, signedAt: null } } };
  }
  // A reopened protocol has its signatures and final verdict taken back; a judged row keeps its word until its values change.
  if (data.kind === "FORM") {
    const { finalVerdict: _verdict, ...values } = data.details.values;
    void _verdict;
    return { ...data, details: { ...data.details, values: { ...values, signatures: Object.fromEntries(Object.entries(values.signatures).map(([key, signature]) => [key, { ...signature, confirmed: false, signedAt: null }])) } } };
  }
  return { ...data, details: { ...data.details, approval: { ...data.details.approval, confirmed: false, approvedAt: null } } };
}
