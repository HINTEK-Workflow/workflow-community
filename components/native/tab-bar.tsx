"use client";

import Link from "next/link";
import { LinkPending } from "@/components/link-pending";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Archive, BadgeCheck, BarChart3, Bell, Calculator, CalendarClock, CalendarX2, FilePenLine, HardDrive, LayoutGrid, LogOut, Menu, OctagonAlert, Settings2, ShoppingCart, FileText, FolderKanban, Users, UsersRound, Smartphone, Sparkles, Upload, X } from "lucide-react";
import { NATIVE_NEW_EVENT, nativeMoreTiles, nativeTabOf, type NativeMoreSection, type TypeKey } from "@/lib/workflow/native-mode";
import { activeTab, DEFAULT_TABS, TAB, type TabKey } from "@/lib/workflow/native-layout";
import { NATIVE_TAB_ICON } from "./layout-icons";
import type { NewChoice } from "@/lib/workflow/new-choices";
import { BottomBarLinkContent } from "@/components/bottom-bar";
import { ListGroup, ListRow, NativeLargeTitle, NativeSearchButton } from "./list";
import { NativeMenuPage } from "./menu-page";
import { markOpenedFromSheet, takeRequestedSheet, useBackClosesFirst } from "@/components/history-nav";
import { useLongPress } from "./long-press";

/**
 * The tab bar of Nivå 1 på mobil (2026-10-09): Hem, Jobb, Ny, Tid and Mer replace the bottom bar on a phone at
 * level 1. Each person may choose up to four buttons and their order under Inställningar (lib/workflow/native-layout.ts);
 * Mer is always last. Ny opens the same choices as the bottom bar's Ny (lib/workflow/new-choices.ts) as a list; Mer shows the whole
 * menu in its groups (lib/workflow/native-mode.ts, nativeMoreSections). Hides with the header while scrolling, like the
 * bottom bar. Display only: what is offered follows the person's rights and the server decides every call.
 */
const NEW_TYPE: Record<NewChoice["key"], TypeKey> = { "work-order": "work-order", task: "control", project: "project", customer: "customer", quote: "quote", purchase: "purchase", round: "round", link: "neutral", deviation: "tools", absence: "notice" };
/** Rows in Mer whose type colour is shared get an icon of their own (Kalender is not Tid; Planering has the project icon, B4). */
const MORE_ICON: Partial<Record<string, LucideIcon>> = { team: UsersRound, planning: CalendarClock, project_planning: FolderKanban, ai: Sparkles, logout: LogOut, report_archive: Archive, import: Upload, settings: Settings2, display: Smartphone, local: HardDrive, notifications: Bell, calculator: Calculator, project_summary: BarChart3, forms: FilePenLine, self_inspection: BadgeCheck, deviations: OctagonAlert, purchases: ShoppingCart, quotes: FileText, projects: FolderKanban, customers: Users, home_edit: LayoutGrid, jobs: NATIVE_TAB_ICON.jobs };
const NEW_ICON: Partial<Record<NewChoice["key"], LucideIcon>> = { deviation: OctagonAlert, absence: CalendarX2 };
const NEW_HINT: Partial<Record<NewChoice["key"], string>> = { deviation: "Fel, tillbud eller risk du har sett", absence: "Sjuk eller annan frånvaro", "work-order": "Felavhjälpning, service, installation", task: "Kontroll, risk och formulär", project: "Flera jobb för samma kund", customer: "Företag eller privatperson i kundregistret", quote: "Pris till kunden innan arbetet", purchase: "Material att beställa", round: "Återkommande kontroll av en anläggning" };

