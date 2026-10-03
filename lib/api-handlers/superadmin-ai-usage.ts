import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseAiSharingPolicy } from "@/lib/ai/sharing-policy";
import { ApiError, context, failure } from "@/lib/kfid/server";

export const dynamic = "force-dynamic";

const windowSchema = z.coerce.number().int().refine(
  (value) => [7, 30, 90, 365].includes(value),
  "Välj 7, 30, 90 eller 365 dagar.",
);

type SummaryRow = {
  runs: bigint;
  completed: bigint;
  failed: bigint;
  active: bigint;
  activeOrganizations: bigint;
  activeUsers: bigint;
  chargedCredits: bigint;
  providerCostOre: bigint;
  inputTokens: bigint;
  cachedInputTokens: bigint;
  outputTokens: bigint;
};

type SeriesRow = {
  bucket: Date;
  runs: bigint;
  completed: bigint;
  failed: bigint;
  chargedCredits: bigint;
  providerCostOre: bigint;
};

type CompanyRow = {
  organizationId: string;
  name: string;
  runs: bigint;
  completed: bigint;
  failed: bigint;
  activeUsers: bigint;
  chargedCredits: bigint;
  providerCostOre: bigint;
  latestRunAt: Date;
  creditBalance: number | null;
};

type SurfaceRow = {
  surface: string;
  agentId: string;
  runs: bigint;
  chargedCredits: bigint;
  providerCostOre: bigint;
  inputTokens: bigint;
  cachedInputTokens: bigint;
  outputTokens: bigint;
};

type ModelRow = {
  model: string;
  runs: bigint;
  chargedCredits: bigint;
  providerCostOre: bigint;
  inputTokens: bigint;
  outputTokens: bigint;
};

const number = (value: bigint | number | null | undefined) => Number(value ?? 0);

