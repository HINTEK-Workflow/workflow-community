import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SYSTEM_CREATOR } from "@/lib/machine/alarm-rules";
import { alarmKey, alarmKeyPrefix, alarmNoteKey, alarmNoteSourcePrefix, alarmRecipients, alarmRef, claimDecision, claimNote, MACHINE_ALARM_CHANNEL, MACHINE_NOTE_CHANNEL, MACHINE_NOTE_QUIET_MS, SIM_RUNNER_CHANNEL, simRunnerKey, type AlarmMember, type AlarmNoteReason } from "@/lib/machine/alarm-notice";
import { escalationSteps, type EscalationStep } from "@/lib/machine/alarm-escalation";
import { hasWorkflowPermission, normalizeWorkflowPermissionProfile } from "@/lib/workflow/permissions";

/**
 * Databasdelen av notis med kvittens för maskinlarm (S4). Reglerna finns i alarm-notice.ts. Ingen schemaändring: en
 * notis är en rad i NoticeDelivery (kanal MACHINE_ALARM), precis som "Tilldelad dig".
 */
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const uniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** Aktiva medlemmar i företaget med sina behörigheter, i den form reglerna behöver. */
export async function loadMembers(organizationId: string): Promise<AlarmMember[]> {
  const rows = await prisma.organizationMember.findMany({
    where: { organizationId, isActive: true, user: { isActive: true } },
    take: 500, select: { userId: true, role: true, workflowPermissions: true },
  });
  return rows.map((row) => ({
    userId: row.userId,
    admin: row.role === "OWNER" || row.role === "ADMIN",
    canReadWorkOrders: hasWorkflowPermission(normalizeWorkflowPermissionProfile(row.workflowPermissions), "work-order", "read"),
    canReadMachines: hasWorkflowPermission(normalizeWorkflowPermissionProfile(row.workflowPermissions), "maintenance", "read"),
  }));
}

/** Personernas sparade val av notistyper (de som inte sparat något saknas). */
export async function loadChoices(userIds: readonly string[]) {
  if (!userIds.length) return new Map<string, string[]>();
  return new Map((await prisma.noticePreference.findMany({ where: { userId: { in: [...userIds] } }, select: { userId: true, kinds: true } })).map((row) => [row.userId, row.kinds]));
}

/**
 * Integrationsmotorn E6: maskindelens (Underhåll 2026-10-30; förut objektets) ansvarig och ersättare, bara när de fortfarande är aktiva medlemmar som får läsa
 * arbetsordrar (administratören alltid). En roll utan giltig person räknas som tom.
 */
export async function loadContacts(organizationId: string, partId: string | null, members: readonly AlarmMember[]) {
  if (!partId) return { responsible: null, deputy: null };
  const rows = await prisma.machineAlarmContact.findMany({ where: { organizationId, machinePartId: partId }, select: { role: true, userId: true } });
  const allowed = new Set(members.filter((member) => member.admin || member.canReadWorkOrders).map((member) => member.userId));
  const pick = (role: string) => rows.find((row) => row.role === role && allowed.has(row.userId))?.userId ?? null;
  return { responsible: pick("responsible"), deputy: pick("deputy") };
}

/** Stegen för en automatisk order (E6): ansvarig → ersättare → alla som får larm; utan larmansvar bara "alla". */
export async function alarmSteps(organizationId: string, partId: string | null, members: readonly AlarmMember[], choices: ReadonlyMap<string, readonly string[]>): Promise<EscalationStep[]> {
  const everyone = alarmRecipients({ members, choices, pending: false });
  return escalationSteps({ ...(await loadContacts(organizationId, partId, members)), everyone });
}

/** Klockans rader för ett steg (en per person; en rad som redan finns lämnas). */
export async function tellPeople(organizationId: string, key: string, userIds: readonly string[], channel: string = MACHINE_ALARM_CHANNEL) {
  let made = 0;
  for (const userId of userIds) {
    try { await prisma.noticeDelivery.create({ data: { organizationId, userId, key, channel }, select: { id: true } }); made++; }
    catch (error) { if (!uniqueViolation(error)) throw error; }
  }
  return made;
}

