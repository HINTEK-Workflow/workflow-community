import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { describeWeekly, nextWeeklySlot } from "@/lib/mail/release-newsletter";
import { saveWeeklySettings } from "@/lib/mail/release-newsletter-server";

export const dynamic = "force-dynamic";

/** Veckobrev (2026-10-06): only the installation's superadmin switches the weekly newsletter on or off. */
export async function PUT(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    if (ctx.user.role !== "SUPERADMIN") throw new ApiError(403, "Bara installationens administratör kan göra det.");
    const saved = await saveWeeklySettings(await body(request));
    await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "mailing_weekly",
      detail: saved.enabled ? `Slog på veckobrevet, ${describeWeekly(saved)}.` : "Stängde av veckobrevet." } });
    return NextResponse.json({ enabled: saved.enabled, weekday: saved.weekday, time: saved.time, next: saved.enabled ? nextWeeklySlot(saved, new Date()).toISOString() : null });
  } catch (error) {
    return failure(error);
  }
}
