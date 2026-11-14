"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { AlertTriangle, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeTimerCard } from "@/components/native/timer-card";
import { Tile } from "@/components/native/tile";
import { useRegisterRunningTimers, useRunningTimers, type RunningTimerSource } from "@/components/workspace-actions";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { Modal } from "@/features/kfid/ui";
import { cn } from "@/lib/utils";
import { announce } from "@/lib/workflow/toast";
import { invalidateWorkspaceCache } from "@/lib/workflow/workspace-cache";
import { formatTimerClock, formatTimerDuration, homeTimeTileHref, runningTimerPlace, runningTimerTaskHref, timerElapsedSeconds, timerNeedsAttention, type RunningTimer, type StoppedTimer } from "@/lib/workflow/running-timer";
import { IconButton } from "@/components/ui/icon-button";

/**
 * Visible time tracking (2026-09-26, decisions 6 and 17). A running timer is always shown in the top bar with a
 * ticking clock, the task and project, and a pause button; a timer that has run long changes its marker, and stopping a
 * long entry offers to adjust it. Cloud reads the caller's own running entries from the server; Local registers the
 * open file's entries. Start/stop anywhere is announced so every open tab updates at once.
 */
const CHANNEL = "hwf-timer";
const CHANGE_EVENT = "hwf-timer-change";
/** Tidrapport opens this entry for editing when it is set (the "Justera" action). */
export const ADJUST_TIME_ENTRY_KEY = "hwf-adjust-time-entry";

type ChangeDetail = { stopped?: StoppedTimer[] };

/** Call after a start, pause or completion: updates the top bar in this and other tabs and warns about long entries. */
export function announceTimerChange(stopped: StoppedTimer[] = []) {
  // PL7: Månadens tid shows finished time, so a timer stopped anywhere (the top bar, a job) reads it again.
  invalidateWorkspaceCache("/api/time-periods");
  window.dispatchEvent(new CustomEvent<ChangeDetail>(CHANGE_EVENT, { detail: { stopped } }));
  try { const channel = new BroadcastChannel(CHANNEL); channel.postMessage("change"); channel.close(); } catch { /* BroadcastChannel is optional */ }
}

function useTimerChanges(onChange: (detail: ChangeDetail) => void) {
  const latest = useRef(onChange);
  useEffect(() => { latest.current = onChange; });
  useEffect(() => {
    const local = (event: Event) => latest.current((event as CustomEvent<ChangeDetail>).detail ?? {});
    window.addEventListener(CHANGE_EVENT, local);
    let channel: BroadcastChannel | null = null;
    try { channel = new BroadcastChannel(CHANNEL); channel.onmessage = () => latest.current({}); } catch { channel = null; }
    return () => { window.removeEventListener(CHANGE_EVENT, local); channel?.close(); };
  }, []);
}

/** Cloud: the caller's own running timers from the server, refreshed on changes, focus and every minute. */
export function useCloudRunningTimers(enabled: boolean) {
  const [state, setState] = useState<{ timers: RunningTimer[]; clockOffsetMs: number } | null>(null);
  const [changes, setChanges] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let controller: AbortController | undefined;
    const load = () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      void api<{ now: string; running: RunningTimer[] }>("/api/workflow-time?running=mine", { signal, cache: "no-store" })
        .then((result) => { if (!signal.aborted) setState({ timers: result.running, clockOffsetMs: Date.parse(result.now) - Date.now() }); })
        .catch(() => { /* The indicator is a convenience; the editor and Tidrapport still show the truth. */ });
    };
    load();
    const interval = window.setInterval(load, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => { controller?.abort(); window.clearInterval(interval); window.removeEventListener("focus", onVisible); document.removeEventListener("visibilitychange", onVisible); };
  }, [enabled, changes]);
  useTimerChanges(() => setChanges((value) => value + 1));
  const pause = useCallback(async (timer: RunningTimer, options?: { keepShort?: boolean }) => {
    // Project time stops through Tid (Arbetsordern styr, 2026-10-26); a work order's through its job.
    const result = timer.kind === "PROJECT"
      ? await api<{ stopped?: StoppedTimer[] }>("/api/workflow-time", { method: "POST", body: JSON.stringify({ action: "project_timer", projectId: timer.taskId, command: "PAUSE", keepShort: Boolean(options?.keepShort) }) })
      : await api<{ stopped?: StoppedTimer[] }>("/api/workflow-tasks", { method: "POST", body: JSON.stringify({ action: "timer", id: timer.taskId, command: "PAUSE", keepShort: Boolean(options?.keepShort) }) });
    return result.stopped ?? [];
  }, []);
  const source = useMemo<RunningTimerSource | undefined>(() => enabled && state ? { ...state, pause } : undefined, [enabled, pause, state]);
  useRegisterRunningTimers(source);
}

