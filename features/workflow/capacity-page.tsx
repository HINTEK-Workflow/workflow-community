"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarX, CheckCircle2, ChevronLeft, ChevronRight, Gauge } from "lucide-react";
import { PageHeader } from "@/components/page-shell";
import { RowsSkeleton } from "@/components/skeleton";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Panel } from "@/features/kfid/ui";
import { useSubPageHref } from "@/features/kfid/use-return-to";
import { Pill } from "@/features/overview/viz";
import { addSwedishDays, formatSwedish, swedishDayKey } from "@/lib/swedish-time";
import { conflictLine, summarizeAvailability } from "@/lib/workflow/availability-summary";
import { capacityRows, capacityWeek, formatCapacityHours, type CapacityData } from "@/lib/workflow/capacity-summary";
import { capacityLoads } from "@/lib/workflow/planning-rounds";
import { cn } from "@/lib/utils";
import { cloudCapacityRead, type CapacityRead } from "./capacity-read";
import { useModules } from "./use-modules";
import { holidayName, isoWeek, shortDay } from "@/lib/workflow/schedule";

const dayRange = (from: string, to: string) => from === to ? shortDay(from) : `${shortDay(from)}–${shortDay(to)}`;
const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;

/**
 * One week of the capacity count: the read, the rows and the week's clashes. A member only has their own row and their own clashes.
 * Nothing moves between weeks (2026-11-02): the shown week stays on screen, dimmed, until the next week's answer is here.
 */
function useCapacityWeek(read: CapacityRead) {
  const [anchor, setAnchor] = useState(() => new Date());
  const week = useMemo(() => capacityWeek(anchor), [anchor]);
  const askedFrom = swedishDayKey(week.startsAt);
  const askedTo = swedishDayKey(new Date(week.endsAt.getTime() - 1));
  const [loaded, setLoaded] = useState<{ from: string; week: typeof week; read: Awaited<ReturnType<CapacityRead>> } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    read({ from: askedFrom, to: askedTo })
      .then((answer) => { if (current) { setLoaded({ from: askedFrom, week, read: answer }); setError(""); } })
      .catch((failure: unknown) => { if (current) setError(failure instanceof Error ? failure.message : "Kapaciteten kunde inte hämtas."); });
    return () => { current = false; };
  }, [askedFrom, askedTo, read, week]);
  const shown = loaded?.week ?? week;
  const busy = Boolean(loaded && loaded.from !== askedFrom);
  const from = swedishDayKey(shown.startsAt);
  const to = swedishDayKey(new Date(shown.endsAt.getTime() - 1));
  const answer = loaded?.read ?? null;
  const data = answer?.data ?? null;
  const loads = useMemo(() => answer ? capacityLoads(answer.data.activities, answer.rounds) : [], [answer]);
  const { rows, unassignedMinutes } = useMemo(() => data ? capacityRows({ ...data, activities: loads }, shown.startsAt) : { rows: [], unassignedMinutes: 0 }, [data, loads, shown.startsAt]);
  const conflicts = useMemo(() => {
    if (!data) return [];
    const members = new Map(data.members.map((member) => [member.id, member]));
    const inWeek = (startsAt: string, endsAt: string) => new Date(startsAt) < shown.endsAt && new Date(endsAt) > shown.startsAt;
    return summarizeAvailability(loads, { weeklyWorkMinutesFor: (id) => members.get(id)?.weeklyWorkMinutes, noFixedHoursFor: (id) => members.get(id)?.noFixedHours, absences: data.absences }).conflicts
      // A long absence names the booking only in the week the booking is in.
      .filter((conflict) => members.has(conflict.userId) && inWeek(conflict.startsAt, conflict.endsAt) && (conflict.kind !== "absence" || inWeek(conflict.first.startsAt, conflict.first.endsAt)))
      .map((conflict) => ({ conflict, name: members.get(conflict.userId)?.name ?? "" }));
  }, [data, loads, shown]);
  // Why a week has fewer hours: a weekday holiday is named beside the dates.
  const holidays = useMemo(() => Array.from({ length: 5 }, (_, day) => holidayName(swedishDayKey(addSwedishDays(shown.startsAt, day)))).filter(Boolean), [shown.startsAt]);
  return { week, from, to, busy, data, rows, unassignedMinutes, conflicts, holidays, error, setAnchor };
}

type CapacityWeekState = ReturnType<typeof useCapacityWeek>;

