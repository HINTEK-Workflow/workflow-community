"use client";

import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeMonthGrid } from "@/components/native";
import { cn } from "@/lib/utils";
import { monthStart } from "@/lib/workflow/month-grid";
import { MONTH_WEEKS, ROUND_DURATION_CHOICES, ROUND_DURATION_MAX, ROUND_TIME_PATTERN, SCHEDULE_COUNT_MAX, SCHEDULE_PRESETS, addDays, applySchedulePreset, monthWeekOf, roundDayLine, roundDurationText,
  ruleWeekdays, scheduleOccurrences, schedulePresetOf, scheduleRuleSentence, swedishOrdinal, upcomingOccurrences, weekdayOf, type FormScheduleRule, type MonthWeek, type SchedulePreset } from "@/lib/workflow/form-schedule";
import { Segmented } from "./work-list";

const WEEKDAY_LETTERS = ["M", "T", "O", "T", "F", "L", "S"];
const WEEKDAY_NAMES = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag", "Söndag"];
const MONTH_WEEK_LABEL: Record<string, string> = { "1": "Första", "2": "Andra", "3": "Tredje", "4": "Fjärde", "-1": "Sista" };
type EndMode = "never" | "date" | "count";
const label = "grid content-start gap-1.5 text-xs font-medium text-muted-foreground";
const chip = "touch:min-h-11";
/** The height of one row of controls: 44 px under 1024 px and on a touch screen, else the control height. */
const ROW = "min-h-11 lg:min-h-[var(--control-h)]";

/** A row of buttons where exactly one is chosen (a radio group with arrow keys), wrapping on a narrow screen. */
function ChoiceButtons<T extends string>({ label: name, value, options, onChange, testId }: { label: string; value: T; options: readonly { id: T; label: string }[]; onChange: (value: T) => void; testId?: string }) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = options[(index + step + options.length) % options.length]!;
    onChange(next.id);
    (event.currentTarget.parentElement?.children[(index + step + options.length) % options.length] as HTMLElement | undefined)?.focus();
  };
  return <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-1.5" data-testid={testId}>
    {options.map((option, index) => { const on = option.id === value;
      return <Button key={option.id} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} variant={on ? "default" : "outline"} className={chip}
        onClick={() => onChange(option.id)} onKeyDown={(event) => move(event, index)} data-testid={testId ? `${testId}-${option.id}` : undefined}>{option.label}</Button>; })}
  </div>;
}

/** One fixed row of the schedule: a label above and a slot that keeps its height whatever is chosen (2026-10-28). */
function FixedRow({ title, slot, testId, children }: { title: string; /** The slot's fixed height (Tailwind classes). */ slot: string; testId: string; children: ReactNode }) {
  return <div className="grid content-start gap-1.5" data-testid={testId}><span className="text-xs font-medium text-muted-foreground">{title}</span>
    <div className={cn("flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:content-start sm:items-center", slot)} data-testid={`${testId}-slot`}>{children}</div></div>;
}

/**
 * "Hur ofta" of a round (2026-10-27, 2026-10-28): what the time rules do, said in one plain sentence at the top that
 * follows every change ("Varje vardag kl. 07:00, ca 30 min, från 14 okt 2026, tills vidare"); quick choices – Varje dag,
 * Varje vardag, Varje vecka, Varannan vecka, Varje månad, Varje år and Eget; a fixed row Detaljer that always shows the
 * choice that applies (interval and unit for Eget, the weekdays M–S, "den N:e" or "första … sista <veckodag>"), or "Inga
 * fler val"; Från and the end on one row (Tills vidare, Till datum or Efter N gånger, the date or count to the right of the
 * choice); Klockslag and Beräknad tid, both optional (none = the whole day, as before); and a preview: a month calendar with
 * the occurrences in green and beside it (under it on a phone) a fixed box with the chosen day – "ons 28 okt 2026 · kl. 07:00 ·
 * ca 30 min" or "ingen rond den dagen" – the round's time and the next occurrence. Every row has a fixed place and
 * height, so nothing moves when a quick choice is pressed and the calendar always stays put (2026-10-28: "se till
 * att fälten har en fast plats oavsett vad jag trycker på så det inte hoppar runt"). When the round's work order is known,
 * occurrences outside its period are marked and a short warning says so. The rules are lib/workflow/form-schedule.ts – the
 * same engine that computes the occurrences everywhere; nothing here interprets a rule on its own.
 */
