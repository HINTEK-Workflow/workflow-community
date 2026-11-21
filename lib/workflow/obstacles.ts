import { z } from "zod";
import { WAITING_REASONS, waitingReasonOf } from "./maintenance";

/**
 * Rapportera hinder (2026-10-11, plan 1M): one press on any kind of job – work order, task, protocol or risk
 * assessment – says what the job waits for (material, the customer, a shutdown or something else, with a short text). The
 * job is then marked in the lists and on the Tidplan's bar, and the job's and the project's responsible people are told.
 * "Lös hindret" is one press and puts the status back.
 *
 * Stored in the job's data (no table): `data.obstacle`. A work order that waits for material, the customer or a shutdown also
 * gets the existing "Väntar på …" (status Pausad + details.waitingOn, lib/workflow/maintenance.ts), so every list that
 * knows it keeps working; an older order paused that way without a report counts as an obstacle too. Every other job gets
 * the status Behöver åtgärdas. A save with any other status (and starting the time) drops the obstacle again, as it drops
 * "Väntar på …" (maintenance.ts withoutStaleWaiting). Pure; shared by Cloud, Local, the demo and the tools.
 */
export const OBSTACLE_REASONS = ["MATERIAL", "CUSTOMER", "SHUTDOWN", "OTHER"] as const;
export type ObstacleReason = (typeof OBSTACLE_REASONS)[number];
export const OBSTACLE_REASON_LABELS: Record<ObstacleReason, string> = {
  MATERIAL: "Väntar på material", CUSTOMER: "Väntar på kund", SHUTDOWN: "Väntar på avställning", OTHER: "Annat",
};
export const OBSTACLE_TEXT_MAX = 300;
/** "Annat" says nothing by itself, so it needs a few words. */
export const OBSTACLE_OTHER_MIN = 3;

/** The stored obstacle (`data.obstacle`): the reason, the person's words, when and by whom, and the status to go back to. */
export const obstacleSchema = z.object({
  reason: z.enum(OBSTACLE_REASONS),
  text: z.string().trim().max(OBSTACLE_TEXT_MAX).default(""),
  since: z.iso.datetime(),
  byName: z.string().trim().max(160).default(""),
  previousStatus: z.string().max(30).default("PLANNED"),
});
export type StoredObstacle = z.infer<typeof obstacleSchema>;

/** What a person sends when reporting. */
export const obstacleInputSchema = z.object({
  reason: z.enum(OBSTACLE_REASONS),
  text: z.string().trim().max(OBSTACLE_TEXT_MAX, `Texten får vara högst ${OBSTACLE_TEXT_MAX} tecken.`).default(""),
}).superRefine((value, context) => {
  if (value.reason === "OTHER" && value.text.length < OBSTACLE_OTHER_MIN)
    context.addIssue({ code: "custom", path: ["text"], message: "Skriv med några ord vad det är som hindrar." });
});
export type ObstacleInput = z.infer<typeof obstacleInputSchema>;

export type Obstacle = { reason: string; text: string; since: string };
type ObstacleTask = { status: string; data?: unknown; updatedAt?: string | Date | null };
const CLOSED = new Set(["COMPLETED", "CANCELLED"]);
const isoOf = (value: string | Date | null | undefined) => value ? new Date(value).toISOString() : "";

/**
 * The job's obstacle, or null. A reported one (`data.obstacle`) while the job is open and Behöver åtgärdas or Pausad; an
 * older work order that is Pausad with a "Väntar på …" counts as one too (without text; since = its last change).
 */
export function jobObstacle(task: ObstacleTask): Obstacle | null {
  if (CLOSED.has(task.status)) return null;
  const data = task.data && typeof task.data === "object" ? task.data as { obstacle?: unknown; details?: unknown } : null;
  const stored = obstacleSchema.safeParse(data?.obstacle);
  if (stored.success && (task.status === "NEEDS_ACTION" || task.status === "PAUSED")) return { reason: stored.data.reason, text: stored.data.text, since: stored.data.since };
  const waiting = waitingReasonOf(task.status, data?.details);
  return waiting ? { reason: waiting, text: "", since: isoOf(task.updatedAt) } : null;
}

