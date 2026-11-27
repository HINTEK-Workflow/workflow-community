import { nextMissionRun, RUN_LOCK_MS, scheduledRunKey, settleRun, STOPPED_TEXT, type MissionSchedule, type RunOutcome, type RunStatus } from "./model";

/**
 * Agenter's job (agents:run, every five minutes) as an engine with its database and work given from outside: lib/agents/server.ts
 * gives the real ones, the tests their own. Like Schemalägg (lib/schedule/engine.ts):
 *
 * - A due mission gets a run with the key of its slot (unique per company), and its next time moves on only from the slot it had,
 *   so two jobs at the same minute make one run.
 * - A run is claimed (queued → running, with a lock) before it runs; only the claim's holder carries it out.
 * - A run still running after the lock has run out stopped half-way: it is marked "Kontrollera innan du kör igen" and is never
 *   tried again by itself, because it may already have made or published something.
 * - Something that may work later is tried again after 5, 15 and 45 minutes; three failed runs in a row pause the mission.
 */
export type EngineMission = { id: string; organizationId: string; schedule: MissionSchedule; nextRunAt: Date; failureStreak: number };
export type EngineRun = { id: string; organizationId: string; missionId: string; runKey: string; attempts: number; status: string };

export type AgentStore = {
  stale(now: Date): Promise<EngineRun[]>;
  /** Active, not removed missions whose next time has come. */
  dueMissions(now: Date, limit: number): Promise<EngineMission[]>;
  /** Creates the slot's run (nothing when it exists); true when created. */
  enqueue(mission: EngineMission, runKey: string, slotAt: Date): Promise<boolean>;
  /** Moves the mission's next time from `from` to `to`, only while it is still `from`. */
  advance(missionId: string, from: Date, to: Date | null): Promise<void>;
  dueRuns(now: Date, limit: number): Promise<EngineRun[]>;
  claim(runId: string, now: Date, lockedUntil: Date): Promise<EngineRun | null>;
  finish(runId: string, data: { status: RunStatus; nextAttemptAt: Date | null; message: string }): Promise<boolean>;
  /** The mission's streak and, when given, its pause with the reason. */
  missionAfterRun(missionId: string, data: { streak: number; pause: string | null; outcome: RunStatus; at: Date }): Promise<void>;
  streakOf(missionId: string): Promise<number>;
};

export type AgentEngineDeps = {
  store: AgentStore;
  /** Carries the run out (its effects, report and feedback are its own); never throws for an ordinary refusal. */
  execute(run: EngineRun, now: Date): Promise<RunOutcome>;
  /** Tells the owner (and, for a pause, the company's admins) by e-mail. */
  notify(run: EngineRun, kind: "stopped" | "paused", reason: string): Promise<void>;
};

export type AgentJobResult = { missions: number; queued: number; due: number; done: number; nothing: number; skipped: number; retried: number; failed: number; stale: number; lost: number };

/** Claims and runs one run (the job, or Kör nu). */
export async function runClaimedAgent(deps: AgentEngineDeps, runId: string, now = new Date()): Promise<{ claimed: boolean; status?: RunStatus; outcome?: RunOutcome }> {
  const run = await deps.store.claim(runId, now, new Date(now.getTime() + RUN_LOCK_MS));
  if (!run) return { claimed: false };
  let outcome: RunOutcome;
  try { outcome = await deps.execute(run, now); }
  catch (error) { outcome = { kind: "retry", message: error instanceof Error && error.message ? error.message.slice(0, 300) : "Något gick fel." }; }
  const streak = await deps.store.streakOf(run.missionId).catch(() => 0);
  const next = settleRun(outcome, run.attempts, now, streak);
  const finished = await deps.store.finish(run.id, { status: next.status, nextAttemptAt: next.nextAttemptAt, message: outcome.message });
  if (!finished) return { claimed: true, outcome };
  if (next.status !== "queued") await deps.store.missionAfterRun(run.missionId, { streak: next.streak, pause: next.pause, outcome: next.status, at: now }).catch(() => undefined);
  if (next.pause) await deps.notify(run, "paused", next.pause).catch(() => undefined);
  return { claimed: true, status: next.status, outcome };
}

export async function runAgentJob(deps: AgentEngineDeps, now = new Date(), limit = 50): Promise<AgentJobResult> {
  const result: AgentJobResult = { missions: 0, queued: 0, due: 0, done: 0, nothing: 0, skipped: 0, retried: 0, failed: 0, stale: 0, lost: 0 };
  for (const run of await deps.store.stale(now)) {
    if (!(await deps.store.finish(run.id, { status: "stopped", nextAttemptAt: null, message: STOPPED_TEXT }))) continue;
    result.stale += 1;
    await deps.notify(run, "stopped", STOPPED_TEXT).catch(() => undefined);
  }
  const missions = await deps.store.dueMissions(now, limit);
  result.missions = missions.length;
  for (const mission of missions) {
    if (await deps.store.enqueue(mission, scheduledRunKey(mission.id, mission.nextRunAt), mission.nextRunAt)) result.queued += 1;
    // A job that was down a while makes one run for the latest slot, not one per missed slot.
    await deps.store.advance(mission.id, mission.nextRunAt, nextMissionRun(mission.schedule, new Date(Math.max(now.getTime(), mission.nextRunAt.getTime()))));
  }
  const due = await deps.store.dueRuns(now, limit);
  result.due = due.length;
  for (const run of due) {
    try {
      const done = await runClaimedAgent(deps, run.id, now);
      if (!done.claimed) { result.lost += 1; continue; }
      if (done.status === "done") result.done += 1;
      else if (done.status === "nothing") result.nothing += 1;
      else if (done.status === "skipped") result.skipped += 1;
      else if (done.status === "queued") result.retried += 1;
      else result.failed += 1;
    } catch { result.failed += 1; }
  }
  return result;
}
