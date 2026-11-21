"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { effectiveStartDate, normalizeStage, STAGE_MAX_LENGTH } from "@/lib/workflow/job-planning";
import { hasProjectFrame, type ProjectFrame } from "@/lib/workflow/project-frame";
import { hoursText, minutesFromHours, MAX_ESTIMATED_MINUTES } from "@/lib/workflow/schedule";

/**
 * Start, Uppskattad tid and Etapp on the job itself (projektförslaget 2026-10-09, steg 2 och 5; plan 1M 2026-10-11), beside
 * Klart senast in the task's fields: the period is Start → Klart senast, the estimate is asked in hours and the stage is a
 * short label that groups the project's jobs. Saved with the job's normal save; the server (Cloud, Local and the demo)
 * checks the same rules (taskScheduleError in lib/workflow/schedule.ts). Every job has a Start: a new job's field starts on
 * today and cannot be emptied; an older job without one shows the day it was created (nothing is saved until it is changed).
 * Each part is one label in the same grid as Klart senast: `part` places Start before it, Uppskattad tid and Etapp after.
 */
type ScheduleValues = { plannedStartDate?: string; estimatedMinutes?: number | null; dueDate: string; stage?: string; createdAt?: string };
type ScheduleChange = { plannedStartDate?: string; estimatedMinutes?: number | null; stage?: string };

export function TaskScheduleFields({ part, task, frame, stageOptions, onChange }: { part: "start" | "estimate" | "stage"; task: ScheduleValues; frame?: Partial<ProjectFrame> | null; stageOptions?: string[]; onChange: (values: ScheduleChange) => void }) {
  const stored = task.plannedStartDate ?? "";
  const start = stored || (task.createdAt ? effectiveStartDate({ plannedStartDate: "", createdAt: task.createdAt }) : "");
  const minutes = task.estimatedMinutes ?? null;
  const listId = useId();
  // The typed hours stay as typed ("1," on the way to "1,5"); the task holds whole minutes.
  const [hours, setHours] = useState(hoursText(minutes));
  // A value from elsewhere (a colleague's save, Läs in senaste) replaces the typed text; the person's own typing does not.
  const [seen, setSeen] = useState(minutes);
  if (seen !== minutes) {
    setSeen(minutes);
    if (minutesFromHours(hours) !== minutes) setHours(hoursText(minutes));
  }
  const framed = hasProjectFrame(frame) ? frame : null;
  const startError = start && task.dueDate && start > task.dueDate ? "Start måste vara före eller samma dag som Klart senast."
    : start && framed && (start < framed.startDate || start > framed.dueDate) ? `Start måste ligga inom projektets tidsram (${framed.startDate}–${framed.dueDate}).` : "";
  const typedMinutes = minutesFromHours(hours);
  const hoursError = hours.trim() && (typedMinutes === null || typedMinutes > MAX_ESTIMATED_MINUTES) ? "Ange timmar, till exempel 16 eller 1,5." : "";
  if (part === "start") return <label className="space-y-2 text-xs font-medium text-muted-foreground">Start
      <Input id="task-planned-start" type="date" required value={start} min={framed?.startDate || undefined} max={task.dueDate || framed?.dueDate || undefined}
        aria-invalid={startError ? true : undefined} aria-describedby={startError ? "task-planned-start-error" : undefined}
        // Every job has a Start: emptying the field keeps the day it had.
        onChange={(event) => { if (event.target.value) onChange({ plannedStartDate: event.target.value }); }} />
      {startError ? <span id="task-planned-start-error" className="block font-normal text-destructive">{startError}</span> : null}
    </label>;
  if (part === "stage") return <label className="space-y-2 text-xs font-medium text-muted-foreground">Etapp (valfritt)
      <Input id="task-stage" value={task.stage ?? ""} maxLength={STAGE_MAX_LENGTH} placeholder="t.ex. Förberedelse" list={stageOptions?.length ? listId : undefined} autoComplete="off"
        onChange={(event) => onChange({ stage: event.target.value })} onBlur={(event) => { const clean = normalizeStage(event.target.value); if (clean !== event.target.value) onChange({ stage: clean }); }} />
      {stageOptions?.length ? <datalist id={listId}>{stageOptions.map((option) => <option key={option} value={option} />)}</datalist> : null}
    </label>;
  return <label className="space-y-2 text-xs font-medium text-muted-foreground">Uppskattad tid (h)
      <Input id="task-estimated-hours" inputMode="decimal" placeholder="t.ex. 16" value={hours}
        aria-invalid={hoursError ? true : undefined} aria-describedby={hoursError ? "task-estimated-hours-error" : undefined}
        onChange={(event) => {
          const typed = event.target.value;
          setHours(typed);
          const next = minutesFromHours(typed);
          if (!typed.trim()) onChange({ estimatedMinutes: null });
          else if (next !== null && next <= MAX_ESTIMATED_MINUTES) onChange({ estimatedMinutes: next });
        }} />
      {hoursError ? <span id="task-estimated-hours-error" className="block font-normal text-destructive">{hoursError}</span> : null}
    </label>;
}