/**
 * Berättar för rätt personer att en automatisk arbetsorder finns (`taskId`) eller att ett förslag väntar (`pendingRowId`).
 * `exceptUserId` är den som själv just godkände och inte behöver en notis. Kastar aldrig: larmet är redan sparat.
 */
export async function notifyAlarm(input: { organizationId: string; sourceId: string; taskId?: string; pendingRowId?: string; exceptUserId?: string | null }): Promise<number> {
  try {
    const pending = !input.taskId;
    const ref = input.taskId ? alarmRef({ taskId: input.taskId }) : input.pendingRowId ? alarmRef({ pendingRowId: input.pendingRowId }) : null;
    if (!ref) return 0;
    const members = await loadMembers(input.organizationId);
    const choices = await loadChoices(members.map((member) => member.userId));
    const except = (ids: readonly string[]) => ids.filter((id) => id !== input.exceptUserId);
    if (pending) return await tellPeople(input.organizationId, alarmKey(ref, input.sourceId), except(alarmRecipients({ members, choices, pending })));
    // E6: an order on a machine part with a responsible person (or a deputy) goes to them first; the rest follow by escalation.
    const row = await prisma.machineAlarmOrder.findFirst({ where: { organizationId: input.organizationId, taskId: input.taskId }, select: { id: true, machinePartId: true } });
    const steps = await alarmSteps(input.organizationId, row?.machinePartId ?? null, members, choices);
    if (row) await prisma.machineAlarmOrder.updateMany({ where: { id: row.id }, data: { escalationStep: 0, escalatedAt: new Date() } });
    return await tellPeople(input.organizationId, alarmKey(ref, input.sourceId), except(steps[0]?.userIds ?? []));
  } catch (error) {
    console.error("machine alarm notice failed", error instanceof Error ? error.name : "unknown");
    return 0;
  }
}

/** Den som skapar nyckeln till källan Simulator är den som kör simulatorn: bara den personen får notiserna om dess larm utan order. */
export async function markSimulatorRunner(input: { organizationId: string; sourceId: string; userId: string }) {
  try {
    const key = simRunnerKey(input.sourceId);
    await prisma.$transaction([
      prisma.noticeDelivery.deleteMany({ where: { organizationId: input.organizationId, channel: SIM_RUNNER_CHANNEL, key } }),
      prisma.noticeDelivery.create({ data: { organizationId: input.organizationId, userId: input.userId, channel: SIM_RUNNER_CHANNEL, key }, select: { id: true } }),
    ]);
  } catch (error) {
    console.error("simulator runner not saved", error instanceof Error ? error.name : "unknown");
  }
}

/**
 * Berättar att ett larm inte gav någon arbetsorder och varför. Ett simulerat larm går bara till den som kör simulatorn och till ingen
 * annan, inte ens när personen saknas. Övriga går till dem som har behörighet till maskinerna. Kastar aldrig: larmet är redan sparat.
 */
export async function noteAlarm(input: { organizationId: string; sourceId: string; eventId: string; reason: AlarmNoteReason; simulated: boolean; taskId?: string | null; now?: Date }): Promise<number> {
  try {
    const members = await loadMembers(input.organizationId);
    const memberIds = new Set(members.map((member) => member.userId));
    const people = input.simulated
      ? (await prisma.noticeDelivery.findMany({ where: { organizationId: input.organizationId, channel: SIM_RUNNER_CHANNEL, key: simRunnerKey(input.sourceId) }, select: { userId: true }, take: 1 })).map((row) => row.userId).filter((id) => memberIds.has(id))
      : alarmRecipients({ members, choices: await loadChoices(members.map((member) => member.userId)), pending: false });
    if (!people.length) return 0;
    const since = new Date((input.now ?? new Date()).getTime() - MACHINE_NOTE_QUIET_MS[input.simulated ? "simulated" : "real"]);
    const told = new Set((await prisma.noticeDelivery.findMany({
      where: { organizationId: input.organizationId, channel: MACHINE_NOTE_CHANNEL, userId: { in: people }, key: { startsWith: alarmNoteSourcePrefix(input.sourceId, input.reason) }, createdAt: { gte: since } },
      select: { userId: true },
    })).map((row) => row.userId));
    return await tellPeople(input.organizationId, alarmNoteKey(input), people.filter((id) => !told.has(id)), MACHINE_NOTE_CHANNEL);
  } catch (error) {
    console.error("machine alarm note failed", error instanceof Error ? error.name : "unknown");
    return 0;
  }
}