export function NativeTabBar({ view, menuView = view, tabs = DEFAULT_TABS, newChoices, newFallbackHref, moreSections, onAction, hidden = false, badge = 0, editable = true }: {
  view: string;
  /** The page whose tab is marked when it is not the view (menuViewOfPage: Företagets platser marks Mer, not Kunder). */
  menuView?: string;
  /** The person's own buttons, already limited to what they may use (Mer comes after them). */
  tabs?: readonly TabKey[];
  newChoices: NewChoice[];
  /** Without any choice Ny leads here (Ny uppgift says why nothing can be created). */
  newFallbackHref: string;
  moreSections: NativeMoreSection[];
  onAction: (action: "ai" | "logout" | "local" | "search" | "calculator") => void;
  hidden?: boolean;
  /** Current notifications, shown on Mer. */
  badge?: number;
  /** A held tab opens the edit mode on Hem (2026-10-21); off where Hem cannot be edited. */
  editable?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"new" | "more" | null>(null);
  const holdTabs = useLongPress(() => { setOpen(null); router.push("/?view=stats&edit=tabs"); }, editable);
  const moreTiles = nativeMoreTiles(moreSections, { jobsTab: tabs.includes("jobs"), timeTab: tabs.includes("time") });
  const params = useSearchParams();
  const tabOfPage = nativeTabOf(view, params);
  const tab = open ?? (tabOfPage === "new" && tabs.includes("new") ? "new" : activeTab(tabs, menuView, tabOfPage === "jobs", params.get("tab")));
  const sheetRef = useRef<HTMLDivElement | null>(null);
  // A new page closes the sheet; Escape closes it too. Back from a page opened from Mer ("‹ Mer", 2026-10-12) arrives
  // with the sheet asked for again, so the person is where they were.
  const [seenView, setSeenView] = useState(view);
  if (seenView !== view) { setSeenView(view); setOpen(takeRequestedSheet()); }
  useEffect(() => {
    if (!open) return;
    sheetRef.current?.querySelector<HTMLElement>("h1")?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  // Hem's "Nytt jobb" tile opens the same list.
  useEffect(() => {
    const onNew = () => setOpen("new");
    window.addEventListener(NATIVE_NEW_EVENT, onNew);
    return () => window.removeEventListener(NATIVE_NEW_EVENT, onNew);
  }, []);
  // Bakåt closes an open sheet before it steps back a page; the round × does the same (2026-10-09). A choice in
  // Ny closes it as well, also when the new page has the same view (2026-10-13: the sheet stayed over Ny arbetsorder).
  const close = useCallback(() => setOpen(null), []);
  useBackClosesFirst(open ? close : null);
  // The browser's or the phone's own Bakåt closes it too (2026-10-13: the page behind went back and the sheet stayed).
  useEffect(() => {
    if (!open) return;
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, [open, close]);
  const closeButton = <button type="button" className="native-sheet-close" aria-label="Stäng" onClick={close} data-testid="native-sheet-close"><X aria-hidden="true" /></button>;
  const toggle = (sheet: "new" | "more") => setOpen((current) => (current === sheet ? null : sheet));
  const current = (key: TabKey) => (!open && tab === key ? "page" as const : undefined);
  return <>
    {open === "new" ? <div ref={sheetRef} role="dialog" aria-modal="false" aria-labelledby="native-new-title" className="native-sheet" data-testid="native-new-sheet">
      {/* "Ny", not "Nytt jobb": the sheet also offers Projekt, Kund and Offert (plan 1A, 2026-10-11). */}
      <NativeLargeTitle actions={closeButton}><span id="native-new-title" tabIndex={-1} className="outline-none">Ny</span></NativeLargeTitle>
      <ListGroup testId="native-new-choices">
        {newChoices.length ? newChoices.filter((choice) => choice.href).map((choice) => <ListRow key={choice.key} type={NEW_TYPE[choice.key]} icon={NEW_ICON[choice.key]} title={choice.label} subtitle={NEW_HINT[choice.key]}
          href={choice.href} onClick={close} testId={`native-new-${choice.key}`} />)
          : <ListRow type="control" title="Ny uppgift" subtitle="Se vad du får skapa" href={newFallbackHref} onClick={close} testId="native-new-task" />}
      </ListGroup>
    </div> : null}
    {open === "more" ? <div ref={sheetRef} role="dialog" aria-modal="false" aria-labelledby="native-more-title" className="native-sheet" data-testid="native-more-sheet">
      <NativeLargeTitle actions={closeButton}><span id="native-more-title" tabIndex={-1} className="outline-none">Mer</span></NativeLargeTitle>
      {/* Sök lives here at level 1 (2026-10-09: a calmer top bar): the field opens the search window. */}
      {/* M2 (2026-10-12): Driftronder as the big tile, everything else as rows; Arbetsordrar and Uppgifter are the Jobb tab (B3), Tid its own tab. */}
      {/* A tile closes the sheet like a row does, also to the page already open (2026-10-24: Mer stayed over Driftronder). */}
      {/* A page opened from here is remembered as such, so its back button says "‹ Mer" and brings the sheet back (2026-10-12). */}
      <NativeMenuPage testId="native-more-menu"
        tiles={moreTiles.tiles.map((row) => ({ title: row.label, type: row.type, href: row.href, testId: row.testId, onClick: () => { markOpenedFromSheet("more"); setOpen(null); } }))}
        groups={moreTiles.sections.map((section, index) => ({ title: section.title, testId: `native-more-group-${index}`, rows: section.rows.map((row) => ({
          key: row.key, type: row.type, icon: MORE_ICON[row.key], title: row.label, subtitle: row.subtitle, testId: row.testId, href: row.href,
          value: row.key === "notifications" && badge ? String(badge) : undefined,
          onClick: row.action ? () => { setOpen(null); onAction(row.action!); } : () => { markOpenedFromSheet("more"); setOpen(null); }, chevron: row.action !== "logout",
        })) }))}>
        <NativeSearchButton onClick={() => { setOpen(null); onAction("search"); }} testId="native-more-search" />
      </NativeMenuPage>
      {/* The version under Logga ut, for a quick look (2026-10-23); also under Hjälp → Om Workflow. */}
      <p className="pb-4 pt-1 text-center text-xs text-muted-foreground" data-testid="menu-version">Version {process.env.NEXT_PUBLIC_APP_VERSION}</p>
    </div> : null}
    <nav aria-label="Flikrad" className="workspace-bottom-nav native-tab-bar lg:hidden" data-mode="tabs" data-testid="native-tab-bar" aria-hidden={hidden || undefined} inert={hidden || undefined} {...holdTabs}>
      {tabs.map((key) => {
        const item = TAB[key];
        const content = <BottomBarLinkContent icon={NATIVE_TAB_ICON[key]} label={item.label} />;
        if (key === "new") return <button key={key} type="button" aria-expanded={open === "new"} data-active={open === "new" || (!open && tab === "new") || undefined} data-slot-key="new" data-testid="native-tab-new" aria-label="Ny – välj vad du vill skapa" onClick={() => toggle("new")}>{content}</button>;
        if (item.action === "ai" || item.action === "search") return <button key={key} type="button" data-slot-key={key} data-testid={`native-tab-${key}`} aria-label={item.hint} onClick={() => { setOpen(null); onAction(item.action as "ai" | "search"); }}>{content}</button>;
        return <Link key={key} href={item.href ?? `/?view=${item.view}`} aria-current={current(key)} data-slot-key={key} data-testid={`native-tab-${key}`} onClick={() => setOpen(null)}>{content}<LinkPending edge="top" /></Link>;
      })}
      <button type="button" aria-expanded={open === "more"} data-active={open === "more" || (!open && tab === "more") || undefined} data-slot-key="more" data-testid="native-tab-more" aria-label="Mer – hela menyn" onClick={() => toggle("more")}>
        <span className="nav-icon"><Menu />{badge ? <span className="nav-dirty" aria-hidden="true" /> : null}</span><span>Mer</span>
      </button>
    </nav>
  </>;
}
