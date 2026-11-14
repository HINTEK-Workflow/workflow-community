"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Plus, Users, X } from "lucide-react";
import { backTargetUrl, openedFromSheet, requestSheet, useBackFallback, useVisitHistory } from "@/components/history-nav";
import { useBreadcrumbTrail } from "@/components/page-shell";
import { confirmLeave } from "@/lib/workflow/leave-guard";
import { isTabRootTrail, resolveBackLabel, screenParent, shortPageName, standardBarFor } from "@/lib/workflow/native-nav";
import { VIEW_LABEL } from "@/lib/workflow/navigation";
import { shortActionLabel } from "@/lib/workflow/dialog-mode";

/**
 * The top bar of Nivå 1 på mobil (2026-10-09, reworked 2026-10-12): the screen title in the middle; to the left
 * "‹ <the page above>" (back), or Avbryt while editing; Spara to the right. There are no floating Bakåt/Framåt in level 1
 * any more. The shell draws a standard bar on every page below Hem from the breadcrumb trail; a page with screens of its own
 * (a job's steps, a form) replaces it with `useNativeTopBar`, which keeps the back button unless it has Avbryt.
 */
export type NativeTopBarConfig = {
  title: string;
  /** Editing: Avbryt (the page asks first when something is changed, 2026-10-13) and Spara instead of back. */
  cancel?: { label?: string; onClick: () => void } | null;
  /** `plain` draws the action as blue text (a list's Redigera/Klar, 2026-10-14), not as the filled main action. */
  save?: { label?: string; onClick: () => void; busy?: boolean; disabled?: boolean; plain?: boolean } | null;
  /**
   * The back button ("‹ <label>"). Without it the page above in the breadcrumb trail names it; `label` names a screen
   * of the page itself (a job's step goes back to "Jobbet"); `null` leaves it out. Never shown together with Avbryt.
   */
  back?: { label?: string } | null;
  /** A small line under the title (a job's screens, 2026-10-22): its save state and who else has it open. */
  status?: NativeBarStatusConfig | null;
};
/**
 * The line under the bar's title: the save state ("Sparat 10:42", "Sparar…", "Inte sparat") and, when someone else has the
 * job open, "Anna har jobbet öppet". It sits inside the bar's own height, so it never moves the bar, the page or the buttons.
 */
export type NativeBarStatusConfig = {
  save: string;
  /** `saved`, `saving`, `changed` or `error` (lib/workflow/autosave.ts). */
  state: string;
  /** Something on screen is not saved yet. */
  unsaved?: boolean;
  /** Why saving failed: a tap on "Inte sparat" says it again. */
  error?: { reason: string; onClick: () => void } | null;
  /** "Anna har jobbet öppet"; empty when nobody else has it open. */
  presence?: string;
};
const Context = createContext<((value: NativeTopBarConfig | null) => void) | null>(null);

export function NativeTopBarProvider({ children, render }: { children: ReactNode; render: (override: NativeTopBarConfig | null) => ReactNode }) {
  const [override, setOverride] = useState<NativeTopBarConfig | null>(null);
  return <Context.Provider value={setOverride}>{render(override)}{children}</Context.Provider>;
}

