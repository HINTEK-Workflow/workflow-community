/**
 * The steps of every flow in Workflow (2026-10-01: "progression och arbetsflöde är otydliga, många klickar
 * vidare utan att läsa"): the same few steps the person walks through, built from the same rules that decide progress
 * and completion, so the line, the percentage and Slutför never disagree. Pure functions, shared by Cloud, Local and
 * the demo; the progress line (features/workflow/flow-progress.tsx) and the decision support read them.
 */

export type FlowStepState = "done" | "current" | "upcoming" | "skipped";
export type FlowStep = {
  key: string;
  label: string;
  state: FlowStepState;
  /** What to do in this step, in one sentence. */
  hint: string;
  /** Where the step is done: an element id or a panel heading. */
  target?: string;
  /** An optional step never becomes the current one; left out it is shown as skipped. */
  optional?: boolean;
  /** What the line shows under the dot when it says more than the step's name ("Ifylld", "Påbörjad 18 %"). */
  display?: string;
};
export type Flow = { steps: FlowStep[]; current: FlowStep | null; done: boolean };

type StepInput = Omit<FlowStep, "state"> & { met: boolean };

/**
 * The current step is the first required step that is not met. Required steps before it are done (even when one of
 * them was left half-way and later steps were met, the first gap is where the person is sent); an optional step that
 * is not met is "skipped" once the flow has passed it, otherwise upcoming.
 */
export function buildFlow(inputs: StepInput[], completed: boolean): Flow {
  if (completed) {
    const steps = inputs.map(({ met, ...step }) => ({ ...step, state: (step.optional && !met ? "skipped" : "done") as FlowStepState }));
    return { steps, current: null, done: true };
  }
  const currentIndex = inputs.findIndex((step) => !step.optional && !step.met);
  const steps = inputs.map(({ met, ...step }, index): FlowStep => {
    if (index === currentIndex) return { ...step, state: "current" };
    if (met) return { ...step, state: "done" };
    if (step.optional) return { ...step, state: currentIndex === -1 || index < currentIndex ? "skipped" : "upcoming" };
    return { ...step, state: "upcoming" };
  });
  return { steps, current: currentIndex >= 0 ? steps[currentIndex] : null, done: false };
}

const filled = (value: string | null | undefined) => Boolean(value && value.trim());

/**
 * Riskbedömning som steg (2026-10-08, lib/workflow/risk-step.ts): when the job has the step it comes before the work.
 * Left out for a task without the step (risk assessments themselves, tasks created before the step existed).
 */
export type RiskFlowStep = { met: boolean; hint: string; display?: string };
const riskFlowStep = (risk: RiskFlowStep | undefined) => risk ? [{ key: "risk", label: "Riskbedömning", met: risk.met, hint: risk.hint || "Gör riskbedömningen innan arbetet startar.", target: "task-risk-step", ...(risk.display ? { display: risk.display } : {}) }] : [];

/**
 * Arbetsorder från offert (plan 1K, 2026-10-11): an order made from an accepted quote names the quote in its data
 * (`details.quote`) or carries rows from it (`quoteRef`). Its flow then asks for Ansvarig and Klart senast as the next
 * step – the order is agreed with the customer and only needs planning – while the quote's Giltig till never becomes a
 * date on the job.
 */
export const workOrderFromQuote = (details: { quote?: { quoteId: string } | null; materials?: readonly { quoteRef?: unknown }[] } | null | undefined): boolean =>
  Boolean(details?.quote?.quoteId) || Boolean(details?.materials?.some((row) => Boolean(row?.quoteRef)));

