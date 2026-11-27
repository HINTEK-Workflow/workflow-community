import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { checkOrigin, failure } from "@/lib/kfid/server";
import { SCREEN_BASE_PATH, SCREEN_COOKIE, SCREEN_PAIR_COOKIE } from "@/lib/boards/guard";
import { pollPairing } from "@/lib/boards/screens-server";
import { noStore, viewerCookie } from "@/lib/boards/viewer-http";

export const dynamic = "force-dynamic";

/** The screen asks whether it has been approved; once it has, its screen key is set as a cookie for /skarm (400 days). */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const answer = await pollPairing((await cookies()).get(SCREEN_PAIR_COOKIE)?.value);
    if (answer.status !== "ready") return NextResponse.json({ status: answer.status }, { status: answer.status === "expired" ? 410 : 200, headers: noStore });
    const response = NextResponse.json({ status: "ready" }, { headers: noStore });
    response.cookies.set(SCREEN_COOKIE, answer.token, viewerCookie(SCREEN_BASE_PATH, 400 * 24 * 3600));
    response.cookies.set(SCREEN_PAIR_COOKIE, "", viewerCookie(SCREEN_BASE_PATH, 0));
    return response;
  } catch (error) { return failure(error); }
}
