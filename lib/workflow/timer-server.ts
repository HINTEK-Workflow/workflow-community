import type { Prisma } from "@prisma/client";
import { MIN_TIME_ENTRY_SECONDS, type StoppedTimer } from "./running-timer";
import { assertTimeOpen } from "./time-period-lock";

/**
 * Server side of the per-person timer. Time runs on a work order or a project (Arbetsordern styr, 2026-10-26):
 * a task's timer runs on its work order, and one person has at most one running timer – starting one pauses the others,
 * wherever they run. Stopping an entry finishes it and writes it to the append-only time history.
 */
type Actor = { organizationId: string; user: { id: string; name?: string | null; email: string } };
type RunningEntry = { id: string; userId: string; startedAt: Date; note: string };
/** What the time is on: a work order (`project` false) or a project. */
export type TimeOwnerRef = { id: string; title: string; project?: boolean };

/** `keepShort`: the person chose "Spara ändå" for a timer under a minute (2026-10-12), so the short entry is saved too. */
export type CloseTimeOptions = { keepShort?: boolean };

/** Time entries of the company: an entry has no company of its own, it is the company's through its work order or project. */
export const timeEntryInOrganization = (organizationId: string): Prisma.WorkflowTimeEntryWhereInput =>
  ({ OR: [{ task: { is: { organizationId } } }, { project: { is: { organizationId } } }] });

/** The owner columns of a new entry: exactly one of them (the database's CHECK says the same). */
export const timeOwnerColumns = (owner: Pick<TimeOwnerRef, "id" | "project">) => owner.project ? { projectId: owner.id } : { taskId: owner.id };

/** The history's snapshot of the owner: `taskId` is the owner's id (kept for older readers), `projectId` marks project time. */
export const timeOwnerSnapshot = (owner: TimeOwnerRef) => ({ taskId: owner.id, taskTitle: owner.title, ...(owner.project ? { projectId: owner.id } : {}) });

export async function closeTimeEntries(tx: Prisma.TransactionClient, actor: Actor, running: RunningEntry[], owner: TimeOwnerRef, now: Date, options: CloseTimeOptions = {}) {
  const stopped: StoppedTimer[] = [];
  // Tidsperiod (2026-10-30): an entry in a sent-in or approved month is never finished or removed here (sending in is refused
  // while a timer runs in the month, so this only stops a race).
  await assertTimeOpen(tx, actor.organizationId, running, actor.user.id);
  for (const entry of running) {
    const elapsedSec = Math.max(0, Math.floor((now.getTime() - entry.startedAt.getTime()) / 1000));
    // "Spara ändå" saves at least one minute (rounded up, 2026-10-18), so the entry shows in the totals.
    const durationSec = options.keepShort ? Math.max(MIN_TIME_ENTRY_SECONDS, elapsedSec) : elapsedSec;
    if (durationSec < MIN_TIME_ENTRY_SECONDS) {
      // Never reached the time history (entries enter it when they stop), so nothing else refers to it.
      await tx.workflowTimeEntry.delete({ where: { id: entry.id } });
      continue;
    }
    await tx.workflowTimeEntry.update({ where: { id: entry.id }, data: { endedAt: now, durationSec } });
    await tx.workflowTimeEntryEvent.create({ data: { organizationId: actor.organizationId, entryId: entry.id, userId: entry.userId, action: "CREATED", reason: "",
      next: { ...timeOwnerSnapshot(owner), startedAt: entry.startedAt.toISOString(), endedAt: now.toISOString(), durationSec, note: entry.note } as Prisma.InputJsonValue,
      actorUserId: actor.user.id, actorName: actor.user.name || actor.user.email } });
    if (entry.userId === actor.user.id) stopped.push({ entryId: entry.id, taskId: owner.id, taskTitle: owner.title, ...(owner.project ? { projectId: owner.id } : {}), startedAt: entry.startedAt.toISOString(), endedAt: now.toISOString(), durationSec });
  }
  return stopped;
}

/** Starting a timer pauses the caller's own timer on every other work order or project; colleagues' timers keep going. */
export async function pauseOtherOwnTimers(tx: Prisma.TransactionClient, actor: Actor, except: { taskId?: string; projectId?: string }, now: Date, options: CloseTimeOptions = {}) {
  // Read all and leave out the one kept here in code: SQL's NOT (taskId = x) is never true for an entry without a taskId.
  const elsewhere = (await tx.workflowTimeEntry.findMany({
    where: { userId: actor.user.id, endedAt: null, AND: [timeEntryInOrganization(actor.organizationId)] },
    include: { task: { select: { id: true, title: true, status: true } }, project: { select: { id: true, name: true } } },
  })).filter((entry) => !(except.taskId && entry.taskId === except.taskId) && !(except.projectId && entry.projectId === except.projectId));
  const paused: StoppedTimer[] = [];
  for (const { task, project, ...entry } of elsewhere) {
    if (project) { paused.push(...await closeTimeEntries(tx, actor, [entry], { id: project.id, title: project.name, project: true }, now, options)); continue; }
    if (!task) continue;
    paused.push(...await closeTimeEntries(tx, actor, [entry], task, now, options));
    const stillRunning = await tx.workflowTimeEntry.count({ where: { taskId: task.id, endedAt: null } });
    if (!stillRunning && task.status === "IN_PROGRESS")
      await tx.workflowTask.updateMany({ where: { id: task.id, organizationId: actor.organizationId, status: "IN_PROGRESS" }, data: { status: "PAUSED", version: { increment: 1 }, updatedBy: actor.user.id } });
  }
  return paused;
}
