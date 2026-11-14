"use client";

import { useMemo, useState } from "react";
import { CalendarCheck, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DialogActions, Modal } from "@/features/kfid/ui";
import { JOB_EVERY_MINUTES } from "@/lib/schedule/labels";
import { COMMON_TIMES, isTaken, nextFreeSlot, quickDays, rhythmText, scheduleSentence, scheduleTimeProblem, type Rhythm } from "@/lib/schedule/rhythm";
import { addSwedishDays, fromSwedishDateTimeInput, startOfSwedishDay, swedishParts, toSwedishDateTimeInput } from "@/lib/swedish-time";
import { cn } from "@/lib/utils";

/**
 * Schemalägg (2026-11-11): the shared small dialog for choosing a day and a clock time in Swedish time – for a post, a
 * page and Ändra tid. Pressing its button is the admin's own approval of what is shown; `check` asks for the same read-through
 * tick as Publicera before it can be pressed.
 *
 * Day and time made easy (2026-11-12): Idag, Imorgon and the next days as chips, the common times as chips, any day and time
 * typed, the choice in words ("Publiceras onsdag 12 november kl. 08:00"), a time that has passed refused, and – for a post – the
 * company's rhythm's next free time suggested (`plan`), with a note when another post already has that slot.
 */
export const scheduleDefault = (now = new Date()) => {
  // Tomorrow at 08:00, the series' default time; a chosen time is published within five minutes after it.
  const tomorrow = addSwedishDays(startOfSwedishDay(now), 1);
  const parts = swedishParts(tomorrow);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T08:00`;
};

/** The company's rhythm and the times other posts already have (ISO), for the suggestion and the note. */
export type SchedulePlan = { rhythm: Rhythm; taken: readonly string[] };

export function ScheduleDialog({ open, title, text, initial, confirmLabel = "Schemalägg", check, busy = false, error, plan, onCancel, onConfirm, testId = "schedule-dialog" }: {
  open: boolean; title: string; text: string; initial?: string | null; confirmLabel?: string;
  /** A tick the person must make before the button can be pressed (what is approved). */
  check?: string;
  busy?: boolean; error?: string | null;
  /** A post's rhythm and the other posts' times: the suggestion and the note about a taken slot. */
  plan?: SchedulePlan | null;
  onCancel: () => void; onConfirm: (at: string) => void; testId?: string;
}) {
  return <Modal open={open} onOpenChange={(next) => { if (!next) onCancel(); }} title={title} size="compact" nativeScreen>
    {open ? <ScheduleForm key={initial ?? "new"} text={text} initial={initial ?? null} confirmLabel={confirmLabel} check={check} busy={busy} error={error} plan={plan ?? null} onCancel={onCancel} onConfirm={onConfirm} testId={testId} /> : null}
  </Modal>;
}

function ScheduleForm({ text, initial, confirmLabel, check, busy, error, plan, onCancel, onConfirm, testId }: {
  text: string; initial: string | null; confirmLabel: string; check?: string; busy: boolean; error?: string | null; plan: SchedulePlan | null; onCancel: () => void; onConfirm: (at: string) => void; testId: string;
}) {
  // The moment the dialog opened: the chips, the suggestion and the check are read from it.
  const [now] = useState(() => new Date());
  const taken = useMemo(() => (plan?.taken ?? []).map((value) => new Date(value)), [plan]);
  const suggestion = useMemo(() => (plan ? nextFreeSlot(plan.rhythm, taken, now) : null), [plan, taken, now]);
  const start = initial ?? (suggestion ? toSwedishDateTimeInput(suggestion) : scheduleDefault(now));
  const [day, setDay] = useState(start.slice(0, 10));
  const [time, setTime] = useState(start.slice(11, 16));
  const [checked, setChecked] = useState(false);
  const days = useMemo(() => quickDays(now, 7), [now]);
  const at = day && time ? `${day}T${time}` : "";
  const problem = scheduleTimeProblem(at, now);
  const chosen = problem ? null : fromSwedishDateTimeInput(at);
  const clash = chosen && plan && isTaken(chosen, taken);
  const reason = problem ?? (check && !checked ? "Kryssa i rutan först." : null);
  const suggested = suggestion ? toSwedishDateTimeInput(suggestion) : null;
  const chip = (pressed: boolean) => cn("min-w-14", pressed && "font-semibold");
  return <form className="space-y-4" data-testid={testId} onSubmit={(event) => { event.preventDefault(); if (!reason && !busy) onConfirm(at); }}>
    <p className="text-sm text-muted-foreground">{text}</p>
    {plan && suggestion && suggested ? <div className="flex flex-wrap items-center gap-2 text-sm" data-testid={`${testId}-suggestion`}>
      <span className="text-muted-foreground">Nästa lediga tid i rytmen ({rhythmText(plan.rhythm)}):</span>
      <Button type="button" size="sm" variant={at === suggested ? "secondary" : "outline"} aria-pressed={at === suggested} className={chip(at === suggested)}
        onClick={() => { setDay(suggested.slice(0, 10)); setTime(suggested.slice(11, 16)); }} data-testid={`${testId}-suggest`}><CalendarCheck />{scheduleSentence(suggestion, now).replace(/^Publiceras /, "")}</Button>
    </div> : null}
    <div className="field-stack">
      <label htmlFor={`${testId}-day`} className="text-xs font-medium">Dag</label>
      <div role="group" aria-label="Snabbval av dag" className="flex flex-wrap gap-1.5" data-testid={`${testId}-days`}>
        {days.map((entry) => <Button key={entry.day} type="button" size="sm" variant={day === entry.day ? "secondary" : "outline"} aria-pressed={day === entry.day} className={chip(day === entry.day)}
          onClick={() => setDay(entry.day)} data-testid={`${testId}-day-${entry.day}`}>{entry.label}</Button>)}
      </div>
      <Input id={`${testId}-day`} type="date" value={day} min={days[0]?.day} onChange={(event) => setDay(event.target.value)} className="max-w-48" data-testid={`${testId}-day-input`} />
    </div>
    <div className="field-stack">
      <label htmlFor={`${testId}-time`} className="text-xs font-medium">Klockslag</label>
      <div role="group" aria-label="Vanliga klockslag" className="flex flex-wrap gap-1.5" data-testid={`${testId}-times`}>
        {COMMON_TIMES.map((value) => <Button key={value} type="button" size="sm" variant={time === value ? "secondary" : "outline"} aria-pressed={time === value} className={chip(time === value)}
          onClick={() => setTime(value)} data-testid={`${testId}-time-${value.replace(":", "")}`}>{value}</Button>)}
      </div>
      <Input id={`${testId}-time`} type="time" value={time} step={JOB_EVERY_MINUTES * 60} onChange={(event) => setTime(event.target.value)} className="max-w-36" data-testid={`${testId}-at`} />
    </div>
    <div className="space-y-1" aria-live="polite">
      {chosen ? <p className="text-sm font-medium" data-testid={`${testId}-sentence`}>{scheduleSentence(chosen, now)}.</p>
        : <p className="text-sm text-destructive" data-testid={`${testId}-problem`}>{problem}</p>}
      <p className="text-xs text-muted-foreground">Svensk tid. Publiceras inom {JOB_EVERY_MINUTES} minuter efter vald tid.</p>
      {clash ? <p className="text-xs text-muted-foreground" data-testid={`${testId}-clash`}>Ett annat inlägg publiceras redan inom en timme från den tiden.</p> : null}
    </div>
    {check ? <label className="flex cursor-pointer items-start gap-2.5 text-sm" data-testid={`${testId}-check`}>
      <Checkbox checked={checked} onCheckedChange={(value) => setChecked(value === true)} className="mt-0.5" />
      <span>{check}</span>
    </label> : null}
    {error ? <p role="alert" className="text-sm text-destructive" data-testid={`${testId}-error`}>{error}</p> : null}
    <DialogActions cancel={{ onClick: onCancel }} primary={{ label: confirmLabel, type: "submit", icon: <CalendarClock />, busy, busyLabel: "Schemalägger…", disabledReason: reason, testId: `${testId}-confirm` }} />
  </form>;
}
