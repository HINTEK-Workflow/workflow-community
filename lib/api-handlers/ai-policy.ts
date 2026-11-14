import { NextResponse } from "next/server";
import { publicInstance } from "@/lib/instance";
import { prisma } from "@/lib/db";
import { aiSharingPolicySchema, getAiSharingPolicy } from "@/lib/ai/sharing-policy";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { azureSettings } from "@/lib/ai/azure-settings-server";

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
    // Only a profile Workflow has released can be chosen (2026-10-24); EU is released when the EU provider is switched on.
    const before = await getAiSharingPolicy(ctx.organizationId);
    if (policy.profile === "eu" && before.profile !== "eu" && !(await azureSettings()).requested)
      throw new ApiError(400, `AI-profilen EU är inte släppt av ${publicInstance().operator} ännu.`);

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
            ? `Uppdaterade företagets val för delning med Workflow AI (AI-profil ${policy.profile === "eu" ? "EU" : "Standard"}${policy.requireEu ? ", kräver EU" : ""}).`
            : "Stängde av företagets delning med Workflow AI.",
        },
      });
    });
    return NextResponse.json({ policy });
  } catch (error) {
    return failure(error);
  }
}
