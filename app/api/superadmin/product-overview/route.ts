import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serverExtensions } from "@/lib/extensions/server";
import { ApiError, context, failure } from "@/lib/kfid/server";
import { KEY_WARNING_DAYS, VISITS_DAYS, summarizeCompanies, type ProductOverview } from "@/lib/kfid/product-overview";
import { serverAlarmLines } from "@/lib/ops/host-status";
import { readServerViews } from "@/lib/ops/host-status-server";
import { pdfTemplatesFlagged } from "@/lib/pdf-templates/server";
import { addReportDays, buildReport } from "@/lib/analytics/report";
import { flushAnalytics } from "@/lib/analytics/record";
import { readCounters } from "@/lib/analytics/store";
import { swedishDayKey } from "@/lib/swedish-time";
import { companyLookupView } from "@/lib/kfid/company-lookup";

export const dynamic = "force-dynamic";

/** Demostarter de senaste dagarna, from the anonymous day counters (Beteendeanalys). */
async function recentVisits(now: Date) {
  const to = swedishDayKey(now);
  await flushAnalytics();
  const report = buildReport(await readCounters(addReportDays(to, -(VISITS_DAYS - 1)), to), addReportDays(to, -(VISITS_DAYS - 1)), to);
  return { days: VISITS_DAYS, demoStarts: report.demo.starts.total, landing: report.funnel.steps[0].count, consentRate: report.consent.rate };
}

/**
 * Produktöversikten (beslut 11, 2026-11-01): read only, for the superadmin only. Metadata about the companies, their
 * payment, Workflow's own keys and the servers; the customers' business data is never read here.
 */
export async function GET() {
  try {
    const ctx = await context();
    if (ctx.user.role !== "SUPERADMIN") throw new ApiError(403, "Systemadministratör krävs.");
    const now = new Date();
    const organizations = await prisma.organization.findMany({
      where: { id: { not: ctx.organizationId } }, orderBy: { name: "asc" }, take: 500,
      select: { id: true, name: true, isActive: true, createdAt: true, slug: true },
    });
    const companies = organizations.filter((item) => !item.slug.startsWith("raderat-"));
    const [payments, keys, servers, flagged, lookup] = await Promise.all([
      serverExtensions.companyPayments(companies.map((item) => item.id), now),
      prisma.integrationKey.findMany({
        where: { organizationId: ctx.organizationId, revokedAt: null, expiresAt: { not: null, lte: new Date(now.getTime() + KEY_WARNING_DAYS * 86_400_000) } },
        orderBy: { expiresAt: "asc" }, take: 10, select: { id: true, name: true, expiresAt: true },
      }),
      readServerViews(now).catch(() => []),
      pdfTemplatesFlagged().catch(() => 0),
      companyLookupView().catch(() => null),
    ]);
    // Företagsuppslagets nyckel (SCB) has its end date of its own (kundresa 2026-11-07, M44: it had gone out and the overview said none did).
    const lookupEnd = lookup?.configured && lookup.validUntil ? new Date(`${lookup.validUntil}T23:59:59Z`) : null;
    const lookupKey = lookupEnd && lookupEnd.getTime() <= now.getTime() + KEY_WARNING_DAYS * 86_400_000
      ? [{ id: "scb", name: "Företagsuppslag (SCB)", expiresAt: lookupEnd.toISOString(), expired: lookupEnd <= now }] : [];
    const visits = await recentVisits(now).catch(() => null);
    const overview: ProductOverview = {
      ...summarizeCompanies(companies.map((item) => ({ ...item, payment: payments[item.id] ?? null })), now, serverExtensions.hasPayments),
      keys: [...lookupKey, ...keys.map((key) => ({ id: key.id, name: key.name, expiresAt: key.expiresAt!.toISOString(), expired: key.expiresAt! <= now }))]
        .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt)),
      serverAlarms: serverAlarmLines(servers),
      pdfTemplatesFlagged: flagged,
      visits,
    };
    return NextResponse.json(overview, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
