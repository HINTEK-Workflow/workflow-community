import { scheduleOccurrences, taskRound, type FormScheduleReminders, type FormScheduleRule } from "./form-schedule";

/**
 * Which rounds get an e-mail today (Daniel 2026-09-30), without Prisma or mail so it can be tested: an active round
 * with e-mail on whose rule has an occurrence today, not already done, sent to its responsible person – or to the
 * company's administrators when none is chosen. Deliveries already made are skipped (one per round, day and person).
 */
export type ReminderSchedule = {
  id: string; organizationId: string; title: string; active: boolean; rule: FormScheduleRule; reminders: FormScheduleReminders;
  assignedToUserId: string | null; place: string;
};
export type ReminderRecipient = { userId: string; email: string };

export function dueRoundEmails(input: {
  schedules: ReminderSchedule[];
  tasks: { id: string; status: string; data: unknown }[];
  /** Active members who may receive: the responsible person must be one of them, administrators by organization. */
  members: (ReminderRecipient & { organizationId: string; admin: boolean })[];
  delivered: { scheduleId: string; occurrence: string; userId: string }[];
  today: string;
}) {
  const done = new Set(input.tasks.flatMap((task) => { const round = taskRound(task); return round && round.status === "COMPLETED" ? [`${round.scheduleId}:${round.occurrence}`] : []; }));
  const sent = new Set(input.delivered.map((item) => `${item.scheduleId}:${item.occurrence}:${item.userId}`));
  return input.schedules.flatMap((schedule) => {
    if (!schedule.active || !schedule.reminders.email || !scheduleOccurrences(schedule.rule, input.today, input.today).length) return [];
    if (done.has(`${schedule.id}:${input.today}`)) return [];
    const members = input.members.filter((member) => member.organizationId === schedule.organizationId);
    const recipients = schedule.assignedToUserId ? members.filter((member) => member.userId === schedule.assignedToUserId) : members.filter((member) => member.admin);
    return recipients.filter((recipient) => !sent.has(`${schedule.id}:${input.today}:${recipient.userId}`))
      .map((recipient) => ({ schedule, recipient: { userId: recipient.userId, email: recipient.email }, occurrence: input.today }));
  });
}
