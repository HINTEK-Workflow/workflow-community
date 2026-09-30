import { Prisma } from "@prisma/client";
import { absoluteUrl, env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { sendSystemEmail } from "@/lib/mail/mailer";
import { buildRoundReminderEmail } from "@/lib/mail/templates";
import { formatSwedish, swedishDayKey } from "@/lib/swedish-time";
import { formScheduleRuleSchema, parseScheduleReminders } from "./form-schedule";
import { dueRoundEmails, type ReminderSchedule } from "./round-reminders";

type Dependencies = { enabled?: boolean; send?: typeof sendSystemEmail };

/**
 * Sends today's round reminders by e-mail (Daniel 2026-09-30). Off until ROUND_EMAIL_DELIVERY_ENABLED is set, like the
 * other mail; run once each morning (scripts/rounds/run-round-reminders.ts). A delivery row is claimed before sending,
 * so a second run – or two at once – never sends the same reminder twice; a failure is recorded without the address.
 */
export async function runRoundReminderWorker(now = new Date(), dependencies: Dependencies = {}) {
  const enabled = dependencies.enabled ?? env.ROUND_EMAIL_DELIVERY_ENABLED;
  if (!enabled) return { status: "disabled" as const };
  if (Number.isNaN(now.getTime())) throw new Error("Ogiltig jobbtidpunkt.");
  const send = dependencies.send ?? sendSystemEmail;
  const today = swedishDayKey(now);
  const rows = await prisma.formSchedule.findMany({
    where: { deletedAt: null, active: true, reminders: { path: ["email"], equals: true }, organization: { isActive: true, storageMode: "HINTEK_CLOUD" } },
    include: { facility: { select: { name: true } }, customer: { select: { name: true, company: true } }, organization: { select: { name: true } } },
    take: 2000,
  });
  const schedules: (ReminderSchedule & { organizationName: string })[] = rows.flatMap((row) => {
    const rule = formScheduleRuleSchema.safeParse(row.rule);
    return rule.success ? [{ id: row.id, organizationId: row.organizationId, organizationName: row.organization.name, title: row.title, active: row.active, rule: rule.data, reminders: parseScheduleReminders(row.reminders),
      assignedToUserId: row.assignedToUserId, place: row.facility?.name || (row.customer ? row.customer.company || row.customer.name : "") }] : [];
  });
  if (!schedules.length) return { status: "completed" as const, sent: 0, failed: 0 };
  const organizationIds = [...new Set(schedules.map((schedule) => schedule.organizationId))];
  const [tasks, members, delivered] = await Promise.all([
    prisma.workflowTask.findMany({ where: { organizationId: { in: organizationIds }, kind: "FORM", status: "COMPLETED", OR: schedules.map((schedule) => ({ data: { path: ["details", "values", "round", "scheduleId"], equals: schedule.id } })), updatedAt: { gte: new Date(now.getTime() - 2 * 86_400_000) } }, select: { id: true, status: true, data: true } }),
    prisma.organizationMember.findMany({ where: { organizationId: { in: organizationIds }, isActive: true, user: { isActive: true } }, select: { organizationId: true, userId: true, role: true, user: { select: { email: true } } } }),
    prisma.roundReminderDelivery.findMany({ where: { scheduleId: { in: schedules.map((schedule) => schedule.id) }, occurrence: today }, select: { scheduleId: true, occurrence: true, userId: true } }),
  ]);
  const due = dueRoundEmails({ schedules, tasks, delivered, today, members: members.map((member) => ({ organizationId: member.organizationId, userId: member.userId, email: member.user.email, admin: member.role === "OWNER" || member.role === "ADMIN" })) });
  let sent = 0;
  let failed = 0;
  for (const item of due) {
    try {
      await prisma.roundReminderDelivery.create({ data: { organizationId: item.schedule.organizationId, scheduleId: item.schedule.id, occurrence: item.occurrence, userId: item.recipient.userId, status: "SENT" } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue; // already claimed
      throw error;
    }
    const schedule = schedules.find((entry) => entry.id === item.schedule.id)!;
    const mail = buildRoundReminderEmail({ organizationName: schedule.organizationName, roundTitle: schedule.title, place: schedule.place, day: formatSwedish(`${today}T12:00:00`, { dateStyle: "long" }), roundsUrl: absoluteUrl("/?view=rounds") });
    try {
      await send({ to: item.recipient.email, subject: `Rond idag: ${schedule.title}`, html: mail.html, text: mail.text });
      sent += 1;
    } catch (error) {
      failed += 1;
      await prisma.roundReminderDelivery.update({ where: { scheduleId_occurrence_userId: { scheduleId: item.schedule.id, occurrence: item.occurrence, userId: item.recipient.userId } }, data: { status: "FAILED", failure: error instanceof Error ? error.name.slice(0, 80) : "SendFailed" } });
    }
  }
  return { status: "completed" as const, sent, failed };
}
