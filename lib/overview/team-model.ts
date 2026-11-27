import { projectAttention, type ProjectAttentionInput } from "@/lib/workflow/project-filters";
import { organizationModuleOn } from "@/lib/workflow/modules";
import { canReadRounds, canViewTeam, hasWorkflowPermission, type WorkflowPermissionProfile, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { canSeePrices } from "@/lib/workflow/material-prices";
import { riskStepState, type LinkedTaskState } from "@/lib/workflow/risk-step";
import { ROUND_SAFETY_QUESTIONS, roundSafetyOf } from "@/lib/workflow/round-safety";
import { addDays } from "@/lib/workflow/schedule";
import { capacityInWindow, capacityWeek, type CapacityActivity, type CapacityPerson } from "@/lib/workflow/capacity-summary";
import { absenceLabel, absenceOn, absentShare, type Absence } from "@/lib/workflow/absence";
import { addSwedishDays, swedishDayKey } from "@/lib/swedish-time";
import { isDeviationOverdue } from "@/lib/self-inspection/model";
import { awaitsAuthorityReport } from "@/lib/self-inspection/incidents";

/**
 * Översikt – Teamet with real data (2026-10-28, 0.29.0: "riktiga data, samma regler som listorna, behörighet på
 * servern"). Pure rules the server (lib/overview/team-server.ts) and the tests share: who may open the tab and which of its
 * sections, which work orders still need their risk step before they start, which accepted quotes still lack a work order,
 * the deviation counts and a round safety check whose answers say the conditions have changed. Nothing here reads or writes.
 */

type Caller = { admin: boolean; workflowPermissions: WorkflowPermissionProfile; organization?: { disabledModules?: readonly string[] | null } | null };

export type TeamTabAccess = {
  /** Teamet itself: admins or team:read (never the work view or a project's responsibility). */
  team: boolean;
  /** Each section still follows its module's own read right. */
  workOrders: boolean;
  projects: boolean;
  quotes: boolean;
  rounds: boolean;
  /** Amounts (purchase/sale prices and quote sums) need the price right. */
  prices: boolean;
  /** The deviation log: the whole company for admins, otherwise only what the log itself shows the person. */
  deviationsCompany: boolean;
};

export function teamTabAccess(ctx: Caller): TeamTabAccess {
  const can = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
  const team = canViewTeam(ctx);
  // Företagets moduler (0.39.0): Teamet stops counting what the company has turned off; the right alone never shows it.
  const on = (key: Parameters<typeof organizationModuleOn>[1]) => organizationModuleOn(ctx.organization, key);
  return {
    team,
    workOrders: team && can("work-order"),
    projects: team && can("projects") && on("projects"),
    quotes: team && can("quotes") && on("quotes"),
    rounds: team && canReadRounds(ctx.admin, ctx.workflowPermissions) && on("rounds"),
    prices: team && canSeePrices({ admin: ctx.admin, permissions: ctx.workflowPermissions }),
    deviationsCompany: team && ctx.admin,
  };
}

export type TeamLoadWeek = { key: "this" | "next"; week: number; startsOn: string; endsOn: string };
export type TeamLoadPerson = { id: string; name: string; weeks: { plannedMinutes: number; capacityMinutes: number }[];
  /** This week's workdays (Mon–Fri), planned against the day's available time (2026-10-29: the load per day). */
  days?: { plannedMinutes: number; capacityMinutes: number; absent?: string }[];
  /** Booked minutes this week on the person's whole days away – a clash, not load (användartest 2026-10-31, K7/F8). */
  conflictMinutes?: number };

/** The windows of Belastning: this week, next week, and this week's five days. */
export function teamLoadWindows(now: Date) {
  const thisWeek = capacityWeek(now);
  const nextWeek = capacityWeek(addSwedishDays(thisWeek.startsAt, 7));
  return {
    windows: [{ key: "this" as const, ...thisWeek }, { key: "next" as const, ...nextWeek }],
    workdays: Array.from({ length: 5 }, (_, index) => ({ startsAt: addSwedishDays(thisWeek.startsAt, index), endsAt: addSwedishDays(thisWeek.startsAt, index + 1) })),
    from: swedishDayKey(thisWeek.startsAt), to: swedishDayKey(new Date(nextWeek.endsAt.getTime() - 1)),
  };
}

/**
 * Belastning per person (2026-11-02): the one capacity count (capacityInWindow), so Teamet and the tab Kapacitet cannot drift
 * apart. Cloud and the demo pass the bookings the person may read with the rounds (capacityLoads). Ingen fast arbetstid (2026-10-30)
 * has no capacity and is not listed. A day away says why, in the words this viewer may see.
 */
export function teamLoadPeople(input: {
  members: readonly (CapacityPerson & { name: string })[]; activities: readonly CapacityActivity[]; absences: readonly Absence[];
  viewer: { id: string; admin: boolean; team: boolean }; windows: ReturnType<typeof teamLoadWindows>["windows"]; workdays: ReturnType<typeof teamLoadWindows>["workdays"];
}): TeamLoadPerson[] {
  return input.members.filter((member) => !member.noFixedHours).map((member) => {
    const count = (window: { startsAt: Date; endsAt: Date }) => capacityInWindow({ person: member, activities: input.activities, absences: input.absences, startsAt: window.startsAt, endsAt: window.endsAt });
    const weeks = input.windows.map(count);
    const conflictMinutes = weeks[0]?.conflictMinutes ?? 0;
    return {
      id: member.id, name: member.name,
      ...(conflictMinutes ? { conflictMinutes } : {}),
      weeks: weeks.map((week) => ({ plannedMinutes: week.plannedMinutes, capacityMinutes: week.availableMinutes ?? 0 })),
      days: input.workdays.map((day) => {
        const date = swedishDayKey(day.startsAt);
        const { plannedMinutes, availableMinutes } = count(day);
        const absence = absentShare(input.absences, member.id, date, member.weeklyWorkMinutes / 5) ? absenceOn(input.absences, member.id, date) : null;
        return { plannedMinutes, capacityMinutes: availableMinutes ?? 0, ...(absence ? { absent: absenceLabel(input.viewer, absence) } : {}) };
      }),
    };
  });
}

/** How far ahead "Kräver åtgärd före start" looks, in Swedish days (today included). */
export const RISK_HORIZON_DAYS = 7;

export type RiskCandidate = {
  id: string;
  title: string;
  kind: string;
  formArea?: string | null;
  status: string;
  data: unknown;
  /** YYYY-MM-DD or "". */
  plannedStartDate: string;
  /** Whether the work has started (time or progress); a started order is past "before start". */
  started: boolean;
  customerName: string;
  /** The linked extended risk assessment as read now (riskCheck.extendedTaskId), or null. */
  extended: LinkedTaskState | null;
};

export type RiskRow = { id: string; title: string; customerName: string; plannedStartDate: string; late: boolean; hint: string;
  /** The work order's status, for the row's progression (a work order before its start is 0 % done). */
  status: string };

/**
 * Work orders that need their risk step before they start: open (not färdigställd or utgått), not started, a planned start
 * from the past up to `RISK_HORIZON_DAYS` ahead, and a risk step that is required and not done (the same rule as the gates,
 * lib/workflow/risk-step.ts). Earliest start first; a start that has passed is `late`.
 */
export function selectRiskBeforeStart(rows: readonly RiskCandidate[], today: string, horizonDays = RISK_HORIZON_DAYS): RiskRow[] {
  const horizon = addDays(today, horizonDays);
  return rows
    .filter((row) => row.kind === "WORK_ORDER" && row.status !== "COMPLETED" && row.status !== "CANCELLED" && !row.started)
    .filter((row) => Boolean(row.plannedStartDate) && row.plannedStartDate <= horizon)
    .flatMap((row) => {
      const state = riskStepState(row, { extended: row.extended, workOrder: null });
      if (!state.applies || state.done) return [];
      return [{ id: row.id, title: row.title, customerName: row.customerName, plannedStartDate: row.plannedStartDate, late: row.plannedStartDate < today, hint: state.hint, status: row.status }];
    })
    .sort((a, b) => a.plannedStartDate.localeCompare(b.plannedStartDate) || a.title.localeCompare(b.title, "sv"));
}

/**
 * The risk rows for the tab: a start still to come belongs to Ej startat (`coming`); a start that has passed is the job's
 * Försenad start, counted in that list, so the rows to come are sent first.
 */
export function riskSection<T extends { late: boolean }>(selected: readonly T[], limit: number) {
  const coming = selected.filter((row) => !row.late);
  return { total: selected.length, coming: coming.length, rows: [...coming, ...selected.filter((row) => row.late)].slice(0, limit) };
}

/**
 * An accepted quote that still waits for its work order: the latest version (not superseded), accepted, no work order made
 * from it, and not an ÄTA version (a change to an accepted quote is handled on the work order that already exists).
 */
export function awaitsWorkOrder(quote: { status: string; supersededAt: Date | string | null; workOrderId: string | null; changeOfVersion: number | null }) {
  return quote.status === "ACCEPTED" && !quote.supersededAt && !quote.workOrderId && quote.changeOfVersion === null;
}

export type DeviationFacts = { status: string; dueDate: string; responsibleUserId: string | null; systematic: boolean; type?: string | null; serious?: boolean | null; reportedToAuthorityAt?: Date | string | null };
/** `reportable`: open entries that must be reported to the authority and are not marked reported (awaitsAuthorityReport);
 *  `reportableOnTime`: those of them not already counted as overdue, so Kräver åtgärd counts each entry once. */
export type DeviationCounts = { open: number; overdue: number; withoutResponsible: number; systematic: number; reportable?: number; reportableOnTime?: number };

/** The log's counts with the log's own rules (lib/self-inspection/model.ts): open is not Åtgärdad, overdue is past Klart senast. */
export function countDeviations(items: readonly DeviationFacts[], today: string): DeviationCounts {
  const open = items.filter((item) => item.status !== "DONE");
  return {
    open: open.length,
    overdue: open.filter((item) => isDeviationOverdue(item, today)).length,
    withoutResponsible: open.filter((item) => !item.responsibleUserId).length,
    systematic: open.filter((item) => item.systematic).length,
    reportable: open.filter(awaitsAuthorityReport).length,
    reportableOnTime: open.filter((item) => awaitsAuthorityReport(item) && !isDeviationOverdue(item, today)).length,
  };
}

/** Whole days from a moment to a Swedish day (the age of an entry), never negative. */
export function ageInDays(createdOn: string, today: string) {
  const diff = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${createdOn}T12:00:00Z`)) / 86_400_000);
  return Number.isFinite(diff) ? Math.max(0, diff) : 0;
}

/**
 * Projektläge as rows (2026-10-29): the ongoing projects that need attention – late, over the time budget, or ready
 * to close (the key figures' rule, lib/workflow/project-filters.ts) – each with its status and how far it has come (the share of
 * its jobs that are färdigställda; jobs that went out do not count). Late first, then over budget, then ready to close.
 */
export const PROJECT_REASONS = ["overdue", "overBudget", "readyToClose"] as const;
export type ProjectReason = (typeof PROJECT_REASONS)[number];
export type TeamProjectRow = { id: string; name: string; customerName: string; dueDate: string; state: string; completion: number | null; reasons: ProjectReason[]; reportedMinutes: number; budgetMinutes: number; href: string };
export function projectRows(projects: readonly { id: string; name: string; customerName: string; dueDate: string; status: ProjectAttentionInput["status"] & { state: string }; timeBudgetMinutes: number; reportedMinutes: number; tasks: readonly { status: string }[] }[], limit = 6): { total: number; rows: TeamProjectRow[] } {
  const rows = projects.filter((project) => project.status.ongoing).map((project) => {
    const counted = project.tasks.filter((task) => task.status !== "CANCELLED");
    return {
      id: project.id, name: project.name, customerName: project.customerName, dueDate: project.dueDate, state: project.status.state,
      completion: counted.length ? Math.round((counted.filter((task) => task.status === "COMPLETED").length / counted.length) * 100) : null,
      reasons: PROJECT_REASONS.filter((reason) => projectAttention(project, reason)),
      reportedMinutes: project.reportedMinutes, budgetMinutes: project.timeBudgetMinutes, href: `/?view=project&projectId=${encodeURIComponent(project.id)}`,
    };
  }).filter((row) => row.reasons.length)
    .sort((a, b) => PROJECT_REASONS.indexOf(a.reasons[0]) - PROJECT_REASONS.indexOf(b.reasons[0]) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.name.localeCompare(b.name, "sv"));
  return { total: rows.length, rows: rows.slice(0, limit) };
}

/**
 * Just nu (2026-10-29): each person with what their time runs on (their latest running entry, already titled by the
 * caller within the viewer's read rights) and their reported minutes today (a running entry up to now). Those with time
 * running first, the longest running at the top; then the others by name.
 */
export type NowEntry = { userId: string; startedAt: Date | string; title: string; href: string | null; project: boolean;
  /** The job's kind, status and progress, for the row's progression (only when the viewer may read the job). */
  kind?: string | null; status?: string | null; progress?: number | null };
export function nowPeople(members: readonly { id: string; name: string; dayMinutes?: number }[], running: readonly NowEntry[], today: readonly { userId: string; startedAt: Date | string; endedAt: Date | string | null; durationSec: number }[], now: Date) {
  const minutes = new Map<string, number>();
  for (const entry of today) {
    const seconds = entry.durationSec + (entry.endedAt ? 0 : Math.max(0, Math.floor((now.getTime() - new Date(entry.startedAt).getTime()) / 1000)));
    minutes.set(entry.userId, (minutes.get(entry.userId) ?? 0) + seconds / 60);
  }
  const latest = new Map<string, NowEntry>();
  for (const entry of running) { const seen = latest.get(entry.userId); if (!seen || new Date(entry.startedAt) > new Date(seen.startedAt)) latest.set(entry.userId, entry); }
  return members.map((member) => {
    const entry = latest.get(member.id);
    return { id: member.id, name: member.name, todayMinutes: Math.round(minutes.get(member.id) ?? 0), dayMinutes: member.dayMinutes ?? 480,
      running: entry ? { title: entry.title, href: entry.href, since: new Date(entry.startedAt).toISOString(), project: entry.project, kind: entry.kind ?? null, status: entry.status ?? null, progress: entry.progress ?? null } : null };
  }).sort((a, b) => Number(Boolean(b.running)) - Number(Boolean(a.running)) || (a.running && b.running ? a.running.since.localeCompare(b.running.since) : 0) || a.name.localeCompare(b.name, "sv"));
}

/**
 * Säkerhetsavstämning (2026-10-27, punkt 4): an answer other than the safe one means the conditions in the work order's
 * risk assessment have changed. Only a check that was made (confirmed) counts.
 */
export function roundSafetyChanged(data: unknown): boolean {
  const check = roundSafetyOf(data);
  if (!check?.confirmedAt) return false;
  return ROUND_SAFETY_QUESTIONS.some((question) => { const value = check.answers[question.id]; return Boolean(value) && value !== question.safe; });
}
