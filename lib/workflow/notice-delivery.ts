import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { absoluteUrl } from "@/lib/env";
import { publicInstance } from "@/lib/instance";
import { refreshRegistrationGate } from "@/lib/auth/registration";
import { runAsPrincipal } from "@/lib/integrations/principal";
import { context } from "@/lib/kfid/server";
import { sendSystemEmail } from "@/lib/mail/mailer";
import { waitingDraftNotice } from "@/lib/mail/mailing-drafts";
import { serverUpdateNoticeList } from "@/lib/ops/host-status-server";
import { issueReportNotices } from "@/lib/workflow/issue-report-notice";
import { mailConfig } from "@/lib/mail/settings-server";
import { loadPushConfig } from "@/lib/push/settings-server";
import { sendWebPush, type PushSubscriptionKeys } from "@/lib/push/web-push";
import { parseScheduleReminders } from "@/lib/workflow/form-schedule";
import { sendsFromTheStart } from "@/lib/workflow/notification-list";
import { availableNoticeKinds, noticeKey, noticeKindsOf, normalizeNoticeKinds, noticesToSend, type NoticeChannel, type NoticeKind } from "@/lib/workflow/notice-channels";
import { buildNoticeDigest, buildPushNotice, type DigestItem } from "@/lib/workflow/notice-digest";
import { notificationToday, type TaskNotification } from "@/lib/workflow/task-notifications";
import { loadCloudNotifications } from "@/lib/workflow/task-notifications-server";

/**
 * Notiser per e-post och push (2026-10-07): the reminders the bell shows, sent as one e-mail and one short push
 * to the people who chose it – never before the person said yes, never twice (one mark per notice, channel and person,
 * claimed before sending), never to a member beyond their own and an admin's team, and never from a loopback QA instance.
 * Run by `npm run notices:send` (cron every 15 minutes, daytime). A person who may not sign in (the login rule) gets
 * nothing, because the notices are read through the same checks as the bell.
 *
 * "Kräver åtgärd" (beslut 4, 2026-11-01) goes from the start, to everyone who is a member of a Cloud company and has not turned
 * it off under Mina inställningar → Notiser: by e-mail, and by push on devices that said yes. Everything else is as before.
 */
export type NoticeEmail = { to: string; subject: string; html: string; text: string };
export type NoticeDeps = {
  now?: Date;
  /** At most this many people per run (default 5 000: only those who chose a channel are read). */
  limit?: number;
  /** The real sending and its switches by default; tests pass their own. */
  email?: { enabled: boolean; send: (mail: NoticeEmail) => Promise<unknown>; roundRemindersMailed?: boolean };
  push?: { enabled: boolean; send: (subscription: PushSubscriptionKeys, payload: string) => Promise<{ status: number }> };
  /**
   * Integrationsmotorn E6 (machine:alarms): only these kinds, only these people, and only the notices `allow` lets through
   * now (the company's hours and the person's own yes to the night). Without it, everything as before.
   */
  only?: { kinds: readonly NoticeKind[]; userIds: readonly string[]; allow?: (organizationId: string, preference: { machineAlarmNight: boolean }) => boolean };
  /**
   * Torrkörning (T5, 2026-10-24: `npm run notices:send -- --dry-run`): the same choice of people and notices, counted as
   * if sent – nothing is claimed, sent, released or deleted, so the next real run sends exactly the same.
   */
  dryRun?: boolean;
};

type Found = { organizationId: string; organizationName: string; item: TaskNotification };
type NoticePerson = { userId: string; email: boolean; push: boolean; kinds: string[]; machineAlarmNight: boolean; requiredNotices: boolean };
export type NoticeRun = { status: "disabled" } | { status: "done"; people: number; emails: number; pushes: number; notices: number; failed: number; skipped: number };

const uniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** The marks of the notices this run sends: the ones it managed to claim, so a second run – or two at once – never sends them again. */
async function claim(rows: { organizationId: string; userId: string; key: string; channel: NoticeChannel }[]) {
  const claimed = new Set<string>();
  for (const data of rows) {
    try { await prisma.noticeDelivery.create({ data, select: { id: true } }); claimed.add(data.key); }
    catch (error) { if (!uniqueViolation(error)) throw error; }
  }
  return claimed;
}

/** A send that failed is not a delivery: the marks go, so the next run tries again. */
const release = (userId: string, channel: NoticeChannel, keys: Iterable<string>) => prisma.noticeDelivery.deleteMany({ where: { userId, channel, key: { in: [...keys] } } });