/** Local: the open file's running timers for the file owner. */
export function useLocalRunningTimers(timers: RunningTimer[] | null, pause: RunningTimerSource["pause"]) {
  const latestPause = useRef(pause);
  useEffect(() => { latestPause.current = pause; });
  const stablePause = useCallback<RunningTimerSource["pause"]>((timer, options) => latestPause.current(timer, options), []);
  const key = timers ? JSON.stringify(timers) : null;
  const source = useMemo<RunningTimerSource | undefined>(() => key === null ? undefined : { timers: JSON.parse(key) as RunningTimer[], clockOffsetMs: 0, pause: stablePause }, [key, stablePause]);
  useRegisterRunningTimers(source);
}

/** A clock that ticks every second while `active` (the server's clock offset applied); shared with Översiktens Tid card. */
export function useNow(active: boolean, offsetMs: number) {
  const [now, setNow] = useState(() => new Date(Date.now() + offsetMs));
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(new Date(Date.now() + offsetMs));
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [active, offsetMs]);
  return now;
}

const taskHref = runningTimerTaskHref;

/**
 * The top bar pill. Renders nothing when no timer is running. Only the clock and the time (2026-10-22, stabil
 * sidladdning beslut 2): the task's name is in the tooltip, the label and the menu, so the pill never changes width with
 * it. `fixed` fills the top bar's reserved place on a computer (AppShell), so the clock's digits never move anything either.
 */
