import { collapseRepeated, keysToMarkRead, notificationListAnswer, parseNotificationState, parseNotificationTab, withReadMarks } from "@/lib/workflow/notification-list";
import type { TaskNotification } from "@/lib/workflow/task-notifications";
import { commentActionSchema, commentParentQuery } from "@/lib/comments/model";

/**
 * Kommentarer och notislistan i demon (beslut 4 och 14, 2026-11-01): the same answers as Cloud, kept in memory for the visit.
 * The demo has invented people and one signed-in role at a time, so nobody else is told and nobody else is listed.
 */
type DemoComment = { id: string; parentType: string; parentId: string; authorName: string; body: string; inCustomerReport: boolean; createdAt: string };
const comments: DemoComment[] = [];
const following = new Set<string>();
const readKeys = new Set<string>();
let next = 1;

const view = (comment: DemoComment) => ({ ...comment, mine: true, canRemove: true });

export function demoComments(user: { name?: string | null }, request: { method: string; url: URL; body?: unknown }, canChooseCustomer: boolean) {
  if (request.method === "GET") {
    const query = commentParentQuery.parse({ parentType: request.url.searchParams.get("parentType"), parentId: request.url.searchParams.get("parentId") });
    return {
      comments: comments.filter((comment) => comment.parentType === query.parentType && comment.parentId === query.parentId).map(view),
      hasOlder: false, following: following.has(`${query.parentType}:${query.parentId}`), canChooseCustomer, people: [],
    };
  }
  const input = commentActionSchema.parse(request.body);
  if (input.action === "add") {
    const comment: DemoComment = { id: `demo-comment-${next++}`, parentType: input.parentType, parentId: input.parentId, authorName: user.name || "Du", body: input.body, inCustomerReport: canChooseCustomer && input.inCustomerReport, createdAt: new Date().toISOString() };
    comments.push(comment);
    return { comment: view(comment), told: 0 };
  }
  if (input.action === "set_customer") {
    const comment = comments.find((item) => item.id === input.id);
    if (comment && canChooseCustomer) comment.inCustomerReport = input.inCustomerReport;
    return { comment: comment ? view(comment) : null };
  }
  if (input.action === "remove") {
    const index = comments.findIndex((item) => item.id === input.id);
    if (index >= 0) comments.splice(index, 1);
    return { removed: input.id };
  }
  if (input.action === "follow") {
    const key = `${input.parentType}:${input.parentId}`;
    if (input.follow) following.add(key); else following.delete(key);
    return { following: input.follow };
  }
  return { seen: true };
}

/** The notification route's answers over the demo's own reminders. */
export function demoNotifications(items: readonly TaskNotification[], request: { method: string; url: URL; body?: unknown }, options: { canTeam: boolean; today: string; scope: "team" | "mine" }) {
  const rows = collapseRepeated(withReadMarks(items, readKeys));
  if (request.method !== "GET") {
    const input = request.body as { action?: string; id?: string; tab?: string };
    const tab = parseNotificationTab(input.tab ?? null);
    const keys = keysToMarkRead(rows, input.action === "read_all" && tab ? { tab, canTeam: options.canTeam } : { id: input.id ?? "" });
    for (const key of keys) readKeys.add(key);
    return { marked: keys.length };
  }
  const tab = parseNotificationTab(request.url.searchParams.get("tab"));
  if (tab) return { ...notificationListAnswer(rows, { tab, state: parseNotificationState(request.url.searchParams.get("state")), limit: 500, canTeam: options.canTeam }), today: options.today };
  const unread = withReadMarks(items, readKeys).filter((item) => !item.read);
  return { items: unread, today: options.today, scope: options.scope, counts: notificationListAnswer(rows, { tab: "mine", state: "unread", limit: 0, canTeam: options.canTeam }).counts, canTeam: options.canTeam };
}
