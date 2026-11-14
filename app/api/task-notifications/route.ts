import { NextResponse } from "next/server";
import { z } from "zod";
import { body, checkOrigin, context, failure, requireCloudStorage, type Context } from "@/lib/kfid/server";
import { prisma } from "@/lib/db";
import { waitingDraftNotice } from "@/lib/mail/mailing-drafts";
import { canViewTeam } from "@/lib/workflow/permissions";
import { collapseRepeated, keysToMarkRead, NOTICE_READ_CHANNEL, NOTIFICATION_TABS, notificationCounts, notificationListAnswer, parseNotificationState, parseNotificationTab } from "@/lib/workflow/notification-list";
import { NOTIFICATION_MAX, notificationLimit, notificationToday, orderNotifications } from "@/lib/workflow/task-notifications";
import { applyReadMarks, loadCloudNotifications } from "@/lib/workflow/task-notifications-server";
import { closureNotification } from "@/lib/company-closure/server";
import { serverUpdateNoticeList } from "@/lib/ops/host-status-server";
import { issueReportNotices } from "@/lib/workflow/issue-report-notice";

export const dynamic = "force-dynamic";

/** Everything the person's bell may hold now, read and unread. A member's Teamet rows only with team:read, and never for an API key. */
async function loadAll(ctx: Context) {
  const now = new Date();
  // The reminders themselves are computed in lib/workflow/task-notifications-server.ts (shared with the job that mails
  // and pushes them).
  const reminders = await loadCloudNotifications(ctx, now, { includeRead: true, teamReader: !ctx.integration && canViewTeam(ctx) });
  // Veckobrev (2026-10-07): the installation's superadmin is told in the bell while a draft waits for approval –
  // first, and never inside an API/MCP call or an app connected through OAuth.
  const draft = ctx.user.role === "SUPERADMIN" && !ctx.integration ? await waitingDraftNotice() : null;
  // Serveruppdateringar (2026-10-25): security updates or a restart waiting > 3 days, or the automatic updates off.
  const servers = ctx.user.role === "SUPERADMIN" && !ctx.integration ? await serverUpdateNoticeList() : [];
  // Felrapporter (2026-11-13): a report through Rapportera fel eller förslag, told to the superadmin the same way.
  const reports = ctx.user.role === "SUPERADMIN" && !ctx.integration ? await issueReportNotices() : [];
  // Radering efter avslut (2026-10-10): while the countdown runs, the company's owners and admins see it first.
  const closure = ctx.admin && !ctx.integration ? await closureNotification(ctx.organizationId) : null;
  const own = await applyReadMarks(ctx, [...(closure ? [closure] : []), ...(draft ? [draft] : []), ...servers, ...reports]);
  return orderNotifications([...own, ...reminders]);
}

export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const all = await loadAll(ctx);
    const params = new URL(request.url).searchParams;
    const limit = notificationLimit(params.get("limit"));
    const today = notificationToday();
    const canTeam = !ctx.integration && canViewTeam(ctx);
    const rows = collapseRepeated(all);
    const tab = parseNotificationTab(params.get("tab"));
    // Notislistan (beslut 4, 2026-11-01): one tab and one state at a time, bounded, with "Kräver åtgärd" on top.
    if (tab) return NextResponse.json({ ...notificationListAnswer(rows, { tab, state: parseNotificationState(params.get("state")), limit, canTeam }), today }, { headers: { "Cache-Control": "private, no-store" } });
    // The bell, Hem, the API and the assistant: what is unread, each notice for itself, as before. Bounded answer (quality check
    // 2026-10-05, F3: 4 106 reminders, 831 kB every minute): the total and the most urgent `limit` reminders.
    const unread = all.filter((item) => !item.read && (ctx.admin || item.audience !== "team"));
    return NextResponse.json({ items: unread.slice(0, limit), total: unread.length, today, scope: ctx.admin ? "team" : "mine", counts: notificationCounts(rows, canTeam), canTeam }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

const readInput = z.union([
  z.object({ action: z.literal("read"), id: z.string().trim().min(1).max(300) }),
  z.object({ action: z.literal("read_all"), tab: z.enum(NOTIFICATION_TABS) }),
]);

/**
 * Oläst/Läst: the person's own marks, never anyone else's. The keys come from what the server itself just computed for this
 * person, so nothing outside what they may read can be marked. Not a change of company data, so a paused company can still do it.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    const input = readInput.parse(await body(request));
    const rows = collapseRepeated(await loadAll(ctx));
    const keys = keysToMarkRead(rows, input.action === "read" ? { id: input.id } : { tab: input.tab, canTeam: !ctx.integration && canViewTeam(ctx) }).slice(0, NOTIFICATION_MAX);
    if (keys.length) await prisma.noticeDelivery.createMany({ data: keys.map((key) => ({ organizationId: ctx.organizationId, userId: ctx.user.id, key, channel: NOTICE_READ_CHANNEL })), skipDuplicates: true });
    return NextResponse.json({ marked: keys.length }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
