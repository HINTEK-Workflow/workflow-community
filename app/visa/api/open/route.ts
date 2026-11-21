import { NextResponse } from "next/server";
import { body, checkOrigin, failure } from "@/lib/kfid/server";
import { clientIp } from "@/lib/security/client-ip";
import { LINK_BASE_PATH, LINK_COOKIE } from "@/lib/boards/guard";
import { openLink } from "@/lib/boards/links-server";
import { LINK_SESSION_HOURS } from "@/lib/boards/screens";
import { noStore, viewerCookie } from "@/lib/boards/viewer-http";

export const dynamic = "force-dynamic";

/** Opens a shared link: the secret (from the address's #-part) and, when asked for, the code, by POST; the answer is a cookie for /visa (12 h). */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const input = (await body(request)) as { k?: unknown; code?: unknown } | null;
    const answer = await openLink(input?.k, input?.code, clientIp(request.headers));
    if (!answer.ok) return NextResponse.json({ error: answer.error, needCode: answer.needCode ?? false }, { status: answer.status, headers: noStore });
    const response = NextResponse.json({ ok: true, name: answer.name }, { headers: noStore });
    response.cookies.set(LINK_COOKIE, answer.session, viewerCookie(LINK_BASE_PATH, LINK_SESSION_HOURS * 3600));
    return response;
  } catch (error) { return failure(error); }
}
