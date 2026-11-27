"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PageBackButton, STANDARD_PAGE_WIDTH, StandardPage, useBreadcrumbTrail, useSubPageTrail } from "@/components/page-shell";
import { previousEntryUrl, subscribeHistory, visitIndex } from "@/components/history-nav";
import { useRegisterEditorActions } from "@/components/workspace-actions";
import { useUnsavedGuard } from "@/lib/workflow/use-unsaved-guard";
import { useBrowserBackGuard } from "@/lib/workflow/use-back-guard";
import { cn } from "@/lib/utils";
import { TaskPageFold } from "@/features/workflow/use-detail-level";
import { holdChrome } from "@/lib/workflow/shell-events";
import { listenForTypedChange } from "@/lib/workflow/typed-change";
import { DISCARD_QUESTION, useConfirm } from "./confirm";
import { DiscardContext, Modal, Panel, useFormPresentation, type DialogSize } from "./ui";

/**
 * A form or list opened from another page (2026-10-11, plan 1O + 1Q): the `size` decides, the display decides how
 * (`formPresentation`, lib/workflow/dialog-mode.ts) – `size="form"` (fits "Lägg till instrument", about 520 x 480 px) is a
 * popup on display 3 from 768 px wide and a page on display 2; anything larger (`page`, `view`, default) is a page on
 * displays 2 and 3; display 1 draws a screen; `compact` is always a small dialog. A page takes the place of the page it was opened from inside the
 * shell's content area (the page under it stays mounted, so nothing typed there is lost), with the shared page structure:
 * heading, a breadcrumb trail ending in the form's own name, a panel with the light-blue heading row, and the
 * form's own button row (`DialogActions`) as on Ny kund. The page is drawn with the standard top (StandardPage: title, status and facts, the form's DialogActions moved
 * into the header's action group top right) at the one page width. The address carries `page=<pageKey>`, so Bakåt/Framåt and the
 * browser's back step close it and an unsaved change is asked about like on every other page.
 *
 * Display level 1 on a phone keeps its own screens: there this renders the ordinary `Modal` (top bar with Avbryt and the
 * action) – same children, same rules. A small dialog (`size="compact"`) stays a small dialog everywhere.
 */
export type DialogPageProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Short text under the heading. */
  description?: string;
  /** Names the address (`page=<pageKey>`): short, lower-case and unique on the page it is opened from. */
  pageKey: string;
  children: React.ReactNode;
  /** "form": fits a popup (display 3), a page on display 2; "page"/"view"/default: a page; "compact": a small dialog. */
  size?: DialogSize;
  nativeScreen?: boolean;
  /** Level 1: a screen without an action closes with "‹ <nativeBack>" in the top bar instead of the round ×. */
  nativeBack?: string;
  /** The Modal's class (level 1 and a small dialog); className is the page's. */
  modalClassName?: string;
  className?: string;
  /** The page guards the browser's own back step while something is changed; false when the content does it itself. */
  guardBack?: boolean;
  /** Nothing typed here is a change to lose (a search that adds at once, Lägg till artiklar 2026-10-16): no question on the way out. */
  untracked?: boolean;
  /** The panel's heading row (the title by default); false when the content has panels of its own. */
  panelTitle?: string | false;
  /** Kept for the callsites; every page with the standard top has the same width (plan 1Q). */
  width?: "form" | "wide";
  /** The form can be opened from the address alone (a new, blank form): a direct link opens it. */
  restorable?: boolean;
  /**
   * false: the content draws its own standard top (an editor with EditorHeader, Lika är rätt 2026-11-14: the fakturaunderlag),
   * so the page has the same top as every other editor; its DialogActions then stand where the content puts them.
   */
  header?: false;
};

/**
 * A dialog shown as a page or a screen is a page of its own, not the task page it was opened from: its cards never take the
 * task page's fold at display levels 1–2 (TaskPageFold), so Skapa faktura opened from a work order on a phone shows its
 * fields at once instead of folded rows (2026-11-19).
 */
export function DialogPage(props: DialogPageProps) {
  return <TaskPageFold.Provider value={false}><DialogPageBody {...props} /></TaskPageFold.Provider>;
}

function DialogPageBody(props: DialogPageProps) {
  const presentation = useFormPresentation(props.size ?? "page");
  if (presentation === "popup") {
    return <Modal open={props.open} onOpenChange={props.onOpenChange} title={props.title} size={props.size === "compact" ? "compact" : "form"} nativeScreen={props.nativeScreen} className={props.modalClassName}>{props.children}</Modal>;
  }
  if (presentation === "screen") {
    return <Modal open={props.open} onOpenChange={props.onOpenChange} title={props.title} size={props.size} nativeScreen={props.nativeScreen} nativeBack={props.nativeBack} className={props.modalClassName}>{props.children}</Modal>;
  }
  return <PageHost {...props} />;
}

