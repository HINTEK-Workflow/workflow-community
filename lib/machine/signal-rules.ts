// Integrationsmotorn E3 (2026-10-24, beslut 1 och 6): regler i data som rena funktioner, som alarm-rules.ts. Ett
// villkor på en signals värde – en fast lista av jämförelser med hysteres och varaktighet – ger en övergång (slår till eller
// släcks), och övergången blir en kanonisk händelse som går genom samma kedja som /events. Inga uttryck, ingen kod från kunden.
// Workflow är inget larm- eller säkerhetssystem och lovar ingen leveranstid.
import { z } from "zod";

export const RULE_OPERATORS = ["eq", "neq", "gt", "gte", "lt", "lte", "changed", "stale"] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];
export const RULE_OPERATOR_LABELS: Record<RuleOperator, string> = {
  eq: "är lika med", neq: "är inte lika med", gt: "är större än", gte: "är minst", lt: "är mindre än", lte: "är högst", changed: "ändras", stale: "har inte hörts av på (sekunder)",
};
export const OUTCOME_TYPES = ["alarm", "state", "diagnosis"] as const;
export const OUTCOME_TYPE_LABELS: Record<(typeof OUTCOME_TYPES)[number], string> = { alarm: "Larm", state: "Driftläge", diagnosis: "Diagnos" };
export const MAX_RULES_PER_SOURCE = 50;
export const RULE_SAFETY_TEXT = "Workflow är inget larm- eller säkerhetssystem och lovar ingen leveranstid. Regler är ett stöd för underhållet, inte ett skydd.";
const ORDERED: readonly RuleOperator[] = ["gt", "gte", "lt", "lte"];

type Value = number | boolean | string;
const value = z.union([z.number().finite(), z.boolean(), z.string().trim().min(1).max(60)]);
export const ruleInputSchema = z.object({
  operator: z.enum(RULE_OPERATORS),
  value: value.nullable().default(null),
  hysteresis: z.number().finite().min(0).max(1e9).nullable().default(null),
  forSeconds: z.number().int().min(0, "Varaktigheten kan inte vara negativ.").max(86_400, "Högst ett dygn.").default(0),
  outcomeType: z.enum(OUTCOME_TYPES),
  outcomeCode: z.string().regex(/^[\x21-\x7e]{1,64}$/, "Koden är 1–64 synliga tecken utan blanksteg."),
  outcomeSeverity: z.enum(["info", "warning", "fault", "critical"]),
  outcomeState: z.enum(["running", "stopped"]).nullable().default(null),
  outcomeText: z.string().trim().max(200).default(""),
  isActive: z.boolean().default(true),
}).superRefine((rule, ctx) => {
  const issue = (message: string, path: string) => ctx.addIssue({ code: "custom", message, path: [path] });
  if (rule.operator === "changed" && rule.value !== null) issue("Ändras jämför inte med något värde.", "value");
  if (rule.operator !== "changed" && rule.value === null) issue("Ange värdet att jämföra med.", "value");
  if (ORDERED.includes(rule.operator) && typeof rule.value !== "number") issue("Större och mindre jämför bara tal.", "value");
  if (rule.operator === "stale" && (typeof rule.value !== "number" || !Number.isInteger(rule.value) || rule.value < 60 || rule.value > 7 * 86_400)) issue("Ange tystnaden i sekunder, 60 till 604 800.", "value");
  if (rule.hysteresis !== null && !ORDERED.includes(rule.operator)) issue("Hysteres gäller bara större och mindre.", "hysteresis");
  if (rule.outcomeType === "state" && !rule.outcomeState) issue("Välj driftläget som regeln ger.", "outcomeState");
  if (rule.outcomeType !== "state" && rule.outcomeState) issue("Läget gäller bara driftläge.", "outcomeState");
});
export type RuleInput = z.infer<typeof ruleInputSchema>;
export type Rule = Pick<RuleInput, "operator" | "value" | "hysteresis" | "forSeconds"> & { id: string };
export type RuleState = { active: boolean; activeSince: Date | null; pendingSince: Date | null; lastValue: unknown; evaluatedAt: Date | null };
export const EMPTY_RULE_STATE: RuleState = { active: false, activeSince: null, pendingSince: null, lastValue: null, evaluatedAt: null };
export type Transition = "raise" | "clear";

/**
 * Om villkoret gäller för ett värde. Med hysteres och en regel som redan slagit till släcks den först när värdet gått
 * tillbaka förbi gränsen med hysteresen (gt 80 med hysteres 2: på över 80, av först under 78), så brus kring gränsen inte
 * fladdrar. Ett värde av fel typ gäller aldrig.
 */
export function holds(rule: Pick<Rule, "operator" | "value" | "hysteresis">, value: unknown, active: boolean): boolean {
  const limit = rule.value;
  if (rule.operator === "eq") return value === limit;
  if (rule.operator === "neq") return value !== null && value !== undefined && value !== limit;
  if (!ORDERED.includes(rule.operator)) return false;
  if (typeof value !== "number" || typeof limit !== "number") return false;
  const band = active ? rule.hysteresis ?? 0 : 0;
  if (rule.operator === "gt") return value > limit - band;
  if (rule.operator === "gte") return value >= limit - band;
  if (rule.operator === "lt") return value < limit + band;
  return value <= limit + band;
}

