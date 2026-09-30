import { createHmac } from "node:crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * HINTEK AI's memory (Daniel 2026-09-30), separate from the fixed agent instructions (in code) and the chat history:
 * - the company's general memory: how the organisation works and wants answers (company admins edit it);
 * - a pseudonymised user memory: how one person works, searches and wants information presented. It is stored under a
 *   keyed hash of company and user and sent to the AI provider without name, e-mail or id.
 * Both are short and only sent when the company allows chat content to be shared with HINTEK AI.
 */
export const MEMORY_MAX = 2000;

export function memoryPseudonym(organizationId: string, userId: string) {
  const secret = env.INTEGRATION_KEYS_SECRET || env.AUTH_SECRET;
  return createHmac("sha256", secret).update(`ai-memory-v1:${organizationId}:${userId}`).digest("hex").slice(0, 40);
}

export async function readMemories(organizationId: string, userId: string) {
  const rows = await prisma.aiMemory.findMany({
    where: { organizationId, OR: [{ scope: "COMPANY", subject: "company" }, { scope: "USER", subject: memoryPseudonym(organizationId, userId) }] },
    select: { scope: true, content: true, updatedAt: true },
  });
  const company = rows.find((row) => row.scope === "COMPANY");
  const user = rows.find((row) => row.scope === "USER");
  return { company: company?.content ?? "", companyUpdatedAt: company?.updatedAt ?? null, user: user?.content ?? "", userUpdatedAt: user?.updatedAt ?? null };
}

export async function writeMemory(organizationId: string, scope: "COMPANY" | "USER", userId: string, content: string) {
  const subject = scope === "COMPANY" ? "company" : memoryPseudonym(organizationId, userId);
  const text = content.trim().slice(0, MEMORY_MAX);
  if (!text) {
    await prisma.aiMemory.deleteMany({ where: { organizationId, scope, subject } });
    return "";
  }
  await prisma.aiMemory.upsert({
    where: { organizationId_scope_subject: { organizationId, scope, subject } },
    create: { organizationId, scope, subject, content: text },
    update: { content: text },
  });
  return text;
}
