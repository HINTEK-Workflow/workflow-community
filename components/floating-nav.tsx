"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, MessageCircle, Save, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { backTargetUrl, subscribeHistory, useVisitHistory } from "@/components/history-nav";
import { useBreadcrumbTrail } from "@/components/page-shell";
import { useWorkspaceActions } from "@/components/workspace-actions";
import { useDetailLevel, useNativeMode } from "@/features/workflow/use-detail-level";
import { confirmLeave } from "@/lib/workflow/leave-guard";
import { ASSISTANT_FULL_SCREEN_QUERY, floatingNavLabel, floatingNavModel, usefulFallback, type FloatingNavButton } from "@/lib/workflow/floating-nav";
import { isTabRootTrail, resolveBackLabel, screenParent, standardBarFor } from "@/lib/workflow/native-nav";
import { VIEW_LABEL } from "@/lib/workflow/navigation";
import { returnOf } from "@/lib/workflow/return-link";
import { setChatOffersHost, useAgentLevels, useChatOfferSignal } from "@/features/ai/chat-offers";

// Tillbaka and Framåt are round arrows without words (2026-11-01); the name is the tooltip and the screen reader's.
const ICONS: Record<FloatingNavButton, LucideIcon> = { back: ArrowLeft, forward: ArrowRight, cancel: X, save: Save };
const ROUND: readonly FloatingNavButton[] = ["back", "forward"];

/**
 * Whether the page's own action group (top right: Avbryt, Spara …) is in sight below the top bar. Measured on scroll, resize
 * and when the page changes, at most once a frame.
 */
function useHeaderActionsInView() {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const group = [...document.querySelectorAll<HTMLElement>(".workspace-main [data-standard-actions]")].find((element) => element.getBoundingClientRect().width > 0);
      if (!group) { setInView(false); return; }
      const box = group.getBoundingClientRect();
      const barBottom = Math.max(0, document.querySelector(".workspace-header")?.getBoundingClientRect().bottom ?? 0);
      setInView(box.bottom > barBottom + 4 && box.top < window.innerHeight);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(measure); };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const main = document.querySelector(".workspace-main");
    const observer = typeof MutationObserver === "undefined" || !main ? null : new MutationObserver(schedule);
    observer?.observe(main!, { childList: true, subtree: true });
    const unsubscribe = subscribeHistory(schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
      unsubscribe();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  return inView;
}