/** The obstacles in a project's jobs, the longest-standing first (a job without a known time last). */
export function projectObstacles<T extends ObstacleTask>(tasks: readonly T[]): { task: T; obstacle: Obstacle }[] {
  return tasks.flatMap((task) => { const obstacle = jobObstacle(task); return obstacle ? [{ task, obstacle }] : []; })
    .sort((a, b) => (a.obstacle.since || "9999").localeCompare(b.obstacle.since || "9999"));
}

/** The reason in words, with the person's text: "Väntar på material – kablarna är beställda". */
export function obstacleText(obstacle: Pick<Obstacle, "reason" | "text">) {
  const label = OBSTACLE_REASON_LABELS[obstacle.reason as ObstacleReason] ?? "Hinder";
  return obstacle.text ? `${label} – ${obstacle.text}` : label;
}

type ObstacleData = { kind?: string; obstacle?: unknown; details?: { waitingOn?: string } & Record<string, unknown> } & Record<string, unknown>;
type Applied<T> = { status: string; data: T };

/**
 * What reporting does to a job: the obstacle is stored, a work order that waits for material, the customer or a shutdown is
 * paused with that reason (unless somebody's time is running on it – the order then needs action instead, so a running
 * clock never sits on a paused order), every other job needs action. The caller has checked rights, version and that the
 * job is open.
 */
export function reportObstacle<T>(task: { kind: string; status: string; data: T; hasRunningTime?: boolean }, input: ObstacleInput, now: Date, byName: string): Applied<T> {
  const data = task.data as unknown as ObstacleData;
  const waits = task.kind === "WORK_ORDER" && !task.hasRunningTime && (WAITING_REASONS as readonly string[]).includes(input.reason);
  const status = waits ? "PAUSED" : "NEEDS_ACTION";
  // A new report on a job that already has one keeps the status it should go back to.
  const stored = obstacleSchema.safeParse(data.obstacle);
  const holding = task.status === "NEEDS_ACTION" || task.status === "PAUSED";
  const previous = holding ? (stored.success ? stored.data.previousStatus : jobObstacle({ status: task.status, data }) ? "PAUSED" : task.status) : task.status;
  const next: ObstacleData = { ...data, obstacle: { reason: input.reason, text: input.text, since: now.toISOString(), byName: byName.slice(0, 160), previousStatus: previous } };
  if (task.kind === "WORK_ORDER" && data.details) next.details = { ...data.details, waitingOn: waits ? input.reason : "" };
  return { status, data: next as unknown as T };
}

/**
 * "Lös hindret": the obstacle and the waiting reason go, and the status goes back to what it was before the report –
 * Pågår becomes Pausad, as when Utgår is lifted (the time decides Pågår). A job whose status somebody has changed since
 * (time started, a status chosen) keeps it.
 */
export function resolveObstacle<T>(task: { kind: string; status: string; data: T }): Applied<T> {
  const data = task.data as unknown as ObstacleData;
  const stored = obstacleSchema.safeParse(data.obstacle);
  const { obstacle: _removed, ...rest } = data;
  void _removed;
  const next: ObstacleData = rest;
  if (task.kind === "WORK_ORDER" && next.details && "waitingOn" in next.details) next.details = { ...next.details, waitingOn: "" };
  const holds = task.status === "NEEDS_ACTION" || task.status === "PAUSED";
  const before = stored.success ? stored.data.previousStatus : "PAUSED";
  const status = !holds ? task.status : before === "PLANNED" || before === "NEEDS_ACTION" ? before : "PAUSED";
  return { status, data: next as unknown as T };
}

/** Why a job cannot get an obstacle (or have one resolved) now, or null. */
export function obstacleBlocked(task: { status: string }): string | null {
  if (task.status === "COMPLETED") return "Jobbet är färdigställt. Återöppna det om något hindrar.";
  if (task.status === "CANCELLED") return "Jobbet har utgått.";
  return null;
}