/** Arbetsorder: Beställning → Planering (valfri; krävs för en arbetsorder från offert) → Riskbedömning → Utförande → Signering → Färdigställd. */
export function workOrderFlow(task: {
  saved: boolean; title: string; status: string; assigned: boolean; dueDate: string; timerRunning: boolean; totalDurationSec: number;
  executionNotes: string; signatureName: string; signatureConfirmed: boolean; riskStep?: RiskFlowStep;
  /** The order was made from an accepted quote: Ansvarig and Klart senast are the next step until both are set. */
  fromQuote?: boolean;
}): Flow {
  return buildFlow([
    { key: "order", label: "Beställning", met: task.saved && filled(task.title), hint: "Ange rubrik och vad som ska göras, och spara.", target: "task-title" },
    task.fromQuote
      ? { key: "plan", label: "Planering", met: task.assigned && filled(task.dueDate), hint: "Välj ansvarig och Klart senast för det offererade arbetet.", target: "task-assignee" }
      : { key: "plan", label: "Planering", optional: true, met: task.assigned || filled(task.dueDate), hint: "Välj ansvarig och Klart senast om arbetet ska planeras.", target: "task-due-date" },
    ...riskFlowStep(task.riskStep),
    { key: "work", label: "Utförande", met: filled(task.executionNotes), target: "task-execution",
      hint: task.timerRunning ? "Tiden går. Beskriv det utförda arbetet, material och eventuella avvikelser." : task.totalDurationSec > 0 ? "Beskriv det utförda arbetet. Starta tid igen om du fortsätter arbeta." : "Starta tid när du börjar och beskriv det utförda arbetet." },
    { key: "sign", label: "Signering", met: filled(task.signatureName) && task.signatureConfirmed, hint: "Ange namnet på den som signerar och intyga att dokumentationen är granskad.", target: "task-signature-name" },
    { key: "complete", label: "Färdigställd", met: false, hint: task.timerRunning ? "Färdigställ uppgiften. Tidtagningen stoppas och du kan lägga till tid." : "Färdigställ uppgiften. Du får frågan om du vill skriva tid.", target: "task-complete" },
  ], task.status === "COMPLETED");
}

/** Riskbedömning: Grunduppgifter → Risker → Godkännande → Färdigställd. */
export function riskFlow(task: {
  saved: boolean; title: string; status: string;
  risks: { hazard: string; protectiveMeasure: string }[]; approvalName: string; approvalConfirmed: boolean;
}): Flow {
  const risksMet = task.risks.length > 0 && task.risks.every((risk) => filled(risk.hazard) && filled(risk.protectiveMeasure));
  return buildFlow([
    { key: "basics", label: "Grunduppgifter", met: task.saved && filled(task.title), hint: "Ange rubrik, plats och ansvarig, och spara.", target: "task-title" },
    { key: "risks", label: "Risker", met: risksMet, hint: task.risks.length ? "Beskriv fara och skyddsåtgärd för varje risk och bedöm risken före och efter." : "Lägg till varje betydande fara som en egen risk.", target: "task-add-risk" },
    { key: "approval", label: "Godkännande", met: filled(task.approvalName) && task.approvalConfirmed, hint: "Den som granskat bedömningen anger sitt namn och bekräftar.", target: "task-approval-name" },
    { key: "complete", label: "Färdigställd", met: false, hint: "Färdigställ riskbedömningen. Du får frågan om du vill skriva tid.", target: "task-complete" },
  ], task.status === "COMPLETED");
}

/**
 * A protocol made from a form: Grunduppgifter → Ifyllnad → Signering (when the form has signatures) → Färdigställd.
 * `issues` are the completion issues ("form-<blockId>" fields), `signatureBlocks` the ids of the form's signatures.
 */
