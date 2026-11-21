import { NextResponse } from "next/server";
import { calendarAccess, calendarFile } from "@/lib/calendar/feed-server";
import { hashCalendarToken, tokenFromPath } from "@/lib/calendar/link";
import { clientIp } from "@/lib/security/client-ip";
import { hitRateLimit, RATE_RULES, rateLimitState } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/**
 * The personal calendar file (PL14, 2026-11-01): read only, no session and no cookie, so a calendar program can fetch it. The
 * link is the only key: lib/calendar/feed-server.ts asks again on every read what the person may see. Every refusal is the same 404, so
 * a guess learns nothing, and guesses are limited per address. The token is never logged or put in an answer.
 */
const HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };
const notFound = () => new NextResponse("Hittades inte.", { status: 404, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
const tooMany = (retryAfterSeconds: number) => new NextResponse("För många försök. Vänta en stund.", { status: 429, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(retryAfterSeconds) } });
/** How long a limited address is asked to wait when the limit is read without counting. */
const REFUSED_RETRY_SECONDS = RATE_RULES.calendarRefusedIp.windowSeconds;

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const address = clientIp(request.headers);
    if ((await rateLimitState(RATE_RULES.calendarRefusedIp, address)) !== "open") return tooMany(REFUSED_RETRY_SECONDS);
    const fromAddress = await hitRateLimit(RATE_RULES.calendarFeedIp, address);
    if (!fromAddress.allowed) return tooMany(fromAddress.retryAfterSeconds);
    const token = tokenFromPath((await params).token);
    const access = await calendarAccess(token);
    if (!access) {
      const guess = await hitRateLimit(RATE_RULES.calendarRefusedIp, address);
      return guess.allowed ? notFound() : tooMany(guess.retryAfterSeconds);
    }
    const fromLink = await hitRateLimit(RATE_RULES.calendarFeedLink, hashCalendarToken(token));
    if (!fromLink.allowed) return tooMany(fromLink.retryAfterSeconds);
    return new NextResponse(await calendarFile(access), { status: 200, headers: { ...HEADERS, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="workflow.ics"' } });
  } catch (error) {
    console.error("calendar file failed", error instanceof Error ? error.name : "unknown");
    return new NextResponse("Kalendern kunde inte läsas just nu.", { status: 503, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8", "Retry-After": "300" } });
  }
}
