import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  context,
  failure,
  requireAdmin,
  requireCloudStorage,
  ApiError,
} from "@/lib/kfid/server";
import { timeSeries } from "@/lib/kfid/analytics";
import { listRecords, recordQuery } from "@/lib/kfid/records";
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    requireAdmin(ctx);
    const params = new URL(request.url).searchParams;
    const today = new Date().toISOString().slice(0, 10);
    const defaultStart = `${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}-01`;
    const from = z.iso.date().parse(params.get("from") || defaultStart),
      to = z.iso.date().parse(params.get("to") || today);
    const days = (Date.parse(to) - Date.parse(from)) / 86400000;
    if (days < 0 || days > 1826)
      throw new ApiError(
        400,
        "Välj ett datumintervall på högst fem år, med start före slut.",
      );
    const requested = z
      .enum(["auto", "day", "week", "month"])
      .parse(params.get("bucket") || "auto");
    const bucket =
      requested === "auto"
        ? days <= 62
          ? "day"
          : days <= 210
            ? "week"
            : "month"
        : requested;
    const status = z
      .enum(["ALL", "DRAFT", "COMPLETED", "POSTED"])
      .parse(params.get("status") || "ALL");
    const clauses = [
      Prisma.sql`"organizationId"=${ctx.organizationId}`,
      Prisma.sql`"deletedAt" IS NULL`,
      Prisma.sql`date>=${from}`,
      Prisma.sql`date<=${to}`,
    ];
    if (status === "POSTED") clauses.push(Prisma.sql`"postedAt" IS NOT NULL`);
    else if (status !== "ALL") clauses.push(Prisma.sql`status=${status}`);
    const where = Prisma.join(clauses, " AND ");
    const [daily, performers, members, customers, recent] = await Promise.all([
      prisma.$queryRaw<
        { date: string; count: number }[]
      >`SELECT date,COUNT(*)::int AS count FROM "Control" WHERE ${where} GROUP BY date ORDER BY date`,
      prisma.$queryRaw<
        { name: string; count: number }[]
      >`SELECT COALESCE(NULLIF(performer,''),'Ej angivet') AS name,COUNT(*)::int AS count FROM "Control" WHERE ${where} GROUP BY performer ORDER BY count DESC LIMIT 30`,
      prisma.organizationMember.count({
        where: {
          organizationId: ctx.organizationId,
          isActive: true,
          user: { isActive: true },
        },
      }),
      prisma.customer.count({
        where: { organizationId: ctx.organizationId, deletedAt: null },
      }),
      listRecords(
        ctx,
        recordQuery.parse({
          kind: "controls",
          from,
          to,
          status,
          sort: params.get("sort") || "date",
          direction: params.get("direction") || "desc",
          page: params.get("page") || 1,
          limit: params.get("limit") || 10,
        }),
      ),
    ]);
    const target = members * 2,
      monthly = timeSeries(daily, from, to, "month", target);
    const lastDate = new Date(`${to}T00:00:00Z`);
    if (
      lastDate.getUTCDate() !==
      new Date(
        Date.UTC(lastDate.getUTCFullYear(), lastDate.getUTCMonth() + 1, 0),
      ).getUTCDate()
    ) {
      lastDate.setUTCDate(1);
      lastDate.setUTCMonth(lastDate.getUTCMonth() - 1);
    }
    const lastMonth = lastDate.toISOString().slice(0, 7);
    const lastCount = monthly.find((m) => m.date === lastMonth)?.count ?? 0;
    return NextResponse.json({
      from,
      to,
      bucket,
      series: timeSeries(daily, from, to, bucket, target),
      performers,
      recent,
      kpis: {
        total: daily.reduce((sum, r) => sum + r.count, 0),
        members,
        customers,
        target,
        lastMonth,
        lastCount,
        difference: lastCount - target,
        average: monthly.length
          ? Math.round(
              (monthly.reduce((sum, m) => sum + m.count, 0) / monthly.length) *
                10,
            ) / 10
          : 0,
      },
    });
  } catch (e) {
    return failure(e);
  }
}