/** The person's notices in each company they belong to, read as the person (a member: their own work, an admin: the team's). */
async function loadFor(userId: string, userRole: string, now: Date): Promise<Found[]> {
  const memberships = await prisma.organizationMember.findMany({
    where: { userId, isActive: true, organization: { isActive: true, storageMode: "HINTEK_CLOUD" } },
    orderBy: { createdAt: "asc" }, take: 20, select: { organizationId: true, organization: { select: { name: true } } },
  });
  const found: Found[] = [];
  for (const membership of memberships) {
    // The same checks as the bell: session-less, but the member must be active, the company active and the person allowed in.
    const ctx = await runAsPrincipal({ keyId: "system:notice-delivery", keyName: "Notiser", kind: "API", organizationId: membership.organizationId, actingUserId: userId, scopes: [] }, () => context({ skipLegal: true })).catch(() => null);
    if (!ctx) continue;
    for (const item of await loadCloudNotifications(ctx, now)) found.push({ organizationId: membership.organizationId, organizationName: membership.organization.name, item });
  }
  // A veckobrev draft waiting for approval, told to the installation's superadmin once (under their first company).
  if (userRole === "SUPERADMIN" && memberships[0]) {
    const draft = await waitingDraftNotice();
    if (draft) found.unshift({ organizationId: memberships[0].organizationId, organizationName: memberships[0].organization.name, item: draft });
    // Serveruppdateringar (2026-10-25): the same way, one notice per server and state (its id carries the day it began).
    for (const item of (await serverUpdateNoticeList(now, { pending: false })).reverse()) found.unshift({ organizationId: memberships[0].organizationId, organizationName: memberships[0].organization.name, item });
    // Felrapporter (2026-11-13): the same way, once per report.
    for (const item of (await issueReportNotices(now)).reverse()) found.unshift({ organizationId: memberships[0].organizationId, organizationName: memberships[0].organization.name, item });
  }
  return found;
}

/** Rounds whose schedule already e-mails its reminder to this person (the older round mail), so they are not mailed twice. */
async function roundsMailedBySchedule(found: Found[]) {
  const ids = [...new Set(found.flatMap(({ item }) => item.kind === "ROUND" ? [item.id.split(":")[1]] : []).filter(Boolean))];
  if (!ids.length) return new Set<string>();
  const schedules = await prisma.formSchedule.findMany({ where: { id: { in: ids } }, select: { id: true, reminders: true } });
  const mailed = new Set(schedules.filter((schedule) => parseScheduleReminders(schedule.reminders).email).map((schedule) => schedule.id));
  return new Set(found.filter(({ item }) => item.kind === "ROUND" && mailed.has(item.id.split(":")[1])).map(({ item }) => item.id));
}

