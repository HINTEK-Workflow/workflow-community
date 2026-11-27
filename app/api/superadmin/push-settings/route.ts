import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { currentPushSettings, generatePushKeys, loadPushConfig, savePushSettings } from "@/lib/push/settings-server";
import { sendWebPush } from "@/lib/push/web-push";
import { requireCentralKeyChange, requireCentralKeyViewer } from "@/lib/secrets/central-access";
import { CentralStoreError } from "@/lib/secrets/central-store";

export const dynamic = "force-dynamic";

/**
 * Webbpush (2026-10-07): the installation's VAPID keys and on/off, set in the app by the superadmin
 * (Installation → E-post). The private key is sealed in the database and never sent to the page.
 */
// Workflow's superadmin only, and a fresh sign-in for every change of a key (lib/secrets/central-access.ts, 2026-10-25).
async function superadmin() {
  const ctx = await context({ skipLegal: true });
  requireCentralKeyViewer(ctx);
  return ctx;
}

const state = async () => ({ ...(await currentPushSettings()), devices: await prisma.pushSubscription.count() });

export async function GET() {
  try {
    await superadmin();
    return NextResponse.json(await state(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error instanceof CentralStoreError ? new ApiError(error.status, error.message) : error);
  }
}

export async function PUT(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await superadmin();
    await savePushSettings(await body(request));
    const next = await state();
    await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "push_settings", detail: next.enabled ? "Slog på webbpush." : "Stängde av webbpush." } });
    return NextResponse.json(next);
  } catch (error) {
    return failure(error instanceof CentralStoreError ? new ApiError(error.status, error.message) : error);
  }
}

const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("generate"), replace: z.boolean().optional() }),
  z.object({ action: z.literal("test") }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await superadmin();
    const input = command.parse(await body(request));
    if (input.action === "generate") {
      const made = await generatePushKeys({ replace: Boolean(input.replace) }, await requireCentralKeyChange(ctx));
      await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "push_keys",
        detail: made.removedDevices ? `Skapade nya nycklar för webbpush; ${made.removedDevices} enheter måste slå på push igen.` : "Skapade nycklar för webbpush." } });
      return NextResponse.json(await state());
    }
    // A test push to the superadmin's own devices, with the saved settings.
    const config = await loadPushConfig();
    const settings = await currentPushSettings();
    if (settings.blockedReason) throw new ApiError(409, settings.blockedReason);
    if (!config) throw new ApiError(409, "Slå på webbpush och skapa nycklar först.");
    const devices = await prisma.pushSubscription.findMany({ where: { userId: ctx.user.id }, take: 10 });
    if (!devices.length) throw new ApiError(409, "Slå på push på den här enheten under Mina inställningar först.");
    const payload = JSON.stringify({ title: "Workflow", body: "Testnotis: webbpush fungerar.", url: "/?view=settings", tag: "push-test" });
    let delivered = 0;
    for (const device of devices) {
      try {
        const { status } = await sendWebPush({ endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth }, payload, { subject: config.subject, keys: config.keys, ttlSeconds: 600 });
        if (status >= 200 && status < 300) delivered++;
        else if (status === 404 || status === 410) await prisma.pushSubscription.delete({ where: { id: device.id } }).catch(() => undefined);
      } catch { /* counted as not delivered */ }
    }
    if (!delivered) throw new ApiError(502, "Testnotisen kunde inte skickas. Kontrollera nycklarna och kontaktadressen.");
    return NextResponse.json({ ok: true, delivered, devices: devices.length });
  } catch (error) {
    return failure(error instanceof CentralStoreError ? new ApiError(error.status, error.message) : error);
  }
}
