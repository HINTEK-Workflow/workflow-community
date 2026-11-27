"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { Boxes, Factory, Film, Globe, Link2, Presentation, Megaphone, Monitor, Table2, Warehouse } from "lucide-react";
import { BOARDS_TAB_LABEL, type BoardsTab } from "@/lib/boards/tabs";
import { Cpu, Building2, UserCog, Calculator, CalendarClock, ChevronDown, ClipboardCheck, ClipboardList, Clock, FileSpreadsheet, FileText, Gauge, GanttChart, Cloud, CreditCard, HelpCircle, KeyRound, PanelsTopLeft, ShieldCheck, Plug, Scale, Settings2, SlidersHorizontal, Sparkles, Tags, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSectionTabIntro } from "@/components/page-shell";
import { TAB_PILLS_CLASS, TAB_ROW_CLASS, tabIconClass, tabPillClass } from "@/features/workflow/in-page-tabs";
import { TIME_TAB_LABEL, type TimeTab } from "@/lib/workflow/time-tabs";
import { BadgeCheck, BookOpenCheck, CalendarCheck, GraduationCap, History, Network, ShieldAlert, UserRoundPlus } from "lucide-react";
import { selfInspectionTabsFor, type SelfInspectionTab } from "@/lib/self-inspection/tabs";
import { activeTab, landingPart, productTabDefs, sectionHref, settingsPartAnchor, settingsTabDefs, type ProductTabOptions, type SettingsTabDef, type SettingsTabOptions } from "@/lib/workflow/settings-tabs";

export { COMPANY_VIEWS, PRODUCT_VIEWS, SETTINGS_VIEWS } from "@/lib/workflow/settings-tabs";

/** `testId`: a tab that tests click by name (Kundregister's Alla objekt). */
type Tab = SettingsTabDef & { icon: LucideIcon; testId?: string };

/**
 * Menystädning (2026-10-01: "vissa menyval kan ligga under en befintlig knapp"): the company's settings are tabs
 * under Inställningar, and the product owner's pages tabs under Installation, instead of one menu button each.
 * Since 2026-10-15 every tab is one page (lib/workflow/settings-tabs.ts): what was a page of its own is a part of the
 * tab's page (`SettingsPart`, `SettingsGroup`), and an older address rolls the page to its part.
 */
const TAB_ICON: Record<string, LucideIcon> = {
  settings: Settings2, company: Building2, administration: UserCog, quote_settings: Calculator, company_features: SlidersHorizontal,
  company_values: Scale, ai_settings: Sparkles, credits: CreditCard, advanced: Plug, help: HelpCircle,
  product_overview: Gauge, customer_companies: Building2, pricing_admin: Tags, ai_admin: Tags, landing_editor: PanelsTopLeft, mailings: PanelsTopLeft,
  login_settings: ShieldCheck, server_keys: KeyRound, pdf_templates: FileText, plc_devices: Cpu,
};
const withIcons = (tabs: SettingsTabDef[], local = false): Tab[] =>
  tabs.map((item) => ({ ...item, icon: item.key === "credits" && local ? Cloud : TAB_ICON[item.key] ?? Settings2 }));

// Everything that is settings is one menu button, Inställningar, with tabs (2026-10-02: "allt är under
// inställningar"): the person's own settings, the company's pages and Hjälp. Installation holds only what is
// beyond those, and only for the superadmin.
export function settingsTabs(options: SettingsTabOptions): Tab[] {
  return withIcons(settingsTabDefs(options), !options.cloud);
}
export function productTabs(options: ProductTabOptions): Tab[] {
  return withIcons(productTabDefs(options));
}

const page = (key: string, label: string, icon: LucideIcon): Tab => ({ key, label, intro: "", sections: [{ view: key, label }], icon });
/** Planering's views (2026-11-01): Kalender, Tidplan and Kapacitet, each its own address. */
export const PLANNING_VIEWS = ["planning", "project_planning", "capacity"] as const;
/**
 * Planering (2026-11-01, a menu button of its own): one page with the views Kalender (the team's bookings), Tidplan
 * (the projects' time plans) and Kapacitet (booked hours per person and week), as the same tab row as Inställningar's; each
 * view keeps its address, so links and Bakåt work. A row needs two views (Local has only Kalender).
 */
export function planningTabs(options: { calendar: boolean; timeline: boolean; capacity: boolean }): Tab[] {
  return [
    ...(options.calendar ? [page("planning", "Kalender", CalendarClock)] : []),
    ...(options.timeline ? [page("project_planning", "Tidplan", GanttChart)] : []),
    ...(options.capacity ? [page("capacity", "Kapacitet", Gauge)] : []),
  ];
}