export async function runNoticeDelivery(deps: NoticeDeps = {}): Promise<NoticeRun> {
  const now = deps.now ?? new Date();
  // A loopback QA instance never sends (Workflow's rule): the mail settings say so for e-mail and push alike.
  const mail = await mailConfig();
  const email = deps.email ?? { enabled: mail.delivery.notices && !mail.blockedReason, send: sendSystemEmail, roundRemindersMailed: mail.delivery.roundReminders };
  const pushConfig = deps.push ? null : await loadPushConfig();
  const push = deps.push ?? { enabled: Boolean(pushConfig) && !mail.blockedReason, send: (subscription: PushSubscriptionKeys, payload: string) => sendWebPush(subscription, payload, { subject: pushConfig!.subject, keys: pushConfig!.keys }) };
  if (!email.enabled && !push.enabled) return { status: "disabled" };
  // The login rule is read from the database (it is otherwise refreshed by the app's own requests).
  await refreshRegistrationGate();

  const wanted: Prisma.NoticePreferenceWhereInput[] = [...(email.enabled ? [{ email: true }] : []), ...(push.enabled ? [{ push: true }] : [])];
  const only = deps.only;
  if (only && !only.userIds.length) return { status: "done", people: 0, emails: 0, pushes: 0, notices: 0, failed: 0, skipped: 0 };
  const preferences: NoticePerson[] = await prisma.noticePreference.findMany({ where: { OR: wanted, kinds: { isEmpty: false }, ...(only ? { userId: { in: [...only.userIds] } } : {}) }, orderBy: { userId: "asc" }, take: deps.limit ?? 5000 });
  // Not for a run of one kind (only): those are the machine alarm's own rules.
  if (!only) {
    const known = new Set(preferences.map((preference) => preference.userId));
    const members = await prisma.organizationMember.findMany({
      where: { isActive: true, organization: { isActive: true, storageMode: "HINTEK_CLOUD" }, user: { isActive: true } },
      distinct: ["userId"], orderBy: { userId: "asc" }, take: deps.limit ?? 5000, select: { userId: true },
    });
    const others = await prisma.noticePreference.findMany({ where: { userId: { in: members.map((member) => member.userId).filter((userId) => !known.has(userId)) } } });
    const stored = new Map(others.map((preference) => [preference.userId, preference]));
    for (const { userId } of members) {
      const person = stored.get(userId) ?? { userId, email: false, push: false, kinds: [], machineAlarmNight: false, requiredNotices: true };
      // Without a working channel for them there is nothing to read their notices for.
      if (!known.has(userId) && person.requiredNotices && (email.enabled || (push.enabled && person.push))) preferences.push(person);
    }
  }
  const result = { people: 0, emails: 0, pushes: 0, notices: 0, failed: 0, skipped: 0 };
  const today = notificationToday(now);
  const instanceName = publicInstance().name;
  const appUrl = absoluteUrl("/");

  for (const preference of preferences) {
    try {
      const user = await prisma.user.findUnique({ where: { id: preference.userId }, select: { id: true, email: true, name: true, role: true, isActive: true } });
      if (!user?.isActive) { result.skipped++; continue; }
      const kinds = normalizeNoticeKinds(preference.kinds, availableNoticeKinds({ superadmin: user.role === "SUPERADMIN" }).map((kind) => kind.key));
      const required = !only && preference.requiredNotices;
      const anyChosen = kinds.length > 0 && (preference.email || preference.push);
      if (!anyChosen && !required) { result.skipped++; continue; }
      const all = await loadFor(user.id, user.role, now);
      const found = (only ? all.filter(({ organizationId, item }) => noticeKindsOf(item).some((kind) => only.kinds.includes(kind)) && (!only.allow || only.allow(organizationId, preference))) : all)
        // Someone who chose nothing only ever hears about what requires action.
        .filter(({ item }) => anyChosen || sendsFromTheStart(item));
      if (!found.length) continue;
      result.people++;
      const keys = found.map(({ item }) => noticeKey(item));
      const alreadySent = async (channel: NoticeChannel) => new Set((await prisma.noticeDelivery.findMany({ where: { userId: user.id, channel, key: { in: keys } }, select: { key: true } })).map((row) => row.key));
      const pick = (candidates: Found[], sent: Set<string>, channelChosen: boolean) => {
        const chosen = new Set(noticesToSend(candidates.map(({ item }) => item), channelChosen ? kinds : [], sent, required ? sendsFromTheStart : undefined));
        return candidates.filter(({ item }) => chosen.has(item));
      };
      const asDigest = (items: Found[]): DigestItem[] => items.map(({ organizationName, item }) => ({ organizationName, item }));

      // E-post: one digest with what is new.
      if (email.enabled && (preference.email || required)) {
        const skipRounds = email.roundRemindersMailed ? await roundsMailedBySchedule(found) : new Set<string>();
        const fresh = pick(found.filter(({ item }) => !skipRounds.has(item.id)), await alreadySent("EMAIL"), preference.email);
        if (deps.dryRun) { if (fresh.length) { result.emails++; result.notices += fresh.length; } }
        const claimed = deps.dryRun || !fresh.length ? new Set<string>() : await claim(fresh.map(({ organizationId, item }) => ({ organizationId, userId: user.id, key: noticeKey(item), channel: "EMAIL" as const })));
        const toSend = fresh.filter(({ item }) => claimed.has(noticeKey(item)));
        if (toSend.length) {
          const digest = buildNoticeDigest({ items: asDigest(toSend), today, name: instanceName, appUrl, recipientName: user.name });
          try { await email.send({ to: user.email, subject: digest.subject, html: digest.html, text: digest.text }); result.emails++; result.notices += toSend.length; }
          catch { await release(user.id, "EMAIL", claimed); result.failed++; }
        }
      }

      // Push: one short message to each of the person's devices.
      if (push.enabled && preference.push) {
        const subscriptions = await prisma.pushSubscription.findMany({ where: { userId: user.id }, take: 20 });
        const fresh = subscriptions.length ? pick(found, await alreadySent("PUSH"), true) : [];
        if (deps.dryRun) { if (fresh.length) { result.pushes++; result.notices += fresh.length; } }
        const claimed = deps.dryRun || !fresh.length ? new Set<string>() : await claim(fresh.map(({ organizationId, item }) => ({ organizationId, userId: user.id, key: noticeKey(item), channel: "PUSH" as const })));
        const toSend = fresh.filter(({ item }) => claimed.has(noticeKey(item)));
        if (toSend.length) {
          const payload = JSON.stringify(buildPushNotice(asDigest(toSend), today, instanceName));
          const delivered: string[] = [];
          const gone: string[] = [];
          for (const subscription of subscriptions) {
            try {
              const { status } = await push.send({ endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth }, payload);
              if (status >= 200 && status < 300) delivered.push(subscription.id);
              else if (status === 404 || status === 410) gone.push(subscription.id);
            } catch { /* tried again at the next run */ }
          }
          // A device that has gone (the push service says so) is forgotten.
          if (gone.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } });
          if (gone.length && gone.length === subscriptions.length) await prisma.noticePreference.update({ where: { userId: user.id }, data: { push: false } });
          if (delivered.length) {
            await prisma.pushSubscription.updateMany({ where: { id: { in: delivered } }, data: { lastSentAt: now } });
            result.pushes++; result.notices += toSend.length;
          } else { await release(user.id, "PUSH", claimed); result.failed++; }
        }
      }
    } catch (error) {
      // One person's failure never stops the others; only the name of the error is kept, never an address.
      result.failed++;
      console.error(`notices:send – fel för en person: ${error instanceof Error ? error.name : "okänt fel"}`);
    }
  }
  return { status: "done", ...result };
}