/**
 * Ett nytt värde för regelns signal. Aldrig bakåt i tiden (ett äldre värde än det senast prövade ändrar ingenting).
 * - `changed`: varje ändring av värdet är en händelse för sig (ingen släckning).
 * - `stale`: ett nytt värde släcker en regel som slagit till för tystnad.
 * - övriga: slår till när villkoret gällt i `forSeconds` i följd, släcks när det inte gäller längre.
 */
export function evaluateReading(rule: Rule, state: RuleState, reading: { value: Value; at: Date }): { state: RuleState; transition: Transition | null } {
  if (state.evaluatedAt && reading.at.getTime() <= state.evaluatedAt.getTime()) return { state, transition: null };
  const next: RuleState = { ...state, lastValue: reading.value, evaluatedAt: reading.at };
  if (rule.operator === "changed") {
    const changed = state.evaluatedAt !== null && state.lastValue !== reading.value;
    return { state: next, transition: changed ? "raise" : null };
  }
  if (rule.operator === "stale") {
    return state.active ? { state: { ...next, active: false, activeSince: null, pendingSince: null }, transition: "clear" } : { state: next, transition: null };
  }
  const ok = holds(rule, reading.value, state.active);
  if (!ok) {
    if (state.active) return { state: { ...next, active: false, activeSince: null, pendingSince: null }, transition: "clear" };
    return { state: { ...next, pendingSince: null }, transition: null };
  }
  if (state.active) return { state: next, transition: null };
  const pendingSince = state.pendingSince ?? reading.at;
  return reachedDuration(rule, pendingSince, reading.at)
    ? { state: { ...next, active: true, activeSince: reading.at, pendingSince: null }, transition: "raise" }
    : { state: { ...next, pendingSince }, transition: null };
}

const reachedDuration = (rule: Pick<Rule, "forSeconds">, since: Date, at: Date) => at.getTime() - since.getTime() >= rule.forSeconds * 1000;

/**
 * Det som tiden ensam avgör (jobbet var 5:e minut och varje anrop från källan): en regel med varaktighet vars villkor fortfarande
 * gäller slår till när tiden gått; `stale` slår till när signalen inte hörts av på regelns antal sekunder.
 */
export function evaluateTime(rule: Rule, state: RuleState, signal: { lastSeenAt: Date }, now: Date): { state: RuleState; transition: Transition | null; at: Date } | null {
  if (rule.operator === "stale") {
    const limit = typeof rule.value === "number" ? rule.value : Infinity;
    if (state.active || now.getTime() - signal.lastSeenAt.getTime() < limit * 1000) return null;
    return { state: { ...state, active: true, activeSince: now, pendingSince: null }, transition: "raise", at: now };
  }
  if (state.active || !state.pendingSince || !reachedDuration(rule, state.pendingSince, now)) return null;
  return { state: { ...state, active: true, activeSince: now, pendingSince: null }, transition: "raise", at: now };
}

/** Övergången som kanonisk händelse. Släcks ett larm blir det `cleared`; släcks en driftlägesregel blir det motsatt läge. */
export function ruleEvent(rule: { id: string; outcomeType: string; outcomeCode: string; outcomeSeverity: string; outcomeState: string | null; outcomeText: string }, transition: Transition, at: Date) {
  if (rule.outcomeType === "diagnosis" && transition === "clear") return null;
  const state = rule.outcomeType === "alarm" ? (transition === "raise" ? "raised" : "cleared")
    : rule.outcomeType === "state" ? (transition === "raise" ? rule.outcomeState : rule.outcomeState === "stopped" ? "running" : "stopped") : null;
  return {
    // Unique per rule, transition and time: the same reading evaluated twice never makes two events.
    eventId: `rule-${rule.id}-${transition}-${at.getTime()}`.slice(0, 128),
    occurredAt: at, type: rule.outcomeType as "alarm" | "state" | "diagnosis", code: rule.outcomeCode,
    severity: rule.outcomeSeverity as "info" | "warning" | "fault" | "critical",
    state, text: rule.outcomeText, basis: rule.outcomeType === "diagnosis" ? "Regel i Workflow" : null, values: null,
  };
}

/** Regeln i ord, för listan på signalsidan. */
export function ruleSummary(rule: Pick<RuleInput, "operator" | "value" | "hysteresis" | "forSeconds" | "outcomeType" | "outcomeCode" | "outcomeState">) {
  const what = rule.operator === "changed" ? "När värdet ändras" : `När värdet ${RULE_OPERATOR_LABELS[rule.operator]} ${String(rule.value).replace(".", ",")}`;
  const extra = [rule.hysteresis ? `hysteres ${String(rule.hysteresis).replace(".", ",")}` : "", rule.forSeconds ? `i ${rule.forSeconds} s` : ""].filter(Boolean).join(", ");
  const outcome = rule.outcomeType === "state" ? `driftläge ${rule.outcomeState === "stopped" ? "stoppad" : "i drift"}` : `${OUTCOME_TYPE_LABELS[rule.outcomeType].toLowerCase()} ${rule.outcomeCode}`;
  return `${what}${extra ? ` (${extra})` : ""}: ${outcome}`;
}
