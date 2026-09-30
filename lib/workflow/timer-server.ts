import type { Prisma } from "@prisma/client";
import { MIN_TIME_ENTRY_SECONDS, type StoppedTimer } from "./running-timer";

/**
 * Server side of the per-person timer, shared by tasks and (2026-09-27) commissioning controls: every task
 * editor can start time. Stopping an entry finishes it and writes it to the append-only time history.
 */
type Actor = { organizationId: string; user: { id: string; name?: string | null; email: string } };
type RunningEntry = { id: string; userId: string; startedAt: Date; note: string };

export async function closeTimeEntries(tx: Prisma.TransactionClient, actor: Actor, running: RunningEntry[], owner: { id: string; title: string }, now: Date) {
  const stopped: StoppedTimer[] = [];
  for (const entry of running) {
    const durationSec = Math.max(0, Math.floor((now.getTime() - entry.startedAt.getTime()) / 1000));
    if (durationSec < MIN_TIME_ENTRY_SECONDS) {
      // Never reached the time history (entries enter it when they stop), so nothing else refers to it.
      await tx.workflowTimeEntry.delete({ where: { id: entry.id } });
      continue;
    }
    await tx.workflowTimeEntry.update({ where: { id: entry.id }, data: { endedAt: now, durationSec } });
    await tx.workflowTimeEntryEvent.create({ data: { organizationId: actor.organizationId, entryId: entry.id, userId: entry.userId, action: "CREATED", reason: "",
      next: { taskId: owner.id, taskTitle: owner.title, startedAt: entry.startedAt.toISOString(), endedAt: now.toISOString(), durationSec, note: entry.note } as Prisma.InputJsonValue,
      actorUserId: actor.user.id, actorName: actor.user.name || actor.user.email } });
    if (entry.userId === actor.user.id) stopped.push({ entryId: entry.id, taskId: owner.id, taskTitle: owner.title, startedAt: entry.startedAt.toISOString(), endedAt: now.toISOString(), durationSec });
  }
  return stopped;
}

/** Starting a timer pauses the caller's own timer on every other task or control; colleagues' timers keep going. */
export async function pauseOtherOwnTimers(tx: Prisma.TransactionClient, actor: Actor, except: { taskId?: string; controlId?: string }, now: Date) {
  const elsewhere = await tx.workflowTimeEntry.findMany({
    where: {
      userId: actor.user.id, endedAt: null,
      OR: [
        { task: { organizationId: actor.organizationId }, ...(except.taskId ? { taskId: { not: except.taskId } } : {}) },
        { control: { organizationId: actor.organizationId }, ...(except.controlId ? { controlId: { not: except.controlId } } : {}) },
      ],
    },
    include: { task: { select: { id: true, title: true, status: true } }, control: { select: { id: true, title: true } } },
  });
  const paused: StoppedTimer[] = [];
  for (const { task, control, ...entry } of elsewhere) {
    const owner = task ?? control;
    if (!owner) continue;
    paused.push(...await closeTimeEntries(tx, actor, [entry], owner, now));
    if (!task) continue;
    const stillRunning = await tx.workflowTimeEntry.count({ where: { taskId: task.id, endedAt: null } });
    if (!stillRunning && task.status === "IN_PROGRESS")
      await tx.workflowTask.updateMany({ where: { id: task.id, organizationId: actor.organizationId, status: "IN_PROGRESS" }, data: { status: "PAUSED", version: { increment: 1 }, updatedBy: actor.user.id } });
  }
  return paused;
}

/** Completing or deleting a control stops every running entry on it. */
export async function closeControlTimers(tx: Prisma.TransactionClient, actor: Actor, control: { id: string; title: string }, now: Date) {
  const running = await tx.workflowTimeEntry.findMany({ where: { controlId: control.id, endedAt: null } });
  return running.length ? closeTimeEntries(tx, actor, running, control, now) : [];
}
