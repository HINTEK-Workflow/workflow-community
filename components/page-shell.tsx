"use client";

import Link from "next/link";
import { RowChevron } from "@/components/row-chevron";
import { createContext, Fragment, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { ChevronRight, Home, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AreaIcon } from "@/components/area-icon";
import type { PanelArea } from "@/lib/workflow/panel-area";
import { breadcrumbTrail, type Crumb, type TrailInput, type TrailLabels } from "@/lib/workflow/navigation";
import { DelayedSkeleton, RowsSkeleton, SkeletonText } from "@/components/skeleton";
import { ListSkeleton } from "@/components/native/list";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { indicatorBadge, type IndicatorTone } from "@/features/workflow/indicator-tone";

/**
 * Sidmallar (2026-10-09, docs/ui-system.md): the page's basic look comes from here, not from loose parts.
 * The shell provides the navigation context and draws the breadcrumbs in one place; a page gives its own name
 * (a project's, a customer's) with `usePageTrail` and draws its heading with `PageHeader`.
 */
type TrailParams = NonNullable<TrailInput["params"]>;
type PageTrail = { key: string; labels: TrailLabels; params: TrailParams };
type PageHeading = { key: string; text: string };
type SubPage = { label: string; href: string };
type NavigationValue = { view: string; params: TrailParams; key: string; page: PageTrail | null; setPage: Dispatch<SetStateAction<PageTrail | null>>; heading: PageHeading | null; setHeading: (heading: PageHeading | null) => void; sub: SubPage | null; setSub: (sub: SubPage | null) => void };
const NavigationContext = createContext<NavigationValue | null>(null);

const navigationKey = (view: string, params: TrailParams) => `${view}?${Object.entries(params).filter(([, value]) => value).map(([name, value]) => `${name}=${value}`).sort().join("&")}`;
type TrailState = [PageTrail | null, Dispatch<SetStateAction<PageTrail | null>>];

/**
 * The page's trail kept by the shell (2026-10-24), so its menu follows the names the open page gave it (menuViewOfPage:
 * Företagets platser marks Inställningar, not Kunder). `labels` are only those given for this very address.
 */
export function useShellPageTrail(view: string, params: TrailParams): { trail: TrailState; labels: TrailLabels | null } {
  const trail = useState<PageTrail | null>(null);
  const page = trail[0];
  return { trail, labels: page?.key === navigationKey(view, params) ? page.labels : null };
}

export function NavigationProvider({ view, params, trail, children }: { view: string; params: TrailParams; trail?: TrailState; children: ReactNode }) {
  const key = navigationKey(view, params);
  const ownTrail = useState<PageTrail | null>(null);
  const [page, setPage] = trail ?? ownTrail;
  const [heading, setHeading] = useState<PageHeading | null>(null);
  const [sub, setSub] = useState<SubPage | null>(null);
  const value = useMemo(() => ({ view, params, key, page, setPage, heading, setHeading, sub, setSub }), [view, params, key, page, setPage, heading, sub]);
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

/** The current page's trail, with the names the page has given (only those given for this very address). */
export function useBreadcrumbTrail(): Crumb[] {
  const context = useContext(NavigationContext);
  if (!context) return [];
  const own = context.page?.key === context.key ? context.page : null;
  const heading = context.heading?.key === context.key ? context.heading.text : undefined;
  const trail = breadcrumbTrail({ view: context.view, params: { ...context.params, ...own?.params }, labels: { ...own?.labels, ...(heading ? { heading } : {}) } });
  // A form opened as a page of its own from this page (features/kfid/dialog-page.tsx): the page it came from becomes a
  // link back to it and the form is the open page.
  const sub = context.sub;
  if (!sub || !trail.length) return trail;
  return [...trail.slice(0, -1), { ...trail[trail.length - 1]!, href: sub.href }, { label: sub.label, href: null }];
}

/** The page a form opened from another page (a sub-page of it, with its own address) adds to the trail while it is open. */
export function useSubPageTrail(sub: { label: string; href: string } | null) {
  const setSub = useContext(NavigationContext)?.setSub;
  const label = sub?.label ?? null;
  const href = sub?.href ?? null;
  useEffect(() => {
    if (!setSub || label === null || href === null) return;
    setSub({ label, href });
    return () => setSub(null);
  }, [setSub, label, href]);
}

/**
 * A page gives its breadcrumbs the names it has read (and parents the address does not carry, such as the project of
 * an opened task). Forgotten when the address changes, so a name never sticks to the next page.
 */
export function usePageTrail(labels: TrailLabels, params: TrailParams = {}) {
  const context = useContext(NavigationContext);
  const setPage = context?.setPage;
  const key = context?.key ?? "";
  const serialized = JSON.stringify([labels, params]);
  // Before the browser paints (2026-10-16): a trail that first shows "Kund" and a frame later the name wrapped onto a second
  // line on a phone and pushed the page down.
  useLayoutEffect(() => {
    if (!setPage) return;
    const [nextLabels, nextParams] = JSON.parse(serialized) as [TrailLabels, TrailParams];
    const mine: PageTrail = { key, labels: nextLabels, params: nextParams };
    setPage(mine);
    // Gone with the page (2026-11-01): the address changes a render before the page is replaced, so the old page gives its
    // names under the new address too, and a customer's name stayed in the trail of the list after Tillbaka.
    return () => setPage((current) => (current === mine ? null : current));
  }, [setPage, key, serialized]);
}

/**
 * The heading a page shows, for the trail of a page that is not saved yet (a new protocol is "Ny kontroll", not "Ny
 * uppgift"; simulation 0.6.3). The editor's header gives it; like usePageTrail it is forgotten when the address changes.
 */
export function usePageHeading(text: string | undefined) {
  const context = useContext(NavigationContext);
  const setHeading = context?.setHeading;
  const key = context?.key ?? "";
  useEffect(() => {
    if (!setHeading) return;
    setHeading(text?.trim() ? { key, text: text.trim() } : null);
  }, [setHeading, key, text]);
}

/**
 * Brödsmulor: the pages above this one, each a link, and the page itself last without a link. Not the history – that
 * is the back button's job. Wraps on a narrow screen instead of scrolling sideways; in the computer's top bar it keeps one
 * line (2026-10-10: it wrapped beside the timer and on protocols even at 1440 px) – the crumbs between the first and the
 * open page are shortened with … first, the open page last, and each keeps its whole name as a tooltip.
 * The order (simulation 0.6.4: at 1280 the middle crumbs were cut to "M…" while the long open page kept its room): the open
 * page is shortened first, down to about 8 rem (11 rem from 1280 px), then the middle crumbs (down to about 6 rem, each stops at
 * a letter and "…"). Those floors never exceed the crumb's own estimated width (N14, 2026-11-01: "Projekt" held 6 rem with air
 * after it while its neighbours were cut), and the empty place of the timer is lent to the trail (app/globals.css).
 * Översikt is only its house icon in the computer's top bar, a fixed width (UX point 5, 2026-10-22: nothing moves
 * when a text changes width – it shrank to "Ö…" one level deeper and moved the crumbs after it); the name stays as the
 * tooltip and for screen readers. The row never draws outside its own box, so it never runs in under the buttons beside it.
 * `reserve` (Fasta platser, 2026-10-30): where the trail opens the page (phone and tablet), a page without one
 * (Översikt) keeps an empty row of the same height, so its heading starts where every other page's does.
 */
export function Breadcrumbs({ trail, className, reserve = false }: { trail: Crumb[]; className?: string; reserve?: boolean }) {
  if (trail.length < 2) return reserve ? <div aria-hidden="true" className={cn("invisible", className)} data-testid="breadcrumbs-reserved">
    <ol className="flex text-sm"><li className="flex items-center"><span className="breadcrumb-link touch-target inline-flex items-center px-1 py-0.5">{"\u00a0"}</span></li></ol>
  </div> : null;
  // A deep trail (a new place under a customer's place) keeps the first, the last three and a "…" for the ones between in the
  // one-line top bar, so the open page is never pushed out of its room (plan 1Q); the whole trail wraps elsewhere.
  const hidden = trail.length > 5 ? trail.slice(1, trail.length - 3) : [];
  return <nav aria-label="Brödsmulor" className={cn("min-w-0 lg:overflow-x-clip", className)} data-testid="breadcrumbs">
    <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-sm lg:flex-nowrap">
      {trail.map((crumb, index) => <Fragment key={`${index}-${crumb.label}`}>
      {hidden.length > 0 && index === 1 ? <li className="hidden shrink-0 items-center gap-1 lg:flex" data-testid="breadcrumb-more"><ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/70" /><span className="px-1 text-muted-foreground" title={hidden.map((item) => item.label).join(" › ")}>…</span></li> : null}
      <li style={{ "--crumb-width": `${crumb.label.length * 0.5 + 2}rem` } as CSSProperties} className={cn("flex min-w-0 items-center gap-1", index === 0 ? "lg:shrink-0" : index === trail.length - 1 ? "lg:min-w-[min(8rem,var(--crumb-width))] lg:shrink-[10000] xl:min-w-[min(11rem,var(--crumb-width))]" : "lg:min-w-[min(6rem,var(--crumb-width))] lg:shrink-[100]", hidden.length && index > 0 && index <= hidden.length && "lg:hidden")}>
        {index > 0 ? <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/70" /> : null}
        {crumb.href
          ? <Link href={crumb.href} className="breadcrumb-link touch-target inline-flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-primary" data-testid="breadcrumb-link" title={crumb.label}>
            {index === 0 ? <Home aria-hidden="true" className="size-3.5 shrink-0" /> : null}<span className={index === 0 ? "truncate lg:sr-only" : "truncate"}>{crumb.label}</span>
          </Link>
          : <span aria-current="page" className="min-w-0 truncate px-1 font-medium text-foreground" data-testid="breadcrumb-current" title={crumb.label}>{crumb.label}</span>}
      </li></Fragment>)}
    </ol>
  </nav>;
}

/** The trail of the open page, drawn by the shell (top bar on a computer, top of the page on phone and tablet). */
export function ShellBreadcrumbs({ className, reserve }: { className?: string; reserve?: boolean }) {
  return <Breadcrumbs trail={useBreadcrumbTrail()} className={className} reserve={reserve} />;
}

/**
 * Sidhuvud – one heading for every page: the title (24 px), a short description and the page's actions to the right
 * (they wrap under the title on a narrow screen). Breadcrumbs are drawn by the shell.
 * Fasta platser (2026-10-30): no small eyebrow over the title – the breadcrumbs already say where you are, and the
 * eyebrow pushed the title, buttons and list down on some pages only. The title starts at the same height on every page.
 *
 * Standardöverdelen (2026-10-11, plan 1Q): title on the left, status badges and the row of facts under
 * them (`children`), and every action button at the top right in the same order – the destructive one (red) furthest
 * left, then the secondary ones (PDF, Skicka, Starta tid …), then Avbryt, and the primary action (Spara/Skapa) furthest
 * right. `actionsSlotRef` gives a form's own button row (DialogActions) a place in that group.
 * Counters in the buttons use even-width digits (stabil sidladdning steg 3), so "3 av 12" becoming "4 av 12" moves nothing.
 */
export function PageHeader({ title, description, icon: Icon, actions, actionsSlotRef, children, className, titleId, nativeActions }: {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  /**
   * The page's main actions (2026-11-15, docs/ui-system.md 2): what creates or starts something new on the page, always
   * here – on an empty page, while an item is open on the page and on every tab. Only permission hides one; the open item's own
   * actions (Spara, Publicera, Ta bort) stand with the item. On a page that is the item (an editor, a form page) they are the item's.
   */
  actions?: ReactNode;
  /** Where a form's Avbryt and main action are drawn (see StandardPage); they follow `actions`. */
  actionsSlotRef?: (element: HTMLElement | null) => void;
  /** Extra content under the description (status badges and the row of facts). */
  children?: ReactNode;
  className?: string;
  titleId?: string;
  /** Level 1 on a phone shows only the buttons, as a grouped list of rows (a page of screens such as a project); the title is the top bar's. */
  nativeActions?: boolean;
}) {
  // Fasta platser (2026-10-30): the title column gives way down to 12 rem (as EditorHeader's) before the buttons leave
  // the top right – at 768 px Offerter's and Projekt's three buttons dropped under the title while Inköp's stayed beside it,
  // so their buttons, filters and lists started 41 px lower than on the other lists.
  return <><div className={cn("page-header mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3", className)} data-testid="page-header" data-standard-header="" data-native-actions-header={nativeActions ? "" : undefined}>
    <div className="page-header-title min-w-0 flex-1 basis-48">
      <h1 id={titleId} className="page-title flex flex-wrap items-center gap-2">{Icon ? <Icon aria-hidden="true" className="size-6 shrink-0 text-primary" /> : null}{title}</h1>
      {description ? <p className="page-description mt-1">{description}</p> : null}
      {children}
    </div>
    {actions || actionsSlotRef ? <div className="page-actions flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2 tabular-nums sm:ml-auto max-sm:justify-start" data-testid="page-actions" data-standard-actions="" data-native-actions={nativeActions ? "" : undefined}>{actions}{actionsSlotRef ? <div ref={actionsSlotRef} className="contents" data-testid="page-actions-slot" /> : null}</div> : null}
  </div><SectionTabsSlot /></>;
}

/**
 * Flikraden under rubriken (Fasta platser, 2026-10-30): a page with a tab row (Inställningar, Installation,
 * Planering) has its heading where every other page has it, and the tabs right under the heading – as Översikt's and
 * Egenkontroll's. The shell gives the row (`tabs`) to this placement; every PageHeader (and the page skeleton's heading)
 * offers a place right after itself, and the row is drawn after the first one on the page. A page without a heading keeps
 * the row at the top, as before. What a page has only for the moment (Översikt's setup banner, update line and the demo's start
 * card) goes the same way, so that nothing ever stands over the heading.
 */
const SectionTabsSlotContext = createContext<((element: HTMLElement) => () => void) | null>(null);

export function SectionTabsPlacement({ tabs, children }: { tabs: ReactNode; children: ReactNode }) {
  const [slots, setSlots] = useState<HTMLElement[]>([]);
  const add = useCallback((element: HTMLElement) => {
    setSlots((current) => [...current, element]);
    return () => setSlots((current) => current.filter((item) => item !== element));
  }, []);
  // The first heading in reading order (a page's own heading comes before a section's further down).
  const target = slots.length ? [...slots].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))[0] : null;
  // The same tree with or without tabs: switching between a page with a tab row and one without must never remount the
  // page (Local's opened workspace lived in it and was lost, 0.33.0 full test).
  return <SectionTabsSlotContext.Provider value={tabs ? add : null}>
    {tabs && !target ? tabs : null}
    {children}
    {tabs && target ? createPortal(tabs, target) : null}
  </SectionTabsSlotContext.Provider>;
}

/** The place after a heading where SectionTabsPlacement may draw the tab row; nothing outside a placement with tabs. */
function SectionTabsSlot() {
  const add = useContext(SectionTabsSlotContext);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => (add && ref.current ? add(ref.current) : undefined), [add]);
  return add ? <div ref={ref} className="contents" data-section-tabs-slot="" /> : null;
}

/**
 * Sidskelett (stabil sidladdning steg 5, 2026-10-22/23): a page on its way – the heading's line at the title's
 * height and a card with grey rows of the real rows' height (`RowsSkeleton`); in the app look (level 1 on a phone)
 * the list's own grey rows (`ListSkeleton`). Used for "Hämtar din arbetsyta" and a view's first read, instead of a line of
 * text that a page several screens high replaces. Seen only after ~150 ms (a quick answer never blinks), no spinner and
 * nothing new that moves: the same calm grey as every skeleton, still under "reduce motion". The words are for screen readers.
 */
export function PageSkeleton({ label = "Hämtar…", rows = 5, panels = 1, title = true, testId = "page-skeleton" }: { label?: string; rows?: number; panels?: number; title?: boolean; testId?: string }) {
  const native = useNativeMode();
  if (native) return <DelayedSkeleton testId={testId}><ListSkeleton rows={rows} label={label} /></DelayedSkeleton>;
  return <DelayedSkeleton className={STANDARD_PAGE_WIDTH} testId={testId}>
    {/* The title column's height is the real header's (page-header-title), so nothing moves when the page arrives. */}
    {title ? <div className="page-header mb-5" aria-hidden="true"><div className="page-header-title"><div className="page-title"><SkeletonText className="w-56 max-w-[60%]" /></div></div></div> : null}
    {title ? <SectionTabsSlot /> : null}
    <div className="space-y-4">{Array.from({ length: Math.max(1, panels) }, (_, index) => <div key={index} className="app-panel rounded-lg border bg-card">
      <div className="px-4 pb-3 pt-3.5" aria-hidden="true"><span className="section-title block"><SkeletonText className="w-40" /></span></div>
      <div className="px-4 pb-4"><RowsSkeleton rows={rows} label={index === 0 ? label : undefined} /></div>
    </div>)}</div>
  </DelayedSkeleton>;
}

/** One width for every page (plan 1Q): the shell's own content width, so forms, editors, protocols, quotes, lists and the footer all line up (2026-10-11, the footer stuck out beside the card). */
export const STANDARD_PAGE_WIDTH = "mx-auto w-full";

const PageActionsContext = createContext<{ slot: HTMLElement | null } | null>(null);
/** The header slot of the page a form is drawn on (null in a popup or screen): DialogActions moves its buttons there. */
export const usePageActionsSlot = () => useContext(PageActionsContext);
/**
 * A form's buttons in some other header row than the page's (2026-10-13: Redigera kund in Kontaktuppgifter's panel row):
 * DialogActions inside moves Avbryt and Spara into `slot`, as it does into a StandardPage's header.
 */
export function PageActionsSlotProvider({ slot, children }: { slot: HTMLElement | null; children: ReactNode }) {
  const value = useMemo(() => ({ slot }), [slot]);
  return <PageActionsContext.Provider value={value}>{children}</PageActionsContext.Provider>;
}
/** A dialog opened from a page (drawn in a portal, but inside the page's React tree) must not move its buttons into the page's header. */
export function PageActionsReset({ children }: { children: ReactNode }) {
  return <PageActionsContext.Provider value={null}>{children}</PageActionsContext.Provider>;
}

/**
 * The page template for a form (FormPage and DialogPage) – the standard top and one width. The form's own button row
 * (`DialogActions`) is moved into the header's action group, so Avbryt and Spara/Skapa stand top right on every page.
 */
export function StandardPage({ title, description, actions, meta, children, className, testId, rootRef, ...rest }: {
  title: ReactNode;
  description?: ReactNode;
  /** Other action buttons (they stand left of Avbryt and the main action). */
  actions?: ReactNode;
  /** Status badges and facts under the title. */
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
  rootRef?: (element: HTMLDivElement | null) => void;
} & Record<`data-${string}`, string | undefined>) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ slot }), [slot]);
  return <div ref={rootRef} className={cn(STANDARD_PAGE_WIDTH, className)} data-testid={testId} data-standard-page="" {...rest}>
    <PageHeader title={title} description={description} actions={actions} actionsSlotRef={setSlot}>{meta}</PageHeader>
    <PageActionsContext.Provider value={value}>{children}</PageActionsContext.Provider>
  </div>;
}

