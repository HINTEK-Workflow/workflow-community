import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { sendSystemEmail } from "@/lib/mail/mailer";
import { mailConfig } from "@/lib/mail/settings-server";
import { audienceRecipients, buildMailingEmail, processMailings, queueMailing, unsubscribeUrl } from "@/lib/mail/mailings";

export const dynamic = "force-dynamic";

// Utskick (2026-10-03): only the installation's superadmin writes and sends.
async function superadmin() {
  const ctx = await context();
  if (ctx.user.role !== "SUPERADMIN") throw new ApiError(403, "Systemadministratör krävs.");
  return ctx;
}

export async function GET() {
  try {
    await superadmin();
    const [newsletter, admins, mailings, config] = await Promise.all([
      audienceRecipients("NEWSLETTER"), audienceRecipients("ADMINS"),
      prisma.mailing.findMany({ orderBy: { createdAt: "desc" }, take: 20, select: { id: true, subject: true, audience: true, status: true, createdAt: true, finishedAt: true } }),
      mailConfig(),
    ]);
    const counts = await prisma.mailingRecipient.groupBy({ by: ["mailingId", "status"], where: { mailingId: { in: mailings.map((item) => item.id) } }, _count: { _all: true } });
    const countFor = (id: string, status: string) => counts.find((row) => row.mailingId === id && row.status === status)?._count._all ?? 0;
    return NextResponse.json({
      audiences: { NEWSLETTER: newsletter.length, ADMINS: admins.length },
      blockedReason: config.blockedReason,
      mailings: mailings.map((item) => ({ ...item, sent: countFor(item.id, "SENT"), pending: countFor(item.id, "PENDING"), failed: countFor(item.id, "FAILED"), skipped: countFor(item.id, "SKIPPED") })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

const input = z.object({
  action: z.enum(["test", "send"]),
  audience: z.enum(["NEWSLETTER", "ADMINS"]),
  subject: z.string().trim().min(3, "Skriv ett ämne.").max(150),
  body: z.string().trim().min(10, "Skriv texten.").max(20_000),
});

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await superadmin();
    const command = input.parse(await body(request));
    if (command.action === "test") {
      const config = await mailConfig();
      if (config.blockedReason) throw new ApiError(409, config.blockedReason);
      const mail = buildMailingEmail({ subject: command.subject, body: command.body, unsubscribe: command.audience === "NEWSLETTER" ? unsubscribeUrl(ctx.user.id) : null });
      try { await sendSystemEmail({ to: ctx.user.email, subject: `[Test] ${command.subject}`, ...mail }); }
      catch { throw new ApiError(502, "Testmejlet kunde inte skickas. Kontrollera inställningarna under E-post."); }
      return NextResponse.json({ ok: true, to: ctx.user.email });
    }
    let queued;
    try { queued = await queueMailing({ subject: command.subject, body: command.body, audience: command.audience, actorId: ctx.user.id }); }
    catch (error) { throw new ApiError(409, (error as Error).message); }
    await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "mailing_send",
      detail: `Skickade utskicket ”${command.subject}” (${command.audience === "NEWSLETTER" ? "nyhetsbrev" : "viktig information"}) till ${queued._count.recipients} mottagare.` } });
    // The first batch goes at once; the rest is worked off by the queue job every five minutes.
    void processMailings().catch(() => undefined);
    return NextResponse.json({ id: queued.id, recipients: queued._count.recipients });
  } catch (error) {
    return failure(error);
  }
}