export function RunningTimerIndicator({ fixed = false }: { fixed?: boolean } = {}) {
  const source = useRunningTimers();
  const timers = source?.timers ?? [];
  const now = useNow(timers.length > 0, source?.clockOffsetMs ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { allowStop, element: shortStopCard } = useShortStopGuard();
  const current = timers[0];
  const elapsed = current ? timerElapsedSeconds(current.startedAt, now) : 0;
  const attention = current ? timerNeedsAttention(current.startedAt, now) : false;
  const clock = formatTimerClock(elapsed);
  const named = current ? `${current.taskTitle}${current.projectName ? `, ${current.projectName}` : ""}` : "";
  const minuteLabel = current ? `Tidtagning pågår på ${named}: ${formatTimerDuration(Math.floor(elapsed / 60) * 60)}${attention ? ". Har pågått länge." : ""}` : "";

  // The browser tab shows the running time, so it is visible from another window too.
  const baseTitle = useRef<string | null>(null);
  useEffect(() => {
    if (!current) {
      if (baseTitle.current !== null) { document.title = baseTitle.current; baseTitle.current = null; }
      return;
    }
    if (baseTitle.current === null) baseTitle.current = document.title.replace(/^[●▲] [\d:]+ – /, "");
    document.title = `${attention ? "▲" : "●"} ${clock} – ${baseTitle.current}`;
  }, [attention, clock, current]);
  useEffect(() => () => { if (baseTitle.current !== null) document.title = baseTitle.current; }, []);

  if (!source || !current) return null;
  async function pause() {
    if (!source || !current) return;
    // Under a minute the same question as everywhere else: Spara ändå, Släng or Fortsätt tiden (2026-10-12).
    const choice = await allowStop(current.startedAt, source.clockOffsetMs);
    if (!choice) return;
    setBusy(true); setError("");
    try { announceTimerChange(await source.pause(current, choice)); announce(stopMessage(choice)); }
    catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  }
  return <><DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button type="button" data-testid="running-timer" data-attention={attention || undefined} aria-label={minuteLabel} title={named}
        className={cn("running-timer inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          fixed && "lg:w-full lg:justify-center lg:gap-1.5 lg:overflow-hidden lg:px-2.5",
          attention ? "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100" : "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100")}>
        {attention ? <AlertTriangle className="size-4 shrink-0" aria-hidden="true" /> : <span aria-hidden="true" className="running-timer-dot size-2.5 shrink-0 rounded-full bg-emerald-500" />}
        <span aria-hidden="true">{clock}</span>
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-80 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-3 text-popover-foreground shadow-md">
        <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><span aria-hidden="true" className="running-timer-dot size-2.5 shrink-0 rounded-full bg-emerald-500" />Tiden går</p>
        <p className="mt-1 line-clamp-2 text-sm font-medium [overflow-wrap:anywhere]">{current.taskTitle}</p>
        <p className="mt-1 text-4xl font-semibold tabular-nums leading-tight">{clock}</p>
        <p className="truncate text-xs text-muted-foreground" data-testid="running-timer-place">{runningTimerPlace(current)}</p>
        {attention ? <p role="status" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">Tidtagningen har pågått länge. Stämmer det? Stoppa och justera tiden om den glömts igång.</p> : null}
        {timers.length > 1 ? <p className="mt-2 text-xs text-muted-foreground">Ytterligare {timers.length - 1} tidtagning pågår.</p> : null}
        {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
        <div className="mt-3 flex justify-end gap-2">
          <Button asChild size="sm" variant="outline"><DropdownMenu.Item asChild><Link href={taskHref(current)}>{current.kind === "PROJECT" ? "Öppna projekt" : "Öppna arbetsorder"}</Link></DropdownMenu.Item></Button>
          <Button size="sm" disabled={busy} onClick={() => void pause()}><Square />Stoppa</Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Stoppa sparar tiden. Starta igen från arbetsordern eller projektet.</p>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>{shortStopCard}</>;
}

/**
 * Tid on Hem in the app (UX-granskningen avsnitt 6, punkt 7): while a timer runs the tile shows its clock – the same source
 * and the same clock as the top bar's pill – and a Stoppa button, never "0 min i dag". The tile keeps its size as the time
 * goes (the grid gives the width, the clock has tabular figures and a fixed width, the line is cut rather than wrapped).
 * Stoppa asks the same question as everywhere under a minute and saves the entry. A tap on the tile opens the job the time
 * runs on (svar 3, 2026-10-24). Without a timer: `idle` (today's total) and `href` (Tid).
 */
export function NativeHomeTimeTile({ title, idle, href }: { title: string; idle: string; href: string }) {
  const source = useRunningTimers();
  const current = source?.timers[0] ?? null;
  const now = useNow(Boolean(current), source?.clockOffsetMs ?? 0);
  const [busy, setBusy] = useState(false);
  const { allowStop, element: shortStopCard } = useShortStopGuard();
  if (!source || !current) return <Tile type="time" title={title} subtitle={idle} href={href} testId="native-tile-time" />;
  const clock = formatTimerClock(timerElapsedSeconds(current.startedAt, now));
  async function stop() {
    if (!source || !current) return;
    const choice = await allowStop(current.startedAt, source.clockOffsetMs);
    if (!choice) return;
    setBusy(true);
    try { announceTimerChange(await source.pause(current, choice)); announce(stopMessage(choice)); }
    catch (issue) { announce((issue as Error).message, true); }
    finally { setBusy(false); }
  }
  // Svar 3 (2026-10-24): while a time runs, a tap opens the job it runs on; Stoppa stays its own button.
  return <><Tile type="time" title={title} href={homeTimeTileHref(current, href)} testId="native-tile-time"
    subtitle={<span className="inline-flex items-center gap-1.5" data-testid="home-time-running" title={current.taskTitle}>
      <span aria-hidden="true" className="running-timer-dot size-2 shrink-0 rounded-full bg-emerald-500" />
      <span className="inline-block min-w-[7ch] font-semibold tabular-nums text-foreground" aria-label={`Tiden går: ${clock}`}>{clock}</span>
    </span>}
    accessory={<IconButton label={`Stoppa tiden på ${current.taskTitle}`} title="Stoppa och spara tiden" variant="outline" className="size-11 rounded-full" disabled={busy} onClick={() => void stop()} data-testid="home-time-stop"><Square /></IconButton>} />{shortStopCard}</>;
}

/** Shown once, wherever a long entry was stopped: confirm it, or adjust it in Tidrapport. */
export function LongTimerWarning() {
  const router = useRouter();
  const [entry, setEntry] = useState<StoppedTimer | null>(null);
  useTimerChanges((detail) => {
    const long = (detail.stopped ?? []).find((stopped) => timerNeedsAttention(stopped.startedAt, stopped.endedAt));
    if (long) setEntry(long);
  });
  const adjust = () => {
    if (!entry) return;
    try { window.sessionStorage.setItem(ADJUST_TIME_ENTRY_KEY, entry.entryId); } catch { /* The time report still opens filtered on the task. */ }
    setEntry(null);
    router.push(entry.projectId ? `/?view=time&timeProjectId=${encodeURIComponent(entry.projectId)}` : `/?view=time&timeTaskId=${encodeURIComponent(entry.taskId)}`);
  };
  return <Modal open={Boolean(entry)} onOpenChange={(open) => { if (!open) setEntry(null); }} title="Tidtagningen pågick länge" size="compact" className="max-w-lg">
    {entry ? <div className="space-y-4" data-testid="long-timer-warning">
      <p className="text-sm">Tidtagningen på <strong>{entry.taskTitle}</strong> pågick i <strong>{formatTimerDuration(entry.durationSec)}</strong>, från {new Date(entry.startedAt).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", dateStyle: "short", timeStyle: "short" })} till {new Date(entry.endedAt).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", dateStyle: "short", timeStyle: "short" })}. Stämmer det?</p>
      <p className="text-xs text-muted-foreground">Tiden är sparad. Justera den om klockan glömdes igång.</p>
      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setEntry(null)}>Stämmer</Button><Button onClick={adjust}>Justera tiden</Button></div>
    </div> : null}
  </Modal>;
}

