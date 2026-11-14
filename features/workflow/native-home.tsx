"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { WorkProfileChangeLink } from "@/features/workflow/work-profile-hints";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, X } from "lucide-react";
import { api } from "@/features/kfid/api";
import { useWorkspaceData } from "@/features/kfid/use-workspace-data";
import { NativeHomeTimeTile } from "./running-timer";
import { ReleaseNotice } from "./release-notes";
import { useNotificationCount, useRunningTimers } from "@/components/workspace-actions";
import { ListGroup, ListRow, NATIVE_HOME_ICON, NativeLargeTitle, NativePage, Tile, TileList, useNativeTopBar, type TileListRow } from "@/components/native";
import { useLongPress } from "@/components/native/long-press";
import { useBackClosesFirst } from "@/components/history-nav";
import { addableTiles, DEFAULT_HOME_TILES, DEFAULT_TABS, HOME_TILE, homeGridColumns, isMyDayTile, nativeLayoutAllowed, noticeRowsThatFit, normalizeNativeLayout, placeAt, removeTile, WIDE_HOME_TILES, type HomeTileKey, type MyDayTile, type NativeLayout, type TabKey } from "@/lib/workflow/native-layout";
import type { MyDayAnswer, MyDayRow } from "@/lib/workflow/my-day";
import { announce } from "@/lib/workflow/toast";
import { useConfirm } from "@/features/kfid/confirm";
import type { HomeTileFace } from "@/components/native/home-edit";
import { OPEN_ASSISTANT_EVENT } from "@/lib/workflow/shell-events";
import type { WorkflowPermissionProfile } from "@/lib/workflow/permissions";
import { jobStepRows, nativeNoticeHref, typeOfTaskKind, NATIVE_NEW_EVENT, type TypeKey } from "@/lib/workflow/native-mode";
import { storedJobFlow, type StoredJob } from "@/lib/workflow/job-flow";
import { emptyRiskStepContext, riskStepState, type RiskStepContext } from "@/lib/workflow/risk-step";
import { swedishDayKey } from "@/lib/swedish-time";
import { keepsWorkflowRegister } from "@/lib/workflow/staff-register";
import { isTaskClosed } from "@/lib/workflow/task-cancel";
import type { OverviewKpis } from "@/lib/workflow/overview-kpis";
import type { TaskNotification } from "@/lib/workflow/task-notifications";
import type { ProjectItem } from "@/features/kfid/types";

// The edit mode's tiles and sheet with their drag and drop (U1/T2, 2026-10-23): loaded when Hem may be edited, a moment
// after Hem is drawn, and Hem stays as it is until they have come, so nothing jumps.
const loadEditKit = () => import("@/components/native/home-edit");
type EditKit = Awaited<ReturnType<typeof loadEditKit>>;

/**
 * Hem on a phone at level 1 (Nivå 1 på mobil, 2026-10-09): a greeting, big tiles – Mina jobb with how many are
 * open and late, Checka in when a project keeps its staff register in Workflow, Nytt jobb, Tid with today's total – a wide
 * "Fortsätt: …" for the job the person is on (the running timer's, else the latest under way) with its next step, and the
 * notifications as a list. Only tiles the person may use; the same data and rules as the rest of the app. Which tiles and
 * in what order each person chooses (lib/workflow/native-layout.ts, 2026-10-09 evening) – since 2026-10-21 right
 * here, like a phone's home screen: hold a tile, move, remove, add, Klart (UX-granskningen A1 and avsnitt 3). Hem fits the
 * screen without scrolling with the default tiles (avsnitt 4): at most three notices, fewer on a lower screen.
 */
type Continue = { id: string; kind: string; title: string; href: string; next: string; running: boolean };
type RunningEntry = { entryId: string; taskId: string; taskTitle: string; kind: string; startedAt: string };
type WorkItem = { id: string; kind?: string | null; title: string };

const greeting = (now: Date) => {
  const hour = Number(new Intl.DateTimeFormat("sv-SE", { hour: "numeric", hour12: false, timeZone: "Europe/Stockholm" }).format(now));
  return hour < 10 ? "God morgon" : hour < 17 ? "Hej" : "God kväll";
};
const hoursText = (seconds: number) => {
  const minutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
};
const jobHref = (id: string, kind: string) => `/?view=workflow_task&taskId=${encodeURIComponent(id)}&taskType=${encodeURIComponent(kind)}`;

