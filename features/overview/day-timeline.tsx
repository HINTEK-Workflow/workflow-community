"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock, CalendarDays, Play } from "lucide-react";
import { AreaIcon } from "@/components/area-icon";
import { Button } from "@/components/ui/button";
import { useRunningTimers } from "@/components/workspace-actions";
import { swedishClock } from "@/lib/swedish-time";
import { panelAreaColor } from "@/lib/workflow/panel-area";
import { isoWeek } from "@/lib/workflow/schedule";
import { cn } from "@/lib/utils";
import { PLAN_KIND_INFO, PLANNING_HREF, type PlanItem } from "@/lib/overview/me";
import { clockMinutes, outsideWindow, placeTimed, timelineStart, TIMELINE_HOURS } from "@/lib/overview/timeline";
import { Box, EmptyNote, Pill } from "./viz";

/**
 * Dagens tidslinje (2026-10-29: "Inför även denna … När jag klickar på kalendern så kan det byta innehåll"): the day
 * chosen in Min plan as hours, from the same posts as the map (lib/overview/me-plan.ts buildPlan) – no read of its own. Always
 * eight hours of the working day (lib/overview/timeline.ts timelineStart); "Hela dygnet" lets the person scroll through all 24
 * for work at other times. A post with a time sits on its hours (a round's start only: half an hour), the others are listed
 * "Under dagen" above the hours. Today has a red line at the Swedish clock. Posts that overlap share the width.
 */
