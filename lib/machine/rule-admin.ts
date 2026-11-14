import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/server";
import { describeIssue, type IssueLike } from "@/lib/tools/issue-text";
import { MAX_RULES_PER_SOURCE, ruleInputSchema, ruleSummary, type RuleInput } from "@/lib/machine/signal-rules";
import { signalLabel } from "@/lib/machine/signals";

/**
 * Integrationsmotorn E3: the admin's rules on a signal (the source's signal page). The caller has checked the session, the
 * admin, Cloud, the Origin and the confirmation within 15 minutes (2026-10-24, "Ja, bekräfta innan ändring"); every
 * read and write here is bound to the caller's company as well.
 */
const id = z.string().min(1).max(64);
export const ruleCommands = [
  z.object({ action: z.literal("create_rule"), signalId: id, rule: z.unknown() }),
  z.object({ action: z.literal("update_rule"), ruleId: id, rule: z.unknown() }),
  z.object({ action: z.literal("delete_rule"), ruleId: id }),
] as const;
type Command = z.infer<(typeof ruleCommands)[number]>;
export const isRuleCommand = (input: { action: string }): input is Command => ruleCommands.some((schema) => schema.shape.action.value === input.action);

function ruleOf(value: unknown): RuleInput {
  const parsed = ruleInputSchema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, describeIssue(parsed.error.issues[0] as IssueLike));
  return parsed.data;
}
const json = (value: unknown) => (value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue);
const data = (rule: RuleInput) => ({ ...rule, value: json(rule.value) });

/** The rules of a source's signals, with their summary and whether they have struck. */
export async function listRules(organizationId: string, signalIds: string[]) {
  if (!signalIds.length) return [];
  const rows = await prisma.machineSignalRule.findMany({ where: { organizationId, signalId: { in: signalIds } }, orderBy: { createdAt: "asc" }, include: { state: { select: { active: true, activeSince: true } } } });
  return rows.map((row) => ({
    id: row.id, signalId: row.signalId, operator: row.operator, value: row.value, hysteresis: row.hysteresis, forSeconds: row.forSeconds, outcomeType: row.outcomeType, outcomeCode: row.outcomeCode,
    outcomeSeverity: row.outcomeSeverity, outcomeState: row.outcomeState, outcomeText: row.outcomeText, isActive: row.isActive, active: row.state?.active ?? false, activeSince: row.state?.activeSince ?? null,
    summary: ruleSummary(ruleInputSchema.parse({ ...row, value: row.value ?? null })),
  }));
}

export async function runRuleCommand(organizationId: string, actorId: string, input: Command): Promise<{ answer: Record<string, unknown>; audit: string }> {
  if (input.action === "create_rule") {
    const rule = ruleOf(input.rule);
    const signal = await prisma.machineSignal.findFirst({ where: { id: input.signalId, organizationId }, select: { id: true, key: true, name: true, kind: true, status: true, sourceId: true, source: { select: { name: true } } } });
    if (!signal) throw new ApiError(404, "Signalen finns inte.");
    if (signal.status === "ignored") throw new ApiError(409, "Signalen är ignorerad. Gör den aktiv först.");
    if (signal.kind === "code" && rule.operator !== "stale") throw new ApiError(400, "En kod har inget värde att jämföra; för en kod går bara Har inte hörts av.");
    if (await prisma.machineSignalRule.count({ where: { organizationId, signal: { sourceId: signal.sourceId } } }) >= MAX_RULES_PER_SOURCE) throw new ApiError(409, `Källan har redan ${MAX_RULES_PER_SOURCE} regler. Ta bort en först.`);
    const created = await prisma.$transaction(async (tx) => {
      // A rule on a found signal makes it active: that is the admin's choice that it matters.
      if (signal.status === "discovered") await tx.machineSignal.updateMany({ where: { id: signal.id, organizationId }, data: { status: "active" } });
      return tx.machineSignalRule.create({ data: { organizationId, signalId: signal.id, ...data(rule), createdById: actorId }, select: { id: true } });
    });
    return { answer: { id: created.id }, audit: `Skapade regeln ”${ruleSummary(rule)}” på signalen ”${signalLabel(signal)}” (${signal.source.name}).` };
  }
  const row = await prisma.machineSignalRule.findFirst({ where: { id: input.ruleId, organizationId }, select: { id: true, signal: { select: { key: true, name: true, kind: true, source: { select: { name: true } } } } } });
  if (!row) throw new ApiError(404, "Regeln finns inte.");
  if (input.action === "delete_rule") {
    await prisma.machineSignalRule.deleteMany({ where: { id: row.id, organizationId } });
    return { answer: { ok: true }, audit: `Tog bort en regel på signalen ”${signalLabel(row.signal)}” (${row.signal.source.name}).` };
  }
  const rule = ruleOf(input.rule);
  if (row.signal.kind === "code" && rule.operator !== "stale") throw new ApiError(400, "En kod har inget värde att jämföra; för en kod går bara Har inte hörts av.");
  // A changed rule starts over: its old state belonged to the old condition.
  await prisma.$transaction([
    prisma.machineSignalRule.updateMany({ where: { id: row.id, organizationId }, data: data(rule) }),
    prisma.machineRuleState.deleteMany({ where: { ruleId: row.id } }),
  ]);
  return { answer: { ok: true }, audit: `Ändrade regeln till ”${ruleSummary(rule)}” på signalen ”${signalLabel(row.signal)}” (${row.signal.source.name}).` };
}
