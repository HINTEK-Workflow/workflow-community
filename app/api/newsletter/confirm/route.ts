import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { checkOrigin, failure } from "@/lib/kfid/server";
import { confirmSubscription } from "@/lib/mail/newsletter-subscribers";
import { readLimitedText } from "@/lib/security/limited-body";

export const dynamic = "force-dynamic";

/**
 * Bekräfta nyhetsbrevet (2026-11-12): the button on /newsletter/confirm. Only this press makes the address active – the
 * link in the mail only opens the page, so a mail filter that opens links in advance confirms nothing. The token is used once.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const type = request.headers.get("content-type") ?? "";
    const text = await readLimitedText(request, 1_000).catch(() => "");
    const fromPage = type.includes("application/x-www-form-urlencoded");
    let token = "";
    if (fromPage) token = new URLSearchParams(text).get("t") ?? "";
    else { try { const value = JSON.parse(text) as { t?: unknown }; token = typeof value?.t === "string" ? value.t : ""; } catch { token = ""; } }
    const done = await confirmSubscription(token);
    if (fromPage) return NextResponse.redirect(new URL(`/newsletter/confirm?status=${done ? "ok" : "invalid"}`, env.APP_URL), 303);
    return done ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Länken är inte giltig." }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