const SEARCH_KEY = "page";
/** The keys of the pages this one was opened from (page=a,b when b was opened from a). */
const ChainContext = createContext<string[]>([]);
const currentValue = () => new URL(location.href).searchParams.get(SEARCH_KEY);
/** Whether the address still names this page (or a page opened from it). */
const stillOpen = (chain: string[]) => {
  const open = (currentValue() ?? "").split(",");
  return chain.every((key, index) => open[index] === key);
};

function addressWith(value: string | null): string {
  const url = new URL(location.href);
  if (value) url.searchParams.set(SEARCH_KEY, value); else url.searchParams.delete(SEARCH_KEY);
  return `${url.pathname}${url.search}`;
}

/**
 * Takes the history steps the page added back (its own and the one the back guard keeps while something is changed), so
 * the address ends on the page it was opened from.
 */
function unwind(value: string, base: string, alive: { current: boolean }, closing: { current: boolean }, round = 0) {
  if (alive.current || closing.current || round > 3 || currentValue() !== value) return;
  const previous = previousEntryUrl();
  const own = previous !== null && new URLSearchParams(previous.split("?")[1] ?? "").get(SEARCH_KEY) === value;
  if (previous === base || own) {
    window.addEventListener("popstate", () => window.setTimeout(() => unwind(value, base, alive, closing, round + 1), 0), { once: true });
    window.history.back();
  } else window.history.replaceState(window.history.state, "", base);
}

function PageHost(props: DialogPageProps) {
  const { open, onOpenChange, pageKey, restorable } = props;
  const parent = useContext(ChainContext);
  // A direct link to a blank form opens it (once, when the page is first drawn); a link to an edit of something the page
  // no longer holds is cleared.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (open || currentValue() !== [...parent, pageKey].join(",")) return;
    if (restorable) onOpenChange(true);
    else window.history.replaceState(window.history.state, "", addressWith(parent.join(",") || null));
  }, [open, pageKey, parent, restorable, onOpenChange]);
  // The browser's own Framåt onto a form that has been closed: the form cannot come back from the address, so the step is taken
  // back and the address never says that a form is open when it is not (2026-11-01).
  useEffect(() => {
    if (open || restorable) return;
    const value = [...parent, pageKey].join(",");
    // Only a step forward: the steps back of a page that just closed are already being taken, and one more would leave the page it was opened from.
    let index = visitIndex();
    return subscribeHistory((event) => {
      const forward = visitIndex() > index;
      index = visitIndex();
      if (forward && event.kind === "visit" && currentValue() === value) unwind(value, addressWith(parent.join(",") || null), { current: false }, { current: false });
    });
  }, [open, restorable, pageKey, parent]);
  if (!open) return null;
  return <PageBody {...props} />;
}

function PageBody(props: DialogPageProps) {
  const parent = useContext(ChainContext);
  const chain = [...parent, props.pageKey];
  return <ChainContext.Provider value={chain}><PageBodyInner {...props} chain={chain} parent={parent} /></ChainContext.Provider>;
}

