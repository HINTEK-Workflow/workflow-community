import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { body, checkOrigin, context, failure, requireCloudStorage } from "@/lib/kfid/server";

export async function GET() {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const bindings = await prisma.localWorkspaceBinding.findMany({
      where: { organizationId: ctx.organizationId, userId: ctx.user.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, localIdentityId: true, createdAt: true },
    });
    return NextResponse.json({ bindings });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    const input = z.object({ action: z.literal("revoke"), id: z.string().min(1).max(100) }).parse(await body(request));
    const revoked = await prisma.localWorkspaceBinding.updateMany({
      where: { id: input.id, organizationId: ctx.organizationId, userId: ctx.user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedByUserId: ctx.user.id },
    });
    if (!revoked.count) throw new ApiError(404, "Kopplingen hittades inte eller har redan återkallats.");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
