import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { validUnsubscribe } from "@/lib/mail/mailings";

export const dynamic = "force-dynamic";

// Avböj nyhetsbrev (2026-10-03): the link in every newsletter, without signing in. GET from the mail opens the
// confirmation page; POST is the mail program's one-click unsubscribe (RFC 8058) and the page's button.
async function unsubscribe(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("u") ?? "";
  const token = url.searchParams.get("t") ?? "";
  if (!userId || !validUnsubscribe(userId, token)) return false;
  await prisma.user.updateMany({ where: { id: userId }, data: { newsletterOptInAt: null } });
  return true;
}

export async function GET(request: Request) {
  const done = await unsubscribe(request);
  return NextResponse.redirect(new URL(`/unsubscribed?status=${done ? "ok" : "invalid"}`, env.APP_URL), 303);
}

export async function POST(request: Request) {
  const done = await unsubscribe(request);
  return done ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Länken är inte giltig." }, { status: 400 });
}