/** What the bell lists, as rows with a coloured dot: red late or urgent, orange soon, blue the rest. */
function noticeDot(item: TaskNotification): TypeKey {
  if (item.urgent || item.deadline === "OVERDUE" || item.needsAction) return "work-order";
  if (item.deadline === "DUE_SOON") return "risk";
  return "notice";
}

/** A list tile's rows from /api/my-day: null while it is read, none when the person may not use it (the tile is then not offered). */
function listRows(part: { rows: MyDayRow[] } | null | undefined): TileListRow[] | null {
  if (part === undefined) return null;
  return part ? part.rows.map((row) => ({ id: row.id, title: row.title, href: row.href, detail: row.detail, late: row.late })) : [];
}
/** Förfallet's figure (beslut 15, 2026-11-01): the tile opens the jobs, so rounds are told apart from the jobs' count. */
const overdueCount = (part: { tasks: number; rounds: number }) => part.rounds ? `${part.tasks} jobb · ${part.rounds} ${part.rounds === 1 ? "rond" : "ronder"}` : String(part.tasks);
/** "4 öppna, varav 2 förfallna" (2026-10-28). */
const deviationsCount = (part: { count: number; overdue: number }) => part.count ? `${part.count} ${part.count === 1 ? "öppen" : "öppna"}${part.overdue ? `, varav ${part.overdue} ${part.overdue === 1 ? "förfallen" : "förfallna"}` : ""}` : "Inga öppna";

