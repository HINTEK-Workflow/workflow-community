"use client";

import { useState } from "react";
import { CheckCircle2, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DialogActions, Modal } from "@/features/kfid/ui";
import { formatTimerDuration } from "@/lib/workflow/running-timer";
import { fromSwedishDateTimeInput, NONEXISTENT_TIME_ERROR, swedishParts } from "@/lib/swedish-time";
import { api } from "@/features/kfid/api";
import { useTaskBookings } from "./task-bookings";

export type CompletionTime = { startedAt: string; endedAt: string; note: string };

const pad = (value: number) => String(value).padStart(2, "0");
/** Today in Swedish time and the last full quarter hour, as the fields' starting values. */
function defaults() {
  const now = swedishParts(new Date());
  const end = Math.floor((now.hour * 60 + now.minute) / 15) * 15;
  const start = Math.max(0, end - 60);
  return { date: `${now.year}-${pad(now.month)}-${pad(now.day)}`, from: `${pad(Math.floor(start / 60))}:${pad(start % 60)}`, to: `${pad(Math.floor(end / 60))}:${pad(end % 60)}` };
}

/**
 * Completing a task asks "Vill du skriva tid?" in the same step (2026-09-30, the guided flow): a completed task
 * cannot take time from an ordinary member afterwards, so the question comes before the task is locked, with the time
 * reported so far. Writing time is chosen from the start when nothing is reported yet; a running timer is stopped by
 * the completion itself. Nothing is saved until the person confirms. A task in a work order has no time of its own: the
 * running time is the work order's and goes on until it is stopped there (användartest 2026-10-31, fel 2; the same as the
 * flow tip in lib/workflow/flow-advisor.ts), so the line says so instead of promising a stop.
 */