/**
 * What a stop may do (2026-10-12): `false` keeps the timer running; otherwise the stop goes on and `keepShort` says whether
 * an entry under a minute is saved ("Spara ändå") or discarded by the server's minute rule ("Släng" – no entry, no new
 * data model). `short` says the question was asked, so the message after can say what happened.
 */
export type StopChoice = { keepShort: boolean; short: boolean } | false;

/** The toast after a stop: an entry saved, or a short one thrown away. */
export function stopMessage(choice: Exclude<StopChoice, false>) {
  return choice.short && !choice.keepShort ? "Tiden slängdes. Ingen tidpost sparades." : "Tiden stoppad och sparad";
}

/**
 * Stop right after Start (2026-10-12): a timer under a minute would otherwise be saved as a "1 min" entry, so the person is
 * asked first – Spara ändå, Släng (no entry) or Fortsätt tiden. `allowStop(startedAt)` resolves the StopChoice; render
 * `element` once.
 */
export function useShortStopGuard() {
  const [confirm, element] = useConfirm();
  const allowStop = useCallback(async (startedAt: string, offsetMs = 0, switchFrom?: { from: string; to: string }): Promise<StopChoice> => {
    if (timerElapsedSeconds(startedAt, new Date(Date.now() + offsetMs)) >= 60) return { keepShort: false, short: false };
    // Before a switch to another job the question names both jobs: the person may not know the time runs elsewhere.
    const answer = await confirm(switchFrom
      ? { title: "Tiden går på ett annat jobb", message: `Tiden har gått i några sekunder på ${switchFrom.from}. Spara den som en post på en minut eller släng den, och starta på ${switchFrom.to}?`, confirmLabel: "Spara och byt", cancelLabel: "Avbryt", alternative: { label: "Släng och byt" } }
      : { title: "Under en minut", message: "Tiden har bara gått i några sekunder. Spara som en minut, släng, eller låt den fortsätta?", confirmLabel: "Spara ändå", cancelLabel: "Fortsätt tiden", alternative: { label: "Släng" } });
    if (answer === "alternative") return { keepShort: false, short: true };
    return answer ? { keepShort: true, short: true } : false;
  }, [confirm]);
  return { allowStop, element };
}

