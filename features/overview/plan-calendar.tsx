"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { AreaIcon } from "@/components/area-icon";
import { PeriodStepper } from "@/components/ui/period-stepper";
import { SkeletonText } from "@/components/skeleton";
import { api } from "@/features/kfid/api";
import { useWorkspaceData } from "@/features/kfid/use-workspace-data";
import { panelAreaColor } from "@/lib/workflow/panel-area";
import { isoWeek } from "@/lib/workflow/schedule";
import { cn } from "@/lib/utils";
import { PLAN_KIND_INFO, PLAN_KINDS, type MeTabData, type PlanItem, type PlanKind } from "@/lib/overview/me";
import type { OverviewAnswer } from "@/lib/overview/tabs";
import { Box, EmptyNote, Pill, SrTable } from "./viz";

/**
 * Min plan (dashboard etapp 6, 2026-10-28): the proposal's month map (layout A, "Denna är snygg") fed with real posts
 * only – my work orders and their bookings, my rounds' occurrences, my planned activities and my projects' end dates. The
 * map's shade is the number of posts on the day, a red mark a day with something missed; a click on a day lists its posts
 * under the map, each opening its own page. The legend is also the filter. The deviation mode, the ring and the other day
 * views of the proposal are gone (one day view: the list under the map). Another month reads only the plan
 * (`?tab=me&part=plan&month=`), kept in memory like every other read.
 */
const DAY_SHORT = ["Mån", "Tis", "Ons", "Tors", "Fre", "Lör", "Sön"];
const DAY_NAMES = ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"];
const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const MIX = [8, 28, 48, 72, 100];

// Date-only arithmetic on calendar days (no clock involved), so the device's own time zone cannot shift a day.
const parse = (value: string) => { const [year, month, day] = value.split("-").map(Number); return new Date(Date.UTC(year, month - 1, day)); };
const iso = (date: Date) => date.toISOString().slice(0, 10);
const weekday = (value: string) => (parse(value).getUTCDay() + 6) % 7;
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const dayLabel = (value: string) => { const date = parse(value); return `${capital(DAY_NAMES[weekday(value)])} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`; };
const monthLabel = (month: string) => `${capital(MONTHS[Number(month.slice(5, 7)) - 1])} ${month.slice(0, 4)}`;
const shiftMonth = (month: string, step: number) => { const date = parse(`${month}-01`); date.setUTCMonth(date.getUTCMonth() + step); return iso(date).slice(0, 7); };
const daysOf = (plan: { from: string; to: string }) => {
  const days: string[] = [];
  for (let day = plan.from; day <= plan.to && days.length < 31; day = iso(new Date(parse(day).getTime() + 86_400_000))) days.push(day);
  return days;
};
const colorOf = (kind: PlanKind) => panelAreaColor(PLAN_KIND_INFO[kind].area);
const time = (item: PlanItem) => item.start ? `${item.start}${item.end ? `–${item.end}` : ""}` : "Under dagen";
const posts = (count: number) => `${count} ${count === 1 ? "post" : "poster"}`;

function StatePill({ item }: { item: PlanItem }) {
  if (item.state === "missed") return <Pill tone="danger" className="shrink-0">Förfallen</Pill>;
  if (item.state === "not_done") return <Pill tone="warning" className="shrink-0">Ej utförd</Pill>;
  if (item.state === "done") return <Pill tone="success" className="shrink-0">Klar</Pill>;
  return null;
}

