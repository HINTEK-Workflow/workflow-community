import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFreshAuth } from "@/lib/auth/fresh-auth";
import { ApiError, body, checkOrigin, context, failure, requireAdmin, requireCloudStorage, requireCloudWriteAccess, requireModule } from "@/lib/kfid/server";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import { checkMeta, chooseMetaPage, metaStatusLine, metaView, removeMetaConnection, saveMetaConnection, setMetaPublishing } from "@/lib/meta/server";

/**
 * Facebook och Instagram (2026-11-10): Inställningar → Kopplingar → Webb och sociala medier. Like the company's other
 * connections: the signed-in person (or an API key's member, with the same checks), an active membership in the active
 * company, ADMIN or OWNER there, Cloud storage, and on every change the app's Origin, the company's write access and the rate;
 * a change of the keys, removing the connection and switching publishing on also a fresh sign-in. Everything is the active
 * company's own – a superadmin gets no other company's connection. The app secret and the tokens are never returned.
 */
export async function metaAdmin() {
  const ctx = await context();
  requireAdmin(ctx);
  requireCloudStorage(ctx);
  return ctx;
}
export type MetaContext = Awaited<ReturnType<typeof metaAdmin>>;

export async function metaRate(ctx: MetaContext, kind: "change" | "read" | "publish") {
  const rule = kind === "change" ? RATE_RULES.metaChange : kind === "read" ? RATE_RULES.metaRead : RATE_RULES.metaPublish;
  const hit = await hitRateLimit(rule, `meta-${kind}:${ctx.organizationId}`);
  if (!hit.allowed) throw new ApiError(429, kind === "publish" ? "Många publiceringar den senaste timmen. Vänta en stund." : "Många anrop den senaste timmen. Vänta en stund.");
}

export const noStore = { "Cache-Control": "private, no-store" };
export const actorOf = (ctx: MetaContext) => ({ userId: ctx.user.id, organizationId: ctx.organizationId });

export async function GET(request: Request) {
  try {
    const ctx = await metaAdmin();
    // The Kopplingar list and Min webbsida's checkbox: what is stored, without asking Meta.
    if (new URL(request.url).searchParams.get("part") === "status") return NextResponse.json(await metaStatusLine(ctx.organizationId), { headers: noStore });
    await metaRate(ctx, "read");
    // On opening: Meta is asked about the token when the last answer is older than six hours.
    await checkMeta(ctx.organizationId, { ifStale: true }).catch(() => undefined);
    return NextResponse.json({ connection: await metaView(ctx.organizationId) }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("connection"), appId: z.string().trim().max(40).optional(), appSecret: z.string().max(200).nullable().optional(), userToken: z.string().max(1000).optional() }),
  z.object({ action: z.literal("choose"), pageId: z.string().max(40) }),
  z.object({ action: z.literal("check") }),
  z.object({ action: z.literal("disconnect") }),
  z.object({ action: z.literal("publishing"), on: z.boolean() }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await metaAdmin();
    const input = requestSchema.parse(await body(request));
    const reads = input.action === "check";
    await metaRate(ctx, reads ? "read" : "change");
    if (!reads) await requireCloudWriteAccess(ctx);
    // Webb och inlägg (2026-11-20): nothing new while the module is off; the connection can always be removed.
    if (!reads && input.action !== "disconnect") requireModule(ctx, "web_posts");
    const actor = actorOf(ctx);
    switch (input.action) {
      case "connection": {
        // The keys decide whose page Workflow can post to: a fresh sign-in.
        await requireFreshAuth(ctx.user.id, ctx.auth);
        const connection = await saveMetaConnection(actor, input);
        return NextResponse.json({ connection }, { headers: noStore });
      }
      case "choose": return NextResponse.json({ connection: await chooseMetaPage(actor, input.pageId) }, { headers: noStore });
      case "check": {
        const check = await checkMeta(ctx.organizationId);
        return NextResponse.json({ check, connection: await metaView(ctx.organizationId) }, { headers: noStore });
      }
      case "disconnect": {
        await requireFreshAuth(ctx.user.id, ctx.auth);
        return NextResponse.json({ connection: await removeMetaConnection(actor) }, { headers: noStore });
      }
      case "publishing": {
        if (input.on) await requireFreshAuth(ctx.user.id, ctx.auth);
        return NextResponse.json({ connection: await setMetaPublishing(actor, input.on) }, { headers: noStore });
      }
    }
  } catch (error) {
    return failure(error);
  }
}
