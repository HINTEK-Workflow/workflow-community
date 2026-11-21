import { prisma } from "@/lib/db";
import { MACHINE_ALARM_CHANNEL } from "@/lib/machine/alarm-notice";
import { alarmNoticeAllowed, isNight } from "@/lib/machine/alarm-escalation";
import { runNoticeDelivery, type NoticeDeps, type NoticeRun } from "@/lib/workflow/notice-delivery";

/**
 * Integrationsmotorn E6 (beslut 2026-10-18 punkt 4): maskinlarm som e-post och push oftare än de andra notiserna, och på
 * natten bara där det är tillåtet. Samma utskick som notices:send (samma val per person, samma "skickat"-märken, aldrig
 * två gånger, aldrig från en QA-instans på loopback), men bara sorten Maskinlarm och bara för dem som har ett oläst larm i
 * klockan. Dagtid (06–20) går larmet ut till den som valt typen och kanalen. På natten bara när företaget valt dygnet runt
 * och personen själv sagt ja; annars väntar det och kommer i morgonlistan, det första utskicket efter kl. 06.
 */
const WINDOW_MS = 48 * 3_600_000;

export async function runMachineAlarmDelivery(deps: NoticeDeps = {}): Promise<NoticeRun> {
  const now = deps.now ?? new Date();
  const rows = await prisma.noticeDelivery.findMany({
    where: { channel: MACHINE_ALARM_CHANNEL, createdAt: { gte: new Date(now.getTime() - WINDOW_MS) } },
    distinct: ["userId", "organizationId"], select: { userId: true, organizationId: true }, take: 5000,
  });
  const userIds = [...new Set(rows.map((row) => row.userId))];
  const night = isNight(now);
  const hours = night && rows.length
    ? new Map((await prisma.organization.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.organizationId))] } }, select: { id: true, machineAlarmHours: true } })).map((row) => [row.id, row.machineAlarmHours]))
    : new Map<string, string>();
  return runNoticeDelivery({
    ...deps, now,
    only: { kinds: ["MACHINE_ALARM"], userIds, allow: (organizationId, preference) => alarmNoticeAllowed({ now, hours: hours.get(organizationId) ?? "day", personNight: preference.machineAlarmNight }) },
  });
}