/**
 * The bar above a list (Listsidor, 2026-09-26/2026-10-09): search, filters and sorting in one framed bar, rows
 * that wrap; filtering is never mixed with actions on the information (those stay in the page header). Counts in its
 * chips and choices ("Öppna (12)") use even-width digits, so nothing beside them moves when a count changes (steg 3).
 */
export function ListToolbar({ children, className, label = "Sök och filter" }: { children: ReactNode; className?: string; label?: string }) {
  return <div role="search" aria-label={label} className={cn("list-toolbar space-y-2 tabular-nums", className)} data-testid="list-toolbar">{children}</div>;
}

/**
 * A hub page's cards (Register och verktyg): each card is one sub-page, the whole card is the link. The hub is an overview,
 * so its icons are the icon standard's soft squares in the hub's function colour (2026-10-24, ikonstandarden).
 * `status` (variant, Kopplingar 2026-10-31): a card that is a connection says how it stands in one line under its text – a
 * round pill (Påslagen, Av, Behöver åtgärd) and what it is about, cut to one line. A card without it looks as before.
 */
export type HubCardStatus = { label: string; tone: IndicatorTone; detail?: string };
export function HubCards({ items, area }: { items: { href: string; title: string; description: string; icon: LucideIcon; testId?: string; status?: HubCardStatus | null }[]; /** The hub's function (lib/workflow/panel-area.ts). */ area: PanelArea }) {
  // Columns by the room the cards have, not the screen (2026-10-29), and a card alone takes the whole row (resa 2026-11-06: Kopplingar's
  // single Fakturaunderlag card stood narrow beside the list at 1366 px).
  return <div className="@container"><ul className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3 @7xl:grid-cols-4" data-testid="hub-cards">
    {items.map((item) => <li key={item.href} className="only:col-span-full">
      <Link href={item.href} className="tap-card flex h-full items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-[var(--workflow-card-border-hover)] hover:bg-[var(--surface-hover)]" data-testid={item.testId ?? "hub-card"}>
        <AreaIcon area={area} icon={item.icon} className="shrink-0" />
        <span className="min-w-0 flex-1"><span className="block font-[family-name:var(--heading-font)] text-[0.9375rem] font-semibold">{item.title}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{item.description}</span>
          {item.status !== undefined ? <span className="mt-2 flex min-w-0 items-center gap-2 text-xs" data-testid="hub-card-status">
            <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px] font-medium", indicatorBadge(item.status?.tone ?? "neutral"))}>{item.status?.label ?? "Hämtar…"}</span>
            {item.status?.detail ? <span className="min-w-0 truncate text-muted-foreground" title={item.status.detail}>{item.status.detail}</span> : null}
          </span> : null}
        </span>
        <RowChevron className="mt-2" />
      </Link>
    </li>)}
  </ul></div>;
}

