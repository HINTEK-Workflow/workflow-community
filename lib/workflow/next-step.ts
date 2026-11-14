import type { Flow } from "@/lib/workflow/task-flow";

/**
 * "Varför kan jag inte gå vidare?" (2026-10-08, Fas 4B): one line beside the progress line that always names the
 * next thing to do and leads there. No rules of its own: the order is the one Färdigställ itself follows – a block on
 * the work (display level/role), the progress line's current step (task-flow), the completion requirements
 * (workflowTaskCompletion) and last the risk step's refusal (risk-step) – so the line, the button and the server never
 * disagree.
 */
export type NextStepLine = {
  /** The step the person is on, named on the line ("Riskbedömning", "Signering"). */
  step: string;
  /** The progress line's step key ("risk", "work", "fill", "complete" …), or "missing" for a requirement off the line. */
  key?: string;
  /** What to do, in one or two sentences: the same text as the step, the requirement or the refusal. */
  text: string;
  /** Where it is done: an element id or a panel heading; absent when nothing on the page can be pointed at. */
  target?: string;
  /** How the page leads there: to a field, to the risk step, to Färdigställ, or only the message (a block). */
  kind: "focus" | "risk" | "complete" | "blocked";
};

export function nextStepLine(input: {
  flow: Flow;
  /** The completion requirements that are not met (the same list as Färdigställ and the percentage). */
  issues?: { field: string; message: string }[];
  /** riskStepRefusal(state, "complete"), or null when the step is done or does not apply. */
  riskRefusal?: string | null;
  /** "1 rad saknar gräns": rows not judged; Färdigställ is allowed but the line must not say that everything is done. */
  pendingText?: string;
  /** Why the person may not work on the task at all (workBlock), or null. */
  blocked?: string | null;
}): NextStepLine | null {
  const { flow, issues = [], riskRefusal = null, blocked = null } = input;
  if (flow.done) return null;
  const current = flow.current;
  if (blocked) return { step: current?.label ?? "Uppgiften", ...(current ? { key: current.key } : {}), text: blocked, kind: "blocked" };
  if (current?.key === "risk") return { step: current.label, key: "risk", text: riskRefusal ?? current.hint, target: current.target, kind: "risk" };
  if (current && current.key !== "complete") return { step: current.label, key: current.key, text: current.hint, ...(current.target ? { target: current.target } : {}), kind: "focus" };
  // Every step on the line is met: what Färdigställ would still refuse, in its own order.
  const issue = issues[0];
  if (issue) return { step: current?.label ?? "Färdigställd", key: "missing", text: issues.length > 1 ? `${issue.message} (och ${issues.length - 1} till)` : issue.message, target: issue.field, kind: "focus" };
  if (riskRefusal) return { step: "Riskbedömning", key: "risk", text: riskRefusal, target: "task-risk-step", kind: "risk" };
  if (input.pendingText) return { step: current?.label ?? "Färdigställd", key: "complete", text: `${input.pendingText}. Komplettera raden eller tryck Färdigställ.`, target: current?.target ?? "task-complete", kind: "complete" };
  return { step: current?.label ?? "Färdigställd", key: "complete", text: "Allt som krävs är klart. Tryck Färdigställ.", target: current?.target ?? "task-complete", kind: "complete" };
}

/**
 * "Nästa steg" som huvudknapp (UX-granskningen avsnitt 6, punkt 7): the job page's primary button names what to do next
 * ("Gör riskbedömningen", "Fyll i protokollet") instead of Spara. Only a wording of the line above – the step and where it
 * leads come from nextStepLine – so the button, the line and Färdigställ never disagree. Null when the page keeps Spara as
 * its primary: a block on the work, or the job's basics (the title, the first save) still to do.
 */
const NEXT_STEP_ACTION: Record<string, string> = {
  plan: "Planera jobbet", risk: "Gör riskbedömningen", work: "Skriv utfört arbete", moments: "Välj moment", fill: "Fyll i protokollet",
  sign: "Signera", risks: "Lägg till risker", approval: "Godkänn bedömningen", missing: "Visa vad som saknas",
};
/** The finished document on the button ("Färdigställ arbetsordern"); the bare word stays the Färdigställ panel's own button. */
const DOC_NOUN: Record<string, string> = { WORK_ORDER: "arbetsordern", RISK_ASSESSMENT: "riskbedömningen", FORM: "protokollet" };

export function nextStepAction(next: NextStepLine | null | undefined, kind: string): string | null {
  if (!next || next.kind === "blocked" || !next.key) return null;
  if (next.key === "complete") return `Färdigställ ${DOC_NOUN[kind] ?? "jobbet"}`;
  return NEXT_STEP_ACTION[next.key] ?? null;
}

/**
 * Help instead of a ban (UX-granskningen avsnitt 6): "Skriv en rubrik så kan du spara." rather than "Ange en rubrik först.".
 * `field` is the form field the title follows ("Anläggning"), when it is not the title itself.
 */
export function titleHelpText(action: string, field?: string): string {
  return `${field ? `Fyll i ${field.toLowerCase()}` : "Skriv en rubrik"} så kan du ${action}.`;
}

/**
 * Svar 4 (2026-10-24): on a computer the primary button alone names the next step (no "Nästa: …" under it), and
 * "Varför kan jag inte gå vidare?" is shown when something hinders – a block, a step left on the line, a requirement or the
 * risk step. Not when everything required is done and Färdigställ is allowed (kind "complete").
 */
export function nextStepHinders(next: NextStepLine | null | undefined): boolean {
  return Boolean(next) && next!.kind !== "complete";
}
