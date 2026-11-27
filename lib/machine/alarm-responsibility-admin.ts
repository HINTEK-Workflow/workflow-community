import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/server";
import { describeIssue, type IssueLike } from "@/lib/tools/issue-text";
import { partPath } from "@/lib/maintenance/model";
import { loadMembers } from "@/lib/machine/alarm-notice-store";
import { ALARM_HOURS, ALARM_SAFETY_TEXT, alarmContactsAudit, alarmContactsInput, alarmSettingsAudit, alarmSettingsInput, escalationSummary } from "@/lib/machine/alarm-escalation";

/**
 * Integrationsmotorn E6: sidan Larmansvar under Kopplingar → Maskiner. Företagets val (när notiserna går ut och minuter per
 * steg) och ansvarig och ersättare per objekt. Anroparen har kontrollerat session, administratör, Cloud, Origin och
 * bekräftelsen inom 15 minuter (ändringarna styr vem som larmas); varje läsning och skrivning här är bunden till företaget.
 * Sedan Underhåll (2026-10-30) gäller larmansvaret en del i maskinträdet, aldrig en plats i kundens platsträd.
 */
const id = z.string().min(1).max(100);
export const alarmCommands = [
  z.object({ action: z.literal("set_alarm_settings"), hours: z.enum(ALARM_HOURS), escalationMinutes: z.number() }),
  z.object({ action: z.literal("set_alarm_contacts"), partId: id, responsibleUserId: id.nullable(), deputyUserId: id.nullable() }),
] as const;
type Command = z.infer<(typeof alarmCommands)[number]>;
export const isAlarmCommand = (input: { action: string }): input is Command => alarmCommands.some((schema) => schema.shape.action.value === input.action);

const nameOf = (user: { name: string | null; email: string }) => user.name?.trim() || user.email;

/** De som kan vara ansvarig eller ersättare: aktiva medlemmar som får läsa arbetsordrar (administratören alltid). */
async function eligiblePeople(organizationId: string) {
  const members = (await loadMembers(organizationId)).filter((member) => member.admin || member.canReadWorkOrders);
  const users = members.length ? await prisma.user.findMany({ where: { id: { in: members.map((member) => member.userId) } }, select: { id: true, name: true, email: true } }) : [];
  return users.map((user) => ({ userId: user.id, name: nameOf(user) })).sort((a, b) => a.name.localeCompare(b.name, "sv"));
}

export async function listAlarmResponsibility(organizationId: string) {
  const [organization, sources, signals, contacts, people] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { machineAlarmHours: true, machineEscalationMinutes: true } }),
    prisma.machineSource.findMany({ where: { organizationId, machinePartId: { not: null } }, select: { machinePartId: true } }),
    prisma.machineSignal.findMany({ where: { organizationId, machinePartId: { not: null } }, select: { machinePartId: true }, take: 2000 }),
    prisma.machineAlarmContact.findMany({ where: { organizationId, machinePartId: { not: null } }, select: { machinePartId: true, role: true, userId: true } }),
    eligiblePeople(organizationId),
  ]);
  const partIds = new Set([...sources, ...signals, ...contacts].map((row) => row.machinePartId!).filter(Boolean));
  const all = partIds.size ? await prisma.machinePart.findMany({ where: { organizationId }, select: { id: true, parentId: true, name: true, isActive: true }, take: 5000 }) : [];
  const parts = all.filter((part) => partIds.has(part.id));
  const names = new Map(people.map((person) => [person.userId, person.name]));
  const contactOf = (partId: string, role: string) => {
    const row = contacts.find((item) => item.machinePartId === partId && item.role === role);
    // A contact who may no longer read work orders (or left) is shown as missing: the alarm skips them.
    return row ? { userId: row.userId, name: names.get(row.userId) ?? null } : null;
  };
  const minutes = organization.machineEscalationMinutes;
  return {
    settings: { hours: organization.machineAlarmHours, escalationMinutes: minutes },
    people,
    objects: parts.map((part) => {
      const responsible = contactOf(part.id, "responsible");
      const deputy = contactOf(part.id, "deputy");
      // The tree's name stands where the customer stood (Fabriken › Linje 2 for a part under them).
      const path = partPath(all, part.id);
      return {
        id: part.id, name: part.name, isActive: part.isActive,
        customerName: path.join(" › ") || "Maskinträd", customerDeleted: false,
        responsible, deputy,
        summary: escalationSummary({ responsible: responsible?.name ?? null, deputy: deputy?.name ?? null, minutes }),
      };
    }).sort((a, b) => a.customerName.localeCompare(b.customerName, "sv") || a.name.localeCompare(b.name, "sv")),
    safety: ALARM_SAFETY_TEXT,
  };
}

export async function runAlarmCommand(organizationId: string, actorId: string, input: Command): Promise<{ answer: Record<string, unknown>; audit: string }> {
  if (input.action === "set_alarm_settings") {
    const parsed = alarmSettingsInput.safeParse(input);
    if (!parsed.success) throw new ApiError(400, describeIssue(parsed.error.issues[0] as IssueLike));
    const before = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { machineAlarmHours: true, machineEscalationMinutes: true } });
    await prisma.organization.update({ where: { id: organizationId }, data: { machineAlarmHours: parsed.data.hours, machineEscalationMinutes: parsed.data.escalationMinutes } });
    return { answer: { ok: true }, audit: alarmSettingsAudit({ hours: before.machineAlarmHours, minutes: before.machineEscalationMinutes }, parsed.data) };
  }
  const parsed = alarmContactsInput.safeParse(input);
  if (!parsed.success) throw new ApiError(400, describeIssue(parsed.error.issues[0] as IssueLike));
  const value = parsed.data;
  const place = await prisma.machinePart.findFirst({ where: { id: value.partId, organizationId }, select: { id: true, name: true } });
  if (!place) throw new ApiError(404, "Maskindelen finns inte.");
  const people = new Map((await eligiblePeople(organizationId)).map((person) => [person.userId, person.name]));
  for (const userId of [value.responsibleUserId, value.deputyUserId]) {
    if (userId && !people.has(userId)) throw new ApiError(400, "Personen är inte en aktiv medlem som får läsa arbetsordrar.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.machineAlarmContact.deleteMany({ where: { organizationId, machinePartId: place.id } });
    const rows = ([["responsible", value.responsibleUserId], ["deputy", value.deputyUserId]] as const).flatMap(([role, userId]) => userId ? [{ organizationId, machinePartId: place.id, role, userId, createdById: actorId }] : []);
    if (rows.length) await tx.machineAlarmContact.createMany({ data: rows });
  });
  return {
    answer: { ok: true },
    audit: alarmContactsAudit(place.name, { responsible: value.responsibleUserId ? people.get(value.responsibleUserId)! : null, deputy: value.deputyUserId ? people.get(value.deputyUserId)! : null }),
  };
}
