"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock, ClipboardList, Link2, Play, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { Panel } from "@/features/kfid/ui";
import { usePicked, useSubPageHref } from "@/features/kfid/use-return-to";
import { swedishClock, swedishDayKey } from "@/lib/swedish-time";
import { newLinkedTaskHref, workflowTaskHref, type LinkedTaskRow } from "@/lib/workflow/work-order-link";
import { roundOrderSummary, type RoundOrderSummary } from "@/lib/workflow/round-work-orders";
import type { RoundsBackend } from "./form-rounds";
import { formatDurationSeconds } from "@/lib/workflow/duration";
import { cn } from "@/lib/utils";
import { indicatorBadge, indicatorBar } from "./indicator-tone";
import { taskKindLabel, taskListItem } from "./work-list-items";
import { useConfirm } from "@/features/kfid/confirm";
import { announce } from "@/lib/workflow/toast";
import { notDoneLine } from "@/lib/workflow/round-outcome";
import { RoundNotDoneDialog } from "./round-not-done-dialog";

/**
 * Uppgifter (2026-10-26, Arbetsordern styr; was Kopplade uppgifter, Fas 2 2026-10-08): on a work order, the protocols,
 * controls and risk assessments in it, with status and progress as in the lists, and "Lägg till uppgift" as the way in –
 * Ny uppgift with the order, its project, customer and place filled in. Their time is recorded on this order. A work order
 * that holds a round for a period (2026-10-27, punkt 3) says which round and period, starts the next occurrence
 * here ("Starta ronden") and lists the occurrences in the period that are late; each occurrence's protocol is a row with its
 * day and the time reported from it.
 * Samband (2026-10-26): Ny uppgift carries the way back (returnTo); the new task's "Tillbaka till arbetsordern"
 * comes back here with the task marked (pickTask), and its row is shown as just added.
 */
