// One meaning for indicator colors everywhere (2026-09-25): green = done/ok, amber = in progress/draft/warning/near a limit,
// red = overdue/over budget/needs action/high risk. Neutral is for planned, paused or cancelled; info is the plain progress blue.
export type IndicatorTone = "success" | "warning" | "danger" | "neutral" | "info";

const badges: Record<IndicatorTone, string> = {
  success: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  warning: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  danger: "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
  neutral: "border-border bg-muted text-muted-foreground",
  info: "border-primary/30 bg-secondary text-secondary-foreground",
};

const bars: Record<IndicatorTone, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-600",
  neutral: "bg-muted-foreground/50",
  info: "bg-primary",
};

const texts: Record<IndicatorTone, string> = {
  success: "text-emerald-700 dark:text-emerald-300",
  warning: "text-amber-700 dark:text-amber-300",
  danger: "text-red-700 dark:text-red-300",
  neutral: "text-muted-foreground",
  info: "text-primary",
};

// A chosen answer (2026-09-29: OK / Ej OK / Ej aktuellt need clear colours): solid, white text.
const choices: Record<IndicatorTone, string> = {
  success: "bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600",
  warning: "bg-amber-500 text-amber-950 hover:bg-amber-600",
  danger: "bg-red-600 text-white hover:bg-red-700 dark:bg-red-600",
  neutral: "bg-slate-500 text-white hover:bg-slate-600 dark:bg-slate-500",
  info: "bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]",
};

/** Tinted pill/badge (border, background and readable text). */
export const indicatorBadge = (tone: IndicatorTone) => badges[tone];
/** Solid fill for progress bars and dots. */
export const indicatorBar = (tone: IndicatorTone) => bars[tone];
/** A chosen answer in a group of answer buttons. */
export const indicatorChoice = (tone: IndicatorTone) => choices[tone];
/** Text color for a value that carries the indicator meaning. */
export const indicatorText = (tone: IndicatorTone) => texts[tone];

/** Task/control status → tone. Unknown statuses are neutral. */
export function statusTone(status: string): IndicatorTone {
  if (["COMPLETED", "Slutförd", "Slutfört", "Klar att avsluta", "Avslutat", "done"].includes(status)) return "success";
  if (["NEEDS_ACTION", "Behöver åtgärdas", "OVERDUE", "Förfallen"].includes(status)) return "danger";
  if (["IN_PROGRESS", "Pågår", "DRAFT", "Utkast", "active"].includes(status)) return "warning";
  return "neutral";
}

/** Completion bar: blue while work is under way, green when done, red when overdue or action is needed. */
export function progressTone({ percent, completed, attention }: { percent: number; completed?: boolean; attention?: boolean }): IndicatorTone {
  if (attention) return "danger";
  if (completed || percent >= 100) return "success";
  return "info";
}

/** Time budget bar: green within budget, amber at high usage, red when exceeded. */
export function budgetTone({ isOverBudget, isHighUsage }: { isOverBudget: boolean; isHighUsage?: boolean }): IndicatorTone {
  if (isOverBudget) return "danger";
  if (isHighUsage) return "warning";
  return "success";
}
