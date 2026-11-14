/**
 * Popup eller sida (2026-10-11, plan 1Q, replacing parts of 1O): the size decides, the display decides how. The size
 * is the box "Lägg till instrument" (four fields in two columns, a note and a tick box, about 520 x 480 px). A form that fits
 * is `size="form"`: a popup on display 3 (from a window of 768 px) and a page of its own on display 2; anything larger is a
 * page (`formPresentation` below, used by FormPage and DialogPage in features/kfid/). Short questions, confirmations and
 * simple choices are small dialogs (`compact`) everywhere. Display level 1 on a phone has its own app look, where every
 * dialog but a compact one is drawn as a screen (`nativeDialogScreen`). Pure, so the rules are tested.
 *
 * - "compact": always a small dialog (confirmations, a key to copy).
 * - "form": see above; a Modal with this size is the popup box itself (never chosen by the Modal on its own).
 * - "auto" (default): a small dialog; at level 1 on a phone a screen when its content is larger than the benchmark.
 * - "view" / "page": at level 1 on a phone a screen; on displays 2 and 3 a page (FormPage/DialogPage).
 */
/** "form" (plan 1Q, 2026-10-11): a form that fits the size of "Lägg till instrument" – a popup on display 3 (computer), a page on display 2, a screen at level 1. */
export type DialogSize = "auto" | "compact" | "form" | "page" | "view";
export type DialogPresentation = "box" | "view";
/** How a form is shown (plan 1Q): a popup box, a page of its own, or a level-1 screen. */
export type FormPresentation = "popup" | "page" | "screen";
export type DeviceClass = "phone" | "tablet" | "desktop";

/** The benchmark for a small dialog's content (2026-10-09). */
export const SMALL_DIALOG = { width: 375, height: 375 } as const;

export function dialogPresentation({ size, device, contentHeight, keyboard = false, wasView = false, native = false }: {
  size: DialogSize;
  device: DeviceClass;
  /** The height the dialog's content needs (scrollHeight of its body), when known. */
  contentHeight?: number | null;
  keyboard?: boolean;
  wasView?: boolean;
  /** Display level 1 on a phone, the only place a dialog may grow into a screen (plan 1O). */
  native?: boolean;
}): DialogPresentation {
  if (!native || size === "compact") return "box";
  if (size === "view" || size === "page" || size === "form" || wasView) return "view";
  if (device === "desktop" || keyboard || contentHeight == null) return "box";
  return contentHeight > SMALL_DIALOG.height ? "view" : "box";
}

/**
 * Popupstorlek (2026-10-13): "Ingen popup får vara bredare eller högre än Nytt projekt. Större innehåll ska öppnas
 * på en separat sida." The box of Nytt projekt (`Modal size="form"`) is the ceiling for every popup: 520 px (32.5rem) wide
 * and at most 85 % of the window high (on a touch screen under 1024 px the part the keyboard leaves, less 24 px – the same
 * rule as Nytt projekt). The shared Modal caps every box to it; content that does not fit is a page (DialogPage/FormPage).
 */
export const POPUP_MAX = { width: 520, heightShare: 0.85 } as const;

/** Whether a popup box of this size keeps within the ceiling in a window of this height (1 px rounding allowed). */
export function popupWithinMax(box: { width: number; height: number }, windowHeight: number): boolean {
  return box.width <= POPUP_MAX.width + 1 && box.height <= Math.round(windowHeight * POPUP_MAX.heightShare) + 1;
}

/** From this window width a form that fits "Lägg till instrument" is a popup at display 3; a narrower window (a phone) gets a page. */
export const FORM_POPUP_MIN_WIDTH = 768;

/**
 * Popup eller sida (2026-10-11, plan 1Q): the size decides, the display decides how.
 * - level 1: a screen, as before (a small `compact` dialog stays a small dialog);
 * - `compact`: always a small dialog (popup);
 * - `form` (fits the size of "Lägg till instrument", about 520 x 480 px): a popup at level 3 in a window of at least
 *   768 px, otherwise a page – display 2 (tablet, and a phone that chose 2) always draws it as a page of its own;
 * - `page`, `view` and `auto` (anything larger): a page at levels 2 and 3.
 * Pure, so the rule is tested and every form follows it from its `size` alone.
 */
export function formPresentation({ level, width, size }: { level: 1 | 2 | 3; width: number; size: DialogSize }): FormPresentation {
  if (size === "compact") return "popup";
  if (level === 1) return "screen";
  if (size === "form" && level === 3 && width >= FORM_POPUP_MIN_WIDTH) return "popup";
  return "page";
}

/**
 * Nivå 1 på mobil (2026-10-10): every dialog but a small one ("compact") opens as a screen of its own with Avbryt
 * and its main action in the top bar, like the phone's own apps; a compact dialog can ask to be a screen too
 * (`nativeScreen`, e.g. Ändra tidplan with its dates). Confirmations (the shared confirm card) are never a screen.
 */
export function nativeDialogScreen({ native, size, nativeScreen }: { native: boolean; size: DialogSize; nativeScreen?: boolean }): boolean {
  if (!native) return false;
  return nativeScreen ?? size !== "compact";
}

/** About this many characters fit in the phone's top bar beside a title, also at 360 px (2026-10-10: "Rapportera" was cut). */
export const TOP_BAR_LABEL_MAX = 7;
/** Swedish verbs that need their particle to mean anything ("Lägg till", "Ta bort", "Sätt till"). */
const PARTICLE_VERBS = new Set(["lägg", "ta", "sätt", "gör", "ge", "fyll", "läs", "byt", "för", "slå"]);
/** Long verbs and the phone's own short word for the same thing. */
const SHORT_VERBS: Record<string, string> = { rapportera: "Skicka", uppdatera: "Spara", registrera: "Spara" };
/** Actions that finish what a dialog is for: named after "och" they are what the tap does ("Spara tid och färdigställ"). */
const FINAL_VERBS = new Set(["färdigställ", "slutför", "skicka", "publicera"]);

/**
 * The main action's label in the top bar of a screen at level 1 (2026-10-10): short as the phone's own ("Spara",
 * "Skapa", "Skicka", "Lägg till"). "Spara ändringar" → "Spara", "Skapa planering" → "Skapa", "Lägg till plats" →
 * "Lägg till", "Rapportera" → "Skicka"; a label that already fits is kept. "Spara tid och färdigställ" → "Färdigställ":
 * the finishing action wins (simulation 2026-10-10: the bar said "Spara" and no longer that the tap completes the job).
 * The full label stays for screen readers (aria-label).
 */
export function shortActionLabel(label: string, max = TOP_BAR_LABEL_MAX): string {
  const text = label.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const final = text.split(/ och /i).slice(1).at(-1)?.split(" ")[0];
  if (final && FINAL_VERBS.has(final.toLocaleLowerCase("sv"))) return `${final.charAt(0).toLocaleUpperCase("sv")}${final.slice(1).toLocaleLowerCase("sv")}`;
  const words = text.split(" ");
  const first = words[0] ?? text;
  const verb = first.toLocaleLowerCase("sv");
  if (words.length > 1 && PARTICLE_VERBS.has(verb)) return `${first} ${words[1]}`;
  return SHORT_VERBS[verb] ?? first;
}
