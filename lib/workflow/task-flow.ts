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

/** Arbetsorder: Beställning → Planering (valfri) → Utförande → Signering → Slutförd. */
export function workOrderFlow(task: {
  saved: boolean; title: string; status: string; assigned: boolean; dueDate: string; timerRunning: boolean; totalDurationSec: number;
  executionNotes: string; signatureName: string; signatureConfirmed: boolean;
}): Flow {
  return buildFlow([
    { key: "order", label: "Beställning", met: task.saved && filled(task.title), hint: "Ange rubrik och vad som ska göras, och spara.", target: "task-title" },
    { key: "plan", label: "Planering", optional: true, met: task.assigned || filled(task.dueDate), hint: "Välj ansvarig och Klart senast om arbetet ska planeras.", target: "task-due-date" },
    { key: "work", label: "Utförande", met: filled(task.executionNotes), target: "task-execution",
      hint: task.timerRunning ? "Tiden går. Beskriv det utförda arbetet, material och eventuella avvikelser." : task.totalDurationSec > 0 ? "Beskriv det utförda arbetet. Starta tid igen om du fortsätter arbeta." : "Starta tid när du börjar och beskriv det utförda arbetet." },
    { key: "sign", label: "Signering", met: filled(task.signatureName) && task.signatureConfirmed, hint: "Ange namnet på den som signerar och intyga att dokumentationen är granskad.", target: "task-signature-name" },
    { key: "complete", label: "Slutförd", met: false, hint: task.timerRunning ? "Slutför uppgiften. Tidtagningen stoppas och du kan skriva till tid." : "Slutför uppgiften. Du får frågan om du vill skriva tid.", target: "task-complete" },
  ], task.status === "COMPLETED");
}

/** Riskbedömning: Grunduppgifter → Risker → Godkännande → Slutförd. */
export function riskFlow(task: {
  saved: boolean; title: string; status: string;
  risks: { hazard: string; protectiveMeasure: string }[]; approvalName: string; approvalConfirmed: boolean;
}): Flow {
  const risksMet = task.risks.length > 0 && task.risks.every((risk) => filled(risk.hazard) && filled(risk.protectiveMeasure));
  return buildFlow([
    { key: "basics", label: "Grunduppgifter", met: task.saved && filled(task.title), hint: "Ange rubrik, plats och ansvarig, och spara.", target: "task-title" },
    { key: "risks", label: "Risker", met: risksMet, hint: task.risks.length ? "Beskriv fara och skyddsåtgärd för varje risk och bedöm risken före och efter." : "Lägg till varje betydande fara som en egen risk.", target: "task-add-risk" },
    { key: "approval", label: "Godkännande", met: filled(task.approvalName) && task.approvalConfirmed, hint: "Den som granskat bedömningen anger sitt namn och bekräftar.", target: "task-approval-name" },
    { key: "complete", label: "Slutförd", met: false, hint: "Slutför riskbedömningen. Du får frågan om du vill skriva tid.", target: "task-complete" },
  ], task.status === "COMPLETED");
}

/**
 * A protocol made from a form: Grunduppgifter → Ifyllnad → Signering (when the form has signatures) → Färdigställd.
 * `issues` are the completion issues ("form-<blockId>" fields), `signatureBlocks` the ids of the form's signatures.
 */
export function formFlow(task: { saved: boolean; title: string; status: string; issues: { field: string; message: string }[]; signatureBlocks: string[]; titleFieldLabel?: string;
  /** A form that asks the person to pick its moments (Kontroll före idrifttagning): the choice is a step of its own. */
  moments?: { label: string; met: boolean; target?: string } }): Flow {
  const signature = new Set(task.signatureBlocks.map((id) => `form-${id}`));
  const momentTarget = task.moments?.target;
  const fillIssues = task.issues.filter((issue) => !signature.has(issue.field) && issue.field !== "task-title" && !(task.moments && !task.moments.met && issue.field === momentTarget));
  const signIssues = task.issues.filter((issue) => signature.has(issue.field));
  return buildFlow([
    { key: "basics", label: "Grunduppgifter", met: task.saved && filled(task.title), hint: task.titleFieldLabel ? `Fyll i ${task.titleFieldLabel.toLowerCase()} och kund, och spara.` : "Ange rubrik och kund, och spara.", target: task.titleFieldLabel ? undefined : "task-title" },
    ...(task.moments ? [{ key: "moments", label: task.moments.label, met: task.moments.met, hint: `Välj de ${task.moments.label.toLowerCase()} som ska utföras.`, target: momentTarget }] : []),
    { key: "fill", label: "Ifyllnad", met: fillIssues.length === 0, hint: fillIssues[0]?.message ?? "Fyll i protokollets punkter.", target: fillIssues[0]?.field },
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
export function projectFlow(project: { closed: boolean; archived: boolean; taskCount: number; startedCount: number; completedCount: number }): Flow {
  const allDone = project.taskCount > 0 && project.completedCount === project.taskCount;
  return buildFlow([
    { key: "created", label: "Skapat", met: true, hint: "Projektet finns." },
    { key: "tasks", label: "Uppgifter", met: project.taskCount > 0, hint: "Skapa projektets första uppgift eller koppla en befintlig.", target: "project-tasks" },
    { key: "work", label: "Utförande", met: project.startedCount > 0 || project.completedCount > 0, hint: "Öppna en uppgift och starta arbetet.", target: "project-tasks" },
    { key: "done", label: "Uppgifterna klara", met: allDone, hint: `${project.taskCount - project.completedCount} av ${project.taskCount} uppgifter återstår.`, target: "project-tasks" },
    { key: "closed", label: "Avslutat", met: false, hint: "Alla uppgifter är slutförda. Avsluta projektet.", target: "project-close" },
  ], project.closed || project.archived);
}
