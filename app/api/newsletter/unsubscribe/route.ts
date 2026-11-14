import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { validSubscriberUnsubscribe, validUnsubscribe } from "@/lib/mail/mailings";
import { removeSubscriber } from "@/lib/mail/newsletter-subscribers";
import { readLimitedText } from "@/lib/security/limited-body";

export const dynamic = "force-dynamic";

// Avböj nyhetsbrev (2026-10-03): the link in every newsletter, without signing in. GET from the mail opens the
// confirmation page; POST is the mail program's one-click unsubscribe (RFC 8058) and the page's button.
// A user's link carries ?u= (the yes is cleared); a landing page subscriber's (2026-11-12) carries ?s= (the row is deleted).
type Target = { kind: "user"; id: string } | { kind: "subscriber"; id: string } | null;
function targetOf(url: URL): Target {
  const token = url.searchParams.get("t") ?? "";
  const userId = url.searchParams.get("u") ?? "";
  const subscriberId = url.searchParams.get("s") ?? "";
  if (userId && validUnsubscribe(userId, token)) return { kind: "user", id: userId };
  if (!userId && subscriberId && validSubscriberUnsubscribe(subscriberId, token)) return { kind: "subscriber", id: subscriberId };
  return null;
}

async function unsubscribe(request: Request) {
  const target = targetOf(new URL(request.url));
  if (!target) return false;
  if (target.kind === "user") await prisma.user.updateMany({ where: { id: target.id }, data: { newsletterOptInAt: null } });
  else await removeSubscriber(target.id);
  return true;
}

// Opening the link changes nothing (security review 2026-10-04): mail filters that open links in advance would otherwise
// unsubscribe people. The page asks, and its button – or the mail program's one-click unsubscribe – posts.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const target = targetOf(url);
  const token = encodeURIComponent(url.searchParams.get("t") ?? "");
  const where = !target ? "/unsubscribed?status=invalid"
    : target.kind === "user" ? `/unsubscribed?status=confirm&u=${encodeURIComponent(target.id)}&t=${token}`
    : `/unsubscribed?status=confirm&s=${encodeURIComponent(target.id)}&t=${token}`;
  return NextResponse.redirect(new URL(where, env.APP_URL), 303);
}

export async function POST(request: Request) {
  const target = targetOf(new URL(request.url));
  const done = await unsubscribe(request);
  // The page's button is an ordinary form: it lands on the result page. A mail program's one-click post gets a plain answer.
  const fromPage = (request.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded") && (await readLimitedText(request, 1_000).catch(() => "")).includes("confirm=1");
  if (fromPage) return NextResponse.redirect(new URL(`/unsubscribed?status=${done ? "ok" : "invalid"}${done && target?.kind === "subscriber" ? "&kind=subscriber" : ""}`, env.APP_URL), 303);
  return done ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Länken är inte giltig." }, { status: 400 });
}