function PageBodyInner({ chain, parent, onOpenChange: onOpenChangeProp, title, description, children, className, panelTitle, guardBack = true, untracked = false, header }: DialogPageProps & { chain: string[]; parent: string[] }) {
  const value = chain.join(",");
  const root = useRef<HTMLDivElement | null>(null);
  const rootRef = useCallback((element: HTMLDivElement | null) => { root.current = element; }, []);
  // Only drawn after the page has opened in the browser, so the content area is always there.
  const [main] = useState<HTMLElement | null>(() => (typeof document === "undefined" ? null : document.getElementById("main-content")));
  const [dirty, setDirty] = useState(false);
  const [confirm, confirmElement] = useConfirm();
  const trail = useBreadcrumbTrail();
  const [from] = useState(() => trail.at(-1)?.label);
  // The address of the page under (a plain page, or the page this one was opened from).
  const [base] = useState(() => addressWith(parent.join(",") || null));
  const closing = useRef(false);
  const onOpenChange = useRef(onOpenChangeProp);
  useEffect(() => { onOpenChange.current = onOpenChangeProp; });
  const alive = useRef(false);

  useEffect(() => {
    const element = document.getElementById("main-content");
    if (!element) return;
    const scroll = window.scrollY;
    element.setAttribute("data-page-takeover", String(Number(element.getAttribute("data-page-takeover") ?? 0) + 1));
    holdChrome();
    window.scrollTo(0, 0);
    return () => {
      const left = Number(element.getAttribute("data-page-takeover") ?? 1) - 1;
      if (left > 0) element.setAttribute("data-page-takeover", String(left)); else element.removeAttribute("data-page-takeover");
      holdChrome();
      window.scrollTo(0, scroll);
    };
  }, [main]);

  // A page opened from a page covers it (it stays mounted, with what was typed in it).
  useLayoutEffect(() => {
    if (!main) return;
    const covered = [...main.querySelectorAll<HTMLElement>("[data-page-takeover-root]")].filter((element) => element !== root.current && !element.hasAttribute("data-page-covered"));
    for (const element of covered) element.setAttribute("data-page-covered", "");
    return () => { for (const element of covered) element.removeAttribute("data-page-covered"); };
  }, [main]);

  // The address: a step of its own in the history, so Bakåt closes the page.
  useEffect(() => {
    alive.current = true;
    if (currentValue() !== value) window.history.pushState(null, "", addressWith(value));
    const unsubscribe = subscribeHistory((event) => {
      if (event.kind === "replace") return;
      if (!stillOpen(chain)) { closing.current = true; onOpenChange.current(false); }
    });
    return () => {
      alive.current = false;
      unsubscribe();
      // Closed by the form itself (Spara, Avbryt): take the step it added to the history back. Deferred, so the
      // development server's remount of effects does not count as a close.
      window.setTimeout(() => unwind(value, base, alive, closing), 0);
    };
  }, [value, base]); // eslint-disable-line react-hooks/exhaustive-deps

  // Over a part of a page that names itself (level 0, Egenkontroll's Rollbeskrivningar), one level per page it was opened from.
  useSubPageTrail({ label: title, href: base, level: parent.length + 1 });
  useUnsavedGuard(dirty, confirm);
  // The browser's own back step with something changed asks first (lib/workflow/use-back-guard.ts).
  // The page's own guard belongs to the page itself (its own `page=` value).
  useBrowserBackGuard(dirty && guardBack, {
    page: value,
    ask: () => confirm(DISCARD_QUESTION),
    onLeave: () => onOpenChange.current(false),
    skip: () => closing.current,
  });

  // Something typed or chosen in the page counts as a change (as in a view).
  useEffect(() => {
    const element = root.current;
    if (!element || untracked) return;
    // Deferred, so the page never re-renders between the browser event and React's own handler (the first keystroke was lost).
    return listenForTypedChange(element, () => setDirty(true));
  }, [main, untracked]);

  // The bottom bar's Spara presses the form's own primary button, so its checks hold (as on Ny kund).
  const press = useCallback(() => root.current?.querySelector<HTMLButtonElement>('[data-dialog-role="primary"]')?.click(), []);
  // Spara in the bottom bar follows the form's own primary button (none: nothing to save, e.g. a list or a read-only page).
  const [canSave, setCanSave] = useState(false);
  // A page without a button row of its own (a list, a history) still gets a way back top right (samband, 2026-10-26:
  // only the browser's Bakåt worked there).
  const [ownButtons, setOwnButtons] = useState(true);
  // A form with its own Avbryt is being edited: the floating navigation (2026-10-27) offers that Avbryt, not Tillbaka.
  const [ownCancel, setOwnCancel] = useState(false);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const read = () => {
      setCanSave(Boolean(element.querySelector('[data-dialog-role="primary"]:not(:disabled)')));
      setOwnButtons(Boolean(element.querySelector('[data-dialog-role]:not([data-page-back])')));
      setOwnCancel(Boolean(element.querySelector('[data-dialog-role="cancel"]:not([data-page-back])')));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
    return () => observer.disconnect();
  }, [main]);
  const pressCancel = useCallback(() => root.current?.querySelector<HTMLButtonElement>('[data-dialog-role="cancel"]:not([data-page-back])')?.click(), []);
  useRegisterEditorActions({ save: press, canSave, busy: false, dirty, cancel: ownCancel ? pressCancel : undefined }, { restore: true });

  // Avbryt in the page asks when something is changed, as in the popup (DiscardContext), so a form needs no question of its own.
  const mayDiscard = useCallback(async () => !dirty || confirm(DISCARD_QUESTION), [dirty, confirm]);
  if (!main) return null;
  const panel = panelTitle === false ? children : <Panel title={panelTitle ?? title}>{children}</Panel>;
  if (header === false) return createPortal(
    <div ref={rootRef} data-testid="dialog-page" data-dialog-page={value} data-page-takeover-root="" data-standard-page="" className={cn(STANDARD_PAGE_WIDTH, className)}>
      {confirmElement}
      <DiscardContext.Provider value={mayDiscard}>{children}</DiscardContext.Provider>
    </div>,
    main,
  );
  return createPortal(
    <StandardPage rootRef={rootRef} testId="dialog-page" data-dialog-page={value} data-page-takeover-root="" className={cn(className)}
      title={title} description={description}
      actions={ownButtons ? undefined : <PageBackButton onClick={() => onOpenChange.current(false)} data-dialog-role="cancel" data-page-back="" title={from ? `Tillbaka till ${from}` : undefined} testId="dialog-page-back" />}>
      {confirmElement}
      <DiscardContext.Provider value={mayDiscard}>{panel}</DiscardContext.Provider>
    </StandardPage>,
    main,
  );
}