/** The phone is held sideways: four tiles in a row (avsnitt 4). */
function useLandscape() {
  const [landscape, setLandscape] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(orientation: landscape)");
    const update = () => setLandscape(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return landscape;
}

export function NativeHome({ name, admin, permissions, projects, notifications, tiles = DEFAULT_HOME_TILES, layout, defaults, allowed: allowedChoices, onSaveLayout, ai = false, local = false, release = null }: {
  name: string;
  admin: boolean;
  permissions: WorkflowPermissionProfile;
  projects: ProjectItem[];
  notifications: TaskNotification[] | null;
  /** The person's own tiles in order; those they may not use are left out. */
  tiles?: readonly HomeTileKey[];
  /** The whole stored choice (tiles and tab bar), edited in place; without it Hem cannot be edited. */
  layout?: NativeLayout;
  /** What Återställ goes back to: the yrkesprofil's Hem and tab bar, otherwise the common default. */
  defaults?: NativeLayout;
  /** What the person may use, by the menu's rule (as the tab bar is drawn); the tiles default to the rule below. */
  allowed?: { allowedHome: readonly HomeTileKey[]; allowedTabs: readonly TabKey[] };
  /** Saves the edited choice (Klart); true when it was saved. */
  onSaveLayout?: (next: NativeLayout) => Promise<boolean>;
  /** Workflow AI is part of this installation. */
  ai?: boolean;
  /** Local (2026-10-18): the same start page, but nothing is fetched from the cloud – the file is on this computer. */
  local?: boolean;
  /**
   * The notice after an update (features/workflow/release-notes.tsx), unseen by the person: drawn as the first row of
   * Notiser, so Hem still fits the screen (punkt 1); above the tiles when Notiser is not on Hem.
   */
  release?: { version: string; onSeen: () => void } | null;
}) {
  const allowedHome = allowedChoices?.allowedHome ?? nativeLayoutAllowed({ memberRole: admin ? "ADMIN" : "MEMBER", workflowPermissions: permissions, ai, localStorageMode: local }).allowedHome;
  const allowedTabs = allowedChoices?.allowedTabs ?? [];
  const allowed = new Set(allowedHome);
  // ---------- Editing in place (avsnitt 3) ----------
  const editable = Boolean(layout && onSaveLayout);
  const [editing, setEditing] = useState(false);
  const [kit, setKit] = useState<EditKit | null>(null);
  const editMode = editing && kit !== null;
  useEffect(() => {
    if (!editable || kit) return;
    let alive = true;
    const get = () => { loadEditKit().then((module) => { if (alive) setKit(module); }).catch(() => undefined); };
    // At once when the edit mode is asked for; otherwise after Hem has had the network to itself.
    const timer = window.setTimeout(get, editing ? 0 : 2500);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [editable, editing, kit]);
  const [draft, setDraft] = useState<NativeLayout>(() => normalizeNativeLayout(layout ?? { home: [...tiles] }));
  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; });
  // Opened from a held tab (or ?edit=tabs) the edit screen starts at Flikraden.
  const [focus, setFocus] = useState<"tiles" | "tabs">("tiles");
  const begin = useCallback(() => {
    if (!editable) return;
    setDraft(normalizeNativeLayout(layout));
    setEditing(true);
    setFocus("tiles");
  }, [editable, layout]);
  const finish = useCallback(() => {
    setEditing(false);
    const next = draftRef.current;
    if (onSaveLayout && JSON.stringify(next) !== JSON.stringify(normalizeNativeLayout(layout))) void onSaveLayout(next);
  }, [layout, onSaveLayout]);
  // Bakåt (the bar, the edge swipe, the phone's own) ends the edit mode – and saves, like Klart.
  useBackClosesFirst(editMode ? finish : null);
  // Klart always in the same place, the top bar's right end (2026-10-26).
  useNativeTopBar(editMode ? { title: "Hemskärmen", save: { label: "Klart", onClick: finish }, back: null } : null);
  const [confirm, confirmElement] = useConfirm();
  // Mer → Redigera hemskärmen, Inställningar → Ordna hemskärmen and a held tab (the tab bar) arrive with ?edit=.
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = params.get("edit");
  const wanted = editable && (requested === "home" || requested === "tabs") ? requested : null;
  // The request starts the edit mode once, while the page is drawn (no effect that sets state), and then leaves the address.
  const [handled, setHandled] = useState<string | null>(null);
  if (wanted !== handled) {
    setHandled(wanted);
    if (wanted) { setDraft(normalizeNativeLayout(layout)); setEditing(true); setFocus(wanted === "tabs" ? "tabs" : "tiles"); }
  }
  useEffect(() => {
    if (!wanted) return;
    const rest = new URLSearchParams(params.toString());
    rest.delete("edit");
    router.replace(`${pathname}?${rest.toString()}`, { scroll: false });
  }, [wanted, params, router, pathname]);
  const draftShown = draft.home.filter((key) => allowed.has(key));
  const setShown = (next: HomeTileKey[]) => setDraft((current) => ({ ...current, home: [...next, ...current.home.filter((key) => !allowed.has(key))] }));
  const remove = (key: HomeTileKey) => {
    const { home, index } = removeTile(draftShown, key);
    setShown(home);
    // No question: the toast says what went and Ångra puts it back where it stood (avsnitt 3, steg 3).
    announce(`${HOME_TILE[key].label} är borttagen.`, false, [{ label: "Ångra", run: () => setDraft((current) => ({ ...current, home: [...placeAt(current.home.filter((item) => allowed.has(item)), key, index), ...current.home.filter((item) => !allowed.has(item))] })) }], 6000);
  };
  const [justAdded, setJustAdded] = useState<HomeTileKey | null>(null);
  // An added tile comes last among the tiles; Notiser stays the list under them.
  const add = (key: HomeTileKey) => {
    const tilesOnly = draftShown.filter((item) => item !== "notices");
    setShown(key === "notices" ? [...draftShown, key] : [...tilesOnly, key, ...(draftShown.includes("notices") ? ["notices" as const] : [])]);
    setJustAdded(key);
  };
  // Two Återställ (2026-10-26): Hem and the tab bar each on their own, with a question first; the edit mode stays.
  const resetTiles = async () => {
    if (!await confirm({ title: "Återställa hemskärmen?", message: "Rutorna blir som från början. Flikraden ändras inte.", confirmLabel: "Återställ" })) return;
    setDraft((current) => ({ ...current, home: [...(defaults?.home ?? DEFAULT_HOME_TILES)] }));
    announce("Hemskärmen är som från början. Tryck Klart för att spara.");
  };
  const resetTabs = async () => {
    if (!await confirm({ title: "Återställa flikraden?", message: "Flikraden blir som från början. Hemskärmen ändras inte.", confirmLabel: "Återställ" })) return;
    setDraft((current) => ({ ...current, tabs: [...(defaults?.tabs ?? DEFAULT_TABS)] }));
    announce("Flikraden är som från början. Tryck Klart för att spara.");
  };
  useEffect(() => { if (!justAdded) return; const timer = setTimeout(() => setJustAdded(null), 1600); return () => clearTimeout(timer); }, [justAdded]);
  const longPress = useLongPress(() => begin(), editable && !editing);
  const landscape = useLandscape();
  const shown = editMode ? draftShown : tiles.filter((key) => allowed.has(key));
  const canJobs = shown.includes("jobs") || shown.includes("continue");
  const canTime = shown.includes("time");
  // Started or stopped anywhere (the top bar, the job, the tile): today's total and Fortsätt are read again.
  const runningKey = (useRunningTimers()?.timers ?? []).map((timer) => timer.entryId).join("|");
  // Stabil sidladdning (2026-10-23): what the tiles say comes through the workspace's memory cache (useWorkspaceData), so
  // Hem opened again draws Fortsätt at once instead of adding it a moment later above the notices (74 px on a phone); the
  // answers are read again behind it. The key holds what decides the answer: which tiles ask and the running timers.
  const kpisRead = useWorkspaceData<OverviewKpis | null>(local || !canJobs ? null : "/api/overview-kpis", (signal) => api<{ mine: OverviewKpis }>("/api/overview-kpis", { signal }).then((result) => result.mine).catch(() => null));
  const kpis = kpisRead.data ?? null;
  const homeKey = local ? null : `native-home?${new URLSearchParams({ jobs: String(canJobs), time: String(canTime), running: runningKey })}`;
  const homeRead = useWorkspaceData<{ todaySec: number | null; current: Continue | null }>(homeKey, async (signal) => {
    let todaySec: number | null = null;
    // Time today: the week's own entries that started today, a running one counted up to now.
    let running: RunningEntry[] = [];
    try { running = (await api<{ running: RunningEntry[] }>("/api/workflow-time?running=mine", { signal })).running ?? []; } catch { /* shown without */ }
    if (canTime) {
      try {
        const week = await api<{ timeEntries: { startedAt: string; durationSec: number }[] }>("/api/workflow-time?capacity=week", { signal });
        const today = swedishDayKey(new Date());
        const startedRunning = new Set(running.map((entry) => entry.startedAt));
        const done = week.timeEntries.filter((entry) => swedishDayKey(entry.startedAt) === today && !startedRunning.has(entry.startedAt)).reduce((sum, entry) => sum + (entry.durationSec || 0), 0);
        const now = Date.now();
        const live = running.filter((entry) => swedishDayKey(entry.startedAt) === today).reduce((sum, entry) => sum + Math.max(0, (now - Date.parse(entry.startedAt)) / 1000), 0);
        todaySec = done + live;
      } catch { /* the tile says nothing about the time */ }
    }
    if (!canJobs) return { todaySec, current: null };
    // The job the person is on: the running timer's, else the latest of their own under way, else open.
    let job: { id: string; kind: string; title: string; running: boolean } | null = running[0] ? { id: running[0].taskId, kind: running[0].kind, title: running[0].taskTitle, running: true } : null;
    for (const filter of ["active", "open"]) {
      if (job) break;
      try {
        const page = await api<{ items: WorkItem[] }>(`/api/work-items?scope=mine&filter=${filter}&sort=updated&page=1&limit=1`, { signal });
        const item = page.items[0];
        if (item?.kind) job = { id: item.id, kind: item.kind, title: item.title, running: false };
      } catch { break; }
    }
    if (!job) return { todaySec, current: null };
    let next = "";
    try {
      const [result, risk] = await Promise.all([
        api<{ tasks: (StoredJob & { kind: string; formArea?: string | null })[] }>(`/api/workflow-tasks?id=${encodeURIComponent(job.id)}`, { signal }),
        api<{ context: RiskStepContext }>(`/api/workflow-tasks/risk-step?taskId=${encodeURIComponent(job.id)}`, { signal }).then((value) => value.context).catch(() => emptyRiskStepContext()),
      ]);
      const task = result.tasks.find((item) => item.id === job!.id);
      // A job that is färdigställt or has utgått (2026-10-09) has nothing to continue.
      if (task && isTaskClosed(task.status)) return { todaySec, current: null };
      if (task) {
        const state = riskStepState(task, risk);
        const steps = jobStepRows({ kind: task.data.kind, flow: storedJobFlow(task, state.applies ? { met: state.done, hint: state.hint } : undefined) });
        next = steps.next ? `Nästa steg: ${steps.next.label}` : "";
      }
    } catch { /* the tile still leads to the job */ }
    return { todaySec, current: { ...job, href: jobHref(job.id, job.kind), next } };
  }, { keepPrevious: true });
  // Gör detta nu, Förfallet and Mina avvikelser (dashboard etapp 2, 2026-10-28): one read for the tiles that are on
  // Hem, none when none is; Gör detta nu is read again when a timer starts or stops (Tiden går).
  const myDayTiles = local ? [] : shown.filter(isMyDayTile);
  const myDayUrl = myDayTiles.length ? `/api/my-day?tiles=${myDayTiles.slice().sort().join(",")}` : null;
  const myDayKey = myDayUrl ? `${myDayUrl}${myDayTiles.includes("next") ? `&running=${encodeURIComponent(runningKey)}` : ""}` : null;
  const myDayRead = useWorkspaceData<MyDayAnswer | null>(myDayKey, (signal) => myDayUrl ? api<MyDayAnswer>(myDayUrl, { signal }).catch(() => null) : Promise.resolve(null), { keepPrevious: true });
  const myDay = myDayRead.data ?? null;
  // A read that failed says so in the tile's room instead of grey rows that never end.
  const myDayFailed = myDayRead.data === null;
  const failedText = "Kunde inte hämtas";
  const todaySec = homeRead.data?.todaySec ?? null;
  const current = homeRead.data?.current ?? null;
  // Personalliggare: a project of the person's job that keeps its register in Workflow, else the first open one.
  const registers = projects.filter((project) => keepsWorkflowRegister(project) && !project.archivedAt && !project.closedAt);
  const checkIn = registers[0] ?? null;
  const firstName = name.trim().split(/\s+/)[0] ?? "";
  // At most three notices on Hem, fewer when the screen is lower, so Hem never scrolls with the default tiles (avsnitt 4).
  const noticesRef = useRef<HTMLDivElement | null>(null);
  const [noticeRows, setNoticeRows] = useState(3);
  const total = notifications?.length ?? 0;
  useLayoutEffect(() => {
    const group = noticesRef.current;
    if (!group || editMode) return;
    const measure = () => {
      // The room is the screen less what stands above the list and what the page keeps below it (the tab bar's space).
      const box = group.getBoundingClientRect();
      const top = box.top + window.scrollY;
      // The bottom paddings and margins of the list's frames up to the page: what stays below its last row.
      let below = 0;
      for (let frame = group.parentElement; frame && frame !== document.body; frame = frame.parentElement) {
        const style = getComputedStyle(frame);
        below += (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.marginBottom) || 0) + (parseFloat(style.borderBottomWidth) || 0);
      }
      // The update's row is part of what the list needs besides the notices (`fixed`), not a notice of its own.
      const rows = [...group.querySelectorAll<HTMLElement>("[role=list] > :not([data-testid=release-notice])")];
      const row = rows[0]?.offsetHeight || 52;
      // What the list needs besides its rows: the heading and its margins (measured, not guessed).
      const fixed = box.height - rows.reduce((sum, item) => sum + item.offsetHeight, 0);
      // At least the most urgent notice is always shown (the demo has its own banner above Hem; the page may then scroll a little).
      setNoticeRows(Math.max(total ? 1 : 0, noticeRowsThatFit(window.innerHeight - below - top, row, total, fixed)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [total, editMode, current, shown.length, kpis, todaySec, release, myDay]);
  const items = (notifications ?? []).slice(0, noticeRows);
  // The figure is the bell's, so the bell, the list and Hem say the same (kundresa 2026-11-07, M2: 6 in the bell, 44 here).
  const bell = useNotificationCount();
  const smallTiles = shown.filter((key) => !WIDE_HOME_TILES.includes(key)).length;
  const columns = homeGridColumns(smallTiles, landscape);
  // What each tile shows, the same on Hem and in the edit mode (2026-10-26: "35 öppna", not a description).
  const jobsLine = local ? HOME_TILE.jobs.hint : kpis ? `${kpis.openTasks} ${kpis.openTasks === 1 ? "öppet" : "öppna"}${kpis.overdueTasks ? ` · ${kpis.overdueTasks} ${kpis.overdueTasks === 1 ? "förfallet" : "förfallna"}` : ""}` : "Hämtar…";
  const timeLine = local ? HOME_TILE.time.hint : todaySec === null ? "Hämtar…" : `${hoursText(todaySec)} i dag`;
  const continueLine = current ? (current.running ? `Tiden går${current.next ? ` · ${current.next}` : ""}` : current.next || "Öppna jobbet") : undefined;
  const myDayLine = (key: MyDayTile): string | undefined => {
    if (key === "next") { const first = myDay?.next?.rows[0]; return first ? `${first.chip}: ${first.title}` : myDay?.next ? "Inget just nu" : undefined; }
    if (key === "overdue") return myDay?.overdue ? (myDay.overdue.count ? `${myDay.overdue.count} förfallna` : "Inget förfallet") : undefined;
    return myDay?.deviations ? deviationsCount(myDay.deviations) : undefined;
  };
  const faceOf = (key: HomeTileKey): HomeTileFace => {
    const item = HOME_TILE[key];
    const face: HomeTileFace = { key, title: item.label, subtitle: item.hint, type: item.type, icon: NATIVE_HOME_ICON[key], wide: WIDE_HOME_TILES.includes(key), when: item.when, present: true };
    switch (key) {
      case "jobs": return { ...face, subtitle: jobsLine };
      case "checkin": return { ...face, subtitle: checkIn?.name, present: Boolean(checkIn) };
      case "time": return { ...face, subtitle: timeLine };
      case "continue": return current ? { ...face, title: `Fortsätt: ${current.title}`, type: typeOfTaskKind(current.kind), icon: undefined, subtitle: continueLine } : { ...face, icon: undefined, present: false };
      case "next": case "overdue": case "deviations": return { ...face, subtitle: myDayLine(key) ?? item.hint };
      default: return face;
    }
  };
  if (editMode && kit) return <NativePage testId="native-home" className="native-home">
    {confirmElement}
    <h1 className="sr-only">Redigera hemskärmen och flikraden</h1>
    <p className="px-1 pb-1 text-center text-xs text-muted-foreground" data-testid="native-home-edit-hint">Dra för att flytta. × tar bort.</p>
    <kit.HomeEditScreen focus={focus}>
      <kit.HomeEditGrid faces={draftShown.map(faceOf)} columns={columns} addable={addableTiles(draftShown, allowedHome)} onMove={setShown} onRemove={remove} onAdd={add} onReset={() => void resetTiles()} />
      <kit.TabBarEditor tabs={draft.tabs} allowedTabs={allowedTabs} onTabs={(tabs) => setDraft((current) => ({ ...current, tabs }))} onReset={() => void resetTabs()} />
    </kit.HomeEditScreen>
  </NativePage>;
  const visibleTiles = shown.filter((key) => key !== "notices");
  const noticesShown = Boolean(notifications) && shown.includes("notices");
  return <NativePage testId="native-home" className="native-home">
    {release && !noticesShown ? <ReleaseNotice version={release.version} onSeen={release.onSeen} /> : null}
    <NativeLargeTitle>{greeting(new Date())}{firstName ? `, ${firstName}` : ""}</NativeLargeTitle>
    <div className="native-home-grid" data-cols={columns} data-testid="native-home-tiles" data-just-added={justAdded ?? undefined} {...longPress}>
      {editable && !visibleTiles.length ? <Tile type="neutral" icon={Plus} title="Lägg till rutor" subtitle="Ordna din hemskärm" wide onClick={() => begin()} testId="native-tile-add" /> : null}
      {visibleTiles.map((key) => {
        const item = HOME_TILE[key];
        const icon = NATIVE_HOME_ICON[key];
        switch (key) {
          case "jobs": return <Tile key={key} type={item.type} icon={icon} title={item.label} href="/?view=tasks" testId="native-tile-jobs" subtitle={jobsLine} />;
          case "checkin": return checkIn ? <Tile key={key} type={item.type} icon={icon} title={item.label} subtitle={checkIn.name} href={`/?view=project&projectId=${encodeURIComponent(checkIn.id)}`} testId="native-tile-checkin" /> : null;
          case "new": return <Tile key={key} type={item.type} icon={icon} title={item.label} subtitle={item.hint} onClick={() => window.dispatchEvent(new Event(NATIVE_NEW_EVENT))} testId="native-tile-new" />;
          // A running timer: its clock and Stoppa, from the top bar's own source (punkt 7), and a tap opens its job (svar 3); otherwise today's total and Tid.
          case "time": return <NativeHomeTimeTile key={key} title={item.label} idle={timeLine} href="/?view=time" />;
          case "ai": return <Tile key={key} type={item.type} icon={icon} title={item.label} subtitle={item.hint} onClick={() => window.dispatchEvent(new Event(OPEN_ASSISTANT_EVENT))} testId="native-tile-ai" />;
          case "continue": return current ? <Tile key={key} wide type={typeOfTaskKind(current.kind)} title={`Fortsätt: ${current.title}`} subtitle={continueLine} href={current.href} testId="native-tile-continue" /> : null;
          // Dashboard etapp 2 (2026-10-28): wide list tiles of a fixed height; grey rows until the answer has come.
          case "next": return <TileList key={key} type={item.type} icon={icon} title={item.label} testId="native-tile-next" empty={myDayFailed ? failedText : "Inget just nu"}
            rows={myDay?.next ? myDay.next.rows.map((row) => ({ id: row.id, title: row.title, href: row.href, chip: { label: row.chip, tone: row.pressing ? "danger" : "info" } })) : myDayFailed || myDay?.next === null ? [] : null} />;
          case "overdue": return <TileList key={key} type={item.type} icon={icon} title={item.label} testId="native-tile-overdue" empty={myDayFailed ? failedText : "Inget förfallet"}
            href={myDay?.overdue?.href} count={myDay?.overdue ? overdueCount(myDay.overdue) : undefined} rows={myDayFailed ? [] : listRows(myDay?.overdue)} />;
          case "deviations": return <TileList key={key} type={item.type} icon={icon} title={item.label} testId="native-tile-deviations" empty={myDayFailed ? failedText : "Inga öppna avvikelser"}
            href={myDay?.deviations?.href} count={myDay?.deviations ? deviationsCount(myDay.deviations) : undefined} rows={myDayFailed ? [] : listRows(myDay?.deviations)} />;
          default: return <Tile key={key} type={item.type} icon={icon} title={item.label} subtitle={item.hint} href={item.href ?? `/?view=${item.view}`} testId={`native-tile-${key}`} />;
        }
      })}
    </div>
    {notifications && noticesShown ? <div ref={noticesRef}><ListGroup title="Notiser" testId="native-home-notifications">
      {/* The update (2026-10-06) as a row of Notiser: a tap opens Nytt i version …, × closes it; both mark it seen. */}
      {release ? <ListRow dot="notice" title={`Nytt i version ${release.version}`} subtitle="Workflow är uppdaterat" href="/?view=help&step=nytt" onClick={release.onSeen} testId="release-notice"
        accessory={<button type="button" className="native-home-row-action" aria-label="Stäng" onClick={release.onSeen}><X className="size-4" aria-hidden="true" /></button>} /> : null}
      {items.length ? items.map((item) => <ListRow key={item.id} dot={noticeDot(item)} title={item.title} href={nativeNoticeHref(item.href)} testId="native-notice-row"
        subtitle={item.detail ?? (item.assignedBy ? `Tilldelad av ${item.assignedBy}` : item.dueDate ? `${item.deadline === "OVERDUE" ? "Förfallen" : "Klart senast"} ${item.dueDate}` : undefined)} />)
        : <ListRow title="Inga notiser just nu" chevron={false} />}
      {(notifications.length > items.length) ? <ListRow title="Visa alla notiser" href="/?view=notifications" value={bell ? String(bell) : undefined} testId="native-notice-all" /> : null}
    </ListGroup></div> : null}
    <WorkProfileChangeLink className="px-1 pt-3" />
  </NativePage>;
}