/** The two lists of the page Arbetsordrar (2026-11-01), each its own address. */
export const WORK_ORDER_VIEWS = ["work_orders", "tasks"] as const;
/**
 * Uppgifter is a tab of Arbetsordrar (2026-11-01, decision 2): protocols and controls. The rights do not change: a tab
 * is offered by the same rule as its list, so whoever has only one of them gets no row (and no empty tab) – and the menu
 * button leads to the one they have.
 */
export function workOrderTabs(options: { workOrders: boolean; tasks: boolean }): Tab[] {
  return [
    ...(options.workOrders ? [page("work_orders", "Arbetsordrar", ClipboardList)] : []),
    ...(options.tasks ? [page("tasks", "Uppgifter", ClipboardCheck)] : []),
  ];
}

/**
 * Tid (2026-11-01, beslut 13): Min tid · Teamet · Lön och export, the same tab row as Inställningar's. The tabs share the
 * view (view=time) and each has its own address through `hrefOf` (lib/workflow/time-tabs.ts); with Min tid alone there is no row.
 */
const TIME_TAB_ICON: Record<TimeTab, LucideIcon> = { mine: Clock, team: Users, payroll: FileSpreadsheet };
export function timeTabs(tabs: readonly TimeTab[]): Tab[] {
  return tabs.map((key) => ({ key, label: TIME_TAB_LABEL[key], intro: "", sections: [{ view: key, label: TIME_TAB_LABEL[key] }], icon: TIME_TAB_ICON[key] }));
}

/** Underhåll (2026-11-02): Anläggning · Förråd, the same tab row as Planering's; the views share view=maintenance (`hrefOf`). */
export function maintenanceTabs(): Tab[] {
  return [page("machines", "Anläggning", Factory), page("store", "Förråd", Warehouse)];
}

/** Tavlor (2026-11-18): Tavlor · Tabeller · Skärmar · Länkar, the views share view=boards (`hrefOf`: lib/boards/tabs.ts). */
const BOARDS_TAB_ICON: Record<BoardsTab, LucideIcon> = { boards: Presentation, tables: Table2, screens: Monitor, links: Link2 };
export function boardsTabs(tabs: readonly BoardsTab[]): Tab[] {
  return tabs.map((key) => page(key, BOARDS_TAB_LABEL[key], BOARDS_TAB_ICON[key]));
}

/**
 * Webb och inlägg (2026-11-20): Inlägg · Min webbsida under Mer, the same tab row as Tavlor's; each tab keeps the address it
 * had as a tab of Inställningar (?view=company_posts, ?view=company_website), so older links work.
 */
// Filmer (2026-11-20): the company's films for YouTube, the third tab (?view=company_videos).
export const WEB_POSTS_VIEWS = ["company_posts", "company_website", "company_videos"] as const;
export function webPostsTabs(): Tab[] {
  return [page("company_posts", "Inlägg", Megaphone), page("company_website", "Min webbsida", Globe), page("company_videos", "Filmer", Film)];
}

/**
 * Kundregister (decision B5; Lika är rätt, 2026-11-13): Kunder · Alla objekt when the company uses the maintenance
 * module – the same tab row as every other page's, drawn by the shell under the heading. Before, the register drew its own
 * segmented tabs inside Kunder's header and after Alla objekt's, so a notice stood under them on one page and over them on
 * the other. Both share view=customers (`hrefOf`: `customerRegisterHref`); the phone's level 1 keeps its segmented control.
 */
/** Egenkontroll's parts (2026-11-24): the same row, each part its own address (lib/self-inspection/tabs.ts). */
const SELF_INSPECTION_ICON: Record<SelfInspectionTab, LucideIcon> = { program: BookOpenCheck, roles: BadgeCheck, organisation: Network, cards: GraduationCap, external: UserRoundPlus, review: CalendarCheck, versions: History, levels: ShieldAlert };
export function selfInspectionTabs(admin: boolean): Tab[] {
  return selfInspectionTabsFor(admin).map((tab) => ({ ...page(tab.key, tab.label, SELF_INSPECTION_ICON[tab.key]), testId: `self-inspection-tab-${tab.key}` }));
}

export const customerRegisterHref =(key: string) => key === "objects" ? "/?view=customers&show=objects" : "/?view=customers";
export function customerRegisterTabs(): Tab[] {
  return [page("customers", "Kunder", Users), { ...page("objects", "Alla objekt", Boxes), testId: "customer-register-objects" }];
}

