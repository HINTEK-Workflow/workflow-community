"use client";

import { useState } from "react";
import { Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DisabledReason } from "@/components/ui/disabled-reason";
import { clockOfMinutes, DEFAULT_WORKDAY, workdayInput, type Workday } from "@/lib/workflow/work-schedule";

/**
 * Arbetstid (2026-10-30), beside the weekly hours in Tid → Arbetstid: "Ingen fast arbetstid" for the person (hourly
 * staff: no weekly target, no capacity, never "saknar tidrapport") and the company's workday (admins; only a suggestion in the
 * time report – time on another day starts there). The same parts on the computer and on the phone's Arbetstid screen.
 */

/** Ingen fast arbetstid: the person's own choice, saved with their weekly hours. */
export function NoFixedHoursField({ checked, onChange, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className="mt-3 flex items-start gap-2.5 text-sm" data-testid="schedule-no-fixed-hours">
    <Checkbox className="mt-0.5" checked={checked} disabled={disabled} onCheckedChange={(value) => onChange(value === true)} />
    <span>Ingen fast arbetstid<span className="block text-xs text-muted-foreground">Timanställd: inget veckomål och ingen kapacitet i planeringen.</span></span>
  </label>;
}

/** Företagets arbetsdag (admins): start and end, saved on their own. */
export function WorkdayFields({ startMinutes = DEFAULT_WORKDAY.startMinutes, endMinutes = DEFAULT_WORKDAY.endMinutes, busy, onSave }: {
  startMinutes?: number; endMinutes?: number; busy: boolean; onSave: (workday: Workday) => Promise<unknown> }) {
  const [start, setStart] = useState(clockOfMinutes(startMinutes));
  const [end, setEnd] = useState(clockOfMinutes(endMinutes === 1440 ? 1439 : endMinutes));
  const { workday, problem } = workdayInput(start, end);
  const unchanged = workday?.startMinutes === startMinutes && workday?.endMinutes === endMinutes;
  return <div className="rounded-xl border bg-muted/30 p-4" data-testid="schedule-workday">
    <p className="text-sm font-semibold">Företagets arbetsdag</p>
    <p className="mt-1 text-xs text-muted-foreground">Används som förslag när du skriver in tid för en annan dag.</p>
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <label className="field-label min-w-28 flex-1 text-xs font-medium text-muted-foreground">Start<Input type="time" value={start} onChange={(event) => setStart(event.target.value)} data-testid="schedule-workday-start" /></label>
      <label className="field-label min-w-28 flex-1 text-xs font-medium text-muted-foreground">Slut<Input type="time" value={end} onChange={(event) => setEnd(event.target.value)} data-testid="schedule-workday-end" /></label>
      <Button type="button" variant="outline" disabled={busy || unchanged} disabledReason={problem} aria-describedby={problem ? "schedule-workday-reason" : undefined}
        onClick={() => { if (workday) void onSave(workday); }} data-testid="schedule-workday-save"><Clock3 />Spara arbetsdag</Button>
    </div>
    <DisabledReason id="schedule-workday-reason" reason={problem} />
  </div>;
}