/** A page's own top bar while it is shown (null gives the shell's bar back). Callbacks may change freely. */
export function useNativeTopBar(config: NativeTopBarConfig | null) {
  const register = useContext(Context);
  const ref = useRef<NativeTopBarConfig | null>(config);
  useEffect(() => { ref.current = config; });
  const key = config ? JSON.stringify([config.title, config.cancel ? config.cancel.label ?? "Avbryt" : null,
    config.save ? [config.save.label ?? "Spara", Boolean(config.save.busy), Boolean(config.save.disabled), Boolean(config.save.plain)] : null,
    config.back === null ? false : config.back?.label ?? "",
    config.status ? [config.status.save, config.status.state, Boolean(config.status.unsaved), config.status.error?.reason ?? null, config.status.presence ?? ""] : null]) : null;
  useEffect(() => {
    if (!register || key === null) return;
    // What the bar shows is fixed by the key; its buttons always call the page's newest callbacks.
    const shown = config!;
    register({
      title: shown.title,
      cancel: shown.cancel ? { label: shown.cancel.label, onClick: () => ref.current?.cancel?.onClick() } : null,
      back: shown.back,
      save: shown.save ? { label: shown.save.label, busy: shown.save.busy, disabled: shown.save.disabled, plain: shown.save.plain, onClick: () => ref.current?.save?.onClick() } : null,
      status: shown.status ? { ...shown.status, error: shown.status.error ? { reason: shown.status.error.reason, onClick: () => ref.current?.status?.error?.onClick() } : null } : null,
    });
    return () => register(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key says when the bar changes; the ref carries the callbacks
  }, [register, key]);
}

/** One button of the bar: Avbryt/Stäng to the left, the main action (strong) to the right. */
export type NativeBarButton = { label: string; onClick: () => void; ariaLabel?: string; busy?: boolean; busyLabel?: string; disabled?: boolean; strong?: boolean; plain?: boolean };

/**
 * The bar itself, shared by a page's own screens (NativeTopBar) and a dialog shown as a screen at level 1 (Modal in
 * features/kfid/ui.tsx): a button to the left, the title in the middle and the main action to the right. A disabled
 * action still answers (aria-disabled) so its owner can say why; a busy one shows its busy word. `leftKind` "back" draws the
 * left button as "‹ <label>" (the page above) instead of the framed Avbryt.
 */
export function NativeBar({ heading, left, right, end, testId = "native-top", className, follow = false, leftKind = "cancel" }: {
  heading: ReactNode; left?: NativeBarButton | null; right?: NativeBarButton | null; testId?: string; className?: string;
  /** Something of its own at the right instead of a text button (a screen without an action: the round × Stäng). */
  end?: ReactNode;
  /** Follows the header while scrolling (a page's bar); a dialog's bar stays put. */
  follow?: boolean;
  leftKind?: "cancel" | "back";
}) {
  // Icons instead of words (2026-10-17): back is the chevron, Avbryt/Stäng the cross and Ny the plus. The word stays as the
  // accessible name (visually hidden) and the button is the 44 px tap area. Other actions (Spara, Skapa, Klar) keep their word.
  const iconFor = (item: NativeBarButton, slot: "cancel" | "save" | "back") =>
    slot === "cancel" && /^(avbryt|stäng)$/i.test(item.label) ? X : slot === "save" && /^ny$/i.test(item.label) && !item.busy ? Plus : null;
  const button = (item: NativeBarButton | null | undefined, slot: "cancel" | "save" | "back") => {
    if (!item) return <span />;
    const Icon = iconFor(item, slot);
    return <button type="button" className="native-top-bar-button" data-kind={slot} data-icon={Icon ? "" : undefined} data-strong={item.strong || undefined} data-plain={item.plain || undefined} onClick={item.onClick} aria-label={item.ariaLabel ?? (Icon ? item.label : undefined)}
      aria-disabled={item.disabled || item.busy || undefined} data-testid={`${testId}-${slot}`}>
      {slot === "back" ? <span className="native-top-bar-pill"><ChevronLeft aria-hidden="true" className="size-5 shrink-0" /><span className="sr-only">{item.label}</span></span>
        : Icon ? <span><Icon aria-hidden="true" className="size-5 shrink-0" /><span className="sr-only">{item.label}</span></span>
        : <span>{item.busy ? item.busyLabel ?? "Sparar…" : item.label}</span>}
    </button>;
  };
  return <div className={className ? `native-top-bar ${className}` : "native-top-bar"} data-chrome-follow={follow ? "" : undefined} data-testid={`${testId}-bar`}>
    {button(left, leftKind)}
    {heading}
    {end ?? button(right, "save")}
  </div>;
}

/**
 * The status line under the bar's title (NativeBarStatusConfig). The save state has a fixed width and the presence is a
 * live region that is always there, so a colleague opening the job is told politely and nothing shifts.
 */
export function NativeBarStatus({ status }: { status: NativeBarStatusConfig }) {
  const whole = [status.save, status.presence].filter(Boolean).join(" · ");
  return <div className="native-top-bar-status" title={status.error?.reason || whole} data-testid="native-job-status">
    {status.error
      ? <button type="button" className="native-top-bar-status-save" data-state={status.state} data-unsaved={status.unsaved || undefined} data-error="" onClick={status.error.onClick} data-testid="native-job-save">{status.save}</button>
      : <span className="native-top-bar-status-save" data-state={status.state} data-unsaved={status.unsaved || undefined} data-testid="native-job-save">{status.save}</span>}
    <span role="status" aria-live="polite" className="native-top-bar-status-presence" data-testid="native-job-presence">
      {status.presence ? <><span aria-hidden="true">·</span><Users aria-hidden="true" className="size-3 shrink-0" /><span className="truncate">{status.presence}</span></> : null}
    </span>
  </div>;
}

/**
 * Draws the top bar of level 1: a page's own (`useNativeTopBar`) or, on a page below Hem without one, the standard bar from
 * the breadcrumb trail – "‹ <the page above>", the page's name in the middle. Back goes through the visit history so an open
 * sheet closes first and unsaved work is asked about (closeFirst, confirmLeave); a page opened directly (nothing to go back
 * to inside Workflow) goes to the page above by its address.
 */
export function NativeTopBar({ override }: { override: NativeTopBarConfig | null }) {
  const trail = useBreadcrumbTrail();
  const { canBack, back } = useVisitHistory();
  const router = useRouter();
  const searchParams = useSearchParams();
  const standard = standardBarFor(trail);
  // A tab's root page (Hem, Jobb, Tid) has nothing above it: no back button, and the tab's own word as title (2026-10-13:
  // Tid said Tidrapport while its screens went back to "Tid"). A page that names its own back is never the root.
  const root = isTabRootTrail(trail) && !override?.back;
  const title = override?.title ?? (standard ? (root ? shortPageName(standard.title) : standard.title) : undefined);
  // A screen of a page (`step`, a row's `item`, a form's `part`) has the page itself above it (2026-10-13): a job's step
  // opened from a notice goes back to the job's menu, not to the list the breadcrumb names.
  const parent = screenParent(searchParams) ?? (trail.length >= 2 ? trail[trail.length - 2]!.href : null);
  // Opened from the Mer sheet (2026-10-12): back says "Mer" and brings the sheet back on the page it returns to.
  const fromSheet = canBack ? openedFromSheet() : null;
  const goBack = () => {
    if (canBack) { if (fromSheet) requestSheet(fromSheet); back(); }
    else if (parent) void confirmLeave().then((ok) => { if (ok) router.push(parent); });
  };
  // The edge swipe follows the same way when nothing is there to go back to (only where the bar shows its back).
  useBackFallback(title && !canBack && parent && !override?.cancel && !root && override?.back !== null ? () => void confirmLeave().then((ok) => { if (ok) router.push(parent); }) : null);
  if (!title) return null;
  const showBack = !override?.cancel && !root && override?.back !== null && (canBack || Boolean(parent));
  // The label says what the button does (2026-10-12): the visit before this one when back goes there, otherwise the page above.
  const here = `/?${searchParams.toString()}`;
  const label = resolveBackLabel({ own: override?.back?.label, previous: canBack ? backTargetUrl() : null, here, trailBack: standard?.backLabel, viewLabels: VIEW_LABEL, openedFrom: fromSheet });
  // One line, cut with … when it does not fit (2026-10-17); the heading's name is always the whole title.
  const heading = <div className="native-top-bar-title" role="heading" aria-level={2} aria-label={title} data-testid="native-top-title">{title}</div>;
  return <NativeBar follow
    heading={override?.status ? <div className="native-top-bar-heading">{heading}<NativeBarStatus status={override.status} /></div> : heading}
    left={override?.cancel ? { label: override.cancel.label ?? "Avbryt", onClick: override.cancel.onClick }
      : showBack ? { label, onClick: goBack, ariaLabel: `Tillbaka till ${label}` } : null}
    leftKind={override?.cancel ? "cancel" : "back"}
    right={override?.save ? { label: shortActionLabel(override.save.label ?? "Spara"), ariaLabel: override.save.label ?? "Spara", onClick: override.save.onClick, busy: override.save.busy, disabled: override.save.disabled, strong: true, plain: override.save.plain } : null} />;
}

