import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseUploadedCloudBundle } from "@/lib/kfid/cloud-bundle";
import { MAX_CLOUD_WORKSPACE_BUNDLE_BYTES } from "@/lib/kfid/cloud-reimport";
import { requireActiveLocalWorkspaceBinding } from "@/lib/kfid/local-workspace-binding";
import { ApiError, checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess } from "@/lib/kfid/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > MAX_CLOUD_WORKSPACE_BUNDLE_BYTES)
      throw new ApiError(413, "Välj en HINTEK Workflow-fil på högst 50 MB.");
    const bundle = await parseUploadedCloudBundle(file, ctx.organizationId);
    if (!bundle.workspace.cloudSnapshot)
      throw new ApiError(422, "Filen saknar ursprung från en Cloud-export.");
    const localIdentityId = bundle.workspace.localIdentity.id;
    const memberWeeklyWorkMinutes = bundle.workspace.localIdentity.weeklyWorkMinutes;
    const localEvent = bundle.workspace.workScheduleEvents.find((event) => event.scope === "MEMBER");
    const localScheduleUpdatedAt = new Date(localEvent?.createdAt ?? bundle.workspace.updatedAt);
    if (Number.isNaN(localScheduleUpdatedAt.getTime())) throw new ApiError(422, "Filens arbetstidshistorik är ogiltig.");

    await requireActiveLocalWorkspaceBinding(prisma, { organizationId: ctx.organizationId, userId: ctx.user.id, localIdentityId });
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "LocalWorkspaceBinding"
        WHERE "organizationId"=${ctx.organizationId} AND "userId"=${ctx.user.id}
          AND "localIdentityId"=${localIdentityId} AND "revokedAt" IS NULL
        FOR UPDATE
      `;
      if (!locked[0]) throw new ApiError(403, "Den lokala arbetsytans koppling har återkallats.");
      const binding = await tx.localWorkspaceBinding.findUniqueOrThrow({ where: { id: locked[0].id } });
      if (!binding.scheduleBaselineCapturedAt)
        throw new ApiError(409, "Kopplingen saknar en verifierad arbetstidsbaslinje. Exportera en ny Cloud-kopia.");
      const members = await tx.$queryRaw<{ id: string; weeklyWorkMinutes: number | null }[]>`
        SELECT id, "weeklyWorkMinutes" FROM "OrganizationMember"
        WHERE "organizationId"=${ctx.organizationId} AND "userId"=${ctx.user.id} FOR UPDATE
      `;
      const member = members[0];
      if (!member) throw new ApiError(403, "Aktivt medlemskap saknas.");
      const cloudChanged = member.weeklyWorkMinutes !== binding.memberWeeklyWorkMinutesAtBinding;
      if (cloudChanged && member.weeklyWorkMinutes !== memberWeeklyWorkMinutes)
        throw new ApiError(409, "Din Cloud-arbetstid har ändrats sedan Cloud-kopian skapades. Exportera en ny kopia eller välj vilket värde som ska gälla.");
      if (binding.lastLocalScheduleUpdatedAt && localScheduleUpdatedAt < binding.lastLocalScheduleUpdatedAt && member.weeklyWorkMinutes !== memberWeeklyWorkMinutes)
        throw new ApiError(409, "En nyare lokal arbetstidsändring har redan synkats. Öppna den senaste Local-filen först.");
      if (member.weeklyWorkMinutes === memberWeeklyWorkMinutes) {
        await tx.localWorkspaceBinding.update({ where: { id: binding.id }, data: {
          memberWeeklyWorkMinutesAtBinding: memberWeeklyWorkMinutes,
          lastLocalScheduleUpdatedAt: binding.lastLocalScheduleUpdatedAt && binding.lastLocalScheduleUpdatedAt > localScheduleUpdatedAt ? binding.lastLocalScheduleUpdatedAt : localScheduleUpdatedAt,
          lastScheduleSyncedAt: new Date(),
        } });
        return { changed: false, eventId: null };
      }
      await tx.organizationMember.update({ where: { id: member.id }, data: { weeklyWorkMinutes: memberWeeklyWorkMinutes } });
      const event = await tx.workScheduleEvent.create({ data: {
        organizationId: ctx.organizationId, memberId: member.id, scope: "MEMBER",
        previousMinutes: member.weeklyWorkMinutes, nextMinutes: memberWeeklyWorkMinutes,
        actorName: `${ctx.user.name || ctx.user.email} · Local synk`,
      } });
      await tx.localWorkspaceBinding.update({ where: { id: binding.id }, data: {
        memberWeeklyWorkMinutesAtBinding: memberWeeklyWorkMinutes,
        lastLocalScheduleUpdatedAt: localScheduleUpdatedAt, lastScheduleSyncedAt: new Date(),
      } });
      return { changed: true, eventId: event.id };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return failure(error);
  }
}
