import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFreshAuth } from "@/lib/auth/fresh-auth";
import { ApiError, body, checkOrigin, context, failure, requireAdmin, requireCloudStorage, requireCloudWriteAccess } from "@/lib/kfid/server";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import {
  checkLinkedIn, chooseLinkedInAuthor, linkedInStatusLine, linkedInView, removeLinkedInConnection, saveLinkedInKeys, setLinkedInPublishing, startLinkedInAuthorization,
} from "@/lib/linkedin/server";

/**
 * LinkedIn (2026-11-11): Inställningar → Kopplingar → Webb och sociala medier. The same checks as Facebook och Instagram
 * (lib/api-handlers/meta.ts): the signed-in person (or an API key's member, with the same checks), an active membership in the
 * active company, ADMIN or OWNER there, Cloud storage, and on every change the app's Origin, the company's write access and the
 * rate; the keys, Koppla LinkedIn, removing the connection and switching publishing on also a fresh sign-in. Everything is the
 * active company's own. The client secret and the tokens are never returned.
 */
export async function linkedInAdmin() {
  const ctx = await context();
  requireAdmin(ctx);
  requireCloudStorage(ctx);
  return ctx;
}
export type LinkedInContext = Awaited<ReturnType<typeof linkedInAdmin>>;

export async function linkedInRate(ctx: LinkedInContext, kind: "change" | "read") {
  const hit = await hitRateLimit(kind === "change" ? RATE_RULES.linkedinChange : RATE_RULES.linkedinRead, `linkedin-${kind}:${ctx.organizationId}`);
  if (!hit.allowed) throw new ApiError(429, "Många anrop den senaste timmen. Vänta en stund.");
}

const noStore = { "Cache-Control": "private, no-store" };
const actorOf = (ctx: LinkedInContext) => ({ userId: ctx.user.id, organizationId: ctx.organizationId });

export async function GET(request: Request) {
  try {
    const ctx = await linkedInAdmin();
    // The Kopplingar list: what is stored, without asking LinkedIn.
    if (new URL(request.url).searchParams.get("part") === "status") return NextResponse.json(await linkedInStatusLine(ctx.organizationId), { headers: noStore });
    await linkedInRate(ctx, "read");
    await checkLinkedIn(ctx.organizationId, { ifStale: true }).catch(() => undefined);
    return NextResponse.json({ connection: await linkedInView(ctx.organizationId) }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("keys"), clientId: z.string().trim().max(60).optional(), clientSecret: z.string().max(300).nullable().optional(), scopeSet: z.enum(["personal", "organization"]).optional() }),
  z.object({ action: z.literal("authorize") }),
  z.object({ action: z.literal("choose"), author: z.string().max(40) }),
  z.object({ action: z.literal("check") }),
  z.object({ action: z.literal("disconnect") }),
  z.object({ action: z.literal("publishing"), on: z.boolean() }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await linkedInAdmin();
    const input = requestSchema.parse(await body(request));
    const reads = input.action === "check";
    await linkedInRate(ctx, reads ? "read" : "change");
    if (!reads) await requireCloudWriteAccess(ctx);
    const actor = actorOf(ctx);
    switch (input.action) {
      case "keys": {
        await requireFreshAuth(ctx.user.id, ctx.auth);
        return NextResponse.json({ connection: await saveLinkedInKeys(actor, input) }, { headers: noStore });
      }
      case "authorize": {
        // Koppla LinkedIn decides whose LinkedIn Workflow may post to: a fresh sign-in, and the answer only for this person.
        await requireFreshAuth(ctx.user.id, ctx.auth);
        return NextResponse.json(await startLinkedInAuthorization(actor), { headers: noStore });
      }
      case "choose": return NextResponse.json({ connection: await chooseLinkedInAuthor(actor, input.author) }, { headers: noStore });
      case "check": {
        const check = await checkLinkedIn(ctx.organizationId);
        return NextResponse.json({ check, connection: await linkedInView(ctx.organizationId) }, { headers: noStore });
      }
      case "disconnect": {
        await requireFreshAuth(ctx.user.id, ctx.auth);
        return NextResponse.json({ connection: await removeLinkedInConnection(actor) }, { headers: noStore });
      }
      case "publishing": {
        if (input.on) await requireFreshAuth(ctx.user.id, ctx.auth);
        return NextResponse.json({ connection: await setLinkedInPublishing(actor, input.on) }, { headers: noStore });
      }
    }
  } catch (error) {
    return failure(error);
  }
}
