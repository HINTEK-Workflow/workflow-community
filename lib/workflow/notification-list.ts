import { swedishDayKey } from "@/lib/swedish-time";
import { FAULT_NOTICE_PREFIX } from "@/lib/operator/admin-notice";
import { ABSENCE_CONFLICT_PREFIX, noticeKey } from "./notice-channels";
import type { TaskNotification } from "./task-notifications";
import { ROUND_FOLLOW_UP_URGENT_PREFIX } from "./round-follow-up";

/**
 * Notislistan (beslut 4, 2026-11-01): one list with the tabs Till mig and Teamet, Oläst and Läst, and "Läs alla". "Kräver åtgärd"
 * stands on top whichever tab is open and also goes as e-mail and push from the start. A repeated reminder is one row per day.
 *
 * Read state: a mark per person and notice in NoticeDelivery (channel READ, key `noticeKey`), so a reminder that becomes more
 * pressing is unread again and the same person never reads for someone else. Pure: what requires action, the rows and
 * the answer; the marks are written in lib/workflow/notification-list-server.ts, and Local has no marks (one user, no tabs).
 */
export const NOTICE_READ_CHANNEL = "READ";
export const NOTIFICATION_TABS = ["mine", "team"] as const;
export type NotificationTab = (typeof NOTIFICATION_TABS)[number];
export const NOTIFICATION_STATES = ["unread", "read"] as const;
export type NotificationState = (typeof NOTIFICATION_STATES)[number];
export const NOTIFICATION_TAB_LABEL: Record<NotificationTab, string> = { mine: "Till mig", team: "Teamet" };
export const NOTIFICATION_STATE_LABEL: Record<NotificationState, string> = { unread: "Oläst", read: "Läst" };
export const REQUIRED_LABEL = "Kräver åtgärd";
/** How many rows "Kräver åtgärd" shows on top. */
export const REQUIRED_MAX = 20;
export { ABSENCE_CONFLICT_PREFIX };

/**
 * What "Kräver åtgärd" holds (fråga 4): a reported obstacle, what must be reported to the authority, a deviation of the grade
 * Hög or Akut until it is done (lib/self-inspection/model.ts decides who gets the row), a fault report, an absence that hits
 * planned work; and an Akut work order and a machine alarm, which already come first. "Behöver åtgärdas" as a task status is the
 * status of that one task and stays a reminder like the others.
 */
export function requiresAction(item: Pick<TaskNotification, "id" | "kind" | "urgent">) {
  return Boolean(item.urgent) || item.kind === "OBSTACLE" || item.kind === "MACHINE_ALARM"
    || item.id.startsWith(FAULT_NOTICE_PREFIX) || item.id.startsWith(ABSENCE_CONFLICT_PREFIX)
    || item.id.startsWith("self-inspection:reportable:") || item.id.startsWith("self-inspection:severe:")
    // Akut från ronden (2026-11-27, lib/workflow/round-follow-up.ts): arbetsledare and admin are told in the app and by e-mail.
    || item.id.startsWith(ROUND_FOLLOW_UP_URGENT_PREFIX);
}

/**
 * Goes by e-mail and push from the start: the five of fråga 4. An Akut work order stands on top but has its own kind to choose; a
 * machine alarm has its own path with the company's hours and the person's yes to the night (lib/machine/alarm-delivery.ts).
 * A deviation the person reported themselves stands in their list but is not mailed back to them.
 */
export const sendsFromTheStart = (item: Pick<TaskNotification, "id" | "kind" | "urgent" | "selfReported">) => item.kind !== "MACHINE_ALARM" && !item.urgent && !item.selfReported && requiresAction(item);

export type NotificationRow = { row: TaskNotification; members: TaskNotification[] };

