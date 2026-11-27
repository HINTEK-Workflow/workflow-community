// One meaning for indicator colors everywhere (2026-09-25): green = done/ok, amber = in progress/draft/warning/near a limit,
// red = overdue/over budget/needs action/high risk. Neutral is for planned, paused or cancelled; info is the plain progress blue.
export type IndicatorTone = "success" | "warning" | "danger" | "neutral" | "info";

// Soft pills without an edge (2026-10-16, the design lab): a light fill and dark text of the same hue.
const badges: Record<IndicatorTone, string> = {
  success: "border-transparent bg-[#dcf5e6] text-[#14632f] dark:bg-emerald-950 dark:text-emerald-200",
  warning: "border-transparent bg-[#fcefd6] text-[#5c3b00] dark:bg-amber-950 dark:text-amber-200",
  danger: "border-transparent bg-[#fde2e2] text-[#9b1c1c] dark:bg-red-950 dark:text-red-200",
  neutral: "border-transparent bg-muted text-muted-foreground",
  info: "border-transparent bg-secondary text-secondary-foreground",
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
  // The red text token (app/globals.css --danger-text, D2 2026-10-23): 6.5:1 on white, 9:1 on the dark cards.
  danger: "text-danger",
  neutral: "text-muted-foreground",
  info: "text-primary",
};

// A chosen answer (2026-09-29: OK / Ej OK / Ej aktuellt need clear colours): solid, white text.
const choices: Record<IndicatorTone, string> = {
  success: "bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-700",
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

// A four-step scale from light yellow to red (Avvikelser's Allvarlighetsgrad, 2026-10-30: "gradient från gul, orange,
// röd; grön är inte en bra färg för tillbud och allvarlighetsgrad"). A card or row: a faint fill and an edge
// of the step's hue (no left stripe, 2026-11-02); the pill in the same hue. The text keeps the card's own contrast in Light and Dark.
export type ScaleStep = 1 | 2 | 3 | 4;
const scaleSurfaces: Record<ScaleStep, string> = {
  1: "border-yellow-200 border-l-yellow-300 bg-yellow-50/60 dark:border-yellow-900/50 dark:border-l-yellow-400/70 dark:bg-yellow-950/15",
  2: "border-amber-200 border-l-amber-500 bg-amber-100/50 dark:border-amber-900/60 dark:border-l-amber-500 dark:bg-amber-950/35",
  3: "border-orange-300 border-l-orange-600 bg-orange-100/80 dark:border-orange-800/70 dark:border-l-orange-500 dark:bg-orange-950/55",
  4: "border-red-300 border-l-red-600 bg-red-100/70 dark:border-red-900/70 dark:border-l-red-500 dark:bg-red-950/55",
};
// Låg and Normal light, Hög and Akut filled – so the four read apart even where the tints are close.
const scaleBadges: Record<ScaleStep, string> = {
  1: "border-transparent bg-yellow-100 text-yellow-900 dark:bg-yellow-300/15 dark:text-yellow-100",
  2: "border-transparent bg-amber-200/70 text-amber-950 dark:bg-amber-500/35 dark:text-amber-50",
  3: "border-transparent bg-orange-600 text-white dark:bg-orange-600 dark:text-white",
  4: "border-transparent bg-red-700 text-white dark:bg-red-600 dark:text-white",
};
/** A card's or row's tint for a step of the scale. */
export const scaleSurface = (step: ScaleStep) => scaleSurfaces[step];
/** The pill of a step, in the same hue as its tint. */
export const scaleBadge = (step: ScaleStep) => scaleBadges[step];

/**
 * Pills of one width (2026-10-30): added to a pill's own classes so pills line up in straight columns from row to
 * row – at least as wide as the longest common label ("Åtgärdad", "Försenad", "Färdigställd") at text-xs, centred, never
 * wrapping. A longer label ("Behöver åtgärdas", "Tillbakaskickad") keeps its natural width, so no text is ever cut. Only
 * where pills stand in a column at a list row's end – never in running text, filters, tabs, headers or detail pages. A
 * phone list asks for it on its ListGroup (`alignPills`).
 */
export const PILL_FIXED_WIDTH = "inline-flex min-w-[5.5rem] shrink-0 justify-center whitespace-nowrap";
/**
 * The same from a width up, where the row has room for it (measured 2026-10-30 at 390 px: a wider pill took a job's name
 * onto one more line and cut a quote's name shorter, so a phone held upright keeps the pill's natural width). Sm: the
 * phone lists (ListGroup alignPills); md: the lists whose status stands in a grid column only from md.
 */
export const PILL_FIXED_WIDTH_SM = "sm:inline-flex sm:min-w-[5.5rem] sm:shrink-0 sm:justify-center sm:whitespace-nowrap";
export const PILL_FIXED_WIDTH_MD = "md:inline-flex md:min-w-[5.5rem] md:shrink-0 md:justify-center md:whitespace-nowrap";

/** Task/control status → tone. Unknown statuses are neutral. */
export function statusTone(status: string): IndicatorTone {
  if (["COMPLETED", "Slutförd", "Färdigställd", "Slutfört", "Färdigställt", "Klar att avsluta", "Avslutat", "done"].includes(status)) return "success";
  if (["NEEDS_ACTION", "Behöver åtgärdas", "OVERDUE", "Förfallen", "Förfallet"].includes(status)) return "danger";
  if (["IN_PROGRESS", "Pågår", "DRAFT", "Utkast", "active"].includes(status)) return "warning";
  return "neutral";
}

/** Completion bar: blue while work is under way, green when done, red when overdue or action is needed, grey when Utgått. */
export function progressTone({ percent, completed, attention, cancelled }: { percent: number; completed?: boolean; attention?: boolean; cancelled?: boolean }): IndicatorTone {
  if (cancelled) return "neutral";
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
