import { isLateTask } from "./late-tasks";
import { jobObstacle } from "./obstacles";
import { occurrenceOverdue, roundReminderFor, type ScheduleView } from "./form-schedule";
import { roundStartAction } from "./round-work-orders";
import { isTaskOpen } from "./task-cancel";
import { rankNextActions, type NextAction, type NextCandidate } from "./next-actions";
import { deviationHref } from "@/lib/self-inspection/deviation-link";
import { MY_DAY_TILES, type MyDayTile } from "./native-layout";

/**
 * Hem's chosen tiles Gör detta nu, Förfallet and Mina avvikelser (dashboard etapp 2, 2026-10-28): what GET
 * /api/my-day answers, worked out here from rows the server has already read inside the person's company and rights.
 * Pure, so the route, the tests and any later caller count the same way – and with the same rules as the lists: a job is
 * late by isLateTask (Jobb, the key figure, Hem's "N försenade"), a round is the person's by roundReminderFor (the bell),
 * and a deviation is open while it is Öppen or Pågår, late when its Klart senast has passed (Swedish day).
 */
export { MY_DAY_TILES, type MyDayTile };
/** At most this many rows per tile (Hem keeps a fixed height); Översikten's Jag asks for more by the same rules. */
export const MY_DAY_ROWS = 3;
/** Where Förfallet's "Visa alla" leads: the person's late jobs in Jobb. */
export const MY_DAY_OVERDUE_HREF = "/?view=tasks&type=all&filter=overdue&scope=mine";
export const MY_DAY_DEVIATIONS_HREF = "/?view=deviations";
export const myDayJobHref = (id: string, kind: string) => `/?view=workflow_task&taskId=${encodeURIComponent(id)}&taskType=${encodeURIComponent(kind)}`;

/** `?tiles=next,overdue` → the known tiles once each, in the fixed order; anything else is dropped. */
export function parseMyDayTiles(value: string | null | undefined): MyDayTile[] {
  const asked = new Set(String(value ?? "").split(",").map((item) => item.trim()));
  return MY_DAY_TILES.filter((tile) => asked.has(tile));
}

/** One row on a tile: a title, a short fact at its end (a day, "Rond <day>", a status) and where a tap leads; `late` draws the fact red. */
export type MyDayRow = { id: string; title: string; detail: string; href: string; late?: boolean;
  /** For Översiktens rows (2026-10-29: progression on Förfallet and Mina avvikelser too): what it is, its status and a job's completion. */
  kind?: string; status?: string; progress?: number | null };
export type MyDayAnswer = {
  today: string;
  next?: { rows: NextAction[] } | null;
  overdue?: { count: number; tasks: number; rounds: number; rows: MyDayRow[]; href: string } | null;
  deviations?: { count: number; overdue: number; rows: MyDayRow[]; href: string } | null;
};

/** A job as the server reads it for Hem: the person's own (isMine) or one they time or were alarmed about. */
export type MyDayTask = {
  id: string; kind: string; title: string; status: string; progress: number | null; dueDate: string | null; plannedStartDate: string | null;
  updatedAt: Date | string | null; isMine: boolean;
  /** The highest priority of a work order's open maintenance items, and what the paused order waits for (Underhåll, 2026-10-30). */
  priority: string | null; obstacle: unknown; waitingOn: string | null;
  /** For the row's second line (Översiktens lyft, 2026-10-29): the customer (company or name) and the place, when there is one. */
  customerName?: string | null; placeName?: string | null;
};