const subscribeWide = (onChange: () => void) => {
  const query = window.matchMedia("(min-width: 1024px)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
/** null until known in the browser: the group is not drawn until then, so that nothing jumps from one side to the other. */
function useWide() {
  const [wide, setWide] = useState<boolean | null>(null);
  useEffect(() => {
    const read = () => setWide(window.matchMedia("(min-width: 1024px)").matches);
    read();
    return subscribeWide(read);
  }, []);
  return wide;
}

/** Whether Workflow AI's window fills the screen here: the group then steps aside, since the window has its own ×. */
function useChatFillsScreen() {
  const [fills, setFills] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(ASSISTANT_FULL_SCREEN_QUERY);
    const read = () => setFills(query.matches);
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, []);
  return fills;
}

/**
 * Flytande navigering (2026-10-27, beslut 5–7; docs/ui-system.md): a separate complement beside the page's own
 * buttons – which keep their place, look and function – so the work can be moved through and finished without the browser's
 * Bakåt/Framåt. Mounted once by the shell; a page states its needs through what it already registers for the bottom bar
 * (`useRegisterEditorActions`: Spara, and now its Avbryt and its "Tillbaka till …"), so nothing has logic of its own:
 * - **Tillbaka** (2026-11-02, replaces N13) – the page's own way back when it has one; while editing the page's own Avbryt; else,
 *   on any page, also a list or tab from the menu, the earlier page in this tab (scroll, search and filters come back); opened
 *   directly, `returnTo` or the page above, which takes the place of the page, so two presses never lead back and forth.
 *   Unsaved changes are asked about (`confirmLeave`).
 * - **Framåt** – when there is a visit forward, after going back. Tillbaka and Framåt are round arrows; nearly transparent only when
 *   there really is nothing to go to. **Avbryt** – the page's own Avbryt, while editing, when the header's is
 *   out of sight. **Spara** – the page's own Spara (the same function), on a computer when the header's is out of sight.
 * - **Workflow AI** (2026-11-02) – `onAssistant` is given to whoever may use it: a round solid button in the primary colour with a
 *   speech bubble, an X in the same place while the chat is open. It is drawn on every page, solid also where the arrows are
 *   nearly transparent, at the group's outer end so that it stays where it is, and a phone on its side draws it alone
 *   (app/globals.css). Where the chat fills the screen the group steps aside. The focus comes back to it when the chat closes.
 * Visning 1 has its own top bar and edge swipe: nothing is drawn there. Visning 2 is compact (symbols), 3 has words. A computer
 * has the group at the bottom right; a tablet at the right above the bottom bar (which has Spara; the right side has Verktyg).
 */
export function FloatingNav({ hidden = false, onAssistant, assistantOpen = false }: { hidden?: boolean; onAssistant?: () => void; assistantOpen?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const native = useNativeMode();
  const level = useDetailLevel();
  const wide = useWide();
  const { canBack, canForward, back, forward } = useVisitHistory();
  const actions = useWorkspaceActions();
  const trail = useBreadcrumbTrail();
  const headerInView = useHeaderActionsInView();
  const chatFillsScreen = useChatFillsScreen();
  // Without a visit to go back to (the page was opened directly): the sub-page's origin, a screen's page, or the page above.
  const returnTo = returnOf(params);
  const root = isTabRootTrail(trail);
  const fallback = usefulFallback(returnTo ?? screenParent(params) ?? (!root && trail.length >= 2 ? trail[trail.length - 2]!.href : null), `/?${params.toString()}`);
  const model = floatingNavModel({
    native, level, wide: Boolean(wide), covered: hidden || (assistantOpen && chatFillsScreen), canBack, canForward, fallback,
    ownBack: Boolean(actions?.back), cancel: Boolean(actions?.cancel), save: Boolean(actions?.canSave && !actions.busy), headerInView,
    assistant: Boolean(onAssistant),
  });
  // The chat closed: back to the button that opened it (it may not have been drawn meanwhile).
  const assistantRef = useRef<HTMLButtonElement>(null);
  const offers = useChatOfferSignal();
  useAgentLevels(Boolean(onAssistant));
  useEffect(() => { if (onAssistant && !native) setChatOffersHost(true); }, [onAssistant, native]);
  const openedAssistant = useRef(false);
  useEffect(() => {
    if (assistantOpen || hidden || !openedAssistant.current) return;
    openedAssistant.current = false;
    assistantRef.current?.focus();
  }, [assistantOpen, hidden]);
  if (wide === null || (!model.buttons.length && !model.idle.length)) return null;
  const backTarget = actions?.back ? null : resolveBackLabel({ previous: canBack ? backTargetUrl() : null, here: `/?${params.toString()}`, trailBack: standardBarFor(trail)?.backLabel, viewLabels: VIEW_LABEL });
  const run: Record<FloatingNavButton, () => void> = {
    back: () => {
      if (actions?.back) actions.back.run();
      else if (actions?.cancel) actions.cancel();
      else if (canBack) back();
      else if (fallback) void confirmLeave().then((ok) => { if (ok) router.replace(fallback); });
    },
    forward,
    cancel: () => actions?.cancel?.(),
    save: () => actions?.save(),
  };
  // Förslag och tips i chatten (2026-11-21): a dot while something waits, and one small movement per new offer (not with
  // reduced motion, never while typing – lib in features/ai/chat-offers.ts).
  const waitingLabel = offers.waiting && !assistantOpen ? "Workflow AI – ett förslag väntar" : null;
  const assistant = model.assistant ? <button ref={assistantRef} type="button" className="floating-nav-button floating-nav-round floating-nav-assistant" onClick={() => { openedAssistant.current = true; onAssistant?.(); }}
    data-offer={offers.waiting && !assistantOpen ? "" : undefined} data-nudge={offers.nudge && !assistantOpen ? "" : undefined}
    aria-label={assistantOpen ? "Stäng Workflow AI" : waitingLabel ?? "Workflow AI"} title={assistantOpen ? "Stäng Workflow AI" : waitingLabel ?? "Workflow AI"} aria-haspopup="dialog" aria-expanded={assistantOpen} data-testid="floating-nav-assistant">
    {assistantOpen ? <X aria-hidden="true" /> : <MessageCircle aria-hidden="true" />}
    {offers.waiting && !assistantOpen ? <span className="chat-offer-dot" aria-hidden="true" data-testid="floating-nav-assistant-dot" /> : null}
    {/* A screen reader hears that something waits, once, without the focus moving. */}
    <span className="sr-only" role="status">{offers.waiting && !assistantOpen ? "Ett förslag väntar i Workflow AI." : ""}</span>
  </button> : null;
  return <div className={cn("floating-nav", model.compact && "floating-nav-compact")} data-placement={model.placement} data-level={level} data-testid="floating-nav" role="group" aria-label="Navigering">
    {/* The arrows keep their places: first Tillbaka, then Framåt, nearly transparent where they have no function here. */}
    {[...ROUND, ...model.buttons.filter((button) => !ROUND.includes(button))].map((button) => {
      const Icon = ICONS[button];
      if (!model.buttons.includes(button)) return <span key={button} aria-hidden="true" className="floating-nav-button floating-nav-round floating-nav-idle" data-kind={button} data-testid={`floating-nav-idle-${button}`}><Icon /></span>;
      const { label, aria } = button === "back" && actions?.back ? { label: "Tillbaka", aria: actions.back.label } : floatingNavLabel(button, backTarget);
      const round = ROUND.includes(button);
      return <button key={button} type="button" className={cn("floating-nav-button", round && "floating-nav-round")} data-kind={button} onClick={run[button]} aria-label={aria} title={aria} data-testid={`floating-nav-${button}`}>
        <Icon aria-hidden="true" />{model.compact || round ? null : <span>{label}</span>}
      </button>;
    })}
    {assistant}
  </div>;
}
