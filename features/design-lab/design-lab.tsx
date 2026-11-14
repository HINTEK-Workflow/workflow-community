"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Bell, Briefcase, Clock3, FlaskConical, Home, Menu, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { defaultDetailLevels, detailLevelFor } from "@/lib/workflow/detail-level";
import { LAB_SECTIONS, type LabSection, type LabView } from "./data";
import { LabContext, Segmented, type LabToast } from "./parts";
import { PurchaseDemo } from "./purchase";
import { WorkOrderDemo } from "./work-order";
import { TaskListDemo } from "./task-list";
import s from "./design-lab.module.css";

const VIEW_NAMES = ["Visning 1", "Visning 2", "Visning 3"] as const;
type ViewName = (typeof VIEW_NAMES)[number];
const SECTION_NAMES = LAB_SECTIONS.map((section) => section.label);

// The device's default display level (phone 1, tablet 2, computer 3 – the app's own first choice, A2), read from the window
// after hydration; 3 on the server. The person's saved level is not read: the lab touches no stored data.
const subscribeResize = (notify: () => void) => { window.addEventListener("resize", notify); return () => window.removeEventListener("resize", notify); };
const deviceLevel = (): LabView => detailLevelFor(defaultDetailLevels, window.innerWidth, window.matchMedia("(pointer: coarse)").matches, window.innerHeight);

/**
 * Designlabbet (2026-10-16): a page of its own for trying a new basic look, inspired by Lovable's "Planering".
 * Example data in memory only – no API, database or browser storage – and every rule of the look lives in
 * design-lab.module.css under this wrapper, with the two typefaces loaded by the route only. The app's pages, shared
 * components and global CSS are untouched; Button and Input are reused and take the look from the wrapper's
 * variables. `Visning 1–3` draws the page as the three display levels would; the layout also follows the real width.
 */
export function DesignLab({ initialView, initialSection }: { initialView: LabView | null; initialSection: LabSection }) {
  const device = useSyncExternalStore(subscribeResize, deviceLevel, () => 3 as LabView);
  const [chosen, setChosen] = useState<LabView | null>(initialView);
  const [section, setSection] = useState<LabSection>(initialSection);
  const [toastState, setToastState] = useState<{ id: number; message: string; action?: { label: string; run: () => void } } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const view = chosen ?? device;

  const toast = useCallback<LabToast>((message, action) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastState({ id: Date.now(), message, action });
    toastTimer.current = setTimeout(() => setToastState(null), action ? 6000 : 3200);
  }, []);
  const lab = useMemo(() => ({ view, toast }), [view, toast]);

  // The address follows the choices, so a view can be linked and reloaded (never a new history entry).
  const remember = (nextView: LabView, nextSection: LabSection) => {
    const url = new URL(window.location.href);
    url.searchParams.set("visning", String(nextView));
    url.searchParams.set("del", nextSection);
    window.history.replaceState(window.history.state, "", url);
  };
  const chooseView = (name: ViewName) => { const next = (VIEW_NAMES.indexOf(name) + 1) as LabView; setChosen(next); remember(next, section); };
  const chooseSection = (label: string) => { const next = LAB_SECTIONS.find((item) => item.label === label)?.id ?? "inkop"; setSection(next); remember(view, next); window.scrollTo({ top: 0 }); };
  const lookOnly = (what: string) => () => toast(`${what} – visar bara utseendet i designlabbet.`);

  const content = section === "inkop" ? <PurchaseDemo key="inkop" /> : section === "arbetsorder" ? <WorkOrderDemo key="arbetsorder" /> : <TaskListDemo key="lista" />;
  const sectionLabel = LAB_SECTIONS.find((item) => item.id === section)?.label ?? "Inköp";

  return <LabContext.Provider value={lab}>
    <div className={s.root} data-view={view} data-testid="design-lab">
      {/* The lab's own bar: clearly not part of the design being tried. */}
      <div className={s.labBar} data-testid="lab-bar">
        <div className={s.labBarInner}>
          <span className={s.labBadge}><FlaskConical aria-hidden="true" />Designlabb · exempeldata, sparas inte</span>
          <div className={s.labControls}>
            <Segmented label="Visningsläge" value={VIEW_NAMES[view - 1]} options={VIEW_NAMES} onChange={chooseView} testId="lab-view-switch" />
            <Segmented label="Del" value={sectionLabel} options={SECTION_NAMES} onChange={chooseSection} testId="lab-section-switch" />
            <Link href="/?view=stats" className={s.labExit}>Till Workflow</Link>
          </div>
        </div>
      </div>

      {view === 1 ? <div className={s.phoneColumn} data-testid="lab-phone">
        {content}
        <nav className={s.tabBar} aria-label="Flikar (visar bara utseendet)">
          {[{ icon: Home, label: "Hem" }, { icon: Briefcase, label: "Jobb", active: true }, { icon: Plus, label: "Ny", create: true }, { icon: Clock3, label: "Tid" }, { icon: Menu, label: "Mer" }].map((tab) => <button key={tab.label} type="button" className={s.tab} aria-current={tab.active ? "page" : undefined} data-create={tab.create ? "" : undefined} onClick={lookOnly(`Fliken ${tab.label}`)}>
            <span className={s.tabIcon}><tab.icon aria-hidden="true" /></span>{tab.label}
          </button>)}
        </nav>
      </div> : <>
        <header className={s.appBar} data-testid="lab-app-bar">
          <div className={s.appBarInner}>
            <span className={cn("workflow-brand-text", s.brand)}>Workflow</span>
            <button type="button" className={s.appSearch} onClick={lookOnly("Sök")}><Search aria-hidden="true" /><span>Sök</span><kbd>Ctrl K</kbd></button>
            <div className={s.appBarEnd}>
              <button type="button" className={s.iconButton} aria-label="Notiser" onClick={lookOnly("Notiser")}><Bell aria-hidden="true" /></button>
              <span className={s.avatar} aria-hidden="true">AN</span>
            </div>
          </div>
        </header>
        <main className={s.main}>{content}</main>
      </>}

      {toastState ? <div key={toastState.id} className={s.toast} role="status" data-testid="lab-toast">
        <span>{toastState.message}</span>
        {toastState.action ? <button type="button" className={s.toastAction} onClick={() => { toastState.action?.run(); setToastState(null); }}>{toastState.action.label}</button> : null}
        <button type="button" className={s.toastClose} aria-label="Stäng" onClick={() => setToastState(null)}><X aria-hidden="true" /></button>
      </div> : null}
    </div>
  </LabContext.Provider>;
}