/** Which rows are one and the same reminder today: late rounds per day, and a person's events about the same thing per day. */
function repeatKey(item: TaskNotification) {
  if (requiresAction(item)) return null;
  const audience = item.audience ?? "mine";
  if (item.kind === "ROUND" && item.deadline === "OVERDUE" && item.id.startsWith("ROUND:") && item.dueDate) return `ROUND|${audience}|${item.dueDate}`;
  if ((item.kind === "TEAM" || item.kind === "COMMENT" || item.id.startsWith("ROUND_NOT_DONE:")) && item.assignedAt) return `${item.kind}|${audience}|${item.href}|${swedishDayKey(new Date(item.assignedAt))}`;
  return null;
}

/** "Upprepade påminnelser samlas till en rad per dag": the first of them stands for the rest, with how many they are. */
export function collapseRepeated(items: readonly TaskNotification[]): NotificationRow[] {
  const groups = new Map<string, TaskNotification[]>();
  const rows: { key: string | null; item: TaskNotification }[] = [];
  for (const item of items) {
    const key = repeatKey(item);
    if (key && groups.has(key)) { groups.get(key)!.push(item); continue; }
    if (key) groups.set(key, [item]);
    rows.push({ key, item });
  }
  return rows.map(({ key, item }) => {
    const members = key ? groups.get(key)! : [item];
    if (members.length === 1) return { row: item, members };
    const read = members.every((member) => member.read);
    const { read: _read, ...first } = item;
    void _read;
    const row: TaskNotification = { ...first, id: `REPEAT:${key}`, repeats: members.length, ...(read ? { read: true } : {}) };
    if (item.kind === "ROUND") return { row: { ...row, title: `${members.length} ronder inte klara`, detail: members.slice(0, 3).map((member) => member.title).join(", ") + (members.length > 3 ? " med flera" : ""), href: "/?view=rounds" }, members };
    if (item.kind === "COMMENT") return { row: { ...row, label: "Nya kommentarer", detail: `${members.length} nya kommentarer. ${item.detail ?? ""}`.trim() }, members };
    return { row: { ...row, detail: `${members.length} händelser. ${item.detail ?? ""}`.trim() }, members };
  });
}

export type NotificationCounts = { mineUnread: number; mineRead: number; teamUnread: number; teamRead: number; required: number; teamRequired: number; bell: number };

const audienceOf = (item: Pick<TaskNotification, "audience">): NotificationTab => item.audience ?? "mine";

/**
 * The bell counts what is new for the person, and what requires action in the team – not every reminder the team has. Till mig holds
 * exactly that (2026-11-05: the bell said 14 while the tabs said 10 and 3, as what requires action stood outside the tabs).
 */
export function notificationCounts(rows: readonly NotificationRow[], canTeam: boolean): NotificationCounts {
  const counts: NotificationCounts = { mineUnread: 0, mineRead: 0, teamUnread: 0, teamRead: 0, required: 0, teamRequired: 0, bell: 0 };
  for (const { row } of rows) {
    const audience = audienceOf(row);
    if (audience === "team" && !canTeam) continue;
    const required = !row.read && requiresAction(row);
    if (required) { counts.required++; if (audience === "team") counts.teamRequired++; }
    // A row in "Kräver åtgärd" is counted there, not again in its tab.
    if (row.read) { if (audience === "mine") counts.mineRead++; else counts.teamRead++; }
    else if (!required) { if (audience === "mine") counts.mineUnread++; else counts.teamUnread++; }
  }
  counts.bell = counts.required + counts.mineUnread;
  return counts;
}

/** What a tab's pill says: Till mig is the bell, Teamet everything unread of the team. */
export const notificationTabCount = (counts: NotificationCounts | undefined, tab: NotificationTab) => !counts ? 0 : tab === "mine" ? counts.bell : counts.teamUnread + counts.teamRequired;

