import { z } from "zod";
import { formDocumentSchema, formLeafBlocks, formValuesSchema, formWorkContent, type FormBlock } from "./form-document";
import { riskCheckOf } from "./risk-step";
import { isTaskOpen } from "./task-cancel";

/**
 * Säkerhetsavstämning inför rondtillfället (2026-10-27, punkt 4): before each occurrence of a round the person makes
 * a short check against the work order's risk assessment – three questions, kept with the occurrence (the protocol's
 * `data.roundSafety`) together with which risk assessment it was checked against. Ja on the first and Nej on the other two
 * means the conditions still hold and the occurrence may start. When something has changed the risk assessment is
 * updated in the work order first (one button there); the check counts as done once the work order's risk assessment was
 * confirmed or completed after the check. Short and quick on a phone: three big Ja/Nej answers and Klart.
 *
 * Applies to a protocol created in a round's work order since the check exists (`data.roundSafetyStep`, set by the
 * persistence boundary on creation, so older protocols are never locked). The check comes before the work, so Starta tid (on
 * the occurrence and on its work order), changing what is filled in, scanning and Färdigställ all wait until it is done, on
 * the server whichever client saves. Only a new protocol's first screen is let through ahead of the check (roundSafetyWorkGate).
 * Pure rules shared by Cloud, Local, the demo and the page. The words are Workflow's own.
 */

export const ROUND_SAFETY_QUESTIONS = [
  { id: "stillValid", text: "Gäller förutsättningarna i arbetsorderns riskbedömning fortfarande?", short: "Förutsättningarna gäller", safe: "yes" },
  { id: "changed", text: "Har något förändrats på platsen eller i arbetet sedan riskbedömningen gjordes?", short: "Något har förändrats", safe: "no" },
  { id: "newRisks", text: "Finns det nya risker som inte finns med i riskbedömningen?", short: "Nya risker", safe: "no" },
] as const;
export type RoundSafetyQuestionId = (typeof ROUND_SAFETY_QUESTIONS)[number]["id"];
export const ROUND_SAFETY_ANSWERS = ["yes", "no"] as const;
export type RoundSafetyAnswer = (typeof ROUND_SAFETY_ANSWERS)[number];
export const ROUND_SAFETY_ANSWER_LABELS: Record<RoundSafetyAnswer, string> = { yes: "Ja", no: "Nej" };

const answer = z.enum(ROUND_SAFETY_ANSWERS).optional();
export const roundSafetySchema = z.object({
  answers: z.object({ stillValid: answer, changed: answer, newRisks: answer }).default({}),
  confirmedBy: z.string().trim().max(160).default(""),
  confirmedById: z.string().max(100).optional(),
  // Set by the persistence boundary (the server, Local's store, the demo), never trusted from a client.
  confirmedAt: z.iso.datetime().nullable().default(null),
  // The work order's risk assessment the check was made against: the order, when its risk step was confirmed then, and its
  // extended risk assessment – set by the persistence boundary, kept with the occurrence.
  riskRef: z.object({
    workOrderId: z.string().max(100),
    riskConfirmedAt: z.string().max(40).nullable().default(null),
    extendedTaskId: z.string().max(100).nullable().default(null),
  }).nullable().default(null),
});
export type RoundSafety = z.output<typeof roundSafetySchema>;
export const emptyRoundSafety = (): RoundSafety => ({ answers: {}, confirmedBy: "", confirmedAt: null, riskRef: null });

