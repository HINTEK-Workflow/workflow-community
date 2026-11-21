import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { ApiError, body, checkOrigin, failure } from "@/lib/kfid/server";
import { currentPushSettings } from "@/lib/push/settings-server";
import { isPushEndpoint, validSubscriptionKeys } from "@/lib/push/web-push";

export const dynamic = "force-dynamic";

/**
 * Web push per device (2026-10-07): the browser's subscription is saved for the signed-in person when they switch
 * push on, and removed when they switch it off. Only the known push services are accepted (an address the server would
 * later call), and only while the installation has push on.
 */
const MAX_DEVICES = 10;

async function me() {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "Logga in för att fortsätta.");
  return user;
}

const subscription = z.object({ endpoint: z.string().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) });

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await me();
    const input = subscription.parse(await body(request));
    if (!isPushEndpoint(input.endpoint)) throw new ApiError(400, "Den här webbläsarens push-tjänst stöds inte.");
    if (!validSubscriptionKeys(input.keys)) throw new ApiError(400, "Enhetens nycklar är ogiltiga.");
    if (!(await currentPushSettings()).ready) throw new ApiError(409, "Webbpush är inte påslaget på den här installationen.");
    const others = await prisma.pushSubscription.count({ where: { userId: user.id, endpoint: { not: input.endpoint } } });
    if (others >= MAX_DEVICES) throw new ApiError(409, `Du har redan push på ${MAX_DEVICES} enheter. Stäng av push på en enhet först.`);
    // The same device signing in as someone else takes the subscription over.
    await prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      update: { userId: user.id, p256dh: input.keys.p256dh, auth: input.keys.auth },
      create: { userId: user.id, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth },
    });
    await prisma.noticePreference.upsert({ where: { userId: user.id }, update: { push: true }, create: { userId: user.id, push: true } });
    return NextResponse.json({ ok: true, devices: others + 1 });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const user = await me();
    const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(await body(request));
    // Only the person's own device.
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
    const devices = await prisma.pushSubscription.count({ where: { userId: user.id } });
    if (!devices) await prisma.noticePreference.updateMany({ where: { userId: user.id }, data: { push: false } });
    return NextResponse.json({ ok: true, devices });
  } catch (error) {
    return failure(error);
  }
}