/** The month as a map: Monday first, the shade by the number of posts, today with a ring, the chosen day marked. */
function MonthMap({ days, today, selected, onSelect, itemsOn, compact }: { days: string[]; today: string; selected: string; onSelect: (day: string) => void; itemsOn: (day: string) => PlanItem[]; compact: boolean }) {
  const cells: (string | null)[] = [...Array.from({ length: weekday(days[0]) }, () => null), ...days];
  while (cells.length % 7) cells.push(null);
  const color = "var(--primary)";
  // The week of each row (2026-10-29: "så det är tydligt vilken vecka det är"), from its first day in the month.
  const weekOfRow = (row: number) => { const first = cells.slice(row * 7, row * 7 + 7).find(Boolean); return first ? isoWeek(first) : null; };
  const cellOf = (day: string) => {
    const items = itemsOn(day);
    const level = Math.min(4, items.length);
    const missed = items.some((item) => item.state === "missed");
    const chosen = day === selected;
    // The name comes from the content (the visible day and count, the rest for screen readers only), so what is seen is
    // what is read (axe label-content-name-mismatch, 2026-10-29).
    return <button key={day} type="button" onClick={() => onSelect(day)} aria-pressed={chosen}
      className={cn("relative flex items-start justify-between rounded-md text-[11px] font-semibold tabular-nums text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
        compact ? "aspect-[1.6] min-h-7 p-1" : "aspect-[1.35] min-h-9 p-1.5",
        day === today ? "ring-2 ring-foreground ring-offset-2 ring-offset-[var(--card)]" : chosen && "ring-2 ring-primary ring-offset-2 ring-offset-[var(--card)]")}
      style={{ background: `color-mix(in srgb, ${color} ${MIX[level]}%, var(--card))` }}>
      {/* The number sits on a small card-coloured chip, so it reads on every shade in both themes. */}
      <span className={cn("rounded px-1 leading-4", level >= 2 && "bg-card/85")}>{parse(day).getUTCDate()}<span className="sr-only"> {MONTHS[parse(day).getUTCMonth()]}, {DAY_NAMES[weekday(day)]}:</span></span>
      {items.length ? <span className="rounded-full bg-card/85 px-1 text-[10px] leading-4 text-muted-foreground">{items.length}<span className="sr-only"> {items.length === 1 ? "post" : "poster"}</span></span> : <span className="sr-only">inget planerat</span>}
      {missed ? <span className="sr-only">, något är förfallet</span> : null}
      {missed ? <span className="absolute bottom-1 right-1 size-2 rounded-full bg-red-600 ring-2 ring-[var(--card)]" aria-hidden="true" /> : null}
    </button>;
  };
  return <div>
    <div className={cn("grid grid-cols-[2rem_repeat(7,minmax(0,1fr))]", compact ? "gap-1" : "gap-1.5")} data-testid="plan-month">
      <span aria-hidden="true" className="pb-1 text-center text-[11px] font-medium text-muted-foreground">V</span>
      {DAY_SHORT.map((name) => <span key={name} aria-hidden="true" className="pb-1 text-center text-[11px] font-medium text-muted-foreground">{name}</span>)}
      {cells.map((day, index) => {
        const week = index % 7 === 0 ? <span key={`week-${index}`} className={cn("flex items-center justify-center text-[11px] font-semibold tabular-nums",
          cells.slice(index, index + 7).includes(selected) ? "text-primary" : "text-muted-foreground")} data-testid="plan-week">
          <span className="sr-only">Vecka </span>{weekOfRow(index / 7)}</span> : null;
        if (!day) return week ? [week, <span key={`blank-${index}`} />] : <span key={`blank-${index}`} />;
        const cell = cellOf(day);
        return week ? [week, cell] : cell;
      })}
    </div>
    <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground" aria-hidden="true">
      Färre{MIX.map((value) => <span key={value} className="size-3 rounded-[3px]" style={{ background: `color-mix(in srgb, ${color} ${value}%, var(--card))` }} />)}Fler
    </div>
    <SrTable caption="Min plan per dag" head={["Dag", "Poster"]} rows={days.filter((day) => itemsOn(day).length).map((day) => [dayLabel(day), itemsOn(day).length])} />
  </div>;
}

function PostRow({ item }: { item: PlanItem }) {
  return <li className="relative flex items-center gap-3 py-2.5">
    <AreaIcon area={PLAN_KIND_INFO[item.kind].area} />
    <div className="min-w-0 flex-1">
      <Link href={item.href} className={cn("stretched-link block truncate text-sm font-medium hover:text-primary", item.state === "done" && "text-muted-foreground")}>{item.title}</Link>
      <p className="truncate text-xs text-muted-foreground"><span className="tabular-nums">{time(item)}</span> · {PLAN_KIND_INFO[item.kind].label}</p>
    </div>
    <StatePill item={item} />
  </li>;
}

type PlanAnswer = OverviewAnswer<{ plan: MeTabData["plan"] }>;

