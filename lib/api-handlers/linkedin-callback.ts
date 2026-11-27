import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { requireCloudWriteAccess } from "@/lib/kfid/server";
import { completeLinkedInAuthorization, type LinkedInCallbackResult } from "@/lib/linkedin/server";
import { linkedInAdmin, linkedInRate } from "./linkedin";

/**
 * LinkedIn's answer to Koppla LinkedIn (2026-11-11): GET /api/linkedin/callback?code=…&state=… (or error=…), the address the
 * admin registers in the app. The browser comes from LinkedIn, so there is no Origin to check: the session, the membership,
 * the admin role, Cloud and the write access are checked as everywhere, and the single-use state (lib/linkedin/server.ts)
 * must be one this person started in this company within ten minutes – that is the protection against a forged answer.
 * The browser is sent back to Kopplingar with a short result word; the code and the state never reach the page or a log, and
 * no referrer is sent on.
 */
const BACK = "/?view=advanced&section=web";
const back = (result: LinkedInCallbackResult) => {
  const response = NextResponse.redirect(new URL(`${BACK}&linkedin=${result}`, new URL(env.APP_URL).origin), 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
};

export async function GET(request: Request) {
  try {
    const ctx = await linkedInAdmin();
    await linkedInRate(ctx, "change");
    await requireCloudWriteAccess(ctx);
    const params = new URL(request.url).searchParams;
    const outcome = await completeLinkedInAuthorization({ userId: ctx.user.id, organizationId: ctx.organizationId }, {
      state: params.get("state"), code: params.get("code"), error: params.get("error"),
    });
    return back(outcome.result);
  } catch {
    return back("failed");
  }
}
