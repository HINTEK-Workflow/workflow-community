"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/features/kfid/ui";
import { formatTimerDuration } from "@/lib/workflow/running-timer";
import { fromSwedishDateTimeInput, swedishParts } from "@/lib/swedish-time";

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
 * Completing a task asks "Vill du skriva tid?" in the same step (Daniel 2026-09-30, the guided flow): a completed task
 * cannot take time from an ordinary member afterwards, so the question comes before the task is locked, with the time
 * reported so far. Writing time is chosen from the start when nothing is reported yet; a running timer is stopped by
 * the completion itself. Nothing is saved until the person confirms.
 */
export function CompleteTaskDialog({ open, onOpenChange, title, lockText, totalDurationSec, timerRunning, canReportTime, onComplete }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  /** "Slutför uppgiften" or "Färdigställ protokollet". */
  title: string;
  /** What completing means for this task, e.g. that it is locked. */
  lockText: string;
  totalDurationSec: number; timerRunning: boolean;
  /** False where time cannot be written here (no permission, or a preview). */
  canReportTime: boolean;
  onComplete: (time: CompletionTime | null) => Promise<boolean>;
}) {
  const [writeTime, setWriteTime] = useState(false);
  const [fields, setFields] = useState(defaults);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setWriteTime(canReportTime && totalDurationSec === 0 && !timerRunning);
    setFields(defaults()); setNote(""); setProblem("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const startedAt = fromSwedishDateTimeInput(`${fields.date}T${fields.from}`);
  const endedAt = fromSwedishDateTimeInput(`${fields.date}T${fields.to}`);
  const minutes = startedAt && endedAt ? Math.round((endedAt.getTime() - startedAt.getTime()) / 60000) : 0;
  const confirm = async () => {
    if (writeTime) {
      if (!startedAt || !endedAt) { setProblem("Ange datum, från och till."); return; }
      if (minutes <= 0) { setProblem("Till måste vara efter från."); return; }
      if (minutes > 24 * 60) { setProblem("En tidpost får vara högst 24 timmar."); return; }
    }
    setBusy(true); setProblem("");
    try {
      const done = await onComplete(writeTime && startedAt && endedAt ? { startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), note: note.trim() } : null);
      if (done) onOpenChange(false);
    } finally { setBusy(false); }
  };
  return <Modal open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }} title={title} className="max-w-lg">
    <div className="space-y-4" data-testid="complete-task-dialog">
      <p className="text-sm leading-6 text-muted-foreground">{lockText}</p>
      <div className="flex items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2.5 text-sm">
        <Clock3 className="size-4 shrink-0 text-primary" />
        <span>Rapporterad tid hittills: <strong data-testid="complete-reported-time">{formatTimerDuration(totalDurationSec)}</strong>{timerRunning ? " · tidtagningen pågår och stoppas när du slutför" : ""}</span>
      </div>
      {canReportTime ? <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Vill du skriva tid?</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Vill du skriva tid?">
          <Button type="button" role="radio" aria-checked={writeTime} variant={writeTime ? "default" : "outline"} onClick={() => setWriteTime(true)}>Ja, skriv tid</Button>
          <Button type="button" role="radio" aria-checked={!writeTime} variant={!writeTime ? "default" : "outline"} onClick={() => setWriteTime(false)}>Nej, slutför utan ny tid</Button>
        </div>
        {writeTime ? <div className="grid gap-3 sm:grid-cols-3">
          <label className="field-stack text-xs font-medium text-muted-foreground">Datum<Input type="date" value={fields.date} onChange={(event) => setFields({ ...fields, date: event.target.value })} /></label>
          <label className="field-stack text-xs font-medium text-muted-foreground">Från<Input type="time" step={300} value={fields.from} onChange={(event) => setFields({ ...fields, from: event.target.value })} /></label>
          <label className="field-stack text-xs font-medium text-muted-foreground">Till<Input type="time" step={300} value={fields.to} onChange={(event) => setFields({ ...fields, to: event.target.value })} /></label>
          <label className="field-stack text-xs font-medium text-muted-foreground sm:col-span-3">Anteckning (valfri)<Input value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} /></label>
          <p className="text-xs text-muted-foreground sm:col-span-3" aria-live="polite">{minutes > 0 ? `${formatTimerDuration(minutes * 60)} läggs till på uppgiften.` : ""}</p>
        </div> : null}
      </fieldset> : null}
      {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Avbryt</Button>
        <Button type="button" disabled={busy} onClick={() => void confirm()} data-testid="complete-task-confirm"><CheckCircle2 />{busy ? "Slutför…" : writeTime ? "Spara tid och slutför" : title.startsWith("Färdigställ") ? "Färdigställ" : "Slutför"}</Button>
      </div>
    </div>
  </Modal>;
}