/**
 * A part of a tab's page that used to be a page of its own and is one card (Visa som, Administrationshistorik): only an
 * anchor, so an older address or ?section=<id> lands on it. The card's own title names it.
 */
export function SettingsPart({ id, children }: { id: string; children: React.ReactNode }) {
  return <div id={settingsPartAnchor(id)} className="scroll-mt-24" data-settings-part={id}>{children}</div>;
}

/**
 * A part of a tab's page made of several cards (Workflow AI under Arbetssätt, Utskick under E-post och utskick): a heading
 * of its own (h2, like the groups of Mina inställningar) with one sentence, and the anchor of `SettingsPart`.
 */
export function SettingsGroup({ id, title, description, children }: { id: string; title: string; description?: React.ReactNode; children: React.ReactNode }) {
  const anchor = settingsPartAnchor(id);
  return <section id={anchor} aria-labelledby={`${anchor}-title`} className="scroll-mt-24 space-y-4 pt-2" data-settings-part={id} data-testid="settings-part-group">
    <div>
      <h2 id={`${anchor}-title`} className="section-title">{title}</h2>
      {description ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
    </div>
    <div className="space-y-6">{children}</div>
  </section>;
}

/**
 * Avancerat (UX-granskningen C1/C2, 2026-10-21/22): the rarely used parts of a settings page, folded at its foot with one
 * line naming what is inside. `open` opens it when the address names a part inside (?step=…, ?section=…); `openKey`
 * changes with that address, so a new address opens it again. `title` names another fold of the same kind (Anpassa rättigheter).
 * `remember` (Tavlornas förklaring, 2026-11-20): a key under which this device keeps whether the fold was left open or closed.
 * Such a fold is open until the person closes it; it is drawn closed and opened after mounting, so the first draw is the same
 * everywhere. Storage is optional: without it the fold simply opens.
 */
type FoldProps = { title?: string; summary: string; open?: boolean; testId?: string; remember?: string; children: React.ReactNode };
const foldStorageKey = (remember: string) => `workflow:fold:${remember}`;

export function AdvancedFold({ openKey, ...props }: FoldProps & { openKey?: string }) {
  // A new address (openKey) starts the fold anew; otherwise the person opens and closes it.
  return <Fold key={openKey ?? ""} {...props} />;
}

function Fold({ title = "Avancerat", summary, open, testId = "settings-advanced", remember, children }: FoldProps) {
  // `open` decides only how the fold starts: a later change (a preset chosen under Anpassa rättigheter) never folds it
  // shut in front of the person (2026-10-22).
  const [startOpen] = useState(Boolean(open));
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!remember || !ref.current) return;
    let closed = false;
    try { closed = window.localStorage.getItem(foldStorageKey(remember)) === "closed"; } catch { /* storage is optional */ }
    if (!closed) ref.current.open = true;
  }, [remember]);
  const toggled = remember ? (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    const state = event.currentTarget.open ? "open" : "closed";
    try { window.localStorage.setItem(foldStorageKey(remember), state); } catch { /* storage is optional */ }
  } : undefined;
  return <details ref={ref} open={startOpen || undefined} onToggle={toggled} className="group space-y-4 rounded-xl border bg-card" data-testid={testId}>
    {/* The whole row is the summary (hela kortet klickbart, 2026-10-24): 48 px high, a ring round it from the keyboard. */}
    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      <span><span className="block">{title}</span><span className="block text-xs font-normal text-muted-foreground">{summary}</span></span>
      <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform -rotate-90 group-open:rotate-0" />
    </summary>
    <div className="space-y-6 px-4 pb-4">{children}</div>
  </details>;
}

/**
 * Rolls the page to the part an address lands on (lib/workflow/settings-tabs.ts, landingPart). The cards above it fetch
 * their content after the page is drawn, so the page is aligned again while it grows, for a few seconds, and never after
 * the person has touched, scrolled or typed. Display only.
 */
export function useRollToPart(part: string | null, view: string) {
  useEffect(() => {
    if (!part || typeof window === "undefined") return;
    const anchor = settingsPartAnchor(part);
    let active = true;
    const align = () => { if (active) document.getElementById(anchor)?.scrollIntoView({ block: "start" }); };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(align);
    observer?.observe(document.body);
    const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    const stop = () => {
      active = false;
      observer?.disconnect();
      window.clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, stop);
    };
    for (const event of events) window.addEventListener(event, stop, { passive: true });
    const timer = window.setTimeout(stop, 4000);
    align();
    return stop;
  }, [part, view]);
}

