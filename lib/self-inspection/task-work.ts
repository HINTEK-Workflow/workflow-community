import { checkLevel, type LevelAction, type LevelDirectory, type ResolvedRiskClass } from "./levels";

/**
 * What a save does to a task, for the level rule (2026-10-07): pure planning (the title, the project, the
 * responsible person, the date) is not work, while filling in, signing and completing are. Pure and without database
 * code, so the route and its tests share it.
 *
 * The answers are compared without the timestamps the server stamps at every save (`signedAt`, `approvedAt`), so a
 * signed task that is saved again unchanged is not "filled in" again.
 */
type Json = unknown;
const STAMPS = new Set(["signedAt", "approvedAt"]);

function stable(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).filter((key) => !STAMPS.has(key)).sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

type TaskData = { kind?: string; details?: Record<string, unknown> } | null | undefined;
/** What the person fills in: a protocol's answers, or a work order's or a risk assessment's details. */
const content = (data: TaskData): Json => data?.kind === "FORM" ? (data.details as { values?: unknown } | undefined)?.values ?? null : data?.details ?? null;

/** The signatures and approvals that are confirmed, by name. */
function confirmed(data: TaskData): string[] {
  const details = data?.details as Record<string, unknown> | undefined;
  if (!details) return [];
  if (data?.kind === "FORM") {
    const signatures = ((details.values as { signatures?: Record<string, { confirmed?: boolean }> } | undefined)?.signatures) ?? {};
    return Object.entries(signatures).filter(([, signature]) => signature?.confirmed).map(([key]) => `form:${key}`);
  }
  const signature = (details.signature ?? details.approval) as { confirmed?: boolean } | undefined;
  return signature?.confirmed ? ["signature"] : [];
}

export function savedWork(input: {
  /** The stored task, or null for a new one. */
  current: { status: string; data: unknown } | null;
  status: string;
  data: unknown;
  /** Whether a new task already holds something that was filled in (workflowTaskHasDocumentation). */
  documented?: boolean;
}): LevelAction | null {
  const next = input.data as TaskData;
  if (!input.current) {
    if (input.status === "COMPLETED") return "complete";
    if (confirmed(next).length) return "sign";
    if (input.documented) return "fill";
    return input.status === "IN_PROGRESS" ? "start" : null;
  }
  const before = input.current.data as TaskData;
  if (input.status === "COMPLETED" && input.current.status !== "COMPLETED") return "complete";
  const signed = confirmed(next).some((name) => !confirmed(before).includes(name));
  if (signed) return "sign";
  if (stable(content(before)) !== stable(content(next))) return "fill";
  // Pausing a task or marking that it needs action is planning, not work; only taking it up (Pågår) is starting it.
  if (input.status !== input.current.status && input.status === "IN_PROGRESS") return "start";
  return null;
}

/**
 * Why a save of a task is refused for the level rule, or null when it is allowed (2026-10-07). The same answer in
 * Cloud's route, in a Local file and in the demo: a new responsible person must reach the class by their own level, and
 * whoever fills in, signs or completes must reach it too – by level, or under supervision when the responsible person (as
 * saved) is a supervisor of enough level. A save that only plans is never refused. `names` is read only for the message.
 */
export function savedTaskRefusal(input: {
  directory: LevelDirectory;
  risk: Pick<ResolvedRiskClass, "name" | "value" | "suggested"> | null;
  actor: { id: string; name?: string };
  task: { assignedToUserId: string | null; assignedToName: string; status: string; data: unknown };
  current: { status: string; data: unknown; assignedToUserId: string | null } | null;
  documented: boolean;
  names?: ReadonlyMap<string, string>;
}): string | null {
  const { directory, risk, actor, task, current } = input;
  if (!directory.enforced || !risk) return null;
  const name = (id: string, kept?: string) => kept || input.names?.get(id);
  const responsibleName = name(task.assignedToUserId ?? "", task.assignedToName.trim() || undefined);
  if (task.assignedToUserId && task.assignedToUserId !== (current?.assignedToUserId ?? null)) {
    const decision = checkLevel({ directory, subject: risk, action: "assign", person: { id: task.assignedToUserId, name: responsibleName }, self: task.assignedToUserId === actor.id });
    if (!decision.allowed) return decision.message;
  }
  const work = savedWork({ current, status: task.status, data: task.data, documented: input.documented });
  if (work) {
    const decision = checkLevel({ directory, subject: risk, action: work, person: { id: actor.id, name: name(actor.id, actor.name) }, self: true,
      responsible: task.assignedToUserId ? { id: task.assignedToUserId, name: responsibleName } : null });
    if (!decision.allowed) return decision.message;
  }
  return null;
}
