import { prisma } from "@/lib/db";
import { parseSourceToken, sourceKeyProblem } from "@/lib/machine/keys";
import { moduleOn } from "@/lib/workflow/modules";

/**
 * Turns a presented key into the source and its company. The company comes ONLY from the source the key belongs to; a body
 * can never name one. Fails closed: unknown, revoked, expired or switched-off source, or a company that is not an active
 * Cloud company. `lastUsedAt` is written at most once a minute.
 */
export type MachinePrincipal = { sourceId: string; organizationId: string; name: string;
  /** Företagets moduler (0.39.0): Underhåll is off, so nothing from this source is taken in (lib/machine/intake-off.ts). */
  intakeOff?: boolean };
export type MachineRefusal = { problem: "invalid" | "revoked" | "expired" | "inactive" };

export async function authenticateMachineSource(token: string, now = new Date()): Promise<MachinePrincipal | MachineRefusal> {
  const parsed = parseSourceToken(token);
  const source = parsed ? await prisma.machineSource.findUnique({ where: { id: parsed.id }, include: { organization: { select: { isActive: true, storageMode: true, disabledModules: true } } } }) : null;
  const problem = sourceKeyProblem(parsed, source, now);
  if (problem) return { problem };
  if (!source || !source.organization.isActive || source.organization.storageMode !== "HINTEK_CLOUD") return { problem: "invalid" };
  if (!source.lastUsedAt || now.getTime() - source.lastUsedAt.getTime() > 60_000) await prisma.machineSource.update({ where: { id: source.id }, data: { lastUsedAt: now } });
  return { sourceId: source.id, organizationId: source.organizationId, name: source.name, intakeOff: !moduleOn(source.organization.disabledModules, "upkeep") };
}

export const isRefusal = (value: MachinePrincipal | MachineRefusal): value is MachineRefusal => "problem" in value;
