import type { Flow } from "@/lib/workflow/task-flow";

/**
 * Beslutsstöd (2026-10-01): help in the background that follows the progress line and the page the person is
 * on, and says what matters now – the timer running elsewhere, a deadline passed, a high remaining risk, deviations
 * without a work order, a task that is ready to complete, a project whose tasks are all done. Rules only: free, the
 * same answer every time, nothing leaves Workflow. HINTEK AI is asked only when the person presses "Fråga HINTEK AI".
 *
 * Shown sparingly: at most one tip at a time, only after the page has been open a while, never one the person has
 * dismissed, and filtered by the person's own setting (often, normal, rarely, off).
 */

export type AdvisorLevel = "often" | "normal" | "rarely" | "off";
export const ADVISOR_LEVELS: { value: AdvisorLevel; label: string; help: string }[] = [
  { value: "often", label: "Ofta", help: "Alla tips, även små påminnelser." },
  { value: "normal", label: "Normalt", help: "Tips som påverkar arbetet: tid, slutförande och avvikelser." },
  { value: "rarely", label: "Sällan", help: "Bara det viktigaste: förfallna datum och hög risk." },
  { value: "off", label: "Av", help: "Inga tips visas." },
];
const LEVEL_MIN: Record<AdvisorLevel, number> = { often: 1, normal: 2, rarely: 3, off: 4 };

export type AdviceAction =
  | { kind: "start-timer" }
  | { kind: "complete" }
  | { kind: "save" }
  | { kind: "focus"; target: string }
  | { kind: "link"; href: string };
export type Advice = {
  /** Stable per rule, so "Visa inte sådana här tips" mutes the rule everywhere. */
  id: string;
  priority: 1 | 2 | 3;
  title: string;
  text: string;
  action?: { label: string; do: AdviceAction };
};

