import { sameAddress } from "./history-stack";

/**
 * Flytande navigering (2026-10-27, beslut 5–7; docs/ui-system.md "Flytande navigering"): a separate complement to the
 * page's own buttons, so the person can move on and finish the work without the browser's Bakåt/Framåt. The page's ordinary
 * buttons (menu, Ta bort, Starta tid, Avbryt, Spara …) keep their place, look and function; the floating group only adds
 * Tillbaka, Framåt, Avbryt and Spara where they are needed, and since 2026-11-02 the icon Workflow AI. The pure rules are here, the
 * drawing in components/floating-nav.tsx.
 */

export type FloatingNavButton = "back" | "forward" | "cancel" | "save";

export type FloatingNavInput = {
  /** Visning 1 (the app look, `data-native`): its own top bar (‹ / Avbryt / Spara), edge swipe and tab bar – no floating group. */
  native: boolean;
  /** The content level in force (1–3): 2 draws a compact group (symbols only), 3 symbols with words. */
  level: 1 | 2 | 3;
  /** From 1024 px: no bottom bar, the group stands at the bottom right. Narrower: left above the bottom bar, which has Spara. */
  wide: boolean;
  /** The on-screen keyboard is up (visualViewport), or the mobile menu is open: the group steps aside. */
  covered: boolean;
  /** A visit inside Workflow to go back to, or forward to (the visit history; any page, also a list or tab from the menu). */
  canBack: boolean;
  canForward: boolean;
  /** Without a visit to go back to: the page above (`returnTo`, a screen's page, the breadcrumb's parent), or null. */
  fallback: string | null;
  /** The page registers its own way back ("Tillbaka till arbetsordern", which also brings the job along). */
  ownBack: boolean;
  /** The page is being edited and registers its own Avbryt (the same button as in its header). */
  cancel: boolean;
  /** The page registers its own Spara (the same function as its header's and the bottom bar's) and it can be used now. */
  save: boolean;
  /** The page's own action group (top right) is in sight: Avbryt and Spara are then not repeated. */
  headerInView: boolean;
  /** The person has Workflow AI here (`assistantIconAllowed`). Left out: no icon. */
  assistant?: boolean;
};

export type FloatingNavModel = {
  buttons: FloatingNavButton[];
  /**
   * Tillbaka and Framåt without a function on this page (2026-11-01): their round places stay, nearly transparent and
   * not clickable, so the arrows never move and appear only when they lead somewhere.
   */
  idle: ("back" | "forward")[];
  /**
   * The icon Workflow AI (2026-11-02): on every page where the group is drawn, whatever the arrows do, also while editing. It
   * is never idle and stands at the group's outer end, so it does not move when Avbryt and Spara come and go. Not in visning
   * 1, which has Hem and Mer, and not while the group has stepped aside (keyboard, menu, the panel itself).
   */
  assistant: boolean;
  /** Where the group stands: bottom right on a computer; on a tablet above the bottom bar, also at the right (2026-11-17: "som i datorn"). */
  placement: "right" | "bar";
  /** Symbols only (visning 2, and every narrow screen), or symbols with words (visning 3 on a computer). */
  compact: boolean;
};

/** Where Workflow AI's window is the whole screen instead of a popup at the button (2026-11-02): a phone's width, or a phone on its side. */
export const ASSISTANT_FULL_SCREEN_QUERY = "(max-width: 639px), (max-width: 1023px) and (max-height: 500px) and (orientation: landscape) and (pointer: coarse)";

/** The page above, unless that is the address the person already stands on: a press would do nothing. */
export const usefulFallback = (fallback: string | null, here: string) => (fallback && !sameAddress(fallback, here) ? fallback : null);

/**
 * Which floating buttons a page needs now; an empty list draws nothing.
 * The arrows (2026-11-02, replaces N13 of 2026-11-01, which offered Tillbaka only on a detail page): Tillbaka whenever there is an
 * earlier page in Workflow in this tab, also on a list or tab from the menu; Framåt after going back; nearly transparent only when
 * there really is nothing to go to.
 */
export function floatingNavModel(input: FloatingNavInput): FloatingNavModel {
  const placement = input.wide ? "right" : "bar";
  const compact = input.level < 3 || !input.wide;
  if (input.native || input.covered) return { buttons: [], idle: [], assistant: false, placement, compact };
  const buttons: FloatingNavButton[] = [];
  // Editing: Tillbaka is the page's own Avbryt (which asks about unsaved changes), so it always leads somewhere.
  if (input.ownBack || input.cancel || input.canBack || input.fallback) buttons.push("back");
  if (input.canForward) buttons.push("forward");
  if (input.cancel && !input.headerInView) buttons.push("cancel");
  // The bottom bar under 1024 px has Spara already (Editor-läge): never two.
  if (input.save && input.wide && !input.headerInView) buttons.push("save");
  const idle = (["back", "forward"] as const).filter((button) => !buttons.includes(button));
  return { buttons, idle, assistant: Boolean(input.assistant), placement, compact };
}

/** The words and tooltips of the buttons (aria-label always, also when only the symbol is drawn). */
export function floatingNavLabel(button: FloatingNavButton, backTarget?: string | null): { label: string; aria: string } {
  switch (button) {
    case "back": return { label: "Tillbaka", aria: backTarget ? `Tillbaka till ${backTarget}` : "Tillbaka" };
    case "forward": return { label: "Framåt", aria: "Framåt" };
    case "cancel": return { label: "Avbryt", aria: "Avbryt redigeringen" };
    // Its own name, as Avbryt redigeringen: the page's Spara stays the one button named exactly "Spara".
    case "save": return { label: "Spara", aria: "Spara ändringarna" };
  }
}
