import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { aiSharingPolicySchema, getAiSharingPolicy } from "@/lib/ai/sharing-policy";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await context();
    return NextResponse.json({
      policy: await getAiSharingPolicy(ctx.organizationId),
      canManage: ctx.admin,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    if (!ctx.admin) throw new ApiError(403, "Företagsadministratör krävs.");
    const policy = aiSharingPolicySchema.parse(await body(request));
    if (policy.enabled && !policy.shareChatContent)
      throw new ApiError(400, "Chattinnehåll måste vara godkänt för att AI ska kunna aktiveras.");

    await prisma.$transaction(async (tx) => {
      await tx.workspaceSettings.upsert({
        where: { organizationId: ctx.organizationId },
        create: { organizationId: ctx.organizationId, aiPolicy: policy },
        update: { aiPolicy: policy },
      });
      await tx.administrationEvent.create({
        data: {
          actorId: ctx.user.id,
          organizationId: ctx.organizationId,
          action: "ai_sharing_policy_updated",
          detail: policy.enabled
            ? "Uppdaterade företagets val för delning med HINTEK AI."
            : "Stängde av företagets delning med HINTEK AI.",
        },
      });
    });
    return NextResponse.json({ policy });
  } catch (error) {
    return failure(error);
  }
}
