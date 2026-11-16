"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus, OctagonAlert, UserRound, Users, UsersRound, Wallet, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { useRunningTimers } from "@/components/workspace-actions";
import { api } from "@/features/kfid/api";
import { useWorkspaceData } from "@/features/kfid/use-workspace-data";
import { useSubPageHref } from "@/features/kfid/use-return-to";
import { TaskStatistics } from "@/features/workflow/task-statistics";
import { useWorkProfile, useWorkView } from "@/features/workflow/use-work-view";
import { WorkProfileChangeLink } from "@/features/workflow/work-profile-hints";
import { workProfileStartTab } from "@/lib/workflow/work-profile";
import { clientExtensions } from "@ee/client";
import { cn } from "@/lib/utils";
import { TAB_PILLS_CLASS, TAB_ROW_CLASS, tabIconClass, tabPillClass } from "@/features/workflow/in-page-tabs";
import type { TaskNotification } from "@/lib/workflow/task-notifications";
import type { MeTabData } from "@/lib/overview/me";
import { OVERVIEW_TAB_LABEL, overviewStartTab, shownOverviewTabs, type LoadedOverviewTab, type OverviewAnswer, type OverviewTab, type OverviewTabAccess } from "@/lib/overview/tabs";
import { MeTab } from "./me-tab";
import { TeamTab } from "./team-tab";
import { EconomyTab } from "./economy-tab";
import { CustomersTab } from "./customers-tab";

const { DailyDigestCard } = clientExtensions;

/**
 * Översikt (dashboard etapp 6–7, 2026-10-28; layout A of the approved proposal): the page header with its buttons,
 * the parts as a tab row – Jag | Teamet | Ekonomi | Kunder, each with its short figure – and one part at a
 * time. It replaces the old Översikt on display levels 2 and 3 in Cloud; on a phone Hem stays the start page and the
 * Översikt opens with ?tab= (features/kfid/workspace.tsx). Local and the demo keep the old Översikt.
 *
 * - Which tabs: the permission matrix (lib/overview/tabs.ts), first from the person's own profile, then from the server's
 *   answer, which every read carries; the server checks every tab again.
 * - Which tab first: ?tab= when allowed, else the work view's (Arbetsledare → Teamet when allowed) – never a grant.
 * - Reads: one GET /api/overview?tab= per shown tab, kept per tab in the workspace's memory, so going back to a tab draws
 *   it at once while it is read again. Statistik (2026-10-29) is no tab: Teamet ends with the company's statistics and Jag
 *   with the person's own, as separate cards with their own read (/api/task-statistics).
 * - Stable: the tab row has one height, each tab draws a skeleton of its own shape until its first answer, and a tab's
 *   figure (chip) has tabular digits.
 */
const ICON: Record<OverviewTab, LucideIcon> = { me: UserRound, team: UsersRound, economy: Wallet, customers: Users };
const DESCRIPTION: Record<OverviewTab, string> = {
  me: "Det du behöver göra, din tid och din plan.",
  team: "Vem gör vad, vad som behöver följas upp och teamets belastning.",
  economy: "Ofakturerad tid, fakturaunderlag, offerter och mål.",
  customers: "Kunder med öppet och förfallet arbete.",
};

type Answer = OverviewAnswer<unknown>;

