/** A form's icon color, from Workflow's own palette only (forms never carry their own CSS). */
export const FORM_COLOR_OPTIONS = [
  ["green", "Grön"], ["blue", "Blå"], ["violet", "Violett"], ["amber", "Bärnsten"], ["rose", "Röd"], ["cyan", "Cyan"],
] as const;

export function formColorClass(color: string) {
  switch (color) {
    case "blue": return "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200";
    case "violet": return "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200";
    case "amber": return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
    case "rose": return "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200";
    case "cyan": return "bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200";
    default: return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200";
  }
}