export function formFlow(task: { saved: boolean; title: string; status: string; issues: { field: string; message: string }[]; signatureBlocks: string[]; titleFieldLabel?: string;
  /** The element id of the field that names the protocol ("form-<blockId>"), so Grunduppgifter marks the panel it is in. */
  titleFieldTarget?: string;
  /** Every requirement, met or not (the same list as the percentage), so the fill step can show how far it has come. */
  requirements?: { field: string; met: boolean }[];
  /** A form that asks the person to pick its moments (Kontroll före idrifttagning): the choice is a step of its own. */
  moments?: { label: string; met: boolean; target?: string };
  /** The job's risk step, after Grunduppgifter and the choice of moments, before the work (2026-10-08). */
  riskStep?: RiskFlowStep;
  /**
   * The job's percentage (workflowTaskProgress, the header's "N % klart"), shown under a started fill step where nothing
   * else shows it (a phone at level 1). Left out, the step only says "Påbörjad": one source for the percentage
   * (simulation 2026-10-10: the header said "42 % klart" while the line said "Påbörjad 36 %").
   */
  progress?: number;
  /**
   * A draft without a work order (kundresan 2026-11-07, H3): nothing can be filled in until it is linked, so Grunduppgifter is the
   * step with this hint and the element to go to, never "fill in a row" on a locked form.
   */
  linkFirst?: { hint: string; target: string } }): Flow {
  const signature = new Set(task.signatureBlocks.map((id) => `form-${id}`));
  const momentTarget = task.moments?.target;
  const fillIssues = task.issues.filter((issue) => !signature.has(issue.field) && issue.field !== "task-title" && !(task.moments && !task.moments.met && issue.field === momentTarget));
  const signIssues = task.issues.filter((issue) => signature.has(issue.field));
  // The fill step is "Ifylld" only when it is filled in (2026-10-07: an empty control at 42 % said so because its moments
  // were not chosen yet): no fill requirement left and the moments chosen. Otherwise "Påbörjad" once something is met.
  const fillMet = fillIssues.length === 0 && (!task.moments || task.moments.met);
  const fillRequirements = (task.requirements ?? []).filter((item) => !signature.has(item.field) && item.field !== "task-title" && !(task.moments && item.field === momentTarget));
  const started = fillRequirements.some((item) => item.met);
  const startedText = task.progress !== undefined ? `Påbörjad ${Math.min(Math.max(Math.round(task.progress), 0), 99)} %` : "Påbörjad";
  // The order of the page's panels (simulation 2026-10-10, dator fynd 20): Grunduppgifter with the moments chosen there,
  // then the risk step before the work, then the work.
  return buildFlow([
    task.linkFirst && task.saved && filled(task.title) ? { key: "basics", label: "Grunduppgifter", met: false, hint: task.linkFirst.hint, target: task.linkFirst.target }
      : { key: "basics", label: "Grunduppgifter", met: task.saved && filled(task.title), hint: task.titleFieldLabel ? `Fyll i ${task.titleFieldLabel.toLowerCase()} och kund, och spara.` : "Ange rubrik och kund, och spara.", target: task.titleFieldLabel ? task.titleFieldTarget : "task-title" },
    ...(task.moments ? [{ key: "moments", label: task.moments.label, met: task.moments.met, hint: `Välj de ${task.moments.label.toLowerCase()} som ska utföras.`, target: momentTarget }] : []),
    ...riskFlowStep(task.riskStep),
    // Before the moments are chosen nothing of the fill step can be done, so it says nothing (QA 2026-10-10: "Påbörjad
    // 100 %" on a new, empty control); a step that is not met never says 100 %.
    { key: "fill", label: "Ifyllnad", met: fillMet, display: fillMet ? "Ifylld" : started && !(task.moments && !task.moments.met) ? startedText : undefined,
      hint: fillIssues[0]?.message ?? (task.moments && !task.moments.met ? `Välj de ${task.moments.label.toLowerCase()} som ska utföras.` : "Fyll i protokollets punkter."), target: fillIssues[0]?.field ?? (fillMet ? undefined : momentTarget) },
    ...(task.signatureBlocks.length ? [{ key: "sign", label: "Signering", met: signIssues.length === 0, hint: signIssues[0]?.message ?? "Signera protokollet.", target: signIssues[0]?.field }] : []),
    { key: "complete", label: "Färdigställd", met: false, hint: "Färdigställ protokollet. Det låses och kan sedan kopieras med Spara som.", target: "task-complete" },
  ], task.status === "COMPLETED");
}

