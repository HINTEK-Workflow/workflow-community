import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { MEMORY_MAX, readMemories, writeMemory } from "@/lib/ai/memory";

export const dynamic = "force-dynamic";

/**
 * HINTEK AI's memory (Daniel 2026-09-30): everyone reads the company's memory and their own; company admins write the
 * company's, each person only their own (stored pseudonymised). Empty text deletes the memory.
 */
const input = z.object({ scope: z.enum(["COMPANY", "USER"]), content: z.string().max(MEMORY_MAX, `Minnet får vara högst ${MEMORY_MAX} tecken.`) });

export async function GET() {
  try {
    const ctx = await context();
    const memory = await readMemories(ctx.organizationId, ctx.user.id);
    return NextResponse.json({ ...memory, canEditCompany: ctx.admin, max: MEMORY_MAX }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    const command = input.parse(await body(request));
    if (command.scope === "COMPANY" && !ctx.admin) throw new ApiError(403, "Bara företagets admin ändrar företagets AI-minne.");
    const content = await writeMemory(ctx.organizationId, command.scope, ctx.user.id, command.content);
    if (command.scope === "COMPANY")
      await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "ai_memory", detail: content ? "Ändrade företagets AI-minne." : "Tömde företagets AI-minne." } });
    return NextResponse.json({ ok: true, content });
  } catch (error) {
    return failure(error);
  }
}
