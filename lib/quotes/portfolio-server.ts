import { prisma } from "@/lib/db";
import { agreedQuoteVersions, quotedWork } from "./conversion";
import { lineView, quoteAccess, workOrderAccess, type QuoteCaller } from "./server";

/**
 * Offererat for the project portfolio (plan 1M, 2026-10-11): per project the agreed quote versions' Arbete hours
 * in minutes – the same figure the project page shows (projectQuoteSummary → comparison.labour.quotedMinutes), read for
 * many projects in one bounded query. Only for someone who may read quotes and work orders, as on the project page;
 * everyone else gets no figure (the portfolio shows "–"). Never an amount or a price.
 */
export async function quotedMinutesByProject(caller: QuoteCaller, projectIds: readonly string[]): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  if (!projectIds.length || caller.storageMode !== "HINTEK_CLOUD" || !quoteAccess(caller).read || !workOrderAccess(caller).read) return result;
  const rows = await prisma.quote.findMany({
    where: { organizationId: caller.organizationId, projectId: { in: [...projectIds] }, status: "ACCEPTED" },
    orderBy: [{ number: "asc" }, { version: "asc" }], take: 2000,
    select: { projectId: true, number: true, version: true, status: true, lines: { orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, kind: true, name: true, quantity: true, unit: true, unitPrice: true, markupPercent: true, catalogue: true, rotLabour: true, position: true } } },
  });
  const byProject = new Map<string, typeof rows>();
  for (const row of rows) if (row.projectId) byProject.set(row.projectId, [...(byProject.get(row.projectId) ?? []), row]);
  for (const [projectId, projectRows] of byProject) result.set(projectId, quotedWork(agreedQuoteVersions(projectRows).flatMap((row) => row.lines.map(lineView))).minutes);
  return result;
}