/**
 * Kontroll före idrifttagning: Grunduppgifter → Kontrollmoment → Mätningar → Sammanfattning → Färdigställd, from the
 * control's own completion errors (their `path`).
 */
export function controlFlow(control: { saved: boolean; completed: boolean; errors: { path: string; message: string }[] }): Flow {
  const first = (test: (path: string) => boolean) => control.errors.find((error) => test(error.path));
  const meta = first((path) => path.startsWith("meta."));
  const moments = first((path) => path === "active");
  const measure = first((path) => /^(iso|cont|volt|rcd)\.|^vis\.checks/.test(path));
  const summary = first((path) => path === "vis.comment");
  return buildFlow([
    { key: "basics", label: "Grunduppgifter", met: !meta && control.saved, hint: meta?.message ?? "Spara kontrollen.", target: "Grunduppgifter" },
    { key: "moments", label: "Kontrollmoment", met: !moments, hint: moments?.message ?? "Välj de kontrollmoment som ska utföras.", target: "Grunduppgifter" },
    { key: "measure", label: "Mätningar", met: !measure, hint: measure?.message ?? "Registrera mätvärden för varje valt moment.", target: measure?.path.startsWith("vis.") ? "Visuell kontroll" : undefined },
    { key: "summary", label: "Sammanfattning", met: !summary, hint: summary?.message ?? "Sammanfatta resultatet.", target: "summary-comment" },
    { key: "complete", label: "Färdigställd", met: false, hint: "Färdigställ kontrollen. Protokollet låses och kan skickas som rapport.", target: "Sammanfattning" },
  ], control.completed);
}

/** Projekt: Skapat → Uppgifter → Utförande → Alla uppgifter klara → Avslutat. */
export function projectFlow(project: { closed: boolean; archived: boolean; taskCount: number; startedCount: number; completedCount: number; /** Start date in the future: the project cannot be closed before it (beslut 5, 2026-10-18). */ startsOn?: string }): Flow {
  const allDone = project.taskCount > 0 && project.completedCount === project.taskCount;
  return buildFlow([
    { key: "created", label: "Skapat", met: true, hint: "Projektet finns." },
    { key: "tasks", label: "Uppgifter", met: project.taskCount > 0, hint: "Skapa projektets första uppgift eller koppla en befintlig.", target: "project-tasks" },
    { key: "work", label: "Utförande", met: project.startedCount > 0 || project.completedCount > 0, hint: "Öppna en uppgift och starta arbetet.", target: "project-tasks" },
    { key: "done", label: "Uppgifterna klara", met: allDone, hint: `${project.taskCount - project.completedCount} av ${project.taskCount} uppgifter återstår.`, target: "project-tasks" },
    { key: "closed", label: "Avslutat", met: false, hint: project.startsOn ? `Alla jobb är klara. Projektet startar ${project.startsOn}.` : "Alla uppgifter är färdigställda. Avsluta projektet.", target: project.startsOn ? undefined : "project-close" },
  ], project.closed || project.archived);
}

/**
 * The line under a finished flow (telefonrapporten 2026-10-10, fynd 27): the same truth as the dots. When an optional step
 * was left out (shown as skipped), the line says so instead of "alla steg är gjorda".
 */
export function flowDoneText(flow: Pick<Flow, "steps">): string {
  const skipped = flow.steps.filter((step) => step.state === "skipped").map((step) => step.label);
  if (!skipped.length) return "Klart – alla steg är gjorda.";
  const names = skipped.length === 1 ? skipped[0] : `${skipped.slice(0, -1).join(", ")} och ${skipped.at(-1)}`;
  return skipped.length === 1 ? `Klart – alla steg är gjorda utom det valfria steget ${names}.` : `Klart – alla steg är gjorda utom de valfria stegen ${names}.`;
}
