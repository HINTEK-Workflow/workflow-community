/**
 * Visning 1 (2026-10-12): navigation without floating arrows. The pure rules behind the top bar's "‹ <previous>"
 * and the edge swipe; the pieces that draw them are in components/native/top-bar.tsx and components/history-nav.tsx.
 */

/** The edge swipe: starts within `edge` px of the left edge, travels more than `distance` px right and mostly sideways. */
export const EDGE_SWIPE = { edge: 28, distance: 60, slope: 0.6 } as const;
export type TouchPoint = { x: number; y: number };

export function isEdgeSwipeBack(start: TouchPoint, end: TouchPoint): boolean {
  const dx = end.x - start.x;
  const dy = Math.abs(end.y - start.y);
  return start.x >= 0 && start.x < EDGE_SWIPE.edge && dx > EDGE_SWIPE.distance && dy <= dx * EDGE_SWIPE.slope;
}

/**
 * Skärmbyte med riktning (appkänslan, beslutad 2026-11-23): which way the new screen comes in. A new page is a step further in
 * ("forward", from the right); the browser moving to an earlier visit is the way back ("back", from the left) and to a later
 * one forward again. A press in the tab bar is a change of place, not a step, and a replaced address is the same screen:
 * neither moves (null – the plain fade).
 */
export type ScreenChange = "forward" | "back";
export function screenChangeFor(input: { kind: "push" | "replace" | "visit"; before: number; after: number; fromTabBar: boolean }): ScreenChange | null {
  if (input.fromTabBar || input.kind === "replace") return null;
  if (input.kind === "push") return "forward";
  return input.after < input.before ? "back" : input.after > input.before ? "forward" : null;
}

type TrailItem = { label: string };

/**
 * The short name a back button gives a page (2026-10-12): the tab's or menu's own word, never "Översikt"/"Verktyg" for
 * pages that are not there. The lists are called as their menu buttons since 2026-10-23 ("Uppgifter", "Tid"); the older
 * names stay for a visit stored before.
 */
const SHORT_PAGE_NAME: Record<string, string> = {
  "Översikt": "Hem", "Uppgifter": "Jobb", "Mina uppgifter": "Jobb", "Tidrapport": "Tid", "Verktyg": "Mer", "Register": "Mer",
  "Mina arbetsordrar": "Arbetsordrar", "Mina projekt": "Projekt", "Mina offerter": "Offerter", "Mina driftronder": "Driftronder", "Kundregister": "Kunder",
};
export function shortPageName(label: string): string {
  const trimmed = label.trim();
  return SHORT_PAGE_NAME[trimmed] ?? trimmed;
}

/** The pages the tab bar leads to are roots: nothing above them, so no back button (Hem is a trail of one). */
const TAB_ROOT_LABELS = new Set(["Uppgifter", "Tid", "Mina uppgifter", "Tidrapport"]);
export function isTabRootTrail(trail: readonly TrailItem[]): boolean {
  return trail.length < 2 || (trail.length === 2 && TAB_ROOT_LABELS.has(trail[1]!.label));
}

/**
 * What a back button says when it goes to the visit before this one (an address inside Workflow): the short name of that
 * page, or the thing it shows (the customer, the project, the job) when the address points into one. Null when unknown.
 */
export function backLabelForAddress(address: string | null | undefined, viewLabels: Readonly<Record<string, string>>): string | null {
  if (!address) return null;
  let params: URLSearchParams;
  try { params = new URL(address, "http://local").searchParams; } catch { return null; }
  const view = params.get("view") ?? "stats";
  if (view === "stats") return "Hem";
  // Every kind of job is "Jobbet" (2026-10-14): one short word in the definite form, so the title keeps its room and the
  // same step never says "Arbetsordern" one time and "Jobbet" the next.
  if (view === "workflow_task" && params.get("taskId")) return "Jobbet";
  if (view === "project" && params.get("projectId")) return "Projektet";
  if (view === "customers" && params.get("customerId")) return "Kunden";
  if (view === "place" && params.get("placeId")) return "Platsen";
  if (view === "quote" && params.get("quoteId")) return "Offerten";
  const label = viewLabels[view];
  return label ? shortPageName(label) : null;
}

