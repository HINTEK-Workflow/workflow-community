import { NextResponse } from "next/server";
import { z } from "zod";
import { EE_PRESENT } from "@ee/present";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, failure, signedInUser } from "@/lib/kfid/server";
import { RETENTION_CHOICES } from "@/lib/analytics/catalog";
import { MAX_REPORT_DAYS, addReportDays, buildComparedReport, countersCsv, previousPeriod } from "@/lib/analytics/report";
import { discardPendingCounts, flushAnalytics } from "@/lib/analytics/record";
import { getAnalyticsSettings, saveAnalyticsSettings } from "@/lib/analytics/settings";
import { firstCounterDay, readCounters, resetCounters } from "@/lib/analytics/store";
import { swedishDayKey } from "@/lib/swedish-time";
import { noStatsCookieDomain, noStatsCookieLine, optedOut } from "@/lib/analytics/exclusion";
import { publicSite } from "@/lib/public-site";
import { publicInstance } from "@/lib/instance";
import { instanceAppUrl } from "@/lib/instance-server";

export const dynamic = "force-dynamic";

async function superadmin() {
  const user = await signedInUser();
  if (!user) throw new ApiError(401, "Logga in för att fortsätta.");
  if (user.role !== "SUPERADMIN") throw new ApiError(403, "Bara installationens administratör kan göra det.");
  return user;
}

/**
 * Egna besök (2026-11-16): whether the browser asking is switched off, and where that holds – on both addresses when the
 * public site shares the app's parent domain, otherwise on the app's address only. The installation's own company is named,
 * since its people are never counted in the app.
 */
function ownVisits(request: Request) {
  const domain = noStatsCookieDomain(publicSite());
  return { browserExcluded: optedOut(request.headers.get("cookie")), sharedDomain: domain, company: publicInstance().operator };
}

const query = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional(), format: z.enum(["json", "csv"]).default("json") });

/**
 * Beteendeanalys (2026-10-07), the product owner's page: anonymous counts of pages and functions in the app and,
 * where the installation has it, the funnel of the public pages for visitors who allowed statistics. The counters hold
 * no person, company, address or browser, so this shows nothing about any customer's work.
 */
export async function GET(request: Request) {
  try {
    await superadmin();
    const input = query.parse(Object.fromEntries(new URL(request.url).searchParams));
    const today = swedishDayKey(new Date());
    const to = input.to && input.to <= today ? input.to : today;
    const from = input.from && input.from <= to ? input.from : addReportDays(to, -29);
    // What was counted a moment ago is written first, so the page never lags behind the last click.
    await flushAnalytics();
    if (input.format === "csv")
      return new Response(countersCsv(await readCounters(from, to)), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="beteendeanalys-${from}-${to}.csv"`, "Cache-Control": "private, no-store" } });
    // The period before, of the same length, is read with it for the comparison on the key figures (2026-11-11).
    const shown = to > from && from < addReportDays(to, -(MAX_REPORT_DAYS - 1)) ? addReportDays(to, -(MAX_REPORT_DAYS - 1)) : from;
    const rows = await readCounters(previousPeriod(shown, to).from, to);
    return NextResponse.json({
      settings: await getAnalyticsSettings(), funnelAvailable: EE_PRESENT, retentionChoices: RETENTION_CHOICES,
      today, first: await firstCounterDay(), report: buildComparedReport(rows, from, to), own: ownVisits(request),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

const settingsInput = z.object({
  usage: z.boolean().optional(),
  funnel: z.boolean().optional(),
  retentionMonths: z.number().int().refine((value) => (RETENTION_CHOICES as readonly number[]).includes(value), "Välj en av de erbjudna lagringstiderna.").optional(),
  reset: z.literal(true).optional(),
  /** Räkna inte den här webbläsaren (2026-11-16): sets or removes wf-no-stats on the browser that asks. */
  browser: z.enum(["exclude", "include"]).optional(),
}).strict();

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await superadmin();
    const input = settingsInput.parse(await body(request));
    const changes: string[] = [];
    if (input.reset) {
      discardPendingCounts();
      const removed = await resetCounters();
      changes.push(`Beteendeanalysen nollställdes (${removed} räknare raderades).`);
    }
    if (input.usage !== undefined || input.funnel !== undefined || input.retentionMonths !== undefined) {
      const before = await getAnalyticsSettings();
      const after = await saveAnalyticsSettings({ usage: input.usage, funnel: input.funnel, retentionMonths: input.retentionMonths });
      if (after.usage !== before.usage) changes.push(`Räkning av användning i appen ${after.usage ? "påslagen" : "avstängd"}.`);
      if (after.funnel !== before.funnel) changes.push(`Trattmätning på de publika sidorna ${after.funnel ? "påslagen" : "avstängd"}.`);
      if (after.retentionMonths !== before.retentionMonths) changes.push(`Lagringstiden för räknarna är ${after.retentionMonths} månader.`);
    }
    if (input.browser) changes.push(input.browser === "exclude" ? "En webbläsare räknas inte längre i statistiken." : "En webbläsare räknas i statistiken igen.");
    if (user.activeOrganizationId && changes.length)
      await prisma.administrationEvent.create({ data: { actorId: user.id, organizationId: user.activeOrganizationId, action: "analytics_settings", detail: changes.join(" ") } });
    const response = NextResponse.json({ ok: true, settings: await getAnalyticsSettings() });
    if (input.browser) {
      const secure = instanceAppUrl().startsWith("https:");
      const domain = noStatsCookieDomain(publicSite());
      response.headers.append("Set-Cookie", noStatsCookieLine(input.browser === "exclude", { secure, domain }));
      // Switched back on: a copy on the app's address alone (set before the public site shared the domain) goes too.
      if (input.browser === "include" && domain) response.headers.append("Set-Cookie", noStatsCookieLine(false, { secure, domain: null }));
    }
    return response;
  } catch (error) {
    return failure(error);
  }
}
