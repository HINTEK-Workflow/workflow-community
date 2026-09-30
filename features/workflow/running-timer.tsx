"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { AlertTriangle, Pause, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRegisterRunningTimers, useRunningTimers, type RunningTimerSource } from "@/components/workspace-actions";
import { api } from "@/features/kfid/api";
import { Modal } from "@/features/kfid/ui";
import { cn } from "@/lib/utils";
import { formatTimerClock, formatTimerDuration, timerElapsedSeconds, timerNeedsAttention, type RunningTimer, type StoppedTimer } from "@/lib/workflow/running-timer";

/**
 * Visible time tracking (Daniel 2026-09-26, decisions 6 and 17). A running timer is always shown in the top bar with a
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
  const pause = useCallback(async (timer: RunningTimer) => {
    const result = timer.kind === "KFID"
      ? await api<{ stopped?: StoppedTimer[] }>("/api/workflow-time", { method: "POST", body: JSON.stringify({ action: "control_timer", id: timer.taskId, command: "PAUSE" }) })
      : await api<{ stopped?: StoppedTimer[] }>("/api/workflow-tasks", { method: "POST", body: JSON.stringify({ action: "timer", id: timer.taskId, command: "PAUSE" }) });
    return result.stopped ?? [];
  }, []);
  const source = useMemo<RunningTimerSource | undefined>(() => enabled && state ? { ...state, pause } : undefined, [enabled, pause, state]);
  useRegisterRunningTimers(source);
}

/** Local: the open file's running timers for the file owner. */
export function useLocalRunningTimers(timers: RunningTimer[] | null, pause: (timer: RunningTimer) => Promise<StoppedTimer[]>) {
  const latestPause = useRef(pause);
  useEffect(() => { latestPause.current = pause; });
  const stablePause = useCallback((timer: RunningTimer) => latestPause.current(timer), []);
  const key = timers ? JSON.stringify(timers) : null;
  const source = useMemo<RunningTimerSource | undefined>(() => key === null ? undefined : { timers: JSON.parse(key) as RunningTimer[], clockOffsetMs: 0, pause: stablePause }, [key, stablePause]);
  useRegisterRunningTimers(source);
}

function useNow(active: boolean, offsetMs: number) {
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

const taskHref = (timer: Pick<RunningTimer, "taskId" | "kind">) => timer.kind === "KFID" ? `/?view=new&id=${encodeURIComponent(timer.taskId)}` : `/?view=workflow_task&taskId=${encodeURIComponent(timer.taskId)}&taskType=${timer.kind}`;
const kindLabel: Record<RunningTimer["kind"], string> = { WORK_ORDER: "Arbetsorder", RISK_ASSESSMENT: "Riskbedömning", FORM: "Formulär", KFID: "Kontroll före idrifttagning" };

/** The top bar pill. Renders nothing when no timer is running. */
export function RunningTimerIndicator() {
  const source = useRunningTimers();
  const timers = source?.timers ?? [];
  const now = useNow(timers.length > 0, source?.clockOffsetMs ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = timers[0];
  const elapsed = current ? timerElapsedSeconds(current.startedAt, now) : 0;
  const attention = current ? timerNeedsAttention(current.startedAt, now) : false;
  const clock = formatTimerClock(elapsed);
  const minuteLabel = current ? `Tidtagning pågår på ${current.taskTitle}${current.projectName ? `, ${current.projectName}` : ""}: ${formatTimerDuration(Math.floor(elapsed / 60) * 60)}${attention ? ". Har pågått länge." : ""}` : "";

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
    setBusy(true); setError("");
    try { announceTimerChange(await source.pause(current)); }
    catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  }
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button type="button" data-testid="running-timer" data-attention={attention || undefined} aria-label={minuteLabel}
        className={cn("running-timer inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          attention ? "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100" : "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100")}>
        {attention ? <AlertTriangle className="size-4 shrink-0" aria-hidden="true" /> : <span aria-hidden="true" className="running-timer-dot size-2.5 shrink-0 rounded-full bg-emerald-500" />}
        <span aria-hidden="true">{clock}</span>
        <span aria-hidden="true" className="hidden max-w-40 truncate font-normal xl:inline">{current.taskTitle}</span>
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-80 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-3 text-popover-foreground shadow-md">
        <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Timer className="size-4" />Tidtagning pågår</p>
        <p className="mt-2 text-2xl font-semibold tabular-nums">{clock}</p>
        <p className="mt-1 truncate text-sm font-medium">{current.taskTitle}</p>
        <p className="truncate text-xs text-muted-foreground">{kindLabel[current.kind]} · {current.projectName ? `Projekt: ${current.projectName}` : "Fristående uppgift"}</p>
        {attention ? <p role="status" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">Tidtagningen har pågått länge. Stämmer det? Pausa och justera tiden om den glömts igång.</p> : null}
        {timers.length > 1 ? <p className="mt-2 text-xs text-muted-foreground">Ytterligare {timers.length - 1} tidtagning pågår.</p> : null}
        {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
        <div className="mt-3 flex justify-end gap-2">
          <Button asChild size="sm" variant="outline"><DropdownMenu.Item asChild><Link href={taskHref(current)}>Öppna uppgift</Link></DropdownMenu.Item></Button>
          <Button size="sm" disabled={busy} onClick={() => void pause()}><Pause />Pausa</Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Pausa stoppar och sparar tiden. Starta igen från uppgiften.</p>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
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
    router.push(`/?view=time&timeTaskId=${encodeURIComponent(entry.taskId)}`);
  };
  return <Modal open={Boolean(entry)} onOpenChange={(open) => { if (!open) setEntry(null); }} title="Tidtagningen pågick länge" className="max-w-lg">
    {entry ? <div className="space-y-4" data-testid="long-timer-warning">
      <p className="text-sm">Tidtagningen på <strong>{entry.taskTitle}</strong> pågick i <strong>{formatTimerDuration(entry.durationSec)}</strong>, från {new Date(entry.startedAt).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", dateStyle: "short", timeStyle: "short" })} till {new Date(entry.endedAt).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", dateStyle: "short", timeStyle: "short" })}. Stämmer det?</p>
      <p className="text-xs text-muted-foreground">Tiden är sparad. Justera den om tidtagningen glömdes igång; ändringen sparas i tidpostens historik.</p>
      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setEntry(null)}>Stämmer</Button><Button onClick={adjust}>Justera tiden</Button></div>
    </div> : null}
  </Modal>;
}