const HOUR = 44;
/** Room above the first hour line, so its label is not cut. */
const PAD = 8;
const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const DAY_NAMES = ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"];
const HOURS = Array.from({ length: 25 }, (_, hour) => hour);
const clockOf = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
/** Pixels from midnight. */
const top = (minutes: number) => PAD + (minutes / 60) * HOUR;
function dayTitle(day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  const name = DAY_NAMES[(date.getUTCDay() + 6) % 7];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

function State({ item }: { item: PlanItem }) {
  if (item.state === "missed") return <Pill tone="danger" className="shrink-0">Förfallen</Pill>;
  if (item.state === "not_done") return <Pill tone="warning" className="shrink-0">Ej utförd</Pill>;
  if (item.state === "done") return <Pill tone="success" className="shrink-0">Klar</Pill>;
  return null;
}

/** The Swedish clock, moved on every half minute (only for today). */
function useClock(on: boolean) {
  const [clock, setClock] = useState(() => swedishClock());
  useEffect(() => {
    if (!on) return;
    const timer = window.setInterval(() => setClock(swedishClock()), 30_000);
    return () => window.clearInterval(timer);
  }, [on]);
  return clock;
}

/**
 * A click on a post with a job chooses it for Tid (2026-10-29: "Jag vill inte att det startar tiden. bara byter jobb");
 * Tid then offers Starta tid and Skriv tid for it. A second click lets it go. Öppna opens the job. A post without a job (a
 * meeting, a round, a project's end) is only shown; Min kalender opens the planning.
 */
type Picking = { selectedId: string | null; onPick: (item: PlanItem | null) => void; running: (item: PlanItem) => boolean };

/** The post's title: a button that chooses its job for Tid, or plain text. */
function PostTitle({ item, pick, className }: { item: PlanItem; pick: Picking; className?: string }) {
  const done = item.state === "done";
  const text = cn("block truncate text-left text-sm hover:text-primary", done && "text-muted-foreground line-through", className);
  // A finished post can be chosen too (2026-10-29): to write time on it afterwards or continue the work.
  if (!item.job) return <span className={cn(text, "hover:text-inherit")}>{item.title}</span>;
  const chosen = pick.selectedId === item.id;
  return <button type="button" className={cn("stretched-link w-full max-w-full outline-none focus-visible:underline", text)} aria-pressed={chosen}
    onClick={() => pick.onPick(chosen ? null : item)} aria-label={chosen ? `${item.title}, valt i Tid` : `Välj ${item.title} i Tid`} title={chosen ? "Valt i Tid" : "Välj arbetsordern i Tid"}
    data-testid="timeline-pick">{item.title}</button>;
}
function PostSide({ item, pick }: { item: PlanItem; pick: Picking }) {
  // Fixed places for the pill and Öppna (2026-10-29: "en bestämd plats och bredd"), kept also when empty – in every
  // block that has a job or a state; a plain booking (a meeting without project) keeps its whole width for its title.
  if (!item.job && item.state === "planned") return null;
  return <>
    <span className="flex shrink-0 justify-end @sm/block:w-[6.5rem]" data-column="pill">
      {pick.running(item) ? <Pill tone="info" className="shrink-0"><Play className="size-3" aria-hidden="true" />Tiden går</Pill>
        : pick.selectedId === item.id ? <Pill tone="info" className="shrink-0">Vald</Pill> : <State item={item} />}
    </span>
    {/* Text only, no arrow (2026-10-24). */}
    <span className="flex w-14 shrink-0 justify-end" data-column="action">
      {item.job ? <Button asChild size="sm" variant="ghost" className="tap-above relative h-7 px-2 text-xs"><Link href={item.href} aria-label={`Öppna ${item.title}`}>Öppna</Link></Button> : null}
    </span>
  </>;
}

const UNTIMED_ROWS = 3;

export function DayTimeline({ day, today, items, className, selectedId = null, onPick }: { day: string; today: string; items: readonly PlanItem[] | null; className?: string;
  /** The post chosen for Tid, and the choice (null lets it go). */
  selectedId?: string | null; onPick?: (item: PlanItem | null) => void }) {
  const isToday = day === today;
  const clock = useClock(isToday);
  const source = useRunningTimers();
  // A busy day's posts without a time fold away, so the hours stay in view (2026-11-02); the choice follows the day.
  const [allDay, setAllDay] = useState<string | null>(null);
  const post: Picking = { selectedId, onPick: (item) => onPick?.(item), running: (item) => Boolean(item.job && source?.timers.some((timer) => timer.taskId === item.job!.id)) };
  const pickedRing = (item: PlanItem) => selectedId === item.id ? "bg-secondary" : "";
  const [whole, setWhole] = useState(false);
  const view = useRef<HTMLDivElement>(null);
  const placed = placeTimed(items ?? []);
  const untimed = (items ?? []).filter((item) => !item.start);
  const now = clockMinutes(clock);
  const start = timelineStart(placed);
  const outside = outsideWindow(placed, start);
  // The eight hours are the view's scroll position: fixed in the ordinary view, free to scroll with Hela dygnet.
  useEffect(() => { if (view.current) view.current.scrollTop = top(start * 60) - PAD; }, [start, whole, day]);
  return <Box className={className} title={isToday ? "Dagens tidslinje" : "Tidslinje"} area="calendar" icon={CalendarClock} anchor="tidslinje"
    action={<span className="flex items-center gap-1">
      <Button size="sm" variant={whole ? "secondary" : "ghost"} aria-pressed={whole} onClick={() => setWhole((value) => !value)} data-testid="overview-timeline-whole">
        {whole ? "8 h" : outside ? `Hela dygnet (${outside} till)` : "Hela dygnet"}
      </Button>
      <Button asChild size="sm" variant="ghost"><Link href={PLANNING_HREF}>Min kalender</Link></Button>
    </span>}>
    <div data-testid="overview-timeline" data-day={day} data-whole={whole || undefined}>
      <p className="mb-3 text-sm font-semibold" aria-live="polite">{dayTitle(day)} <span className="font-normal text-muted-foreground">· vecka {isoWeek(day)}{isToday ? " · i dag" : ""}</span></p>
      {items === null ? <div className="native-skeleton rounded-md" style={{ height: TIMELINE_HOURS * HOUR + PAD * 2 }} aria-busy="true" /> : <>
        {!items.length ? <div className="mb-3"><EmptyNote compact icon={CalendarDays} title="Inget planerat den här dagen" /></div> : null}
        {untimed.length ? <section aria-label="Under dagen" className="mb-3">
          <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">Under dagen</h3>
          <ul className="space-y-1.5">{(allDay === day ? untimed : untimed.filter((item, index) => index < UNTIMED_ROWS || selectedId === item.id || post.running(item))).map((item) => <li key={item.id} className={cn("tap-card @container/block relative flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5", pickedRing(item))}
            style={{ "--tone": panelAreaColor(PLAN_KIND_INFO[item.kind].area) } as React.CSSProperties}>
            <AreaIcon area={PLAN_KIND_INFO[item.kind].area} />
            <div className="min-w-0 flex-1">
              <PostTitle item={item} pick={post} className="font-medium" />
              <p className="truncate text-xs text-muted-foreground">{PLAN_KIND_INFO[item.kind].label}</p>
            </div>
            <PostSide item={item} pick={post} />
          </li>)}</ul>
          {untimed.length > UNTIMED_ROWS ? <Button type="button" size="sm" variant="ghost" className="mt-1" aria-expanded={allDay === day} onClick={() => setAllDay(allDay === day ? null : day)} data-testid="timeline-untimed-more">{allDay === day ? "Visa färre" : `Visa alla ${untimed.length}`}</Button> : null}
        </section> : null}
        {/* Always eight hours high; the whole day lies under it and Hela dygnet makes it scroll. */}
        <div ref={view} className={cn("relative rounded-md", whole ? "overflow-y-auto overscroll-contain" : "overflow-hidden")} style={{ height: TIMELINE_HOURS * HOUR + PAD * 2 }}
          tabIndex={whole ? 0 : undefined} aria-label={whole ? "Hela dygnet, rulla för att se fler timmar" : undefined} data-testid="overview-timeline-view">
          <div className="relative" style={{ height: top(24 * 60) + PAD }}>
            {HOURS.map((hour) => <div key={hour} className="absolute inset-x-0 flex h-0 items-center gap-2" style={{ top: top(hour * 60) }} aria-hidden="true">
              <span className="w-11 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{clockOf(hour)}</span>
              <span className="h-px flex-1 bg-border" />
            </div>)}
            <ol className="absolute bottom-0 left-[3.25rem] right-0 top-0">
              {placed.map(({ item, from, to, lane, lanes }) => {
                const height = Math.max(30, top(to) - top(from) - 3);
                const roomy = height >= 60;
                return <li key={item.id} className={cn("tap-card @container/block absolute overflow-hidden rounded-md border bg-card", item.state === "done" && "opacity-75", pickedRing(item))}
                  style={{ top: top(from) + 1, height, left: `calc(${(lane / lanes) * 100}% + ${lane ? 2 : 0}px)`, width: `calc(${100 / lanes}% - ${lanes > 1 ? 2 : 0}px)`,
                    "--tone": panelAreaColor(PLAN_KIND_INFO[item.kind].area), background: selectedId === item.id ? "var(--secondary)" : `color-mix(in srgb, var(--tone) 7%, var(--card))` } as React.CSSProperties}>
                  <div className={cn("relative flex h-full gap-2 px-2.5", roomy ? "items-start py-2" : "items-center py-1")}>
                    {roomy ? <AreaIcon area={PLAN_KIND_INFO[item.kind].area} /> : null}
                    <div className={cn("min-w-0 flex-1", !roomy && "flex items-baseline gap-2")}>
                      <PostTitle item={item} pick={post} className="font-semibold" />
                      <p className="truncate text-xs tabular-nums text-muted-foreground">{item.start}{item.end ? `–${item.end}` : ""} · {PLAN_KIND_INFO[item.kind].label}</p>
                    </div>
                    <PostSide item={item} pick={post} />
                  </div>
                </li>;
              })}
            </ol>
            {isToday ? <div className="pointer-events-none absolute inset-x-0 z-10 flex h-0 items-center" style={{ top: top(now) }} data-testid="overview-timeline-now">
              {/* A zero-high row: the label and the line are both centred on the minute. */}
              <span className="w-11 shrink-0 rounded-full bg-red-600 px-1 text-center text-[10.5px] font-semibold tabular-nums leading-5 text-white">{clock}</span>
              <span className="h-0.5 flex-1 bg-red-600" aria-hidden="true" />
            </div> : null}
          </div>
        </div>
      </>}
    </div>
  </Box>;
}