export function CompleteTaskDialog({ open, onOpenChange, title, lockText, totalDurationSec, timerRunning, timerOnWorkOrder = false, canReportTime, onComplete, taskId, openTasks = "" }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  /** "Slutför uppgiften" or "Färdigställ protokollet". */
  title: string;
  /** What completing means for this task, e.g. that it is locked. */
  lockText: string;
  totalDurationSec: number; timerRunning: boolean;
  /** The running time is the work order's (a task in it): completing the task does not stop it. */
  timerOnWorkOrder?: boolean;
  /** False where time cannot be written here (no permission, or a preview). */
  canReportTime: boolean;
  /** True when done; a message when it failed – shown in the dialog itself (2026-10-01: "inget händer"). */
  onComplete: (time: CompletionTime | null) => Promise<boolean | string>;
  /**
   * Cloud and the demo (steg 1, 2026-10-09): with the job's id the dialog asks whether its coming bookings should be
   * removed, which frees the people's capacity; No leaves them. Each removal goes through the ordinary booking API, so
   * it is logged and refused when the person may not change those bookings.
   */
  taskId?: string;
  /**
   * A work order with tasks that are not done (2026-11-07, kundresan M6): what is left, said in the dialog; completing is
   * allowed once the person ticks "Färdigställ ändå". Empty when nothing is left.
   */
  openTasks?: string;
}) {
  const { bookings } = useTaskBookings(open ? taskId : null);
  const upcoming = bookings ?? [];
  const [removeBookings, setRemoveBookings] = useState(false);
  const [writeTime, setWriteTime] = useState(false);
  const [fields, setFields] = useState(defaults);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [acceptOpen, setAcceptOpen] = useState(false);
  // Each opening starts afresh, set while rendering (React's "adjust state when a value changes").
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      // Never preselected (2026-10-02, the simulation): the suggested hour often overlapped time already written on another task and doubled it.
      setWriteTime(false); setRemoveBookings(false); setAcceptOpen(false);
      setFields(defaults()); setNote(""); setProblem("");
    }
  }
  const startedAt = fromSwedishDateTimeInput(`${fields.date}T${fields.from}`);
  const endedAt = fromSwedishDateTimeInput(`${fields.date}T${fields.to}`);
  const minutes = startedAt && endedAt ? Math.round((endedAt.getTime() - startedAt.getTime()) / 60000) : 0;
  const confirm = async () => {
    if (openTasks && !acceptOpen) { setProblem("Kryssa i Färdigställ ändå, eller gör klart uppgifterna först."); return; }
    if (writeTime) {
      // Filled in but not a time that happens (the March night): said so, instead of moved an hour (2026-10-21).
      if (!startedAt || !endedAt) { setProblem(fields.date && fields.from && fields.to ? NONEXISTENT_TIME_ERROR : "Ange datum, från och till."); return; }
      if (minutes <= 0) { setProblem("Till måste vara efter från."); return; }
      if (minutes > 24 * 60) { setProblem("En tidpost får vara högst 24 timmar."); return; }
    }
    setBusy(true); setProblem("");
    try {
      const done = await onComplete(writeTime && startedAt && endedAt ? { startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), note: note.trim() } : null);
      if (done === true && removeBookings && upcoming.length) {
        // The job is completed first, so a refused removal never leaves the bookings gone and the job open.
        const refused: string[] = [];
        for (const booking of upcoming) {
          try { await api("/api/planned-activities", { method: "POST", body: JSON.stringify({ action: "delete", id: booking.id, version: booking.version }) }); }
          catch (issue) { refused.push(issue instanceof Error ? issue.message : booking.title); }
        }
        if (refused.length) { setProblem(`Jobbet är färdigställt, men ${refused.length === 1 ? "en bokning" : `${refused.length} bokningar`} kunde inte tas bort: ${refused[0]}`); return; }
        onOpenChange(false);
      } else if (done === true) onOpenChange(false);
      else setProblem(typeof done === "string" && done ? done : "Det gick inte att färdigställa. Kontrollera uppgifterna och försök igen.");
    } catch (issue) {
      setProblem(issue instanceof Error ? issue.message : "Det gick inte att färdigställa.");
    } finally { setBusy(false); }
  };
  return <Modal open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }} title={title} size="form">
    <div className="space-y-4" data-testid="complete-task-dialog">
      <p className="text-sm leading-6 text-muted-foreground">{lockText}</p>
      {openTasks ? <div className="notice space-y-2" role="status" data-testid="complete-open-tasks">
        <p className="text-sm">{openTasks}</p>
        <label className="flex min-h-10 items-center gap-2.5 text-sm font-medium"><Checkbox checked={acceptOpen} onCheckedChange={(checked) => { setAcceptOpen(checked === true); setProblem(""); }} data-testid="complete-open-tasks-accept" />Färdigställ ändå</label>
      </div> : null}
      <div className="flex items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2.5 text-sm">
        <Clock3 className="size-4 shrink-0 text-primary" />
        <span>Rapporterad tid: <strong data-testid="complete-reported-time">{formatTimerDuration(totalDurationSec)}</strong>{timerRunning ? timerOnWorkOrder ? " · tidtagningen på arbetsordern fortsätter tills du stoppar den där" : " · tidtagningen pågår och stoppas när du färdigställer" : ""}</span>
      </div>
      {canReportTime ? <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Vill du skriva tid?</legend>
        {totalDurationSec === 0 && !timerRunning ? <p className="text-xs text-muted-foreground">Ingen tid är rapporterad ännu. Har du jobbat utan klockan, välj Ja.</p> : null}
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Vill du skriva tid?">
          <Button type="button" role="radio" aria-checked={writeTime} variant={writeTime ? "secondary" : "outline"} onClick={() => setWriteTime(true)}>Ja, skriv tid</Button>
          <Button type="button" role="radio" aria-checked={!writeTime} variant={!writeTime ? "secondary" : "outline"} onClick={() => setWriteTime(false)}>Nej, färdigställ utan ny tid</Button>
        </div>
        {writeTime ? <div className="grid gap-3 sm:grid-cols-3">
          <label className="field-stack text-xs font-medium text-muted-foreground">Datum<Input type="date" value={fields.date} onChange={(event) => setFields({ ...fields, date: event.target.value })} /></label>
          <label className="field-stack text-xs font-medium text-muted-foreground">Från<Input type="time" step={300} value={fields.from} onChange={(event) => setFields({ ...fields, from: event.target.value })} /></label>
          <label className="field-stack text-xs font-medium text-muted-foreground">Till<Input type="time" step={300} value={fields.to} onChange={(event) => setFields({ ...fields, to: event.target.value })} /></label>
          <label className="field-stack text-xs font-medium text-muted-foreground sm:col-span-3">Anteckning (valfritt)<Input value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} /></label>
          <p className="text-xs text-muted-foreground sm:col-span-3" aria-live="polite">{minutes > 0 ? `${formatTimerDuration(minutes * 60)} läggs till på uppgiften.` : ""}</p>
        </div> : null}
      </fieldset> : null}
      {upcoming.length ? <fieldset className="space-y-3" data-testid="complete-task-bookings">
        <legend className="text-sm font-semibold">Ta bort {upcoming.length === 1 ? "den kommande bokningen" : `${upcoming.length} kommande bokningar`}?</legend>
        <p className="text-xs text-muted-foreground">Jobbet har bokad personal framåt. Tas bokningarna bort blir tiden ledig.</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Ta bort kommande bokningar?">
          <Button type="button" role="radio" aria-checked={removeBookings} variant={removeBookings ? "secondary" : "outline"} onClick={() => setRemoveBookings(true)}>Ja, ta bort</Button>
          <Button type="button" role="radio" aria-checked={!removeBookings} variant={!removeBookings ? "secondary" : "outline"} onClick={() => setRemoveBookings(false)}>Nej, behåll</Button>
        </div>
      </fieldset> : null}
      {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
      {/* The shared action row (QA 2026-10-10): at level 1 on a phone the dialog is a screen with Avbryt and Färdigställ
          in its top bar, never a round × beside a row of its own. */}
      <DialogActions className="border-t pt-4" cancel={{ onClick: () => { if (!busy) onOpenChange(false); } }}
        primary={{ label: writeTime ? "Spara tid och färdigställ" : "Färdigställ", busy, busyLabel: "Färdigställer…", icon: <CheckCircle2 />, onClick: () => void confirm(), testId: "complete-task-confirm" }} />
    </div>
  </Modal>;
}
