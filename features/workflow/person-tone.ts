// Stable, presentation-only colors keyed by a member, project or other id, shared by calendar, cards and time lists.
const tones = [
  { surface: "border-sky-500 bg-sky-50 text-sky-950 dark:bg-sky-950 dark:text-sky-100", solid: "bg-sky-600" },
  { surface: "border-teal-500 bg-teal-50 text-teal-950 dark:bg-teal-950 dark:text-teal-100", solid: "bg-teal-600" },
  { surface: "border-orange-500 bg-orange-50 text-orange-950 dark:bg-orange-950 dark:text-orange-100", solid: "bg-orange-500" },
  { surface: "border-violet-500 bg-violet-50 text-violet-950 dark:bg-violet-950 dark:text-violet-100", solid: "bg-violet-600" },
  { surface: "border-emerald-500 bg-emerald-50 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100", solid: "bg-emerald-600" },
  { surface: "border-rose-500 bg-rose-50 text-rose-950 dark:bg-rose-950 dark:text-rose-100", solid: "bg-rose-600" },
] as const;

const toneFor = (key: string) => tones[[...key].reduce((total, character) => total + character.charCodeAt(0), 0) % tones.length];

/** Tinted background, colored left/outline border and readable text. */
export const personSurfaceTone = (key: string) => toneFor(key).surface;
/** Saturated fill for avatars and legend dots; pair with white text. */
export const personSolidTone = (key: string) => toneFor(key).solid;

export const personInitials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("sv-SE")).join("") || "?";
