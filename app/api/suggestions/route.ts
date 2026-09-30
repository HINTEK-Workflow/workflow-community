import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  context,
  checkOrigin,
  body,
  failure,
  requireAdmin,
  ApiError,
  requireCloudWriteAccess,
} from "@/lib/kfid/server";
import {
  suggestionSchema,
  preferencesSchema,
  builtInSuggestions,
} from "@/lib/kfid/preferences";
export async function GET() {
  try {
    const ctx = await context();
    const [global, company, personal] = await Promise.all([
      prisma.systemSettings.findUnique({ where: { id: "global" } }),
      prisma.workspaceSettings.findUnique({
        where: { organizationId: ctx.organizationId },
      }),
      prisma.userPreferences.findUnique({ where: { userId: ctx.user.id } }),
    ]);
    return NextResponse.json({
      global: global?.suggestions ?? {},
      company: company?.suggestions ?? {},
      personal: preferencesSchema.parse(personal?.data ?? {}).fieldSuggestions,
      builtin: builtInSuggestions,
      admin: ctx.admin,
      superadmin: ctx.testAdmin,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    const input = z
      .object({
        scope: z.enum(["personal", "company", "global"]),
        values: suggestionSchema,
      })
      .parse(await body(request));
    if (input.scope === "personal") {
      const old = await prisma.userPreferences.findUnique({
        where: { userId: ctx.user.id },
      });
      const data = {
        ...preferencesSchema.parse(old?.data ?? {}),
        fieldSuggestions: input.values,
      } as Prisma.InputJsonValue;
      await prisma.userPreferences.upsert({
        where: { userId: ctx.user.id },
        create: { userId: ctx.user.id, data },
        update: { data },
      });
    } else if (input.scope === "company") {
      requireAdmin(ctx);
      await requireCloudWriteAccess(ctx);
      await prisma.workspaceSettings.upsert({
        where: { organizationId: ctx.organizationId },
        create: {
          organizationId: ctx.organizationId,
          suggestions: input.values,
        },
        update: { suggestions: input.values },
      });
    } else {
      if (!ctx.testAdmin) throw new ApiError(403, "Systemadministratör krävs.");
      await prisma.systemSettings.upsert({
        where: { id: "global" },
        create: { id: "global", suggestions: input.values },
        update: { suggestions: input.values },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