/** The protocol's check from its data, or null. */
export function roundSafetyOf(data: unknown): RoundSafety | null {
  const raw = data && typeof data === "object" ? (data as { roundSafety?: unknown }).roundSafety : undefined;
  if (!raw) return null;
  const parsed = roundSafetySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Whether the protocol has the check: created in a round's work order since the check exists. */
export function roundSafetyRequired(task: { kind: string; data: unknown }) {
  return task.kind === "FORM" && Boolean(task.data && typeof task.data === "object" && (task.data as { roundSafetyStep?: unknown }).roundSafetyStep === true);
}

/** The work order's risk assessment as the rule needs it: when it was last confirmed (simplified) or completed (extended). */
export type RoundSafetyRisk = { workOrderId: string; title: string; updatedAt: string | null };

export type RoundSafetyState = {
  applies: boolean;
  done: boolean;
  /** An answer says the conditions have changed, so the risk assessment is updated in the work order. */
  changed: boolean;
  unanswered: RoundSafetyQuestionId[];
  hint: string;
};
const NOT_REQUIRED: RoundSafetyState = { applies: false, done: true, changed: false, unanswered: [], hint: "" };

/** The rule: whether the occurrence's check is done, and what is left. */
export function roundSafetyState(task: { kind: string; status: string; data: unknown }, risk: RoundSafetyRisk | null): RoundSafetyState {
  if (!roundSafetyRequired(task)) return NOT_REQUIRED;
  const check = roundSafetyOf(task.data);
  const unanswered = ROUND_SAFETY_QUESTIONS.filter((question) => !check?.answers[question.id]).map((question) => question.id);
  const changed = ROUND_SAFETY_QUESTIONS.some((question) => { const value = check?.answers[question.id]; return Boolean(value) && value !== question.safe; });
  const base = { applies: true, changed, unanswered };
  if (task.status === "COMPLETED") return { ...base, done: true, hint: "" };
  if (unanswered.length) return { ...base, done: false, hint: "Svara på frågorna i säkerhetsavstämningen." };
  if (!check?.confirmedAt) return { ...base, done: false, hint: "Bekräfta säkerhetsavstämningen." };
  if (!changed) return { ...base, done: true, hint: "" };
  // Something changed: done once the work order's risk assessment was updated after the check.
  if (risk?.updatedAt && risk.updatedAt > check.confirmedAt) return { ...base, done: true, hint: "" };
  return { ...base, done: false, hint: `Förutsättningarna har ändrats. Uppdatera riskbedömningen i arbetsordern${risk?.title ? ` ”${risk.title}”` : ""} innan rondtillfället startar.` };
}

const REFUSAL_LEAD = {
  start: "Gör säkerhetsavstämningen innan du startar tiden.",
  fill: "Gör säkerhetsavstämningen innan du fyller i rondtillfället.",
  complete: "Gör säkerhetsavstämningen innan du färdigställer rondtillfället.",
} as const;

/** The refusal for starting the time, filling in or completing while the check is not done, or null. */
export function roundSafetyRefusal(state: RoundSafetyState, action: keyof typeof REFUSAL_LEAD): string | null {
  if (!state.applies || state.done) return null;
  return `${REFUSAL_LEAD[action]} ${state.hint}`.trim();
}

const scanCount = (data: unknown) => {
  const scans = (data as { details?: { values?: { round?: { scans?: unknown } } } } | null | undefined)?.details?.values?.round?.scans;
  return Array.isArray(scans) ? scans.length : 0;
};

/** What the person has put into the protocol, or null when the data cannot be read: nothing old is refused because of that. */
function protocolWork(data: unknown) {
  const details = (data as { details?: { document?: unknown; values?: unknown } } | null | undefined)?.details;
  const document = formDocumentSchema.safeParse(details?.document);
  const values = formValuesSchema.safeParse(details?.values);
  return document.success && values.success ? { document: document.data, work: formWorkContent(document.data, values.data) } : null;
}

const sameWork = (a: Record<string, string>, b: Record<string, string>) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};

/** A new protocol's first screen on a phone (Skapa): everything before the form's second section, as the page draws it. */
function firstScreenHolds(document: { blocks: FormBlock[] }, work: Record<string, string>) {
  const secondSection = document.blocks.findIndex((block, index) => block.type === "section" && document.blocks.slice(0, index).some((item) => item.type === "section"));
  const shown = formLeafBlocks({ blocks: secondSection < 0 ? document.blocks : document.blocks.slice(0, secondSection) });
  const keys = new Set(shown.flatMap((block) => "key" in block ? [block.key] : []));
  const summary = shown.some((block) => block.type === "summary");
  return Object.keys(work).every((place) => place === "deviation" ? summary : keys.has(place.split(":")[1] ?? ""));
}

/**
 * The save of a protocol while its check is not done: the status it gets and whether the save is refused. A saved protocol
 * whose filled-in content changes, or that gains a scan, is refused: that is the work going on, from any client. Saving the
 * check itself with what the protocol already holds is never refused, so the check can always be finished, and the page holds
 * a scan back until then. A new protocol may hold what its first screen shows, which on a phone has no room for the check;
 * anything more is refused. It is Planerad whatever status it was sent with, as nothing may have started.
 */
