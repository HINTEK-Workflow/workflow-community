import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { ApiError, body, checkOrigin, failure } from "@/lib/kfid/server";
import { mailConfig } from "@/lib/mail/settings-server";
import { currentPushSettings } from "@/lib/push/settings-server";
import { availableNoticeKinds, noticePreferenceInput, normalizeNoticeKinds } from "@/lib/workflow/notice-channels";
import { MACHINE_ALARM_KIND } from "@/lib/machine/alarm-notice";

/**
 * Before the person has saved anything, machine alarms already reach them (lib/machine/alarm-notice.ts alarmRecipients), so the
 * choice shows as on – a first save of other kinds must not turn the alarms off without the person seeing it (resa 2026-11-06).
 */
const UNSAVED_KINDS = [MACHINE_ALARM_KIND];

export const dynamic = "force-dynamic";

/**
 * Notiser per e-post och push (2026-10-07): the signed-in person's own choices – channel and kinds, nothing on
 * from the start. The row is the person's own (their id from the session, never one from the request).
 */
async function me() {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "Logga in för att fortsätta.");
  return user;
}

export async function GET() {
  try {
    const user = await me();
    const [preference, mail, push, devices] = await Promise.all([
      prisma.noticePreference.findUnique({ where: { userId: user.id } }),
      mailConfig(), currentPushSettings(), prisma.pushSubscription.count({ where: { userId: user.id } }),
    ]);
    const kinds = availableNoticeKinds({ superadmin: user.role === "SUPERADMIN" });
    return NextResponse.json({
      preference: { email: preference?.email ?? false, push: Boolean(preference?.push) && devices > 0, kinds: normalizeNoticeKinds(preference ? preference.kinds : UNSAVED_KINDS, kinds.map((kind) => kind.key)), machineAlarmNight: preference?.machineAlarmNight ?? false, requiredNotices: preference?.requiredNotices ?? true },
      kinds,
      // The choice is saved whatever the installation can do now; this says what happens with it.
      email: { available: mail.delivery.notices && !mail.blockedReason,
        reason: mail.blockedReason ?? (mail.delivery.notices ? null : "E-postnotiser är inte påslagna på den här installationen ännu. Ditt val sparas och gäller när de slås på.") },
      push: { available: push.ready, publicKey: push.ready ? push.publicKey : "", devices,
        reason: push.blockedReason ?? (push.ready ? null : "Webbpush är inte påslaget på den här installationen.") },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  try {
    checkOrigin(request);
    const user = await me();
    const input = noticePreferenceInput.parse(await body(request));
    const allowed = availableNoticeKinds({ superadmin: user.role === "SUPERADMIN" }).map((kind) => kind.key) as string[];
    if (input.kinds.some((kind) => !allowed.includes(kind))) throw new ApiError(400, "Den sortens notiser finns inte för dig.");
    const kinds = normalizeNoticeKinds(input.kinds, input.kinds);
    // Push is switched on and off per device (./push); this saves e-mail, which kinds and (E6) the person's own yes to
    // machine alarms at night – only ever the person's own row, and only when the request says so.
    const night = input.machineAlarmNight === undefined ? {} : { machineAlarmNight: input.machineAlarmNight };
    const required = input.requiredNotices === undefined ? {} : { requiredNotices: input.requiredNotices };
    const saved = await prisma.noticePreference.upsert({ where: { userId: user.id }, update: { email: input.email, kinds, ...night, ...required }, create: { userId: user.id, email: input.email, kinds, ...night, ...required }, select: { machineAlarmNight: true, requiredNotices: true } });
    return NextResponse.json({ email: input.email, kinds, machineAlarmNight: saved.machineAlarmNight, requiredNotices: saved.requiredNotices });
  } catch (error) {
    return failure(error);
  }
}
