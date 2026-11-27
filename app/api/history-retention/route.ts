import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure, requireAdmin } from "@/lib/kfid/server";
import {
  HISTORY_CATEGORY_KEYS,
  isRetentionChoice,
  manualCutoffProblem,
  retentionCutoff,
  retentionLabel,
  type HistoryCategory,
} from "@/lib/workflow/history-retention";
import { countHistory, purgeHistory } from "@/lib/workflow/history-retention-server";

export const dynamic = "force-dynamic";

/**
 * Historik och lagring (2026-09-30): the company admin chooses how long the company's work history is kept and
 * can delete older history by hand. Cloud only – Local keeps its history in its own file.
 */
async function admin() {
  const ctx = await context();
  requireAdmin(ctx);
  if (ctx.organization.storageMode !== "HINTEK_CLOUD")
    throw new ApiError(409, "Lagringstid för historik gäller serverlagring. Local har historiken i den egna filen.");
  return ctx;
}

const categories = z.array(z.enum(HISTORY_CATEGORY_KEYS as [HistoryCategory, ...HistoryCategory[]])).min(1).max(HISTORY_CATEGORY_KEYS.length)
  .transform((list) => [...new Set(list)]);
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("retention"), months: z.number().int().nullable() }),
  z.object({ action: z.literal("preview"), before: z.string(), categories }),
  z.object({ action: z.literal("purge"), before: z.string(), categories, confirm: z.literal(true) }),
]);

const cutoff = (day: string) => {
  const problem = manualCutoffProblem(day);
  if (problem) throw new ApiError(400, problem);
  return new Date(`${day}T00:00:00.000Z`);
};

export async function GET() {
  try {
    const ctx = await admin();
    const company = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { historyRetentionMonths: true } });
    const months = company.historyRetentionMonths;
    const [pending, recent] = await Promise.all([
      months ? countHistory(ctx.organizationId, retentionCutoff(months), HISTORY_CATEGORY_KEYS) : null,
      prisma.administrationEvent.findMany({
        where: { organizationId: ctx.organizationId, action: { in: ["history_purge", "history_retention", "history_retention_setting"] } },
        orderBy: { createdAt: "desc" }, take: 10, select: { id: true, action: true, detail: true, createdAt: true },
      }),
    ]);
    return NextResponse.json({ months, label: retentionLabel(isRetentionChoice(months) ? months : null), pending, recent }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await admin();
    const command = input.parse(await body(request));
    if (command.action === "retention") {
      if (!isRetentionChoice(command.months)) throw new ApiError(400, "Välj en av lagringstiderna.");
      await prisma.$transaction([
        prisma.organization.update({ where: { id: ctx.organizationId }, data: { historyRetentionMonths: command.months } }),
        prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "history_retention_setting",
          detail: `Lagringstid för historik: ${retentionLabel(command.months)}.` } }),
      ]);
      return NextResponse.json({ ok: true, months: command.months });
    }
    const before = cutoff(command.before);
    if (command.action === "preview")
      return NextResponse.json({ counts: await countHistory(ctx.organizationId, before, command.categories) }, { headers: { "Cache-Control": "no-store" } });
    const counts = await purgeHistory({ organizationId: ctx.organizationId, before, categories: command.categories, actorId: ctx.user.id, kind: "manual" });
    return NextResponse.json({ ok: true, counts });
  } catch (error) {
    return failure(error);
  }
}