export function roundSafetyWorkGate(
  task: { kind: string; data: unknown },
  risk: RoundSafetyRisk | null,
  input: { chosen: string; documented: boolean; stored: { status: string; data: unknown } | null },
): { status: string; refusal: string | null } {
  const natural = input.chosen === "PLANNED" && input.documented ? "IN_PROGRESS" : input.chosen;
  if (!roundSafetyRequired(task)) return { status: natural, refusal: null };
  const state = roundSafetyState({ ...task, status: input.stored?.status ?? "PLANNED" }, risk);
  if (state.done) return { status: natural, refusal: null };
  const refused = { status: natural, refusal: roundSafetyRefusal(state, "fill") };
  const sent = protocolWork(task.data);
  if (!input.stored) {
    if (scanCount(task.data) > 0 || (sent && !firstScreenHolds(sent.document, sent.work))) return refused;
    return { status: input.chosen === "IN_PROGRESS" || input.chosen === "PAUSED" ? "PLANNED" : input.chosen, refusal: null };
  }
  if (scanCount(task.data) > scanCount(input.stored.data)) return refused;
  const stored = protocolWork(input.stored.data);
  if (sent && stored && !sameWork(sent.work, stored.work)) return refused;
  return { status: input.chosen, refusal: null };
}

/**
 * Starta tid on a round's work order: the time runs on the order whichever button is pressed, so its open occurrences' checks
 * count here too. Without an open occurrence the order's own risk step decides.
 */
export function orderRoundSafetyRefusal(occurrences: readonly { kind: string; title: string; status: string; data: unknown }[], risk: RoundSafetyRisk | null): string | null {
  for (const occurrence of occurrences) {
    if (!isTaskOpen(occurrence.status) || !roundSafetyRequired(occurrence)) continue;
    if (!roundSafetyState(occurrence, risk).done) return `Gör säkerhetsavstämningen på ”${occurrence.title}” innan du startar tiden.`;
  }
  return null;
}

/** When the work order's risk assessment was last made good: its simplified step confirmed, or its extended one completed. */
export function workOrderRiskUpdatedAt(order: { data: unknown }, extended: { status: string; completedAt?: string | Date | null; updatedAt?: string | Date | null } | null): string | null {
  const iso = (value: string | Date | null | undefined) => value ? (typeof value === "string" ? value : value.toISOString()) : null;
  const confirmed = riskCheckOf(order.data)?.confirmedAt ?? null;
  const completed = extended && extended.status === "COMPLETED" ? iso(extended.completedAt ?? extended.updatedAt) : null;
  const latest = [confirmed, completed].filter((value): value is string => Boolean(value)).sort();
  return latest.length ? latest[latest.length - 1] : null;
}

const sameAnswers = (a: RoundSafety | null, b: RoundSafety | null) => Boolean(a && b && ROUND_SAFETY_QUESTIONS.every((question) => a.answers[question.id] === b.answers[question.id]));

/**
 * The persistence boundary: a new protocol in a round's work order gets `roundSafetyStep`; a saved one keeps what it was
 * created with. Who confirmed and when are set here (kept while the answers are unchanged), with the reference to the work
 * order's risk assessment as it was then. A save that does not carry the check keeps the stored one.
 */
export function stampRoundSafety<T extends object>(data: T, input: { created: boolean; stored: unknown; inRoundOrder: boolean; actor: { id: string; name: string }; now: string; risk: { workOrderId: string; riskConfirmedAt: string | null; extendedTaskId: string | null } | null }): T {
  const { roundSafetyStep: _flag, roundSafety: _check, ...rest } = data as T & { roundSafetyStep?: unknown; roundSafety?: unknown };
  void _flag; void _check;
  const storedFlag = Boolean(input.stored && typeof input.stored === "object" && (input.stored as { roundSafetyStep?: unknown }).roundSafetyStep === true);
  const flagged = (input.created ? input.inRoundOrder : storedFlag) ? { ...rest, roundSafetyStep: true } : rest;
  const sent = "roundSafety" in (data as object) ? roundSafetyOf(data) : undefined;
  const before = roundSafetyOf(input.stored);
  const next = sent === undefined ? before : sent;
  if (!next) return flagged as T;
  if (!next.confirmedAt) return { ...flagged, roundSafety: { ...next, confirmedBy: "", confirmedById: undefined, confirmedAt: null, riskRef: null } } as T;
  if (before?.confirmedAt && sameAnswers(before, next)) return { ...flagged, roundSafety: { ...next, confirmedBy: before.confirmedBy, confirmedById: before.confirmedById, confirmedAt: before.confirmedAt, riskRef: before.riskRef } } as T;
  return { ...flagged, roundSafety: { ...next, confirmedBy: input.actor.name.slice(0, 160), confirmedById: input.actor.id.slice(0, 100), confirmedAt: input.now, riskRef: input.risk } } as T;
}

