/**
 * Lagöversikt (2026-10-09, AI-beslut 3): the team's open work as `list_team_work` returns it to Workflow AI, the
 * API and MCP. The rows come from Workflow's own list (Alla) in the person's session, so the read permission is the
 * list's; this only sorts them into late, due soon, needs action and waiting, by the rules. Pure: no database.
 */
export const TEAM_WORK_FILTERS = ["open", "late", "due_soon", "action", "waiting"] as const;
export type TeamWorkFilter = (typeof TEAM_WORK_FILTERS)[number];
/** "Snart": due within this many days from today. */
export const TEAM_WORK_SOON_DAYS = 7;
/** At most this many rows go back (the list is read 48 at a time, the most urgent first). */
export const TEAM_WORK_MAX_ROWS = 30;

type Row = Record<string, unknown>;
const KIND_TEXT: Record<string, string> = { WORK_ORDER: "arbetsorder", RISK_ASSESSMENT: "riskbedömning", FORM: "protokoll" };

const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** One list row as the team overview shows it: who, where, when and what stops it – never an opinion about a person. */
export function teamWorkRow(item: Row, today: string) {
  const due = typeof item.dueDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(item.dueDate) ? item.dueDate.slice(0, 10) : "";
  const waitingOn = String((item.maintenance as Row | undefined)?.waitingOn ?? "");
  const status = String(item.status ?? "");
  return {
    id: String(item.id ?? ""),
    kind: KIND_TEXT[String(item.kind)] ?? "uppgift",
    title: String(item.title ?? ""),
    status,
    dueDate: due || null,
    late: Boolean(due && due < today),
    dueSoon: Boolean(due && due >= today && due <= addDays(today, TEAM_WORK_SOON_DAYS)),
    needsAction: status === "NEEDS_ACTION",
    waitingOn: waitingOn || null,
    assignedToName: String(item.assignedToName ?? item.responsibleName ?? "") || null,
    projectName: String(item.projectName ?? "") || null,
    customerName: String(item.customerName ?? "") || null,
    url: `/?view=workflow_task&taskId=${encodeURIComponent(String(item.id ?? ""))}&taskType=${encodeURIComponent(String(item.kind ?? ""))}`,
  };
}
export type TeamWorkRow = ReturnType<typeof teamWorkRow>;

const matches: Record<TeamWorkFilter, (row: TeamWorkRow) => boolean> = {
  open: () => true,
  late: (row) => row.late,
  due_soon: (row) => row.dueSoon,
  action: (row) => row.needsAction,
  waiting: (row) => Boolean(row.waitingOn),
};

/** The overview: counts per kind of trouble and the rows of the chosen filter, late ones first. */
export function teamWorkView(items: readonly Row[], filter: TeamWorkFilter, today: string, listFull = false) {
  const rows = items.filter((item) => item.status !== "COMPLETED" && item.status !== "CANCELLED").map((item) => teamWorkRow(item, today));
  const chosen = rows.filter(matches[filter]).sort((a, b) => Number(b.late) - Number(a.late) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  return {
    today, filter,
    counts: Object.fromEntries(TEAM_WORK_FILTERS.map((name) => [name, rows.filter(matches[name]).length])) as Record<TeamWorkFilter, number>,
    items: chosen.slice(0, TEAM_WORK_MAX_ROWS),
    // The list holds more open work than was read: the counts are of the most urgent ones.
    truncated: listFull || chosen.length > TEAM_WORK_MAX_ROWS,
  };
}