/** Min plan. `plan` is the month read with the tab; stepping to another month reads only that month's plan. */
export function PlanCalendar({ plan, today, level, className, onDay, dayList = true, narrow = false, legendApart = false }: {
  plan: MeTabData["plan"]; today: string; level: 2 | 3; className?: string;
  /** The chosen day and its posts (null while another month is read), for Dagens tidslinje beside the map (2026-10-29). */
  onDay?: (day: string, items: PlanItem[] | null) => void;
  /** The list of the chosen day's posts under the map; off when the timeline shows the day instead. */
  dayList?: boolean;
  /** The map in a narrow column: the small cells. */
  narrow?: boolean;
  /** The types (the legend and filter, with the month's counts) in a card of their own under the map (2026-10-29). */
  legendApart?: boolean;
}) {
  const [month, setMonth] = useState(plan.month);
  const [selected, setSelected] = useState(today.startsWith(plan.month) ? today : plan.from);
  const [hidden, setHidden] = useState<ReadonlySet<PlanKind>>(new Set());
  const other = month !== plan.month;
  const url = other ? `/api/overview?tab=me&part=plan&month=${month}` : null;
  const read = useWorkspaceData<PlanAnswer>(url, (signal) => api<PlanAnswer>(url!, { signal, cache: "no-store" }), { keepPrevious: true });
  const shown = other ? read.data?.data.plan ?? null : plan;
  const days = shown ? daysOf(shown) : [];
  const visible = (shown?.items ?? []).filter((item) => !hidden.has(item.kind));
  const itemsOn = (day: string) => visible.filter((item) => item.date === day);
  const go = (next: string) => { setMonth(next); setSelected(today.startsWith(next) ? today : `${next}-01`); };
  const toggle = (kind: PlanKind) => setHidden((current) => {
    const next = new Set(current);
    if (next.has(kind)) next.delete(kind); else next.add(kind);
    return next;
  });
  const chosen = shown && selected >= shown.from && selected <= shown.to ? itemsOn(selected) : [];
  const compact = narrow || level === 2;
  // Tell the timeline only when the day or its posts change (a key, so a new array alone never sets state again).
  const chosenKey = `${selected}|${shown ? chosen.map((item) => `${item.id}:${item.state}`).join(",") : "…"}`;
  const report = useRef(onDay);
  useEffect(() => { report.current = onDay; });
  useEffect(() => { report.current?.(selected, shown ? chosen : null); }, [chosenKey]); // eslint-disable-line react-hooks/exhaustive-deps -- the key holds the day and its posts
  // The legend is the filter: each type can be hidden and shown; the count is for the month in view.
  const legend = <div role="group" aria-label="Visa typer" className={cn("flex flex-wrap items-center gap-1.5", !legendApart && "mt-3")} data-testid="plan-legend">
    {PLAN_KINDS.map((kind) => {
      const on = !hidden.has(kind);
      const count = (shown?.items ?? []).filter((item) => item.kind === kind).length;
      return <button key={kind} type="button" aria-pressed={on} onClick={() => toggle(kind)}
        className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40",
          on ? "bg-card hover:bg-[var(--surface-hover)]" : "border-dashed bg-transparent text-muted-foreground line-through decoration-1 hover:bg-[var(--surface-hover)]")}>
        <span className={cn("h-2.5 w-3.5 rounded-[3px]", !on && "opacity-35")} style={{ background: colorOf(kind) }} aria-hidden="true" />
        {PLAN_KIND_INFO[kind].label}<span className="inline-block min-w-[2ch] tabular-nums text-muted-foreground">{shown ? count : ""}</span>
      </button>;
    })}
  </div>;
  // With the types apart, the calendar's icon stands on their card and the map has none (2026-10-29).
  const map = <Box className={legendApart ? undefined : className} title="Min plan" anchor="min-plan" area="calendar" icon={legendApart ? null : undefined}>
    <div className="flex flex-wrap items-center gap-2">
      <PeriodStepper previousLabel="Föregående månad" nextLabel="Nästa månad" onPrevious={() => go(shiftMonth(month, -1))} onNext={() => go(shiftMonth(month, 1))}
        today={{ label: "I dag", onClick: () => go(today.slice(0, 7)), disabled: month === today.slice(0, 7) && selected === today }} />
      <p className="min-w-0 flex-1 truncate text-base font-semibold" aria-live="polite" aria-busy={read.fetching || undefined}>{monthLabel(month)}</p>
    </div>
    {legendApart ? null : legend}
    <div className="mt-4 space-y-5">
      <div className={cn("min-w-0", narrow ? "" : compact ? "max-w-xl" : "max-w-3xl")}>
        {shown ? <MonthMap days={days} today={today} selected={selected} onSelect={setSelected} itemsOn={itemsOn} compact={compact} />
          : read.error ? <p role="alert" className="text-sm text-destructive">{read.error}</p>
          // The next month on its way: the map's room (six rows of days) in grey, so nothing under it moves.
          : <div className={cn("native-skeleton rounded-md", compact ? "h-56" : "h-80")} aria-busy="true"><span role="status" className="sr-only">Hämtar planen…</span></div>}
      </div>
      {dayList ? <section aria-label={`Valt datum: ${dayLabel(selected)}`} className="min-w-0" data-testid="plan-day-list">
        <div className="flex items-baseline justify-between gap-2 border-b pb-2">
          <h3 className="text-sm font-semibold">{dayLabel(selected)}{selected === today ? " · i dag" : ""}</h3>
          <span className="text-xs tabular-nums text-muted-foreground">{shown ? posts(chosen.length) : <SkeletonText className="w-12" />}</span>
        </div>
        {chosen.length ? <ul className="divide-y">{chosen.map((item) => <PostRow key={item.id} item={item} />)}</ul>
          : <EmptyNote icon={CalendarDays} title="Inget planerat" text="Välj en annan dag i kalendern." />}
      </section> : null}
    </div>
  </Box>;
  if (!legendApart) return map;
  // The types in their own card above the map (2026-10-29: "ett eget kort som tillhör kalendern … ovanför").
  return <div className={cn("grid content-start gap-5 [html[data-detail='2']_&]:gap-3", className)}>
    <Box title="Visa i kalendern" area="calendar">{legend}</Box>
    {map}
  </div>;
}