export async function GET(request: Request) {
  try {
    const ctx = await context();
    if (ctx.user.role !== "SUPERADMIN")
      throw new ApiError(403, "Systemadministratör krävs.");
    const days = windowSchema.parse(new URL(request.url).searchParams.get("days") ?? "30");
    const to = new Date();
    const from = new Date(to);
    from.setUTCHours(0, 0, 0, 0);
    from.setUTCDate(from.getUTCDate() - days + 1);
    const bucket = days === 365 ? "month" : "day";

    const summaryPromise = prisma.$queryRaw<SummaryRow[]>`
      SELECT
        COUNT(*) AS runs,
        COUNT(*) FILTER (WHERE status='COMPLETED') AS completed,
        COUNT(*) FILTER (WHERE status='FAILED') AS failed,
        COUNT(*) FILTER (WHERE status IN ('RESERVED','RUNNING')) AS active,
        COUNT(DISTINCT "organizationId") AS "activeOrganizations",
        COUNT(DISTINCT "actorId") AS "activeUsers",
        COALESCE(SUM("chargedCredits"),0) AS "chargedCredits",
        COALESCE(SUM("providerCostOre"),0) AS "providerCostOre",
        COALESCE(SUM("inputTokens"),0) AS "inputTokens",
        COALESCE(SUM("cachedInputTokens"),0) AS "cachedInputTokens",
        COALESCE(SUM("outputTokens"),0) AS "outputTokens"
      FROM "AiRun" WHERE "createdAt">=${from}`;
    const seriesPromise = bucket === "month"
      ? prisma.$queryRaw<SeriesRow[]>`
          SELECT date_trunc('month',"createdAt") AS bucket,
            COUNT(*) AS runs,
            COUNT(*) FILTER (WHERE status='COMPLETED') AS completed,
            COUNT(*) FILTER (WHERE status='FAILED') AS failed,
            COALESCE(SUM("chargedCredits"),0) AS "chargedCredits",
            COALESCE(SUM("providerCostOre"),0) AS "providerCostOre"
          FROM "AiRun" WHERE "createdAt">=${from}
          GROUP BY 1 ORDER BY 1`
      : prisma.$queryRaw<SeriesRow[]>`
          SELECT date_trunc('day',"createdAt") AS bucket,
            COUNT(*) AS runs,
            COUNT(*) FILTER (WHERE status='COMPLETED') AS completed,
            COUNT(*) FILTER (WHERE status='FAILED') AS failed,
            COALESCE(SUM("chargedCredits"),0) AS "chargedCredits",
            COALESCE(SUM("providerCostOre"),0) AS "providerCostOre"
          FROM "AiRun" WHERE "createdAt">=${from}
          GROUP BY 1 ORDER BY 1`;
    const companiesPromise = prisma.$queryRaw<CompanyRow[]>`
      SELECT r."organizationId", o.name,
        COUNT(*) AS runs,
        COUNT(*) FILTER (WHERE r.status='COMPLETED') AS completed,
        COUNT(*) FILTER (WHERE r.status='FAILED') AS failed,
        COUNT(DISTINCT r."actorId") AS "activeUsers",
        COALESCE(SUM(r."chargedCredits"),0) AS "chargedCredits",
        COALESCE(SUM(r."providerCostOre"),0) AS "providerCostOre",
        MAX(r."createdAt") AS "latestRunAt",
        w.balance AS "creditBalance"
      FROM "AiRun" r
      JOIN "Organization" o ON o.id=r."organizationId"
      LEFT JOIN "CreditWallet" w ON w."organizationId"=r."organizationId"
      WHERE r."createdAt">=${from}
      GROUP BY r."organizationId",o.name,w.balance
      ORDER BY "chargedCredits" DESC,runs DESC,o.name ASC
      LIMIT 200`;
    const modelsPromise = prisma.$queryRaw<ModelRow[]>`
      SELECT model,COUNT(*) AS runs,
        COALESCE(SUM("chargedCredits"),0) AS "chargedCredits",
        COALESCE(SUM("providerCostOre"),0) AS "providerCostOre",
        COALESCE(SUM("inputTokens"),0) AS "inputTokens",
        COALESCE(SUM("outputTokens"),0) AS "outputTokens"
      FROM "AiRun" WHERE "createdAt">=${from}
      GROUP BY model ORDER BY runs DESC,model ASC`;
    // Tokens and cost per place in Workflow (plan 2026-10-01, fas 0); older runs have no place and show their agent.
    const surfacesPromise = prisma.$queryRaw<SurfaceRow[]>`
      SELECT COALESCE(surface,'') AS surface,"agentId",COUNT(*) AS runs,
        COALESCE(SUM("chargedCredits"),0) AS "chargedCredits",
        COALESCE(SUM("providerCostOre"),0) AS "providerCostOre",
        COALESCE(SUM("inputTokens"),0) AS "inputTokens",
        COALESCE(SUM("cachedInputTokens"),0) AS "cachedInputTokens",
        COALESCE(SUM("outputTokens"),0) AS "outputTokens"
      FROM "AiRun" WHERE "createdAt">=${from}
      GROUP BY 1,2 ORDER BY runs DESC,1 ASC,2 ASC LIMIT 50`;

    const [[summary = {} as SummaryRow], series, companies, models, surfaces] = await Promise.all([
      summaryPromise,
      seriesPromise,
      companiesPromise,
      modelsPromise,
      surfacesPromise,
    ]);
    const settings = await prisma.workspaceSettings.findMany({
      where: { organizationId: { in: companies.map((item) => item.organizationId) } },
      select: { organizationId: true, aiPolicy: true },
    });
    const policyByOrganization = new Map(
      settings.map((item) => [item.organizationId, parseAiSharingPolicy(item.aiPolicy)]),
    );

    return NextResponse.json({
      days,
      bucket,
      from: from.toISOString(),
      to: to.toISOString(),
      source: "WORKFLOW_LEDGER",
      contentIncluded: false,
      summary: {
        runs: number(summary.runs),
        completed: number(summary.completed),
        failed: number(summary.failed),
        active: number(summary.active),
        activeOrganizations: number(summary.activeOrganizations),
        activeUsers: number(summary.activeUsers),
        chargedCredits: number(summary.chargedCredits),
        providerCostOre: number(summary.providerCostOre),
        inputTokens: number(summary.inputTokens),
        cachedInputTokens: number(summary.cachedInputTokens),
        outputTokens: number(summary.outputTokens),
      },
      series: series.map((item) => ({
        date: item.bucket.toISOString(),
        runs: number(item.runs),
        completed: number(item.completed),
        failed: number(item.failed),
        chargedCredits: number(item.chargedCredits),
        providerCostOre: number(item.providerCostOre),
      })),
      companies: companies.map((item) => ({
        organizationId: item.organizationId,
        name: item.name,
        isInternal: item.organizationId === ctx.organizationId,
        aiEnabled: policyByOrganization.get(item.organizationId)?.enabled ?? false,
        runs: number(item.runs),
        completed: number(item.completed),
        failed: number(item.failed),
        activeUsers: number(item.activeUsers),
        chargedCredits: number(item.chargedCredits),
        providerCostOre: number(item.providerCostOre),
        latestRunAt: item.latestRunAt.toISOString(),
        creditBalance: item.creditBalance ?? 0,
      })),
      models: models.map((item) => ({
        model: item.model,
        runs: number(item.runs),
        chargedCredits: number(item.chargedCredits),
        providerCostOre: number(item.providerCostOre),
        inputTokens: number(item.inputTokens),
        outputTokens: number(item.outputTokens),
      })),
      surfaces: surfaces.map((item) => ({
        surface: item.surface,
        agentId: item.agentId,
        runs: number(item.runs),
        chargedCredits: number(item.chargedCredits),
        providerCostOre: number(item.providerCostOre),
        inputTokens: number(item.inputTokens),
        cachedInputTokens: number(item.cachedInputTokens),
        outputTokens: number(item.outputTokens),
      })),
    });
  } catch (error) {
    return failure(error);
  }
}