/**
 * Start time on a job while the time runs on another (2026-10-12, "rätta allt" 1): never stop the other job's
 * time silently. The person is asked "Tiden går på <A>. Stoppa den och starta på <B>?" (Stoppa och byt / Avbryt); under a
 * minute the Stoppa question naming both jobs (Spara och byt / Släng och byt / Avbryt). `allowStart(target)` resolves the StopChoice
 * for the server's own switch (`keepShort` goes with the START command). Render `element` once.
 */
export function useStartTimerGuard() {
  const source = useRunningTimers();
  const [confirm, switchCard] = useConfirm();
  const { allowStop, element: shortStopCard } = useShortStopGuard();
  const allowStart = useCallback(async (target: { taskId: string; title: string }): Promise<StopChoice> => {
    const other = source?.timers.find((timer) => timer.taskId !== target.taskId) ?? null;
    if (!other) return { keepShort: false, short: false };
    const offset = source?.clockOffsetMs ?? 0;
    if (timerElapsedSeconds(other.startedAt, new Date(Date.now() + offset)) < 60) return allowStop(other.startedAt, offset, { from: other.taskTitle, to: target.title || "det här jobbet" });
    const ok = await confirm({ title: "Tiden går på ett annat jobb", message: `Tiden går på ${other.taskTitle}. Stoppa den och starta på ${target.title || "det här jobbet"}?`, confirmLabel: "Stoppa och byt", cancelLabel: "Avbryt" });
    return ok ? { keepShort: false, short: false } : false;
  }, [allowStop, confirm, source]);
  return { allowStart, element: <>{switchCard}{shortStopCard}</> };
}

/**
 * The running timer of one job as the shared timer card (2026-10-12): the job's own Tid screen at level 1 looks
 * like the timer in the Tid list and the top bar's pill. The clock comes from the registered running timers; the stop
 * button is the job's own (it stops and saves the entry). "Spara ändå" under a minute stops through the registered source
 * with `keepShort` first, since the job's own stop does not carry the answer; the job's stop then only reloads.
 */
export function NativeJobTimerCard({ taskId, title, busy, onStop, stopTestId }: { taskId: string; title: string; busy: boolean; onStop: () => void; stopTestId?: string }) {
  const source = useRunningTimers();
  const running = source?.timers.find((timer) => timer.taskId === taskId) ?? null;
  const now = useNow(Boolean(running), source?.clockOffsetMs ?? 0);
  const { allowStop, element } = useShortStopGuard();
  const stop = async () => {
    const choice = running ? await allowStop(running.startedAt, source?.clockOffsetMs ?? 0) : { keepShort: false, short: false };
    if (!choice) return;
    if (choice.keepShort && running && source) {
      try { announceTimerChange(await source.pause(running, { keepShort: true })); } catch (issue) { announce((issue as Error).message, true); return; }
    } else if (choice.short) announce(stopMessage(choice));
    onStop();
  };
  return <><NativeTimerCard clock={running ? formatTimerClock(timerElapsedSeconds(running.startedAt, now)) : "--:--:--"} title={title} busy={busy} onStop={() => void stop()} testId="native-job-timer-card" stopTestId={stopTestId} />{element}</>;
}
