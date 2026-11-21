import { NextResponse } from "next/server";
import { body, checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess, requireModule } from "@/lib/kfid/server";
import { selfInspectionActionNeedsModule } from "@/lib/workflow/modules";
import { selfInspectionAccess, selfInspectionActionSchema, SelfInspectionError } from "@/lib/self-inspection/model";
import { deviationWorkOrderActionSchema } from "@/lib/self-inspection/deviation-link";
import { createWorkOrderFromDeviation } from "@/lib/self-inspection/deviation-link-server";
import { alarmDeviationActionSchema } from "@/lib/machine/alarm-deviation";
import { createDeviationFromAlarmOrder } from "@/lib/machine/alarm-deviation-server";
import { applyCloudSelfInspectionAction, cloudCardHistory, cloudInstrumentProtocols, cloudInstrumentsView, cloudSelfInspectionView } from "@/lib/self-inspection/server";

export const dynamic = "force-dynamic";

/**
 * Egenkontrollprogram (2026-10-06). The permission area selfInspection: every active member reads the current
 * version, confirms it and reports deviations; company admins edit, approve and keep the log (beslut 3). The session,
 * the membership, the legal gate and the company come from context(); Local keeps the programme in its file.
 */
function answer(error: unknown) {
  if (error instanceof SelfInspectionError) return NextResponse.json({ error: error.message }, { status: error.status });
  return failure(error);
}

export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    if (!selfInspectionAccess({ active: true, admin: ctx.admin }).read) throw new SelfInspectionError(403, "Du saknar åtkomst till egenkontrollprogrammet.");
    // The instrument register has a page of its own (2026-10-07): the same right to read it, one query.
    const params = new URL(request.url).searchParams;
    if (params.get("part") === "instruments")
      return NextResponse.json(await cloudInstrumentsView(ctx), { headers: { "Cache-Control": "private, no-store" } });
    // Instrumentkoppling (2026-10-11): the protocols that chose one instrument, for those who may read protocols.
    if (params.get("part") === "instrument-protocols") {
      const id = (params.get("id") ?? "").slice(0, 120);
      if (!id) throw new SelfInspectionError(400, "Ange vilket instrument.");
      return NextResponse.json(await cloudInstrumentProtocols(ctx, id), { headers: { "Cache-Control": "private, no-store" } });
    }
    // Kompetenskort v2 (2026-10-08): one card's history, read on its own and bounded; the rule of who reads it is in cloudCardHistory.
    if (params.get("part") === "card-history") {
      const personId = (params.get("personId") ?? "").slice(0, 120);
      if (!personId) throw new SelfInspectionError(400, "Ange vems kompetenskort.");
      return NextResponse.json({ versions: await cloudCardHistory(ctx, personId) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json(await cloudSelfInspectionView(ctx), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return answer(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    const raw = await body(request);
    // Avvikelse ↔ arbetsorder (2026-10-10): "Skapa arbetsorder" on a log entry, with every check of a new work order.
    const order = deviationWorkOrderActionSchema.safeParse(raw);
    if (order.success) {
      const created = await createWorkOrderFromDeviation(ctx, order.data.deviationId);
      return NextResponse.json({ ...(await cloudSelfInspectionView(ctx)), createdWorkOrderId: created.id }, { headers: { "Cache-Control": "private, no-store" } });
    }
    // Integrationsmotorn E6 (2026-10-24): "Skapa avvikelse" on an automatic work order – an entry linked to the order.
    const fromAlarm = alarmDeviationActionSchema.safeParse(raw);
    if (fromAlarm.success) return NextResponse.json(await createDeviationFromAlarmOrder(ctx, fromAlarm.data.taskId), { headers: { "Cache-Control": "private, no-store" } });
    const input = selfInspectionActionSchema.parse(raw);
    // Företagets moduler (0.39.0): Avvikelser and Instrument are always on and share this route with the programme.
    if (selfInspectionActionNeedsModule(input.action)) requireModule(ctx, "self_inspection");
    const result = await applyCloudSelfInspectionAction(ctx, input);
    // A new report answers with its id, so the page can send the photos taken with it.
    return NextResponse.json({ ...(await cloudSelfInspectionView(ctx)), ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return answer(error);
  }
}