export function LinkedTasksPanel({ workOrder, local, localRounds, canCreate = true, refreshKey }: {
  workOrder: { id: string; title?: string; status: string; projectId: string | null; customerId: string | null; facilityId?: string | null; roundScheduleId?: string | null; roundOccurrence?: string | null; plannedStartDate?: string; dueDate?: string };
  /** Local: the file's tasks in the order; Cloud and the demo read them from the server. */
  local?: LinkedTaskRow[];
  /** Local: the file's rounds, so the round the order holds is worked out from the file (Cloud and the demo ask the server). */
  localRounds?: RoundsBackend;
  canCreate?: boolean;
  /** Read again when the order changes (its version). */
  refreshKey?: number;
}) {
  const [fetched, setFetched] = useState<{ tasks: LinkedTaskRow[]; hasMore: boolean } | null>(null);
  const [failed, setFailed] = useState("");
  const subPage = useSubPageHref();
  const [added, setAdded] = useState<string | null>(null);
  usePicked("Task", (id) => { setAdded(id); });
  const addedRow = useRef<HTMLLIElement | null>(null);
  useEffect(() => { if (added && addedRow.current) addedRow.current.scrollIntoView({ block: "center" }); }, [added, fetched]);
  useEffect(() => {
    if (local) return;
    let active = true;
    api<{ tasks: LinkedTaskRow[]; hasMore: boolean }>(`/api/workflow-tasks/work-order-links?linked=${encodeURIComponent(workOrder.id)}`)
      .then((result) => { if (active) { setFetched(result); setFailed(""); } })
      .catch((issue) => { if (active) setFailed((issue as Error).message); });
    return () => { active = false; };
  }, [local, workOrder.id, refreshKey, added]);
  // Driftrond i arbetsordern (punkt 3): the round the order holds, its period, Starta ronden and the late occurrences (the
  // server builds the links; Local works them out from the file).
  const holdsRound = Boolean(workOrder.roundScheduleId);
  const [fetchedRound, setFetchedRound] = useState<RoundOrderSummary | null>(null);
  // Ej utfört (2026-10-28, etapp 5): Cloud says it offers it; Local and the demo do not.
  const [canMarkNotDone, setCanMarkNotDone] = useState(false);
  const [notDoneFor, setNotDoneFor] = useState<string | null>(null);
  const [roundRevision, setRoundRevision] = useState(0);
  const [confirm, confirmCard] = useConfirm();
  const [roundError, setRoundError] = useState("");
  const localStarted = (local ?? []).flatMap((task) => task.occurrence && task.status !== "CANCELLED" ? [task.occurrence] : []).sort().join(",");
  useEffect(() => {
    if (!holdsRound || (local && !localRounds)) return;
    let active = true;
    const read = local && localRounds
      ? localRounds.load().then((data) => roundOrderSummary(workOrder, data.schedules.find((item) => item.id === workOrder.roundScheduleId) ?? null, new Set(localStarted ? localStarted.split(",") : []), data.today, swedishClock()))
      : api<{ round: RoundOrderSummary | null; canMarkNotDone?: boolean }>(`/api/form-schedules?roundOrder=${encodeURIComponent(workOrder.id)}`).then((result) => { if (active) setCanMarkNotDone(Boolean(result.canMarkNotDone)); return result.round; });
    read.then((result) => { if (active) setFetchedRound(result); }).catch(() => { if (active) setFetchedRound(null); });
    return () => { active = false; };
  }, [holdsRound, Boolean(local), localRounds, localStarted, workOrder.id, workOrder.status, workOrder.plannedStartDate, workOrder.dueDate, refreshKey, added, roundRevision]); // eslint-disable-line react-hooks/exhaustive-deps
  const round = fetchedRound;
  const tasks = local ?? fetched?.tasks ?? [];
  const completed = workOrder.status === "COMPLETED";
  const today = swedishDayKey(new Date());
  const startShown = Boolean(round?.href && !completed);
  const markable = Boolean(canMarkNotDone && round?.round && !local && !completed && workOrder.status !== "CANCELLED");
  const revoke = async (id: string) => {
    if (!(await confirm({ title: "Ångra Ej utfört?", message: "Tillfället blir öppet igen. Markeringen finns kvar i historiken som ångrad.", confirmLabel: "Ångra" }))) return;
    try { await api("/api/form-schedules", { method: "POST", body: JSON.stringify({ action: "revoke_not_done", id }) }); setRoundError(""); setRoundRevision((value) => value + 1); announce("Ej utfört är ångrat"); }
    catch (issue) { setRoundError((issue as Error).message); }
  };
  const addButton = <Button asChild variant={startShown ? "outline" : "default"}><Link href={subPage(newLinkedTaskHref(workOrder))} data-testid="linked-task-new"><Plus />Lägg till uppgift</Link></Button>;
  return <Panel icon={ClipboardList} title={holdsRound ? "Rondtillfällen och uppgifter" : "Uppgifter"} description={holdsRound ? "Varje rondtillfälle registreras här med sitt protokoll och sin tid. Tiden räknas på arbetsordern." : "Protokoll, kontroller och riskbedömningar i arbetsordern. Tiden räknas på arbetsordern."}
    actions={canCreate ? completed
      ? <span className="text-xs text-muted-foreground" data-testid="linked-tasks-closed">Återöppna arbetsordern för att lägga till uppgifter.</span>
      : <>
        {round?.href ? <Button asChild><Link href={round.href} data-testid="round-order-start"><Play />Starta ronden{round.occurrence ? ` ${round.occurrence}${round.round?.time ? ` kl. ${round.round.time}` : ""}` : ""}</Link></Button>
          : round?.notice ? <span className="text-xs text-muted-foreground" data-testid="round-order-notice">{round.notice}</span> : null}
        {addButton}
      </> : undefined}>
    {confirmCard}
    <RoundNotDoneDialog target={notDoneFor && round?.round ? { title: round.round.title, date: notDoneFor } : null} onClose={() => setNotDoneFor(null)}
      onConfirm={async (reason) => {
        if (!notDoneFor || !round?.round) return null;
        try { await api("/api/form-schedules", { method: "POST", body: JSON.stringify({ action: "mark_not_done", scheduleId: round.round.id, occurrence: notDoneFor, reason }) }); setRoundRevision((value) => value + 1); announce("Tillfället är markerat Ej utfört"); return null; }
        catch (issue) { return (issue as Error).message; }
      }} />
    <div data-testid="linked-tasks">
      {round?.round ? <div className="mb-3 space-y-1.5 rounded-lg border bg-muted/40 px-3 py-2 text-sm" data-testid="round-order-summary">
        <p className="flex flex-wrap items-center gap-x-2"><CalendarClock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-semibold">Driftrond: {round.round.title}</span>
          <span className="text-xs text-muted-foreground">{round.round.ruleText}{round.period ? ` · Period ${round.period.from === round.period.to ? round.period.from : `${round.period.from}–${round.period.to}`}` : ""}</span></p>
        {round.late.length ? <p className="text-xs" data-testid="round-order-late"><span className="font-medium text-destructive">Förfallna tillfällen:</span>{" "}
          {round.late.map((item, index) => <span key={item.date}>{index ? ", " : ""}{item.href ? <Link href={item.href} className="underline underline-offset-4">{item.date}</Link> : item.date}
            {/* Ej utfört (2026-10-28): the late occurrence will not be done – a required reason, no protocol. */}
            {markable ? <> (<button type="button" className="underline underline-offset-4 text-muted-foreground hover:text-foreground" onClick={() => setNotDoneFor(item.date)} data-testid="round-order-not-done" aria-label={`Markera ${item.date} Ej utfört`}>Ej utfört</button>)</> : null}</span>)}</p> : null}
        {round.notDone?.length ? <ul className="space-y-0.5 text-xs text-muted-foreground" data-testid="round-order-not-done-history">
          {round.notDone.slice(0, 10).map((item) => <li key={item.id} className="break-words"><span className="font-medium text-foreground">{item.occurrence}</span> · {notDoneLine(item)}
            {markable ? <> · <button type="button" className="underline underline-offset-4 hover:text-foreground" onClick={() => void revoke(item.id)} data-testid="round-order-not-done-revoke">Ångra</button></> : null}</li>)}
        </ul> : null}
        {roundError ? <p role="alert" className="text-xs text-destructive">{roundError}</p> : null}
      </div> : null}
      {failed ? <p className="text-sm text-destructive" role="alert">{failed}</p>
        : !local && !fetched ? <p className="text-sm text-muted-foreground">Hämtar uppgifter…</p>
        : !tasks.length ? <p className="text-sm text-muted-foreground" data-testid="linked-tasks-empty">{completed ? "Arbetsordern har inga uppgifter." : holdsRound ? "Starta ronden, eller lägg till första uppgiften." : "Lägg till första uppgiften."}</p>
        : <ul className="-mx-4 divide-y border-y">{tasks.map((task) => {
          const item = taskListItem({ ...task, updatedAt: "" }, today);
          const fresh = task.id === added;
          return <li key={task.id} ref={fresh ? addedRow : undefined} data-testid="linked-task" data-just-added={fresh ? "" : undefined} className={cn("grid gap-2 px-5 py-2.5 sm:grid-cols-[minmax(0,1fr)_8rem_8rem] sm:items-center", fresh && "bg-secondary")}>
            <div className="min-w-0">
              <Link href={workflowTaskHref(task)} className="flex items-center gap-1.5 truncate text-sm font-semibold hover:underline"><Link2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />{task.title}</Link>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{fresh ? <span className="font-semibold text-primary">Nyss tillagd · </span> : null}{task.occurrence ? <span data-testid="linked-task-occurrence">Rondtillfälle {task.occurrence} · </span> : null}{taskKindLabel(task.kind)}{task.assignedToName ? ` · ${task.assignedToName}` : ""}{item.date ? ` · ${item.date.label} ${item.date.value}` : ""}{task.durationSec ? <span data-testid="linked-task-time"> · Tid {formatDurationSeconds(task.durationSec)}</span> : null}</p>
            </div>
            <Badge variant="outline" className={cn("w-fit", indicatorBadge(item.status.tone))}>{item.status.label}</Badge>
            <div className="text-xs"><span className="font-semibold tabular-nums">{item.progress.percent}%</span>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", indicatorBar(item.progress.tone))} style={{ width: `${item.progress.percent}%` }} /></div></div>
          </li>;
        })}</ul>}
      {fetched?.hasMore ? <p className="mt-2 text-xs text-muted-foreground">Visar de 100 senast ändrade.</p> : null}
    </div>
  </Panel>;
}
