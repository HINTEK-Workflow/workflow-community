import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { failure } from "@/lib/kfid/server";
import { LINK_BASE_PATH, LINK_COOKIE } from "@/lib/boards/guard";
import { linkFeed } from "@/lib/boards/links-server";
import { LINK_SESSION_HOURS } from "@/lib/boards/screens";
import { noStore, viewerCookie } from "@/lib/boards/viewer-http";

export const dynamic = "force-dynamic";

/** What a shared link shows (Tavlor etapp 2): read only, checked on every fetch; the session is renewed while it is used. */
export async function GET() {
  try {
    const { feed, renew } = await linkFeed((await cookies()).get(LINK_COOKIE)?.value);
    const response = NextResponse.json(feed, { headers: noStore });
    if (renew) response.cookies.set(LINK_COOKIE, renew, viewerCookie(LINK_BASE_PATH, LINK_SESSION_HOURS * 3600));
    return response;
  } catch (error) { return failure(error); }
}