/** One loaded tab: its read (kept in memory per address) and its component. Mounted only while the tab is open. */
function LoadedTab({ tab, level, notifications, onAnswer, userName }: { tab: LoadedOverviewTab; level: 2 | 3; notifications: readonly TaskNotification[]; onAnswer: (answer: Answer) => void; userName: string }) {
  const url = `/api/overview?tab=${tab}`;
  const read = useWorkspaceData<Answer>(url, (signal) => api<Answer>(url, { signal, cache: "no-store" }), { keepPrevious: true });
  const answer = read.data;
  useEffect(() => { if (answer) onAnswer(answer); }, [answer, onAnswer]);
  // Jag reads again when a time starts or stops (Gör detta nu has "Tiden går"), the old answer staying meanwhile – but not
  // when the running timers first arrive, so opening the page is one read.
  const source = useRunningTimers();
  const running = tab === "me" && source ? source.timers.map((timer) => timer.entryId).join(",") : null;
  const seenRunning = useRef<string | null>(null);
  const { reload } = read;
  useEffect(() => {
    if (running === null) return;
    if (seenRunning.current !== null && seenRunning.current !== running) void reload();
    seenRunning.current = running;
  }, [running, reload]);
  // T12 finding F4 (2026-10-28): the error has its own Försök igen, not only a page reload.
  if (read.error && !answer) return <div role="alert" className="notice flex flex-wrap items-center justify-between gap-3 text-destructive" data-testid="overview-tab-error">
    <span>{read.error}</span>
    <Button type="button" size="sm" variant="outline" disabled={read.fetching} onClick={() => void reload()} data-testid="overview-tab-retry">Försök igen</Button>
  </div>;
  const data = answer?.tab === tab ? answer.data : null;
  return <div aria-busy={read.fetching || undefined}>
    {tab === "me" ? <MeTab data={data as MeTabData | null} level={level} notifications={notifications} userName={userName} onChanged={() => void reload()} />
      : tab === "team" ? <TeamTab data={data as Parameters<typeof TeamTab>[0]["data"]} level={level} onChanged={() => void reload()} />
      : tab === "economy" ? <EconomyTab data={data as Parameters<typeof EconomyTab>[0]["data"]} level={level} onChanged={() => void reload()} />
      : <CustomersTab data={data as Parameters<typeof CustomersTab>[0]["data"]} level={level} />}
  </div>;
}

