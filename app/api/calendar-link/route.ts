import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { requireFreshAuth } from "@/lib/auth/fresh-auth";
import { createCalendarLink, removeCalendarLink, storedCalendarLink } from "@/lib/calendar/link-store";
import { absoluteUrl } from "@/lib/env";
import { ApiError, checkOrigin, context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { recordSecurityEvent } from "@/lib/security/security-log";

export const dynamic = "force-dynamic";

/**
 * The person's own calendar link under Mina inställningar (PL14, 2026-11-01): signed in, in a Cloud company, never through an API
 * or MCP key. The address is shown once, when it is made; only its hash is kept. A new link replaces the old one, which stops working at
 * once, and making one asks for a fresh sign-in like a key does. Taking one away needs nothing more than being signed in.
 */
const NO_STORE = { "Cache-Control": "no-store" };
async function caller() {
  const ctx = await context();
  requireCloudStorage(ctx);
  if (ctx.integration) throw new ApiError(403, "Kalenderlänken kan bara ändras inloggad i Workflow.");
  return ctx;
}

export async function GET() {
  try {
    const ctx = await caller();
    const link = await storedCalendarLink(ctx.user.id);
    return NextResponse.json({ link: link ? { createdAt: link.createdAt, thisCompany: link.organizationId === ctx.organizationId } : null }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await caller();
    await requireFreshAuth(ctx.user.id, ctx.auth);
    const now = new Date();
    const token = await createCalendarLink(ctx.user.id, ctx.organizationId, now);
    await recordSecurityEvent({ type: "calendar_link_created", userId: ctx.user.id, actorId: ctx.user.id, headers: await headers() });
    return NextResponse.json({ url: absoluteUrl(`/api/calendar/${token}.ics`), link: { createdAt: now.toISOString(), thisCompany: true } }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await caller();
    await removeCalendarLink(ctx.user.id);
    await recordSecurityEvent({ type: "calendar_link_removed", userId: ctx.user.id, actorId: ctx.user.id, headers: await headers() });
    return NextResponse.json({ link: null }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}
