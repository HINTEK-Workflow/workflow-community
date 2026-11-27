import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFreshAuth } from "@/lib/auth/fresh-auth";
import { ApiError, body, checkOrigin, context, failure, requireAdmin, requireCloudStorage, requireCloudWriteAccess, requireModule } from "@/lib/kfid/server";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import {
  checkYouTube, chooseYouTubeChannel, removeYouTubeConnection, saveYouTubeKeys, setYouTubePublishing, startYouTubeAuthorization, youTubeStatusLine, youTubeView,
} from "@/lib/youtube/server";

/**
 * YouTube (2026-11-20): Inställningar → Kopplingar → Webb och sociala medier. The same checks as LinkedIn (lib/api-handlers/
 * linkedin.ts): the signed-in person (or an API key's member, with the same checks), an active membership in the active company,
 * ADMIN or OWNER there, Cloud storage, and on every change the app's Origin, the company's write access, the module and the rate;
 * the keys, Koppla YouTube, removing the connection and switching publishing on also a fresh sign-in. Everything is the active
 * company's own. The client secret and the tokens are never returned.
 */
export async function youTubeAdmin() {
  const ctx = await context();
  requireAdmin(ctx);
  requireCloudStorage(ctx);
  return ctx;
}
export type YouTubeContext = Awaited<ReturnType<typeof youTubeAdmin>>;

export async function youTubeRate(ctx: YouTubeContext, kind: "change" | "read" | "upload" | "publish") {
  const rule = kind === "change" ? RATE_RULES.youtubeChange : kind === "read" ? RATE_RULES.youtubeRead : kind === "upload" ? RATE_RULES.youtubeUpload : RATE_RULES.youtubePublish;
  const hit = await hitRateLimit(rule, `youtube-${kind}:${ctx.organizationId}`);
  if (!hit.allowed) throw new ApiError(429, kind === "publish" ? "Många publiceringar den senaste timmen. Vänta en stund." : "Många anrop den senaste timmen. Vänta en stund.");
}

export const noStore = { "Cache-Control": "private, no-store" };
export const actorOf = (ctx: YouTubeContext) => ({ userId: ctx.user.id, organizationId: ctx.organizationId });

export async function GET(request: Request) {
  try {
    const ctx = await youTubeAdmin();
    // The Kopplingar list: what is stored, without asking Google.
    if (new URL(request.url).searchParams.get("part") === "status") return NextResponse.json(await youTubeStatusLine(ctx.organizationId), { headers: noStore });
    await youTubeRate(ctx, "read");
    await checkYouTube(ctx.organizationId, { ifStale: true }).catch(() => undefined);
    return NextResponse.json({ connection: await youTubeView(ctx.organizationId) }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("keys"), clientId: z.string().trim().max(120).optional(), clientSecret: z.string().max(200).nullable().optional() }),
  z.object({ action: z.literal("authorize") }),
  z.object({ action: z.literal("choose"), channel: z.string().max(64) }),
  z.object({ action: z.literal("check") }),
  z.object({ action: z.literal("disconnect") }),
  z.object({ action: z.literal("publishing"), on: z.boolean() }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await youTubeAdmin();
    const input = requestSchema.parse(await body(request));
    const reads = input.action === "check";
    await youTubeRate(ctx, reads ? "read" : "change");
    if (!reads) await requireCloudWriteAccess(ctx);
    // Webb och inlägg: nothing new while the module is off; the connection can always be removed.
    if (!reads && input.action !== "disconnect") requireModule(ctx, "web_posts");
    const actor = actorOf(ctx);
    switch (input.action) {
      case "keys": {
        await requireFreshAuth(ctx.user.id, ctx.auth);
        return NextResponse.json({ connection: await saveYouTubeKeys(actor, input) }, { headers: noStore });
      }
      case "authorize": {
        // Koppla YouTube decides whose channel Workflow may upload to: a fresh sign-in, and the answer only for this person.
        await requireFreshAuth(ctx.user.id, ctx.auth);
        return NextResponse.json(await startYouTubeAuthorization(actor), { headers: noStore });
      }
      case "choose": return NextResponse.json({ connection: await chooseYouTubeChannel(actor, input.channel) }, { headers: noStore });
      case "check": {
        const check = await checkYouTube(ctx.organizationId);
        return NextResponse.json({ check, connection: await youTubeView(ctx.organizationId) }, { headers: noStore });
      }
      case "disconnect": {
        await requireFreshAuth(ctx.user.id, ctx.auth);
        return NextResponse.json({ connection: await removeYouTubeConnection(actor) }, { headers: noStore });
      }
      case "publishing": {
        if (input.on) await requireFreshAuth(ctx.user.id, ctx.auth);
        return NextResponse.json({ connection: await setYouTubePublishing(actor, input.on) }, { headers: noStore });
      }
    }
  } catch (error) {
    return failure(error);
  }
}