export function OverviewPage({ access, level, notifications = [], canCreateWorkOrder, readsProjects, userName = "" }: {
  /** The tabs by the person's own profile (lib/overview/tabs.ts overviewTabs); the server's answer replaces it. */
  access: OverviewTabAccess;
  /** Display level: 3 the whole view, 2 compact (also on a phone, where the page opens from Hem). */
  level: 2 | 3;
  notifications?: readonly TaskNotification[];
  /** Ny arbetsorder: everything starts in a work order (Arbetsordern styr, 2026-10-26). */
  canCreateWorkOrder: boolean;
  /** The person's name, for Jag's greeting. */
  userName?: string;
  /** Teamet's statistics' Projekt part, as the server decides it. */
  readsProjects: boolean;
}) {
  const params = useSearchParams();
  const subPage = useSubPageHref();
  const workView = useWorkView();
  const [serverAccess, setServerAccess] = useState<OverviewTabAccess | null>(null);
  const [chips, setChips] = useState<Partial<Record<OverviewTab, string>>>({});
  const tabsAllowed = serverAccess ?? access;
  const tabs = shownOverviewTabs(tabsAllowed);
  const profileTab = workProfileStartTab(useWorkProfile()?.effective.profile);
  const askedTab = params.get("tab");
  const [open, setOpen] = useState<OverviewTab>(() => overviewStartTab(access, workView?.view, askedTab, profileTab));
  // Teamet or Frånvaro chosen while the page is open (the phone's tab bar, Ny) opens that tab; the address says which.
  const [seenTab, setSeenTab] = useState(askedTab);
  // Also back to an address without a tab: Tillbaka opens the start tab again (2026-11-02).
  if (askedTab !== seenTab) { setSeenTab(askedTab); setOpen(overviewStartTab(access, workView?.view, askedTab, profileTab)); }
  // A tab the server does not allow (the profile changed meanwhile) falls back to the start tab.
  const shown: OverviewTab = tabsAllowed[open] ? open : overviewStartTab(tabsAllowed, workView?.view, null, profileTab);
  // The chosen tab stays in the address (?tab=), so a reload or a shared link opens the same part; nothing else is read. A step
  // of its own, as every tab row (2026-11-02): Tillbaka goes to the tab before.
  const choose = (tab: OverviewTab) => {
    setOpen(tab);
    setSeenTab(tab);
    const url = new URL(window.location.href);
    if (url.searchParams.get("tab") === tab) return;
    url.searchParams.set("tab", tab);
    window.history.pushState(null, "", url);
  };
  const onAnswer = useCallback((answer: Answer) => {
    setServerAccess((current) => current && JSON.stringify(current) === JSON.stringify(answer.tabs) ? current : answer.tabs);
    setChips((current) => {
      const next = { ...current, ...answer.chips };
      if (!(answer.tab in answer.chips)) delete next[answer.tab];
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, []);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + tabs.length) % tabs.length;
    choose(tabs[next]);
    refs.current[next]?.focus();
  };

  return <div data-testid="overview-page" data-level={level}>
    {/* The same two buttons on every tab, in the same place (användartest 2026-10-31, N10; sidans huvudåtgärder byter aldrig
        med fliken, 2026-11-15). Ny arbetsorder only for whoever may; the server decides every save anyway. */}
    <PageHeader title="Översikt" description={DESCRIPTION[shown]} actions={<>
      <Button asChild variant="outline"><Link href={subPage("/?view=deviations&new=1")} data-testid="overview-report-deviation"><OctagonAlert />Rapportera avvikelse</Link></Button>
      {canCreateWorkOrder ? <Button asChild><Link href={subPage("/?view=workflow_task&taskType=WORK_ORDER")} data-testid="overview-new-work-order"><Plus />Ny arbetsorder</Link></Button> : null}
    </>} />
    {/* Dagsammanställningen (2026-10-02): the night's short digest, where the company has chosen it, as on the old Översikt. */}
    {DailyDigestCard ? <div className="mb-6" data-detail-min="2"><DailyDigestCard /></div> : null}
    {/* The settings pages' tab row (SectionTabs' pills) as real tabs with arrow keys, each with its figure when it has one. */}
    {tabs.length > 1 ? <div className={TAB_ROW_CLASS}>
      <div role="tablist" aria-label="Översiktens delar" className={cn("flex", TAB_PILLS_CLASS)}>
        {tabs.map((tab, index) => {
          const here = tab === shown;
          const Icon = ICON[tab];
          return <button key={tab} ref={(element) => { refs.current[index] = element; }} type="button" role="tab" id={`overview-tab-${tab}`} aria-selected={here} aria-controls="overview-tab-panel" tabIndex={here ? 0 : -1}
            onClick={() => choose(tab)} onKeyDown={(event) => move(event, index)} data-testid={`overview-tab-${tab}`}
            className={cn(tabPillClass(here), "shrink-0")}>
            <Icon className={tabIconClass(here)} aria-hidden="true" />{OVERVIEW_TAB_LABEL[tab]}
            {chips[tab] ? <span className={cn("rounded-full px-1.5 text-xs tabular-nums", here ? "bg-card text-foreground" : "bg-muted")} data-testid={`overview-chip-${tab}`}>{chips[tab]}</span> : null}
          </button>;
        })}
      </div>
    </div> : null}
    <div role="tabpanel" id="overview-tab-panel" aria-labelledby={`overview-tab-${shown}`}>
      <LoadedTab key={shown} tab={shown} level={level} notifications={notifications} onAnswer={onAnswer} userName={userName} />
      {/* Statistik as separate cards (2026-10-29): the company's on Teamet (team's right, as the server checks), your own on Jag. */}
      {shown === "team" || shown === "me" ? <div key={`statistics-${shown}`} className={level === 2 ? "mt-3" : "mt-5"}>
        <TaskStatistics cards mine={shown === "me"} projects={readsProjects} />
      </div> : null}
      <WorkProfileChangeLink className="mt-5" />
    </div>
  </div>;
}