const KIND_LABEL: Record<string, string> = { WORK_ORDER: "Arbetsorder", RISK_ASSESSMENT: "Riskbedömning", FORM: "Protokoll" };
const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
/** "2026-10-27" → "27 okt" (the day as people say it); "" stays "". */
export const shortDay = (day: string | null | undefined) => day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}` : "";
/** Whole days from a Swedish day to today, never negative. */
const daysSince = (day: string, today: string) => Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / 86_400_000));
const lateText = (day: string, today: string) => { const days = daysSince(day, today); return days <= 1 ? `Förfallen ${days ? "i går" : "i dag"}` : `Förfallen sedan ${shortDay(day)} (${days} dagar)`; };
/** A job's second line: what it is, for whom and where – and when it is due. */
function taskDetail(task: MyDayTask, today: string) {
  const due = task.dueDate ? (isLateTask({ status: task.status, dueDate: task.dueDate }, today) ? lateText(task.dueDate, today) : `Klart senast ${shortDay(task.dueDate)}`) : "";
  return [KIND_LABEL[task.kind] ?? "Uppgift", task.customerName, task.placeName, due].filter(Boolean).join(" · ");
}
const roundDetail = (round: MyDayRound, today: string) => round.late ? `Driftrond · missad ${shortDay(round.date)}${round.date < today ? ` (${daysSince(round.date, today)} dagar)` : ""}` : `Driftrond · ${round.date === today ? "i dag" : shortDay(round.date)}`;
export type MyDayRound = { id: string; title: string; date: string; late: boolean; href: string;
  /** Its protocol is started (Fortsätt rond), for the row's progression (2026-10-29). */
  started?: boolean };
/** A round's progression on Översikten: started or not – a round that is not started is 0 % done; a started one has no figure here. */
const roundProgress = (round: MyDayRound) => round.started ? { status: "ROUND_STARTED", progress: null } : { status: "ROUND_NOT_STARTED", progress: 0 };
export type MyDayDeviation = { id: string; number: number; title: string; status: string; category: string; dueDate: string };

/**
 * The person's own round occurrences that wait (today's not done, or a late or missed one): rounds they are responsible for,
 * or – with nobody responsible – those of the company's admins, by the bell's rule. An admin is not given the team's rounds here.
 */
export function myRounds(views: readonly ScheduleView[], user: { id: string; admin: boolean }, today: string): MyDayRound[] {
  return views.flatMap((view) => {
    const current = view.overview.current;
    if (!view.active || !current || !roundReminderFor(view, user)) return [];
    const action = roundStartAction(view);
    return [{ id: `round:${view.id}:${current.date}`, title: view.title, date: current.date, late: current.date < today || occurrenceOverdue(current), href: action?.href ?? "/?view=rounds", started: action?.kind === "continue" }];
  });
}

/** Förfallet: the person's late jobs and late rounds, the oldest first; the count is all of them, the rows at most three. */
export function overdueSummary(tasks: readonly MyDayTask[], rounds: readonly MyDayRound[], today: string, limit = MY_DAY_ROWS): NonNullable<MyDayAnswer["overdue"]> {
  const lateTasks = tasks.filter((task) => task.isMine && isLateTask({ status: task.status, dueDate: task.dueDate }, today));
  const lateRounds = rounds.filter((round) => round.late);
  const rows = [
    ...lateTasks.map((task) => ({ sort: task.dueDate ?? "", row: { id: task.id, title: task.title, detail: taskDetail(task, today), href: myDayJobHref(task.id, task.kind), late: true, kind: task.kind, status: task.status, progress: task.progress } })),
    ...lateRounds.map((round) => ({ sort: round.date, row: { id: round.id, title: round.title, detail: roundDetail(round, today), href: round.href, late: true, kind: "ROUND", ...roundProgress(round) } })),
  ].sort((a, b) => a.sort.localeCompare(b.sort) || a.row.title.localeCompare(b.row.title, "sv") || (a.row.id < b.row.id ? -1 : 1));
  return { count: rows.length, tasks: lateTasks.length, rounds: lateRounds.length, rows: rows.slice(0, limit).map((item) => item.row), href: MY_DAY_OVERDUE_HREF };
}

const openDeviation = (entry: MyDayDeviation) => entry.status === "OPEN" || entry.status === "IN_PROGRESS";
const lateDeviation = (entry: MyDayDeviation, today: string) => Boolean(entry.dueDate) && entry.dueDate < today;

/** Mina avvikelser: open entries the person is responsible for; late first, then by Klart senast (none last), then the newest. */
export function deviationSummary(entries: readonly MyDayDeviation[], today: string, limit = MY_DAY_ROWS): NonNullable<MyDayAnswer["deviations"]> {
  const open = entries.filter(openDeviation).sort((a, b) => Number(lateDeviation(b, today)) - Number(lateDeviation(a, today))
    || (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99") || b.number - a.number);
  const late = open.filter((entry) => lateDeviation(entry, today)).length;
  return {
    count: open.length, overdue: late, href: MY_DAY_DEVIATIONS_HREF,
    rows: open.slice(0, limit).map((entry) => ({
      id: entry.id, title: entry.title || `Avvikelse ${entry.number}`, href: deviationHref(entry.id), late: lateDeviation(entry, today), kind: "DEVIATION", status: entry.status,
      // The status stands in its own pill on Översikten (2026-10-29); Hem's tile shows it here when nothing else is due.
      detail: [`Avvikelse ${entry.number}`, entry.dueDate ? "" : entry.status === "IN_PROGRESS" ? "Pågår" : "Öppen",
        entry.dueDate ? (lateDeviation(entry, today) ? lateText(entry.dueDate, today) : `Klart senast ${shortDay(entry.dueDate)}`) : ""].filter(Boolean).join(" · "),
    })),
  };
}

/** The facts the ranking needs besides the rows: the jobs whose timer runs, alarmed jobs and jobs booked today. */
export type MyDayFacts = { running: ReadonlySet<string>; alarms: ReadonlySet<string>; bookedToday: ReadonlySet<string> };

/** Gör detta nu: every candidate with its facts, ranked by lib/workflow/next-actions.ts. */
export function nextSummary(tasks: readonly MyDayTask[], rounds: readonly MyDayRound[], deviations: readonly MyDayDeviation[], facts: MyDayFacts, today: string, limit = MY_DAY_ROWS): NonNullable<MyDayAnswer["next"]> {
  const candidates: NextCandidate[] = [
    ...tasks.filter((task) => isTaskOpen(task.status)).map((task): NextCandidate => {
      const active = ["IN_PROGRESS", "PAUSED", "NEEDS_ACTION"].includes(task.status) || (task.progress ?? 0) > 0;
      const mine = task.isMine;
      return {
        id: task.id, title: task.title, href: myDayJobHref(task.id, task.kind), dueDate: task.dueDate, kind: task.kind, detail: taskDetail(task, today), status: task.status, progress: task.progress,
        signals: {
          alarm: facts.alarms.has(task.id),
          urgent: task.kind === "WORK_ORDER" && task.priority === "URGENT" && mine,
          running: facts.running.has(task.id),
          overdue: mine && isLateTask({ status: task.status, dueDate: task.dueDate }, today),
          booked_today: mine && (task.plannedStartDate === today || facts.bookedToday.has(task.id)),
          obstacle: mine && Boolean(jobObstacle({ status: task.status, data: { obstacle: task.obstacle, details: { waitingOn: task.waitingOn } }, updatedAt: task.updatedAt })),
          needs_action: mine && task.status === "NEEDS_ACTION",
          in_progress: mine && active,
          open: mine,
        },
      };
    }),
    ...rounds.map((round): NextCandidate => ({ id: round.id, title: round.title, href: round.href, dueDate: round.date, kind: "ROUND", detail: roundDetail(round, today), ...roundProgress(round), signals: { round_late: round.late, round_today: !round.late && round.date === today } })),
    ...deviations.filter(openDeviation).map((entry): NextCandidate => ({ id: `deviation:${entry.id}`, title: entry.title || `Avvikelse ${entry.number}`, href: deviationHref(entry.id), dueDate: entry.dueDate, kind: "DEVIATION", status: entry.status,
      detail: [`Avvikelse ${entry.number}`, entry.dueDate ? (lateDeviation(entry, today) ? lateText(entry.dueDate, today) : `Klart senast ${shortDay(entry.dueDate)}`) : ""].filter(Boolean).join(" · "), signals: { immediate_deviation: entry.category === "IMMEDIATE" } })),
  ];
  return { rows: rankNextActions(candidates, limit) };
}
