import { NextResponse } from "next/server";
import { body, checkOrigin, failure } from "@/lib/kfid/server";
import { clientIp } from "@/lib/security/client-ip";
import { SCREEN_BASE_PATH, SCREEN_PAIR_COOKIE } from "@/lib/boards/guard";
import { startPairing } from "@/lib/boards/screens-server";
import { PAIR_MINUTES } from "@/lib/boards/screens";
import { appOrigin, noStore, pairPageUrl, qrSvg, viewerCookie } from "@/lib/boards/viewer-http";

export const dynamic = "force-dynamic";

/** A screen asks to be connected (Tavlor etapp 2): a code to show and a QR code to the pairing page; the screen's own secret goes in a cookie for /skarm. */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const pairing = await startPairing(request.headers, await body(request).catch(() => ({})), clientIp(request.headers));
    const response = NextResponse.json({ code: pairing.code, expiresAt: pairing.expiresAt, interval: pairing.interval, qr: await qrSvg(pairPageUrl(pairing.code)), address: appOrigin() }, { headers: noStore });
    response.cookies.set(SCREEN_PAIR_COOKIE, pairing.secret, viewerCookie(SCREEN_BASE_PATH, (PAIR_MINUTES + 5) * 60));
    return response;
  } catch (error) { return failure(error); }
}
