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
    if (!ctx.admin) throw new ApiError(403, "Bara en företagsadministratör kan göra det.");
    const sent = aiSharingPolicySchema.parse(await body(request));
    if (sent.enabled && !sent.shareChatContent)
      throw new ApiError(400, "Chattinnehåll måste vara godkänt för att AI ska kunna aktiveras.");
    // Only a profile Workflow has released can be chosen (2026-10-24); EU is released when Azure is switched on.
    const before = await getAiSharingPolicy(ctx.organizationId);
    const azureOn = (await azureSettings()).requested;
    if (sent.profile === "eu" && before.profile !== "eu" && !azureOn)
      throw new ApiError(400, `AI-profilen EU är inte släppt av ${publicInstance().operator} ännu.`);
    const profileChosen = before.profileChosen || sent.profile !== before.profile;
    // F4 (2026-11-21): a Cloud company that switches AI on without having chosen a profile gets EU, the safest default.
    const euByDefault = !publicInstance().community && sent.enabled && !before.enabled && !profileChosen && azureOn;
    // The MCP switch is changed only under API och MCP: this page keeps what is saved, whatever it sends.
    // So is the company's own weekly quota, which only the superadmin sets.
    const policy = { ...sent, profile: euByDefault ? "eu" as const : sent.profile, profileChosen, mcpAllowed: before.mcpAllowed, weeklyQuotaKr: before.weeklyQuotaKr, continueOnCredits: before.continueOnCredits };

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
