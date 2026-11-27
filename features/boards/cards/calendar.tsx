"use client";

import { useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { EditorSegmented } from "@/components/editor-ribbon";
import { CALENDAR_RANGE_LABEL, CALENDAR_VIEW_LABEL, peopleFit, SCHEDULE_AXIS_EM, SCHEDULE_HOUR_EM, SCHEDULE_TEXT_EM, scheduleColumns, scheduleFit, scheduleHours } from "@/lib/boards/cards/calendar";
import type { CalendarShape } from "@/lib/boards/cards/shapes";
import type { SourceOf } from "@/lib/boards/cards";
import { cn } from "@/lib/utils";
import { Placeholder, useFitCount, useReportShown, type Shown } from "../board-card";

/**
 * Kalenderkortet (2026-11-19): Planering's bookings as a list – time, what and who – or as a schedule with a column per person
 * (per day for the week), the hours of the working day widened to the bookings. Text follows the card's size like the other cards.
 * A time or a name is never cut in the middle (2026-11-20: "07:00-0", "Elis Ham…"): the card measures its box in em and
 * shows what fits whole – the start time alone, "Elis H.", fewer columns or hour marks (lib/boards/cards/calendar.ts).
 */

/** The box's size in em of its own text, measured again whenever it changes size. */
function useBoxEm(box: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => {
      const font = Number.parseFloat(getComputedStyle(element).fontSize) || 14;
      const rect = element.getBoundingClientRect();
      setSize((current) => {
        const next = { w: rect.width / font, h: rect.height / font };
        return current && Math.abs(current.w - next.w) < 0.05 && Math.abs(current.h - next.h) < 0.05 ? current : next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [box]);
  return size;
}
export function CalendarBody({ data, onShown }: { data: CalendarShape; onShown: (shown: Shown | null) => void }) {
  if (!data.items.length) return <Placeholder text={data.range === "today" ? "Inga bokningar i dag." : "Inga bokningar den här veckan."} />;
  return data.view === "schedule" ? <ScheduleView data={data} onShown={onShown} /> : <ListView data={data} onShown={onShown} />;
}

function ListView({ data, onShown }: { data: CalendarShape; onShown: (shown: Shown | null) => void }) {
  const box = useRef<HTMLOListElement | null>(null);
  const fit = useFitCount(box, data.items.length);
  const room = useBoxEm(box);
  useReportShown(fit, data.items.length, data.total, onShown);
  const dayLabel = new Map(data.days.map((day) => [day.key, day.label]));
  // A narrow list keeps its room for what the booking is: the start time alone, and the names as short as they need to be.
  const width = room?.w ?? 24;
  const rangeTime = width >= 16;
  return <ol ref={box} className="h-full space-y-[0.3em] overflow-hidden" aria-label="Bokningar" data-testid="board-calendar-list" data-time={rangeTime ? "range" : "start"}>
    {data.items.map((item, index) => {
      const newDay = data.range === "week" && (index === 0 || data.items[index - 1]!.day !== item.day);
      const people = peopleFit(item.people, width * 0.4, 0.85);
      return <li key={index} data-fit-item="" className={cn("min-w-0", index >= fit && "invisible")} aria-hidden={index >= fit ? true : undefined}>
        {newDay ? <p className="mb-[0.15em] text-[0.75em] font-semibold text-muted-foreground first-letter:uppercase">{dayLabel.get(item.day)}</p> : null}
        <div className="flex min-w-0 items-baseline gap-[0.6em] border-b pb-[0.25em] last:border-0" title={`${item.start}–${item.end} ${item.title}${item.people.length ? ` · ${item.people.join(", ")}` : ""}`}>
          <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums" data-testid="board-calendar-time">{rangeTime ? `${item.start}–${item.end}` : item.start}</span>
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
          {people ? <span className="shrink-0 whitespace-nowrap text-[0.85em] text-muted-foreground" data-testid="board-calendar-people">{people}</span> : null}
        </div>
      </li>;
    })}
  </ol>;
}

function ScheduleView({ data, onShown }: { data: CalendarShape; onShown: (shown: Shown | null) => void }) {
  const root = useRef<HTMLDivElement | null>(null);
  const room = useBoxEm(root);
  const columns = scheduleColumns(data);
  const hours = scheduleHours(data.items);
  const span = (hours.to - hours.from) * 60;
  // What fits whole in the card's box: the columns, the names' form, the time's form and the hour marks.
  const fit = scheduleFit({ widthEm: room?.w ?? 40, heightEm: Math.max(1, (room?.h ?? 20) - 3), labels: columns, hours: hours.to - hours.from });
  const visible = columns.slice(0, fit.columns);
  const shownItems = visible.reduce((sum, column) => sum + column.items.length, 0);
  useReportShown(shownItems, shownItems, data.total, onShown);
  const marks = Array.from({ length: hours.to - hours.from + 1 }, (_, index) => hours.from + index).filter((hour) => (hour - hours.from) % fit.hourStep === 0);
  const text = { fontSize: `${SCHEDULE_TEXT_EM}em` };
  /** A booking's inner width in em of its own text, for the week's names under it. */
  const bookingEm = (((room?.w ?? 40) - SCHEDULE_AXIS_EM - 0.2 * (fit.columns - 1)) / fit.columns - 0.2) / SCHEDULE_TEXT_EM - 0.85;
  return <div ref={root} className="flex h-full min-h-0 flex-col" data-testid="board-calendar-schedule" data-names={fit.names} data-time={fit.time} data-columns={fit.columns} role="group" aria-label="Schema">
    {/* The names in their column: a first and a last name may take two lines, a word never breaks; "Elis H." where they do not fit. */}
    <div className="flex min-w-0 gap-[0.2em]" style={{ paddingLeft: `${SCHEDULE_AXIS_EM}em` }} aria-hidden="true">
      {visible.map((column) => <div key={column.key || "none"} className="min-w-0 flex-1">
        <p className="line-clamp-2 px-[0.1em] text-center font-semibold leading-tight [overflow-wrap:normal] first-letter:uppercase" style={text} title={column.label} data-testid="board-calendar-name">{fit.names === "full" ? column.label : column.short}</p>
      </div>)}
    </div>
    <div className="relative mt-[0.2em] flex min-h-0 flex-1">
      <div className="relative shrink-0 text-muted-foreground" style={{ width: `${SCHEDULE_AXIS_EM}em` }} aria-hidden="true">
        {marks.map((hour) => <span key={hour} className="absolute right-[0.4em] -translate-y-1/2 tabular-nums" style={{ top: `${((hour - hours.from) * 60 / span) * 100}%`, fontSize: `${SCHEDULE_HOUR_EM}em` }}>{String(hour).padStart(2, "0")}</span>)}
      </div>
      <div className="relative flex min-w-0 flex-1 gap-[0.2em]">
        {marks.map((hour) => <div key={hour} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border/70" style={{ top: `${((hour - hours.from) * 60 / span) * 100}%` }} aria-hidden="true" />)}
        {visible.map((column) => <div key={column.key || "none"} className="relative min-w-0 flex-1 rounded-sm bg-muted/30" role="list" aria-label={column.label}>
          {column.items.map((item, index) => {
            const top = Math.max(0, ((item.from - hours.from * 60) / span) * 100);
            const height = Math.max(3, ((item.to - item.from) / span) * 100);
            const people = data.range === "week" ? peopleFit(item.people, bookingEm) : "";
            return <div key={index} role="listitem" className="absolute inset-x-[0.1em] overflow-hidden rounded-[0.3em] border-l-[0.25em] border-[var(--card-accent)] bg-[color-mix(in_srgb,var(--card-accent)_16%,var(--card))] px-[0.3em] py-[0.1em] leading-tight"
              style={{ top: `${top}%`, height: `max(${height}%, 1.45em)`, ...text }} title={`${item.start}–${item.end} ${item.title}${item.people.length ? ` · ${item.people.join(", ")}` : ""}`}>
              <span className="block whitespace-nowrap font-semibold tabular-nums" data-testid="board-calendar-time">{fit.time === "range" ? `${item.start}–${item.end}` : item.start}</span>
              <span className="block truncate">{item.title}</span>
              {people ? <span className="block truncate text-muted-foreground">{people}</span> : null}
            </div>;
          })}
        </div>)}
      </div>
    </div>
    {columns.length > visible.length ? <p className="mt-[0.2em] text-[0.7em] text-muted-foreground" data-testid="board-calendar-more">Visar {visible.length} av {columns.length} kolumner. Gör kortet bredare eller välj Lista.</p> : null}
  </div>;
}

export function CalendarSettings({ source, onSource }: { source: SourceOf<"calendar">; onSource: (source: SourceOf<"calendar">) => void }) {
  const id = useId();
  return <div className="space-y-3">
    <div className="grid gap-1.5"><span className="field-label text-xs font-medium" id={`${id}-range`}>Vilka bokningar</span>
      <EditorSegmented label="Vilka bokningar" value={source.range ?? "today"} onChange={(range) => onSource({ ...source, range })} testId="card-calendar-range"
        options={(["today", "week"] as const).map((value) => ({ value, label: CALENDAR_RANGE_LABEL[value] }))} /></div>
    <div className="grid gap-1.5"><span className="field-label text-xs font-medium">Visa som</span>
      <EditorSegmented label="Visa som" value={source.view ?? "list"} onChange={(view) => onSource({ ...source, view })} testId="card-calendar-view"
        options={(["list", "schedule"] as const).map((value) => ({ value, label: CALENDAR_VIEW_LABEL[value] }))} /></div>
    <p className="text-xs text-muted-foreground">Bokningarna kommer från Planering och följer samma behörighet. Schemat har en kolumn per person i dag och en per dag för veckan. Namnen döljs utanför appen om du inte väljer annat när du publicerar.</p>
  </div>;
}