const viewOf = (address: string): string | null => { try { return new URL(address, "http://local").searchParams.get("view") ?? "stats"; } catch { return null; } };

/**
 * The back button's name, from the same source as its target (2026-10-12): the visit before this one when back goes there
 * (so "Hem", "Inställningar" or "Platser" is whatever the person really returns to), but a page's own name for a screen of
 * itself (a job's step goes back to "Jobbet", a quote's line to "Rader") when the visit before is the same page; otherwise
 * the page above in the breadcrumb trail.
 */
export function resolveBackLabel(input: { own?: string; previous: string | null | undefined; here: string; trailBack?: string; viewLabels: Readonly<Record<string, string>>;
  /** The page was opened from the Mer sheet, which lay over the visit before (2026-10-12): back reopens Mer, so it says Mer. */
  openedFrom?: "more" | null }): string {
  if (input.openedFrom === "more" && input.previous) return "Mer";
  const fromHistory = backLabelForAddress(input.previous, input.viewLabels);
  if (fromHistory) {
    const samePage = input.previous ? viewOf(input.previous) === viewOf(input.here) : false;
    return backLabelFor(samePage ? input.own : undefined, fromHistory);
  }
  return backLabelFor(input.own, input.trailBack);
}

/**
 * What the shell's standard bar shows on a page without a bar of its own: the open page's name in the middle and the short name
 * of the page above it to the left. Home (a trail of one) has no bar.
 */
export function standardBarFor(trail: readonly TrailItem[]): { title: string; backLabel: string } | null {
  if (trail.length < 2) return null;
  return { title: trail[trail.length - 1]!.label, backLabel: shortPageName(trail[trail.length - 2]!.label) };
}

/** A page's own bar may name the page to go back to (a job's step goes back to "Jobbet"); without a name the trail gives it. */
export function backLabelFor(own: string | undefined, trailBack: string | undefined): string {
  return (own?.trim() || trailBack?.trim() || "Tillbaka");
}

export type FlowStepInput = { key: string; label: string };
export type FlowBarModel = {
  /** 1-based position and the number of steps. */
  position: number;
  total: number;
  /** The step before and after, or null at the ends. */
  previous: FlowStepInput | null;
  next: FlowStepInput | null;
  /** "Nästa: <name>" on every step but the last. */
  nextLabel: string | null;
  /** The last step offers the finishing action instead of Nästa. */
  isLast: boolean;
  /** Dots for StepBar: done before the current, current, todo after. */
  dots: ("done" | "current" | "todo")[];
};

/** The bottom row of a flow (Föregående / Nästa: <name> / the finishing action) for the step at `index` (0-based). */
export function flowBarModel(steps: readonly FlowStepInput[], index: number): FlowBarModel {
  const total = steps.length;
  const at = Math.min(Math.max(index, 0), Math.max(total - 1, 0));
  const next = steps[at + 1] ?? null;
  return {
    position: total ? at + 1 : 0,
    total,
    previous: steps[at - 1] ?? null,
    next,
    nextLabel: next ? `Nästa: ${next.label}` : null,
    isLast: total > 0 && at === total - 1,
    dots: steps.map((_, i) => (i < at ? "done" : i === at ? "current" : "todo")),
  };
}

/** The address one screen up: a row's `item` goes to its step, a step (and a form's `part`) to the page itself. */
export function screenParent(params: { get(name: string): string | null; toString(): string }): string | null {
  const next = new URLSearchParams(params.toString());
  if (next.get("item")) next.delete("item");
  else if (next.get("step") || next.get("part")) { next.delete("step"); next.delete("part"); }
  else return null;
  return `/?${next.toString()}`;
}