export function RoundRuleFields({ rule, onChange, today, holder = null }: {
  rule: FormScheduleRule;
  onChange: (rule: FormScheduleRule) => void;
  today: string;
  /** The work order that holds the round now, with its period: occurrences outside it are marked. */
  holder?: { title?: string; from?: string; to?: string } | null;
}) {
  const [custom, setCustom] = useState(() => schedulePresetOf(rule) === "custom");
  const preset: SchedulePreset = custom ? "custom" : schedulePresetOf(rule);
  const [endMode, setEndMode] = useState<EndMode>(() => rule.endDate ? "date" : rule.count ? "count" : "never");
  const [anchor, setAnchor] = useState(() => rule.startDate > today ? rule.startDate : today);
  const [selected, setSelected] = useState<string | null>(null);
  const [clock, setClock] = useState(rule.time ?? "");
  const change = (patch: Partial<FormScheduleRule>) => onChange({ ...rule, ...patch });
  const choosePreset = (next: SchedulePreset) => {
    if (next === "custom") { setCustom(true); return; }
    setCustom(false);
    onChange(applySchedulePreset(rule, next));
  };
  const chooseEnd = (mode: EndMode) => {
    setEndMode(mode);
    if (mode === "never") change({ endDate: "", count: undefined });
    if (mode === "date") change({ count: undefined, endDate: rule.endDate || addDays(rule.startDate > today ? rule.startDate : today, 365) });
    if (mode === "count") change({ endDate: "", count: rule.count ?? 10 });
  };
  // An empty or half-typed klockslag is no klockslag: the round is for the whole day until a whole time is given.
  const changeClock = (value: string) => { setClock(value); change({ time: ROUND_TIME_PATTERN.test(value) ? value : undefined }); };
  const changeDuration = (minutes: number | undefined) => change({ durationMinutes: minutes && minutes > 0 ? Math.min(ROUND_DURATION_MAX, Math.round(minutes)) : undefined });
  const unit = rule.frequency === "DAILY" ? (rule.interval === 1 ? "dag" : "dagar") : rule.frequency === "WEEKLY" ? (rule.interval === 1 ? "vecka" : "veckor") : (rule.interval === 1 ? "månad" : "månader");
  const weekdays = ruleWeekdays(rule);
  const onWeekday = rule.monthWeek !== undefined && rule.monthWeekday !== undefined;
  const showMonthMode = rule.frequency === "MONTHLY" && !(preset === "year");
  const showWeekdays = rule.frequency === "WEEKLY";
  const noDetails = preset !== "custom" && !showWeekdays && !showMonthMode;
  const period = holder?.from && holder.to ? { from: holder.from, to: holder.to } : null;
  const outside = (day: string) => Boolean(period && (day < period.from || day > period.to));
  const next = useMemo(() => upcomingOccurrences(rule, today, 8), [rule, today]);
  const outsideCount = next.filter(outside).length;
  const values = useMemo(() => {
    const first = monthStart(anchor);
    // Six weeks from the month's first Monday: the grid always shows six rows (fixedWeeks).
    const days = scheduleOccurrences(rule, addDays(first, -7), addDays(first, 42), 60);
    return Object.fromEntries(days.map((day) => [day, outside(day) ? 2 : 1]));
  }, [rule, anchor]); // eslint-disable-line react-hooks/exhaustive-deps -- `outside` follows the holder's period, read on every render
  const selectedIsOccurrence = Boolean(selected && scheduleOccurrences(rule, selected, selected, 1).length);

  return <div className="grid gap-4" data-testid="round-rule">
    {/* Room for three lines on a phone and two on a wider screen, so a longer sentence never pushes the rows below. */}
    <p className="min-h-[4.75rem] rounded-lg bg-secondary/60 px-3 py-2 text-sm font-medium text-foreground sm:min-h-[3.5rem]" aria-live="polite" data-testid="round-rule-sentence">{scheduleRuleSentence(rule)}</p>
    <ChoiceButtons label="Hur ofta" value={preset} options={SCHEDULE_PRESETS} onChange={choosePreset} testId="round-preset" />
    {/* Detaljer (2026-10-28): always there, as high as its largest content (three rows on a phone, two wider). */}
    <FixedRow title="Detaljer" testId="round-details" slot="min-h-[calc(3*2.75rem+1.5rem)] sm:min-h-[calc(2*2.75rem+0.5rem)] lg:min-h-[calc(2*var(--control-h)+0.5rem)]">
      {preset === "custom" ? <span className={cn("flex items-center gap-2 text-sm text-foreground", ROW)} data-testid="round-custom">Var
        <Input className="w-20" type="number" min={1} max={366} value={rule.interval} aria-label={`Var … ${unit}`} data-testid="round-interval"
          onChange={(event) => change({ interval: Math.max(1, Math.min(366, Number(event.target.value) || 1)) })} />
        <select className="form-select w-32" aria-label="Enhet" value={rule.frequency} data-testid="round-unit"
          onChange={(event) => { const frequency = event.target.value as FormScheduleRule["frequency"]; change({ frequency, weekdays: frequency === "WEEKLY" ? weekdays : [], monthWeek: undefined, monthWeekday: undefined }); }}>
          <option value="DAILY">Dagar</option><option value="WEEKLY">Veckor</option><option value="MONTHLY">Månader</option></select></span> : null}
      {showWeekdays ? <div className="grid w-full max-w-[22rem] grid-cols-7 gap-1 sm:w-auto" role="group" aria-label="Veckodagar" data-testid="round-weekdays">{WEEKDAY_LETTERS.map((letter, index) => { const weekday = index + 1; const on = weekdays.includes(weekday);
        // A weekday pressed changes the days; the last one cannot be taken away (a weekly round is done on some day).
        return <Button key={weekday} type="button" className={cn("min-w-0 px-0 sm:min-w-11", chip)} variant={on ? "default" : "outline"} aria-pressed={on} aria-label={WEEKDAY_NAMES[index]} title={WEEKDAY_NAMES[index]}
          onClick={() => { const nextDays = on ? weekdays.filter((item) => item !== weekday) : [...weekdays, weekday].sort((a, b) => a - b); if (nextDays.length) change({ weekdays: nextDays }); }}>{letter}</Button>; })}</div> : null}
      {showMonthMode ? <div className="contents" data-testid="round-month-mode">
        <Segmented label="Vilken dag i månaden" value={onWeekday ? "weekday" : "date"} testId="round-month-kind"
          options={[{ value: "date", label: `Den ${swedishOrdinal(Number(rule.startDate.slice(8, 10)))}` }, { value: "weekday", label: "En veckodag" }]}
          onChange={(kind) => change(kind === "date" ? { monthWeek: undefined, monthWeekday: undefined } : { monthWeek: monthWeekOf(rule.startDate), monthWeekday: weekdayOf(rule.startDate) })} />
        {onWeekday ? <span className="flex items-center gap-2">
          <select className="form-select w-28" aria-label="Vilken" value={String(rule.monthWeek)} data-testid="round-month-week" onChange={(event) => change({ monthWeek: Number(event.target.value) as MonthWeek })}>
            {MONTH_WEEKS.map((week) => <option key={week} value={String(week)}>{MONTH_WEEK_LABEL[String(week)]}</option>)}</select>
          <select className="form-select w-32" aria-label="Veckodag" value={String(rule.monthWeekday)} data-testid="round-month-weekday" onChange={(event) => change({ monthWeekday: Number(event.target.value) })}>
            {WEEKDAY_NAMES.map((name, index) => <option key={name} value={String(index + 1)}>{name}</option>)}</select>
        </span> : null}
      </div> : null}
      {noDetails ? <span className={cn("flex items-center text-sm text-muted-foreground", ROW)} data-testid="round-no-details">Inga fler val</span> : null}
    </FixedRow>
    {/* Från and Slut on one row (2026-10-28: no empty gap): the end's date or count stands to the right of its choice in
        a slot of fixed size, with a short grey text for Tills vidare, so nothing moves when the end is changed. */}
    <div className="grid gap-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
      <label className={label}>Från<Input type="date" value={rule.startDate} data-testid="round-start-date" onChange={(event) => { if (event.target.value) change({ startDate: event.target.value }); }} /></label>
      <div className="grid content-start gap-1.5"><span className="text-xs font-medium text-muted-foreground">Slut</span>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Slut" value={endMode} onChange={chooseEnd} testId="round-end"
            options={[{ value: "never", label: "Tills vidare" }, { value: "date", label: "Till datum" }, { value: "count", label: "Antal gånger" }]} />
          <div className={cn("flex w-44 items-center", ROW)} data-testid="round-end-slot">
            {endMode === "date" ? <Input type="date" aria-label="Till och med" value={rule.endDate} min={rule.startDate} data-testid="round-end-date" onChange={(event) => change({ endDate: event.target.value })} /> : null}
            {endMode === "count" ? <span className="flex items-center gap-2"><Input className="w-24" type="number" min={1} max={SCHEDULE_COUNT_MAX} aria-label="Antal gånger" value={rule.count ?? 1} data-testid="round-count"
              onChange={(event) => change({ count: Math.max(1, Math.min(SCHEDULE_COUNT_MAX, Number(event.target.value) || 1)) })} /><span className="text-sm text-foreground">gånger</span></span> : null}
            {endMode === "never" ? <span className="text-sm text-muted-foreground">Inget slutdatum</span> : null}
          </div>
        </div>
      </div>
    </div>
    {/* Klockslag and beräknad tid (2026-10-28: "hur planeras det?"): optional; the same controls whatever is chosen. */}
    <div className="grid gap-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]" data-testid="round-time-row">
      <label className={label}>Klockslag (valfritt)<Input type="time" value={clock} data-testid="round-time" onChange={(event) => changeClock(event.target.value)} /></label>
      <div className="grid content-start gap-1.5"><span id="round-duration-label" className="text-xs font-medium text-muted-foreground">Beräknad tid (valfritt)</span>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-labelledby="round-duration-label" data-testid="round-duration">
          {ROUND_DURATION_CHOICES.map((minutes) => { const on = rule.durationMinutes === minutes;
            // Pressed again, a quick choice is taken away (no beräknad tid).
            return <Button key={minutes} type="button" className={chip} variant={on ? "default" : "outline"} aria-pressed={on} data-testid={`round-duration-${minutes}`}
              onClick={() => changeDuration(on ? undefined : minutes)}>{roundDurationText(minutes)}</Button>; })}
          <span className="flex items-center gap-2"><Input className="w-20" type="number" min={1} max={ROUND_DURATION_MAX} aria-label="Beräknad tid i minuter" placeholder="Eget" value={rule.durationMinutes ?? ""} data-testid="round-duration-minutes"
            onChange={(event) => changeDuration(event.target.value ? Number(event.target.value) : undefined)} /><span className="text-sm text-foreground">min</span></span>
        </div>
      </div>
    </div>
    {/* Förhandsvisning (2026-10-28): the month (always six rows) with the occurrences in green, outside the work order's
        period in amber; beside it on a wide screen – under it on a phone – a fixed box for the chosen day, the round's time and
        the next occurrence. The box's rows are always there, so nothing moves when a day or a choice changes. */}
    <div className="grid gap-4 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:items-start" data-testid="round-preview">
      <NativeMonthGrid anchor={anchor} today={today} selected={selected} values={values} testId="round-month" fixedWeeks
        format={(value) => value === 2 ? "!" : ""} valueLabel={(value) => value === 2 ? "tillfälle utanför arbetsorderns period" : "tillfälle"} tone={(value) => value === 2 ? "warning" : "success"}
        onSelect={setSelected} onMoveMonth={(offset) => setAnchor(monthStart(anchor, offset))} onToday={() => { setAnchor(today); setSelected(today); }} />
      <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 text-sm" data-testid="round-day-box"><dl className="grid grid-cols-2 gap-3">
        <div className="col-span-2 grid gap-0.5"><dt className="text-xs font-medium text-muted-foreground">Vald dag</dt>
          <dd className="min-h-10" aria-live="polite" data-testid="round-day-line">
            {selected ? <span className={selectedIsOccurrence ? "font-medium text-foreground" : "text-muted-foreground"}>{roundDayLine(rule, selected)}{outside(selected) && selectedIsOccurrence ? " · utanför arbetsorderns period" : ""}</span>
              : <span className="text-muted-foreground">Välj en dag i kalendern.</span>}</dd></div>
        <div className="grid gap-0.5"><dt className="text-xs font-medium text-muted-foreground">Klockslag</dt><dd data-testid="round-box-time">{rule.time ? `kl. ${rule.time}` : "Hela dagen"}</dd></div>
        <div className="grid gap-0.5"><dt className="text-xs font-medium text-muted-foreground">Beräknad tid</dt><dd data-testid="round-box-duration">{rule.durationMinutes ? `ca ${roundDurationText(rule.durationMinutes)}` : "Inte angiven"}</dd></div>
        <div className="col-span-2 grid gap-0.5"><dt className="text-xs font-medium text-muted-foreground">Nästa tillfälle</dt><dd className="min-h-10" data-testid="round-box-next">{next[0] ? roundDayLine(rule, next[0]) : "Inga fler tillfällen"}</dd></div></dl>
        {/* Room for the warning always, so it never pushes anything when it comes or goes. */}
        <div className="min-h-10">{outsideCount ? <p role="status" className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300" data-testid="round-outside-period"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {outsideCount === 1 ? "Ett" : outsideCount} av de närmaste tillfällena ligger utanför arbetsorderns period ({period!.from}–{period!.to}).</p> : null}</div>
      </div>
    </div>
  </div>;
}
