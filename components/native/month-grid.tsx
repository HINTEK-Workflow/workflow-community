"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { hoursShort, monthGrid, monthTitle } from "@/lib/workflow/month-grid";

/**
 * The month as a real calendar (2026-10-12): seven columns Monday–Sunday with a week number in front of each row, today
 * framed, a value per day (hours by default, a dot when there is none), the chosen day filled, and ‹ › to move a month. A
 * component for the pages to place; it holds no state. The page keeps `anchor` (any day of the shown month), `selected` and
 * the values, and shows the chosen day’s rows under the grid. Days outside the month are dimmed and not pressable. Pure
 * rules: lib/workflow/month-grid.ts. Meant for level 1 first; usable at levels 2–3 later.
 *
 * Days are Swedish calendar days, "YYYY-MM-DD". `values` are seconds per day unless `format` says otherwise.
 */
export type NativeMonthGridProps = {
  anchor: string;
  today: string;
  selected?: string | null;
  values?: Record<string, number>;
  /** The small text in a day’s cell (default: hours with a comma, "6,5"); an empty text shows the dot. */
  format?: (value: number) => string;
  onSelect: (day: string) => void;
  /** -1 / +1: the page moves `anchor` by that many months. */
  onMoveMonth: (offset: -1 | 1) => void;
  /** Back to the month of today (and selects it); leave out to hide I dag. */
  onToday?: () => void;
  /** What a day's value means for a screen reader (default: "6,5 timmar"); a variant for a count or a mark, as the rounds' preview. */
  valueLabel?: (value: number, text: string) => string;
  /** A day drawn in a tone: "success" a marked day (the rounds' preview: an occurrence, green), "warning" one that needs attention (outside the work order's period). */
  tone?: (value: number) => "warning" | "success" | undefined;
  testId?: string;
  /** Always six week rows, so the grid never changes height between months (the rounds' preview, 2026-10-28). */
  fixedWeeks?: boolean;
};

export function NativeMonthGrid({ anchor, today, selected, values, format = hoursShort, onSelect, onMoveMonth, onToday, valueLabel = (_value, text) => `${text} timmar`, tone, testId = "native-month", fixedWeeks = false }: NativeMonthGridProps) {
  const grid = monthGrid({ anchor, today, selected, values, fixedWeeks });
  return <div className="native-month" data-testid={testId}>
    <div className="native-month-head">
      <button type="button" aria-label="Föregående månad" onClick={() => onMoveMonth(-1)} data-testid={`${testId}-previous`}><ChevronLeft aria-hidden="true" /></button>
      <div className="native-month-title" aria-live="polite" data-testid={`${testId}-title`}>{monthTitle(anchor)}{onToday ? <button type="button" className="native-month-today" onClick={onToday} data-testid={`${testId}-today`}>I dag</button> : null}</div>
      <button type="button" aria-label="Nästa månad" onClick={() => onMoveMonth(1)} data-testid={`${testId}-next`}><ChevronRight aria-hidden="true" /></button>
    </div>
    <div className="native-month-grid" role="grid" aria-label={monthTitle(anchor)}>
      <span className="native-month-wd" aria-hidden="true" />
      {["M", "T", "O", "T", "F", "L", "S"].map((letter, index) => <span key={index} className="native-month-wd" aria-hidden="true">{letter}</span>)}
      {grid.weeks.map((week) => <div key={week.days[0]!.key} role="row" className="contents">
        <span className="native-month-week" role="rowheader" aria-label={`Vecka ${week.week}`}>{week.week}</span>
        {week.days.map((cell) => {
          const text = cell.inMonth && cell.value > 0 ? format(cell.value) : "";
          return <button key={cell.key} type="button" role="gridcell" className="native-month-day" data-out={!cell.inMonth || undefined} data-today={cell.today || undefined} data-selected={cell.selected || undefined}
            data-has={text ? "" : undefined} data-tone={cell.inMonth && cell.value > 0 ? tone?.(cell.value) : undefined} disabled={!cell.inMonth} aria-selected={cell.selected} aria-current={cell.today ? "date" : undefined} onClick={() => onSelect(cell.key)} data-testid={`${testId}-day`} data-day={cell.key}
            aria-label={`${cell.day} ${monthTitle(cell.key).split(" ")[0]}${text ? `, ${valueLabel(cell.value, text)}` : ""}`}>
            <span>{cell.day}</span><small>{cell.inMonth ? text : ""}</small>
          </button>;
        })}
      </div>)}
    </div>
  </div>;
}
