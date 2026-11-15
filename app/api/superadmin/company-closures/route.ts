import { NextResponse } from "next/server";
import { z } from "zod";
import { closureDryRun, closureOverview, postponeClosure, setAutoErase } from "@/lib/company-closure/server";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { addSwedishDays, fromSwedishDateInput } from "@/lib/swedish-time";

export const dynamic = "force-dynamic";

/**
 * Radering efter avslut (2026-10-10), Installation → Kundföretag. Superadmin only, never through an API
 * key or a connected app. GET lists the companies counting down and those due, with dates (metadata only, never the
 * company's work); `?dryRun=1` shows what the next run would do, with counts of what each due company would lose.
 * PATCH (Origin): "postpone" moves a company's erasure date later with a required reason (company's history);
 * "auto_erase" turns automatic erasure on or off (off by default; history of the superadmin's own company).
 */
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("postpone"), organizationId: z.string().min(1).max(100), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ange ett datum."), reason: z.string().trim().min(3, "Skriv ett skäl till uppskjutningen.").max(300) }),
  z.object({ action: z.literal("auto_erase"), enabled: z.boolean() }),
]);

async function superadmin() {
  const ctx = await context();
  if (ctx.user.role !== "SUPERADMIN" || ctx.integration) throw new ApiError(403, "Bara installationens administratör kan göra det.");
  return ctx;
}

export async function GET(request: Request) {
  try {
    await superadmin();
    const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
    return NextResponse.json(dryRun ? { dryRun: await closureDryRun() } : await closureOverview(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await superadmin();
    const command = input.parse(await body(request));
    if (command.action === "auto_erase") {
      await setAutoErase({ enabled: command.enabled, actorId: ctx.user.id, organizationId: ctx.organizationId });
      return NextResponse.json({ ok: true, autoErase: command.enabled });
    }
    // The end of the chosen Swedish day, so "skjut upp till 1 december" keeps the data through that day.
    const start = fromSwedishDateInput(command.until);
    const until = start ? new Date(addSwedishDays(start, 1).getTime() - 1) : null;
    const result = await postponeClosure({ organizationId: command.organizationId, until, reason: command.reason, actorId: ctx.user.id });
    if ("error" in result) throw new ApiError(409, result.error ?? "Kunde inte skjuta upp raderingen.");
    return NextResponse.json(result);
  } catch (error) {
    return failure(error);
  }
}
