import type { MyDayAnswer } from "@/lib/workflow/my-day";
import type { PanelArea } from "@/lib/workflow/panel-area";
import { listHref } from "@/lib/url-filters";

/**
 * Översiktens Jag (dashboard etapp 6, 2026-10-28: "Alla nyckeltal ska baseras på riktig data … Dashboarden ska visa
 * vad användaren behöver göra"). The answer of GET /api/overview?tab=me and the pure rules behind it, so the server, the
 * page and the tests read the same thing (the rules themselves: lib/overview/me-plan.ts). Gör detta nu, Förfallet and Mina avvikelser are Hem's (lib/workflow/my-day.ts),
 * never counted again here.
 */

/** Min plan's types: only what has a real source (2026-10-28: no material picks or quotes to send). */
export const PLAN_KINDS = ["work-order", "round", "activity", "milestone"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];
export const PLAN_KIND_INFO: Record<PlanKind, { label: string; area: PanelArea }> = {
  "work-order": { label: "Arbetsorder", area: "work-order" },
  round: { label: "Driftrond", area: "round" },
  activity: { label: "Planerad aktivitet", area: "calendar" },
  milestone: { label: "Projektets slutdatum", area: "project" },
};
export type PlanState = "done" | "missed" | "not_done" | "planned";
export type PlanItem = {
  id: string;
  /** YYYY-MM-DD (Swedish day). */
  date: string;
  kind: PlanKind;
  title: string;
  href: string;
  /** "HH:MM" when the post has a time. */
  start?: string;
  end?: string;
  state: PlanState;
  /**
   * What the post's time goes on, chosen in Tid from the timeline (2026-10-29): a job (a round's protocol or work order)
   * or – kind PROJECT – a project's own time. None for a booking without job or project, or a round day no work order holds.
   */
  job?: { id: string; kind: string };
};

/** One time entry as Jag shows it: on what, from–to (Swedish clock), its minutes, and where it opens. */
export type TimeLine = { id: string; title: string; href: string; start: string; end: string | null; minutes: number;
  /** What the time was on, for Skriv tid (the time report opened on it): a work order or a project. */
  taskId?: string | null; projectId?: string | null };

export type MeRow = { id: string; title: string; detail: string; href: string; late?: boolean };
export type MeTabData = {
  today: string;
  /** The tab chip: the person's late work, or "" when nothing is late. */
  chip: string;
  /** Gör detta nu, ranked by lib/workflow/next-actions.ts; null without a source the person may read. */
  next: MyDayAnswer["next"];
  /** Förfallet (late jobs + late rounds); `tasksHref` is the Jobb list with the same rule (filter=overdue&scope=mine). */
  overdue: (NonNullable<MyDayAnswer["overdue"]> & { tasksHref: string; roundsHref: string }) | null;
  /** Mina avvikelser: the open entries I am responsible for (the log's filter=mine). */
  deviations: (NonNullable<MyDayAnswer["deviations"]> & { mineHref: string }) | null;
  /** Utkast utan arbetsorder that are mine: link them (Koppla) on the task page. Null without read on tasks. */
  drafts: { count: number; rows: MeRow[] } | null;
  /** Ej utfört in my rounds' window (the follow-up), per round; `href` is Driftronder with Behöver åtgärd. Null without rounds. */
  notDone: { count: number; rows: (MeRow & { count: number })[]; href: string } | null;
  /** This week's reported time against the ordinary working time (ordinarie arbetstid, not a goal). */
  week: { from: string; reportedMinutes: number; ordinaryMinutes: number; days: { date: string; minutes: number }[]; href: string };
  /**
   * Tid without a running timer (Översiktens lyft, 2026-10-29): where I last had time, to continue there, and today's
   * entries under the clock. Optional so an older answer still draws.
   */
  recent?: TimeLine | null;
  /** My absence from today on (Frånvaro, 2026-10-29), and that I may register it; left out where it is not built yet. */
  absence?: { userId: string; mine: { id: string; label: string; from: string; to: string; hours: { start: string; end: string } | null; type: string | null; note: string;
    /** Imported from a payroll or HR system and locked here (changed there): "Från Flex HRM", and its status. */
    locked?: boolean; sourceLabel?: string; status?: string;
    /** Registered by someone else (a manager): removing it asks first and tells them (användartest 2026-10-31, F7). */
    byOther?: boolean }[] } | null;
  todayEntries?: TimeLine[];
  /** Min plan for one month. */
  plan: { month: string; from: string; to: string; items: PlanItem[] };
};

export const ME_ROWS = 5;
/** Gör detta nu stands beside Tid and fills its height (2026-10-29), so it shows a few more rows. */
export const ME_NEXT_ROWS = 5;
export const ROUNDS_ATTENTION_HREF = listHref("rounds", { attention: true });
export const OVERDUE_TASKS_HREF = listHref("tasks", { type: "all", filter: "overdue", scope: "mine" });
/** Mina avvikelser in the log (lib/workflow/my-day.ts MY_DAY_DEVIATIONS_HREF with the log's filter=mine). */
export const MY_DEVIATIONS_HREF = "/?view=deviations&filter=mine";
export const TIME_REPORT_HREF = "/?view=time";
export const PLANNING_HREF = "/?view=planning";
export const projectHref = (id: string) => `/?view=project&projectId=${encodeURIComponent(id)}`;

/** The month asked for (YYYY-MM), else today's; with its first and last day. */
export function planMonth(asked: string | null | undefined, today: string) {
  const month = asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : today.slice(0, 7);
  const [year, number] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { month, from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** The tab chip: what is late for me, in two words. */
export const meChip = (overdue: MeTabData["overdue"]) => overdue && overdue.count ? `${overdue.count} förfallna` : "";
