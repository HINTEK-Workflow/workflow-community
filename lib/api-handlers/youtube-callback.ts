import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { requireCloudWriteAccess } from "@/lib/kfid/server";
import { completeYouTubeAuthorization, type YouTubeCallbackResult } from "@/lib/youtube/server";
import { youTubeAdmin, youTubeRate } from "./youtube";

/**
 * Google's answer to Koppla YouTube (2026-11-20): GET /api/youtube/callback?code=…&state=… (or error=…), the address the admin
 * registers on the OAuth client. The browser comes from Google, so there is no Origin to check: the session, the membership, the
 * admin role, Cloud and the write access are checked as everywhere, and the single-use state (lib/youtube/server.ts) must be one
 * this person started in this company within ten minutes – that, with PKCE, is the protection against a forged answer. The
 * browser is sent back to Kopplingar with a short result word; the code and the state never reach the page or a log, and no
 * referrer is sent on.
 */
const BACK = "/?view=advanced&section=web";
const back = (result: YouTubeCallbackResult) => {
  const response = NextResponse.redirect(new URL(`${BACK}&youtube=${result}`, new URL(env.APP_URL).origin), 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
};

export async function GET(request: Request) {
  try {
    const ctx = await youTubeAdmin();
    await youTubeRate(ctx, "change");
    await requireCloudWriteAccess(ctx);
    const params = new URL(request.url).searchParams;
    const outcome = await completeYouTubeAuthorization({ userId: ctx.user.id, organizationId: ctx.organizationId }, {
      state: params.get("state"), code: params.get("code"), error: params.get("error"),
    });
    return back(outcome.result);
  } catch {
    return back("failed");
  }
}