function WeekStepper({ state }: { state: CapacityWeekState }) {
  return <div className="flex items-center gap-1">
    <IconButton label="Föregående vecka" variant="outline" onClick={() => state.setAnchor(addSwedishDays(state.week.startsAt, -7))} data-testid="capacity-previous"><ChevronLeft /></IconButton>
    <Button type="button" variant="outline" onClick={() => state.setAnchor(new Date())} data-testid="capacity-today">Denna vecka</Button>
    <IconButton label="Nästa vecka" variant="outline" onClick={() => state.setAnchor(addSwedishDays(state.week.startsAt, 7))} data-testid="capacity-next"><ChevronRight /></IconButton>
  </div>;
}

/**
 * Arbetstid och historik: the only screen with that history. Whoever sees the team opens it under the person's row, and only a person with
 * a change or a weekly time of their own has it (2026-11-02): the same sentence under everyone drowned who has room this week.
 */
function WorkingTimeDetails({ member, organizationWeeklyWorkMinutes }: { member: CapacityData["members"][number]; organizationWeeklyWorkMinutes: number }) {
  const own = member.memberWeeklyWorkMinutes ?? null;
  const events = member.events ?? [];
  if (own === null && !events.length) return null;
  return <details className="text-xs text-muted-foreground @lg:col-span-3" data-testid="capacity-working-time">
    <summary className="w-fit cursor-pointer">Arbetstid och historik</summary>
    <p className="mt-2">Veckoarbetstid: {formatCapacityHours(member.weeklyWorkMinutes)}. Organisationsstandard: {formatCapacityHours(organizationWeeklyWorkMinutes)}. {own === null ? "Medlemmen följer standarden." : `Personligt undantag: ${formatCapacityHours(own)}.`}</p>
    {events.length ? <ol className="mt-3 space-y-2 text-xs">{events.map((event) => <li key={event.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
      <span className="text-foreground">{event.previousMinutes === null ? "Inget undantag" : formatCapacityHours(event.previousMinutes)} → {event.nextMinutes === null ? "Inget undantag" : formatCapacityHours(event.nextMinutes)} · {event.actorName}</span>
      <span>{formatSwedish(event.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
    </li>)}</ol> : null}
  </details>;
}

function CapacityList({ state }: { state: CapacityWeekState }) {
  const { data, rows, unassignedMinutes, error, busy } = state;
  const memberOf = (id: string) => data?.members.find((member) => member.id === id);
  return <div aria-busy={busy} className={cn("transition-opacity", busy && "opacity-60")}>
    {error ? <p role="alert" className="notice text-destructive">{error}</p>
      : !data ? <RowsSkeleton rows={4} label="Hämtar kapaciteten…" />
      : !rows.length ? <p className="text-sm text-muted-foreground" data-testid="capacity-empty">Ingen fast arbetstid att visa.</p>
      : <ol className="@container divide-y rounded-xl border" data-testid="capacity-list">
        {rows.map((row) => { const member = memberOf(row.id); return <li key={row.id} className="grid gap-x-4 gap-y-2 p-4 @lg:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_8rem] @lg:items-center" data-testid="capacity-row">
          <div className="min-w-0">
            <p className="text-sm font-semibold [overflow-wrap:anywhere]">{row.name}</p>
            {row.absences.length ? <p className="mt-1 text-xs text-muted-foreground">{row.absences.map((absence) => `${absence.label}, ${dayRange(absence.from, absence.to)}`).join(" · ")}</p> : null}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{formatCapacityHours(row.plannedMinutes)} av {formatCapacityHours(row.availableMinutes)}</p>
            <div role="img" aria-label={`${row.plannedPercent} procent av tillgänglig tid`} className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full ${row.overplannedMinutes ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${row.plannedPercent}%` }} />
            </div>
          </div>
          <div className="@lg:text-right">
            {row.overplannedMinutes
              ? <Pill tone="warning" className="whitespace-nowrap">{formatCapacityHours(row.overplannedMinutes)} för mycket</Pill>
              : <Pill tone="neutral" className="whitespace-nowrap">{formatCapacityHours(row.remainingPlannedMinutes)} kvar</Pill>}
          </div>
          {data.canViewTeam && member ? <WorkingTimeDetails member={member} organizationWeeklyWorkMinutes={data.organizationWeeklyWorkMinutes ?? member.weeklyWorkMinutes} /> : null}
        </li>; })}
      </ol>}
    {data && !error && unassignedMinutes ? <p className="mt-3 text-xs text-muted-foreground" data-testid="capacity-unassigned">{formatCapacityHours(unassignedMinutes)} bokat utan ansvarig räknas inte här.</p> : null}
  </div>;
}

const clashDescription = (state: CapacityWeekState) => `${count(state.conflicts.length, "tidskrock", "tidskrockar")} ${state.data?.canViewTeam ? "i teamets planering" : "i din planering"} · rådgivande`;

function ConflictList({ state }: { state: CapacityWeekState }) {
  const subPage = useSubPageHref();
  // A clash leads to its booking (2026-11-02). Only real bookings the person may read: a round's load has no booking to open.
  const readable = new Set(state.data?.activities.map((activity) => activity.id));
  return <ol data-testid="availability-conflict-list" aria-busy={state.busy} className={cn("divide-y rounded-xl border border-amber-200 bg-amber-50/40 transition-opacity dark:border-amber-900 dark:bg-amber-950/20", state.busy && "opacity-60")}>
    {state.conflicts.map(({ conflict, name }, index) => <li key={`${conflict.kind}-${conflict.userId}-${conflict.first.activityId}-${conflict.second.activityId}-${conflict.startsAt}-${index}`} className="flex gap-3 p-4">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-semibold [overflow-wrap:anywhere]">{state.data?.canViewTeam ? `${name}: ` : ""}{conflict.activities.map((item, position) => <Fragment key={item.activityId}>{position ? " och " : ""}{readable.has(item.activityId) ? <Link href={subPage(`/?view=planning&activityId=${encodeURIComponent(item.activityId)}&edit=1`)} data-testid="availability-conflict-booking" className="text-primary hover:underline">{item.title}</Link> : item.title}</Fragment>)}</p>
        <p className="mt-1 text-xs text-muted-foreground">{conflictLine(conflict)}. Justera en bokning när bemanningen är bestämd.</p>
      </div>
    </li>)}
  </ol>;
}

/**
 * Planering's view Kapacitet (2026-11-01, decision 1; 2026-11-02: the only place for it): a read-only list per person and week,
 * booked hours against the time available (the one count, capacityInWindow), and the week's clashes. Read through
 * /api/planning-capacity, whose own check decides who is shown: whoever may see Teamet gets the team, everyone else themself. Bookings
 * are changed in Kalender, never here.
 */
export function CapacityPage() {
  const moduleIsOn = useModules();
  const roundsOn = moduleIsOn("rounds");
  const read = useMemo(() => cloudCapacityRead(roundsOn), [roundsOn]);
  const state = useCapacityWeek(read);
  const { from, to, data, rows, holidays, conflicts, error } = state;
  const planned = rows.reduce((sum, row) => sum + row.plannedMinutes, 0);
  const overbooked = rows.filter((row) => row.overplannedMinutes).length;
  const description = [`${shortDay(from)}–${shortDay(to)}`, ...holidays,
    ...(data?.canViewTeam ? [count(rows.length, "person", "personer"), `${formatCapacityHours(planned)} planerat`, ...(overbooked ? [`${overbooked} överbokad${overbooked === 1 ? "" : "e"}`] : [])] : [])].join(" · ");
  return <div className="space-y-6" data-testid="capacity-page">
    <PageHeader title="Planering" description="Bokade tider mot arbetstiden, där helgdagar och frånvaro är borträknade. Arbetsordrar utan bokning räknas inte." />
    <Panel icon={Gauge} title={`Vecka ${isoWeek(from)}`} description={description} actions={<WeekStepper state={state} />}>
      <CapacityList state={state} />
    </Panel>
    {data && !error ? <Panel icon={conflicts.length ? CalendarX : CheckCircle2} title="Tidskrockar" description={conflicts.length ? clashDescription(state) : undefined}>
      {conflicts.length ? <ConflictList state={state} /> : <p aria-busy={state.busy} className={cn("text-sm text-muted-foreground", state.busy && "opacity-60")} data-testid="availability-no-conflicts">Inga tidskrockar den här veckan.</p>}
    </Panel> : null}
  </div>;
}

/**
 * Local has no tab Kapacitet (2026-11-02), since its Planering is only Kalender. The same week in one folded card under the
 * lists, with the same function and the same words.
 */
export function CapacityFoldedPanel({ read }: { read: CapacityRead }) {
  const state = useCapacityWeek(read);
  const row = state.rows[0];
  const summary = row ? `${formatCapacityHours(row.plannedMinutes)} av ${formatCapacityHours(row.availableMinutes)} denna vecka · ${count(state.conflicts.length, "tidskrock", "tidskrockar")}` : "Ingen fast arbetstid att visa.";
  return <div id="planning-part-capacity"><Panel icon={Gauge} collapsible defaultCollapsed foldKey="planning-capacity" title="Kapacitet" description={summary}>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">Vecka {isoWeek(state.from)}<span className="ml-2 font-normal text-muted-foreground">{[`${shortDay(state.from)}–${shortDay(state.to)}`, ...state.holidays].join(" · ")}</span></p><WeekStepper state={state} /></div>
      <CapacityList state={state} />
      {state.conflicts.length ? <ConflictList state={state} /> : state.data ? <p className="text-sm text-muted-foreground" data-testid="availability-no-conflicts">Inga tidskrockar den här veckan.</p> : null}
    </div>
  </Panel></div>;
}