/** Tar bort de olästa larmnotiserna för en order eller ett förslag, för alla (eller alla utom en person). */
export async function clearAlarmNotices(input: { organizationId: string; ref: string; exceptUserId?: string }, db: Pick<typeof prisma, "noticeDelivery"> = prisma) {
  const { count } = await db.noticeDelivery.deleteMany({
    where: { organizationId: input.organizationId, channel: MACHINE_ALARM_CHANNEL, key: { startsWith: alarmKeyPrefix(input.ref) }, ...(input.exceptUserId ? { userId: { not: input.exceptUserId } } : {}) },
  });
  return count;
}

export type ClaimResult =
  | { result: "not_found" }
  | { result: "closed" }
  | { result: "taken"; by: string }
  | { result: "mine"; version: number; status: string }
  | { result: "claimed"; version: number; status: string };

/**
 * Kvittera ("Jag tar den"). Anroparen har redan kontrollerat session, företag och behörighet. Bara en automatisk order
 * i företaget kan kvitteras. Villkoret ligger i databasen (assignedToUserId är null), så två som kvitterar samtidigt
 * ger en ägare och ett vänligt besked till den andra. Orderns status ändras aldrig och ordern stängs aldrig.
 */
export async function claimMachineAlarm(input: { organizationId: string; userId: string; userName: string; taskId: string }): Promise<ClaimResult> {
  return prisma.$transaction(async (tx) => {
    const link = await tx.machineAlarmOrder.findFirst({ where: { organizationId: input.organizationId, taskId: input.taskId }, select: { id: true } });
    const read = () => tx.workflowTask.findFirst({
      where: { id: input.taskId, organizationId: input.organizationId, kind: "WORK_ORDER", createdBy: SYSTEM_CREATOR },
      select: { version: true, title: true, description: true, status: true, progress: true, data: true, assignedToUserId: true, assignedToName: true },
    });
    const task = link ? await read() : null;
    if (!task) return { result: "not_found" };
    const decision = claimDecision(task, input.userId);
    if (decision.result === "closed") return { result: "closed" };
    if (decision.result === "taken") return { result: "taken", by: decision.by };
    // E6: the first acknowledgement is kept on the alarm's row (the key figures' time to acknowledge) and stops the escalation.
    const acknowledge = () => tx.machineAlarmOrder.updateMany({ where: { id: link!.id, acknowledgedAt: null }, data: { acknowledgedAt: new Date(), acknowledgedById: input.userId } });
    if (decision.result === "mine") {
      await acknowledge();
      await clearAlarmNotices({ organizationId: input.organizationId, ref: input.taskId }, tx);
      return { result: "mine", version: task.version, status: task.status };
    }
    // The condition is part of the update itself: only one of two at once gets the order.
    const changed = await tx.workflowTask.updateMany({
      where: { id: input.taskId, organizationId: input.organizationId, assignedToUserId: null, status: { notIn: ["COMPLETED", "CANCELLED"] } },
      data: { assignedToUserId: input.userId, assignedToName: input.userName, version: { increment: 1 }, updatedBy: input.userId },
    });
    if (!changed.count) {
      const now = await read();
      if (!now) return { result: "not_found" };
      const again = claimDecision(now, input.userId);
      return again.result === "taken" ? { result: "taken", by: again.by } : again.result === "mine" ? { result: "mine", version: now.version, status: now.status } : { result: "closed" };
    }
    const fresh = (await read())!;
    // The history: a new version with the same content and a plain line saying who took the order.
    await tx.workflowTaskRevision.create({ data: { taskId: input.taskId, version: fresh.version, createdBy: input.userId, snapshot: json({ title: fresh.title, description: fresh.description, status: fresh.status, progress: fresh.progress, data: fresh.data, completedAt: null, note: claimNote(input.userName) }) } });
    await acknowledge();
    await clearAlarmNotices({ organizationId: input.organizationId, ref: input.taskId }, tx);
    return { result: "claimed", version: fresh.version, status: fresh.status };
  });
}
