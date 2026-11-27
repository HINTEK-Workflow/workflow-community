import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, type Context } from "@/lib/kfid/server";
import { aiMay, getAiSharingPolicy, type AiSharingPolicy } from "@/lib/ai/sharing-policy";
import { cleanFocus, focusInstruction, resolveSystemAgent, SYSTEM_AGENTS, systemAgent, type ResolvedAgent, type SystemAgent } from "./system-agents";

/**
 * The built-in agents' choices on the server (AgentSetting): the company's (userId "", the admin's) and each person's own. Where an
 * agent already had a company switch (Riskbedömning tillsammans, the nightly summary, the machine analysis) that switch is the one
 * the agent's Av and På change, so every existing server check keeps working.
 */
const policyOn = (agent: SystemAgent, policy: AiSharingPolicy) =>
  agent.policySwitch === "riskTogether" ? aiMay(policy, "riskTogether") : agent.policySwitch === "dailyDigest" ? Boolean(policy.dailyDigest) : agent.policySwitch === "shareMachines" ? Boolean(policy.shareMachines) : true;

/** The company's resolved agents (for the server's own checks); the person's level when a user is given. */
export async function companyAgents(organizationId: string, userId?: string): Promise<Map<string, ResolvedAgent>> {
  const [rows, policy] = await Promise.all([
    prisma.agentSetting.findMany({ where: { organizationId, userId: { in: userId ? ["", userId] : [""] } }, select: { userId: true, agentId: true, data: true } }),
    getAiSharingPolicy(organizationId),
  ]);
  const company = new Map(rows.filter((row) => !row.userId).map((row) => [row.agentId, row.data]));
  const own = new Map(rows.filter((row) => row.userId).map((row) => [row.agentId, row.data]));
  return new Map(SYSTEM_AGENTS.map((agent) => [agent.id, resolveSystemAgent(agent, company.get(agent.id), own.get(agent.id), policyOn(agent, policy))]));
}

/**
 * Refuses when the company has switched the agent off (the same words everywhere). Otherwise it gives the company's extra
 * instruction (2026-11-23: how the agent should think and write) as it goes after the agent's own instructions – data, never a rule;
 * "" when there is none.
 */
export async function assertSystemAgentOn(organizationId: string, agentId: string): Promise<string> {
  const agent = systemAgent(agentId);
  if (!agent) return "";
  const resolved = (await companyAgents(organizationId)).get(agentId);
  if (resolved && !resolved.on) throw new ApiError(409, `Agenten ${agent.name} är avstängd för företaget. En administratör slår på den under Agenter.`);
  return agent.uses === "model" && resolved?.focus ? focusInstruction(resolved.focus) : "";
}
/** The agent's instructions with the company's extra instruction after them. */
export const withExtraInstruction = (instructions: string, extra: string) => extra ? `${instructions}\n\n${extra}` : instructions;

export async function listSystemAgents(ctx: Context) {
  const resolved = await companyAgents(ctx.organizationId, ctx.user.id);
  return SYSTEM_AGENTS.map((agent) => { const chosen = resolved.get(agent.id)!; return { ...agent, on: chosen.on, focus: chosen.focus, level: chosen.level, standard: chosen.standard, whenChosen: chosen.when }; });
}

async function setPolicySwitch(ctx: Context, agent: SystemAgent, on: boolean) {
  if (!agent.policySwitch) return;
  const current = await getAiSharingPolicy(ctx.organizationId);
  const aiPolicy: AiSharingPolicy = agent.policySwitch === "riskTogether" ? { ...current, abilities: { ...current.abilities, riskTogether: on } } : { ...current, [agent.policySwitch]: on };
  await prisma.workspaceSettings.upsert({ where: { organizationId: ctx.organizationId }, create: { organizationId: ctx.organizationId, aiPolicy }, update: { aiPolicy } });
}

/** The admin's choice for the whole company: on or off, the focus and when it may speak up. Never what it may do. */
export async function saveCompanyAgent(ctx: Context, agentId: string, input: { on?: boolean; focus?: string; when?: string; reset?: boolean }) {
  if (!ctx.admin) throw new ApiError(403, "Bara en företagsadministratör ändrar vad agenterna gör för företaget. Hur ofta du själv får förslag väljer du nedan.");
  const agent = systemAgent(agentId);
  if (!agent) throw new ApiError(404, "Agenten finns inte.");
  if (input.reset) {
    await prisma.agentSetting.deleteMany({ where: { organizationId: ctx.organizationId, userId: "", agentId } });
    await setPolicySwitch(ctx, agent, true);
    await audit(ctx, `Återställde agenten ${agent.name} till Workflows original.`);
    return listSystemAgents(ctx);
  }
  const existing = await prisma.agentSetting.findUnique({ where: { organizationId_userId_agentId: { organizationId: ctx.organizationId, userId: "", agentId } }, select: { data: true } });
  const before = (existing?.data ?? {}) as { on?: boolean; focus?: string; when?: string };
  const data = { ...before, ...(input.on !== undefined ? { on: input.on } : {}), ...(input.focus !== undefined ? { focus: cleanFocus(input.focus) } : {}), ...(input.when !== undefined && agent.when.some((item) => item.key === input.when) ? { when: input.when } : {}) };
  await prisma.agentSetting.upsert({ where: { organizationId_userId_agentId: { organizationId: ctx.organizationId, userId: "", agentId } }, create: { organizationId: ctx.organizationId, userId: "", agentId, data: data as Prisma.InputJsonValue, updatedById: ctx.user.id }, update: { data: data as Prisma.InputJsonValue, updatedById: ctx.user.id } });
  if (input.on !== undefined) await setPolicySwitch(ctx, agent, input.on);
  const what = [input.on !== undefined && input.on !== (before.on ?? true) ? (input.on ? "slog på den" : "stängde av den") : "", input.focus !== undefined && cleanFocus(input.focus) !== (before.focus ?? "") ? "ändrade den extra instruktionen" : "", input.when !== undefined && input.when !== before.when ? "ändrade när den körs" : ""].filter(Boolean).join(", ");
  if (what) await audit(ctx, `Agenten ${agent.name}: ${what}.`);
  return listSystemAgents(ctx);
}

/** The person's own choice: how often the agent's proposals or tips come (Av switches it off for oneself). */
export async function savePersonAgent(ctx: Context, agentId: string, level: "often" | "normal" | "rarely" | "off") {
  if (!systemAgent(agentId)) throw new ApiError(404, "Agenten finns inte.");
  await prisma.agentSetting.upsert({ where: { organizationId_userId_agentId: { organizationId: ctx.organizationId, userId: ctx.user.id, agentId } }, create: { organizationId: ctx.organizationId, userId: ctx.user.id, agentId, data: { level }, updatedById: ctx.user.id }, update: { data: { level }, updatedById: ctx.user.id } });
  return listSystemAgents(ctx);
}

async function audit(ctx: Context, detail: string) {
  await prisma.administrationEvent.create({ data: { organizationId: ctx.organizationId, actorId: ctx.user.id, action: "agent_settings", detail: detail.slice(0, 500) } }).catch(() => undefined);
}