/**
 * The height of the tab row while the page is read (Användare, 2026-11-02): the list stands from the start, the tabs are not
 * offered before the company has confirmed the person as an admin, and nothing may move when they come (2026-10-30).
 */
export function SectionTabsReserve() {
  return <div className={TAB_ROW_CLASS} aria-hidden="true" data-testid="section-tabs-reserve"><div className="h-[var(--control-h)] sm:h-9" /></div>;
}

/**
 * `keep`: address values that follow along to the other tab (Planering: the chosen project, 2026-10-30).
 * `hrefOf`: a tab's address when the tabs share one view (Tid); by default its own view.
 */
export function SectionTabs({ label, tabs, current, keep = [], hrefOf }: { label: string; tabs: Tab[]; current: string; keep?: readonly string[]; hrefOf?: (key: string) => string }) {
  const router = useRouter();
  const params = useSearchParams();
  const section = params.get("section");
  const kept = keep.flatMap((key) => { const value = params.get(key); return value ? [`&${key}=${encodeURIComponent(value)}`] : []; }).join("");
  const tabHref = (key: string) => hrefOf ? hrefOf(key) : `/?view=${key}${kept}`;
  const active = activeTab(tabs, current);
  const open = active?.tab.key ?? current;
  useRollToPart(landingPart(tabs, current, section), current);
  // One sentence per tab (2026-10-09 natt): what the tab is for – the page heading's description, over the tab row
  // (components/page-shell.tsx, 2026-11-19). Värden och referenser is a page of its own under Arbetssätt, with its own
  // description: Arbetssätt's sentence is not about it (UT4). Användare's heading already says the same, with the company's name.
  useSectionTabIntro(tabs.length >= 2 && active?.tab.intro && current !== "company_values" && current !== "administration" ? active.tab.intro : null);
  if (tabs.length < 2) return null;
  // One row (D9, UX punkt 8, replaces "knappar på två rader" 2026-10-10: the pills broke onto two rows with uneven gaps at
  // 1440 px): a tab that does not fit is shortened with … (its whole name as the tooltip), the open one never; if even that
  // is not enough the row scrolls sideways without a visible scrollbar. A long row (Installation's eight tabs) leaves out the
  // icons of the tabs not open below 1920 px, so the names fit whole at 1440 px (kundresa 2026-11-07, M45: "Kundföre…", "Pri…").
  const long = tabs.length > 6;
  const chip = (tab: Tab) => <Link key={tab.key} href={tabHref(tab.key)} aria-current={tab.key === open ? "page" : undefined} title={tab.label} data-testid={tab.testId}
    className={cn(tabPillClass(tab.key === open), long && "px-2.5")}>
    <tab.icon className={cn(tabIconClass(tab.key === open), long && tab.key !== open && "min-[1920px]:block hidden")} aria-hidden="true" /><span className="min-w-0 truncate">{tab.label}</span>
  </Link>;
  // A tab with several pages (only Webbplats och utskick, C6 2026-10-21): its pages as a second row of buttons that wrap on every
  // width, never a sideways strip.
  const sections = active && active.tab.sections.length > 1 ? active.tab.sections : [];
  // On a phone one picker. On a wider screen one row of chips (see `chip`).
  // The full width like the page under it (2026-10-16: the pages are wide), the tabs from the left edge. Under the page's
  // heading since 2026-10-30 (SectionTabsPlacement in components/page-shell.tsx), the look unchanged.
  return <div className={TAB_ROW_CLASS} data-testid="section-tabs-area">
    <label className="block sm:hidden">
      <span className="sr-only">{label}</span>
      <select className="form-select" aria-label={label} value={open} onChange={(event) => router.push(tabHref(event.target.value))} data-testid="section-tabs-picker">
        {tabs.map((tab) => <option key={tab.key} value={tab.key}>{tab.label}</option>)}
      </select>
    </label>
    <nav aria-label={label} className={cn("section-tabs hidden sm:flex", TAB_PILLS_CLASS)} data-testid="section-tabs">
      {tabs.map(chip)}
    </nav>
    {sections.length ? <nav aria-label={active!.tab.label} className="mt-3 flex flex-wrap gap-2" data-testid="section-subtabs">
      {sections.map((item) => {
        const here = item === active!.section;
        return <Link key={sectionHref(item)} href={sectionHref(item)} aria-current={here ? "page" : undefined}
          className={cn("touch-target flex h-[var(--control-h)] items-center rounded-md border px-3.5 text-sm transition-colors", here ? "border-primary/30 bg-secondary font-medium text-secondary-foreground" : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground")}>
          {item.label}
        </Link>;
      })}
    </nav> : null}
  </div>;
}