/** The sections of the page (2026-11-05), in order. Every row is in exactly one. */
export const NOTIFICATION_SECTIONS = [
  { key: "required", label: REQUIRED_LABEL },
  { key: "machines", label: "Maskiner och larm" },
  { key: "work", label: "Arbetsordrar och uppgifter" },
  { key: "reminders", label: "Påminnelser" },
] as const;
export type NotificationSection = (typeof NOTIFICATION_SECTIONS)[number]["key"];
const WORK_KINDS = new Set<TaskNotification["kind"]>(["WORK_ORDER", "RISK_ASSESSMENT", "FORM", "ROUND", "ASSIGNED", "OBSTACLE", "FOLLOW_UP", "QUOTE", "TEAM", "COMMENT"]);
/**
 * What comes from a machine has its own section, except an unread alarm with an open work order: it stands in Kräver åtgärd
 * (2026-11-06). A row already read no longer stands as required.
 */
export function notificationSection(item: Pick<TaskNotification, "id" | "kind" | "urgent" | "read">): NotificationSection {
  if (item.kind === "MACHINE_ALARM" && !item.read) return "required";
  if (item.kind === "MACHINE_ALARM" || item.kind === "MACHINE_NOTE" || item.kind === "OPERATOR" || item.id.startsWith(FAULT_NOTICE_PREFIX)) return "machines";
  if (requiresAction(item) && !item.read) return "required";
  return WORK_KINDS.has(item.kind) ? "work" : "reminders";
}
export function notificationsBySection<T extends Pick<TaskNotification, "id" | "kind" | "urgent" | "read">>(items: readonly T[]) {
  return NOTIFICATION_SECTIONS.map((section) => ({ ...section, items: items.filter((item) => notificationSection(item) === section.key) })).filter((section) => section.items.length);
}

/** The answer to the list: what requires action comes with Till mig, and with Teamet when it is the team's, then the tab's rows in the bell's order. Bounded by `limit`. */
export function notificationListAnswer(rows: readonly NotificationRow[], query: { tab: NotificationTab; state: NotificationState; limit: number; canTeam: boolean }) {
  const counts = notificationCounts(rows, query.canTeam);
  const visible = rows.map(({ row }) => row).filter((row) => audienceOf(row) === "mine" || query.canTeam);
  const required = visible.filter((row) => !row.read && requiresAction(row) && (query.tab === "mine" || audienceOf(row) === "team"));
  const tabRows = query.tab === "team" && !query.canTeam ? [] : visible.filter((row) => audienceOf(row) === query.tab
    && (query.state === "read" ? row.read : !row.read && !requiresAction(row)));
  return { required: required.slice(0, REQUIRED_MAX), requiredTotal: required.length, items: tabRows.slice(0, query.limit), total: tabRows.length, counts, canTeam: query.canTeam };
}
export type NotificationListAnswer = ReturnType<typeof notificationListAnswer> & { today: string };

export const parseNotificationTab = (value: string | null): NotificationTab | null => NOTIFICATION_TABS.includes(value as NotificationTab) ? value as NotificationTab : null;
export const parseNotificationState = (value: string | null): NotificationState => value === "read" ? "read" : "unread";

/**
 * The marks of what a person read: one row, or every unread row in a tab. "Läs alla" leaves "Kräver åtgärd" – read is not done
 * – and those rows are marked one at a time, by choice. The marks are the raw notices behind each row.
 */
export function keysToMarkRead(rows: readonly NotificationRow[], target: { id: string } | { tab: NotificationTab; canTeam: boolean }): string[] {
  const chosen = "id" in target
    ? rows.filter(({ row }) => row.id === target.id)
    : target.tab === "team" && !target.canTeam ? []
    : rows.filter(({ row }) => !row.read && !requiresAction(row) && audienceOf(row) === target.tab);
  return [...new Set(chosen.flatMap(({ members }) => members.filter((member) => !member.read).map((member) => noticeKey(member))))];
}

/** Marks read rows from the person's stored marks. */
export function withReadMarks(items: readonly TaskNotification[], marks: ReadonlySet<string>): TaskNotification[] {
  return items.map((item) => !item.read && marks.has(noticeKey(item)) ? { ...item, read: true } : item);
}