/** The facts the report shows: each answer, who confirmed and when. Null when the protocol has no check. */
export function roundSafetyReportFacts(data: unknown): { rows: { label: string; value: string; changed: boolean }[]; confirmedBy: string; confirmedAt: string | null } | null {
  const check = roundSafetyOf(data);
  if (!check) return null;
  const rows = ROUND_SAFETY_QUESTIONS.flatMap((question) => {
    const value = check.answers[question.id];
    return value ? [{ label: question.short, value: ROUND_SAFETY_ANSWER_LABELS[value], changed: value !== question.safe }] : [];
  });
  return { rows, confirmedBy: check.confirmedBy, confirmedAt: check.confirmedAt };
}

type StoredTask = { id: string; kind: string; title: string; status: string; data: unknown; completedAt?: string | Date | null; updatedAt?: string | Date | null; roundScheduleId?: string | null; roundOccurrence?: string | null };

/** The work order's risk assessment read from the tasks at hand (Local, the demo). */
export function roundSafetyRiskFrom(tasks: readonly StoredTask[], workOrderId: string | null | undefined): RoundSafetyRisk | null {
  const order = workOrderId ? tasks.find((item) => item.id === workOrderId && item.kind === "WORK_ORDER") : undefined;
  if (!order) return null;
  const extendedId = riskCheckOf(order.data)?.extendedTaskId;
  const extended = extendedId ? tasks.find((item) => item.id === extendedId) ?? null : null;
  return { workOrderId: order.id, title: order.title, updatedAt: workOrderRiskUpdatedAt(order, extended) };
}

/** The refusal for Starta tid or Färdigställ in Local and the demo, or null. */
export function localRoundSafetyRefusal(tasks: readonly StoredTask[], task: { kind: string; status: string; data: unknown; workOrderId?: string | null }, action: "start" | "complete") {
  if (!roundSafetyRequired(task) || task.status === "COMPLETED") return null;
  return roundSafetyRefusal(roundSafetyState(task, roundSafetyRiskFrom(tasks, task.workOrderId)), action);
}

/** The refusal for Starta tid on a round's work order in Local and the demo, or null. */
export function localOrderRoundSafetyRefusal(tasks: readonly (StoredTask & { workOrderId?: string | null })[], workOrderId: string) {
  return orderRoundSafetyRefusal(tasks.filter((item) => item.workOrderId === workOrderId), roundSafetyRiskFrom(tasks, workOrderId));
}

/** The stamp on save in Local and the demo: the same as Cloud's, with the work order read from the tasks at hand. */
export function localStampRoundSafety<T extends object>(tasks: readonly StoredTask[], task: { kind: string; workOrderId?: string | null; data: T }, input: { created: boolean; stored: unknown; actor: { id: string; name: string }; now: string; inRound: boolean }): T {
  if (task.kind !== "FORM") return task.data;
  const order = task.workOrderId ? tasks.find((item) => item.id === task.workOrderId && item.kind === "WORK_ORDER") : undefined;
  const check = order ? riskCheckOf(order.data) : null;
  return stampRoundSafety(task.data, { created: input.created, stored: input.stored, inRoundOrder: Boolean(order?.roundScheduleId && !order.roundOccurrence && input.inRound), actor: input.actor, now: input.now,
    risk: order ? { workOrderId: order.id, riskConfirmedAt: check?.confirmedAt ?? null, extendedTaskId: check?.extendedTaskId ?? null } : null });
}