/**
 * Lista till vänster, innehåll till höger (Kopplingar, 2026-11-02; docs/design-standard.md): the same two columns as the customer
 * page's places (`.place-explorer`, a container query, the list sticky beside the content). One changes area without going back
 * through an overview, and nothing above moves. Narrower than the two columns (a phone, a narrow window): the list first and the
 * area on its own once one is chosen (`chosen`: the address names it), with the ordinary way back. Pure CSS, so nothing jumps.
 */
export function SplitPane({ list, children, chosen, testId }: { list: ReactNode; children: ReactNode; chosen: boolean; testId?: string }) {
  return <div className="place-explorer-wrap">
    <div className="place-explorer split-pane" data-chosen={chosen ? "" : undefined} data-testid={testId}>
      <div className="place-explorer-tree split-pane-list">{list}</div>
      <div className="split-pane-content min-w-0">{children}</div>
    </div>
  </div>;
}

/**
 * The list of a SplitPane: one row per area, the whole row the link (with the row arrow), its soft icon and its status as in
 * `HubCards` (a round pill and one line). The open area has a quiet tint, never a stripe (2026-11-02).
 */
export function SplitPaneNav({ label, area, items }: { label: string; area: PanelArea; items: { href: string; title: string; icon: LucideIcon; testId?: string; current: boolean; status?: HubCardStatus | null }[] }) {
  return <nav aria-label={label} className="rounded-lg border bg-card" data-testid="split-pane-nav">
    <ul className="divide-y">
      {items.map((item) => <li key={item.href}>
        <Link href={item.href} aria-current={item.current ? "page" : undefined}
          className={cn("touch-target flex items-center gap-3 px-3 py-2.5 transition-colors first:rounded-t-lg hover:bg-[var(--surface-hover)]", item.current && "bg-secondary")} data-testid={item.testId}>
          <AreaIcon area={area} icon={item.icon} className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate text-sm", item.current ? "font-semibold" : "font-medium")}>{item.title}</span>
            {item.status !== undefined ? <span className="mt-1 flex min-w-0 items-center gap-2 text-xs" data-testid="split-pane-status">
              <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px] font-medium", indicatorBadge(item.status?.tone ?? "neutral"))}>{item.status?.label ?? "Hämtar…"}</span>
              {item.status?.detail ? <span className="min-w-0 truncate text-muted-foreground" title={item.status.detail}>{item.status.detail}</span> : null}
            </span> : null}
          </span>
          <RowChevron />
        </Link>
      </li>)}
    </ul>
  </nav>;
}

/**
 * Tillbaka in a page's head (one template for page tops, 2026-11-02): an outline button with the same symbol everywhere (the
 * one of "Tillbaka till …", use-return-to.tsx), in the action group before the page's Spara. A link with `href`, a button with `onClick`.
 */
export function PageBackButton({ href, onClick, label = "Tillbaka", title, testId, ...rest }: { href?: string; onClick?: () => void; label?: string; title?: string; testId?: string } & Record<`data-${string}`, string | undefined>) {
  const content = <><Undo2 aria-hidden="true" />{label}</>;
  if (href) return <Button asChild variant="outline"><Link href={href} title={title} data-testid={testId} {...rest}>{content}</Link></Button>;
  return <Button type="button" variant="outline" onClick={onClick} title={title} data-testid={testId} {...rest}>{content}</Button>;
}