export type AdvisorKind = "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM" | "COMMISSIONING_CONTROL" | "PROJECT";
export type AdvisorContext = {
  kind: AdvisorKind;
  flow: Flow;
  saved: boolean;
  completed: boolean;
  /** Swedish day keys (ÅÅÅÅ-MM-DD). */
  today: string;
  dueDate?: string;
  /** Unsaved changes on a task that has never been saved. */
  unsavedNew?: boolean;
  timerAvailable?: boolean;
  timerRunning?: boolean;
  totalDurationSec?: number;
  /** The person's timer on another task or control. */
  otherTimer?: { title: string } | null;
  /** A work order's noted deviations. */
  deviationsNoted?: boolean;
  /** Protocol rows meant to be followed up with a work order that have none. */
  rowsWithoutOrder?: number;
  /** Risks whose remaining risk is high (10 or more) after the measure. */
  highResidualRisks?: number;
  /** Control points not approved. */
  failedPoints?: number;
  /** A project's tasks. */
  project?: { taskCount: number; openCount: number; closed: boolean; readyToCloseShown?: boolean };
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Every tip that applies now, most important first. */
export function adviseFlow(context: AdvisorContext): Advice[] {
  const tips: Advice[] = [];
  const step = context.flow.current?.key;
  if (context.kind === "PROJECT" && context.project) {
    const { taskCount, openCount, closed, readyToCloseShown } = context.project;
    if (closed) return [];
    if (context.dueDate && context.dueDate < context.today && openCount > 0)
      tips.push({ id: "project-overdue", priority: 3, title: "Projektet är försenat", text: `Slutdatumet ${context.dueDate} har passerat och ${plural(openCount, "uppgift är", "uppgifter är")} kvar. Flytta datumet eller fördela arbetet.` });
    // One message per thing (2026-10-02): the green "Klar att avsluta" box already says this, next to the button.
    if (taskCount > 0 && openCount === 0 && !readyToCloseShown)
      tips.push({ id: "project-close", priority: 2, title: "Alla uppgifter är slutförda", text: "Avsluta projektet så räknas det som klart i översikten och i statistiken.", action: { label: "Till Avsluta", do: { kind: "focus", target: "project-close" } } });
    if (!taskCount)
      tips.push({ id: "project-first-task", priority: 1, title: "Projektet har inga uppgifter än", text: "Progressionen räknas från projektets uppgifter. Skapa den första eller koppla en befintlig.", action: { label: "Till uppgifterna", do: { kind: "focus", target: "project-tasks" } } });
    return tips.sort((a, b) => b.priority - a.priority);
  }
  if (context.completed) return [];
  if (context.unsavedNew)
    tips.push({ id: "unsaved", priority: 1, title: "Inte sparad än", text: "Spara så att arbetet inte går förlorat. Tiden kan startas först när uppgiften är sparad.", action: { label: "Spara", do: { kind: "save" } } });
  if (context.dueDate && context.dueDate < context.today)
    tips.push({ id: "overdue", priority: 3, title: "Förfallen", text: `Klart senast var ${context.dueDate}. Slutför uppgiften eller flytta datumet om planen har ändrats.`, action: { label: "Till datumet", do: { kind: "focus", target: "task-due-date" } } });
  if (context.highResidualRisks)
    tips.push({ id: "high-residual", priority: 3, title: "Hög kvarvarande risk", text: `${plural(context.highResidualRisks, "risk har", "risker har")} hög risk även efter skyddsåtgärden. Arbetet bör inte starta förrän åtgärderna sänker risken.` });
  if (context.rowsWithoutOrder)
    tips.push({ id: "rows-without-order", priority: 2, title: `${plural(context.rowsWithoutOrder, "avvikelse saknar", "avvikelser saknar")} arbetsorder`, text: "Skapa arbetsorder direkt på raderna, så följs de upp och syns i projektet." });
  if (context.failedPoints && step === "summary")
    tips.push({ id: "failed-points", priority: 2, title: `${plural(context.failedPoints, "kontrollpunkt är", "kontrollpunkter är")} inte godkända`, text: "Beskriv avvikelserna och vad som ska åtgärdas i sammanfattningen; det kommer med i protokollet.", action: { label: "Till sammanfattningen", do: { kind: "focus", target: "summary-comment" } } });
  if (context.timerAvailable && context.saved && !context.timerRunning && context.otherTimer && step && step !== "complete")
    tips.push({ id: "other-timer", priority: 2, title: "Din tid går på en annan uppgift", text: `Tiden registreras just nu på ”${context.otherTimer.title}”. Starta tid här så pausas den andra tidtagningen.`, action: { label: "Starta tid här", do: { kind: "start-timer" } } });
  else if (context.timerAvailable && context.saved && !context.timerRunning && !context.totalDurationSec && (step === "work" || step === "fill" || step === "measure"))
    tips.push({ id: "start-timer", priority: context.kind === "WORK_ORDER" ? 2 : 1, title: "Ingen tid registrerad", text: "Starta tid när du arbetar, så hamnar den på uppgiften och i projektet utan att du behöver skriva in den efteråt.", action: { label: "Starta tid", do: { kind: "start-timer" } } });
  if (context.kind === "WORK_ORDER" && context.deviationsNoted && step === "sign")
    tips.push({ id: "deviation-followup", priority: 1, title: "Avvikelser noterade", text: "Avvikelserna kommer med i rapporten. Behövs mer arbete skapar du en ny arbetsorder när den här är slutförd." });
  if (step === "complete")
    tips.push({ id: "ready-complete", priority: 2, title: "Allt som krävs är ifyllt", text: context.timerRunning ? "Slutför nu: tidtagningen stoppas och tiden sparas på uppgiften." : "Slutför uppgiften. Du får frågan om du vill skriva tid.", action: { label: context.kind === "FORM" || context.kind === "COMMISSIONING_CONTROL" ? "Färdigställ" : "Slutför", do: { kind: "complete" } } });
  return tips.sort((a, b) => b.priority - a.priority);
}

/** The one tip to show, if any: important enough for the person's setting, not muted and not dismissed here. */
export function pickAdvice(tips: Advice[], level: AdvisorLevel, muted: readonly string[], dismissed: readonly string[]): Advice | null {
  return tips.find((tip) => tip.priority >= LEVEL_MIN[level] && !muted.includes(tip.id) && !dismissed.includes(tip.id)) ?? null;
}

/** The person's setting as stored in their preferences; unknown values fall back to Normalt. */
export const ADVISOR_DEFAULT: { level: AdvisorLevel; muted: string[] } = { level: "normal", muted: [] };

/** The window event a tip sends when the person presses "Fråga HINTEK AI"; the shell opens the assistant with it. */
export const ASSISTANT_ASK_EVENT = "hintek:assistant-ask";
