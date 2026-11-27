import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { sendSystemEmail } from "@/lib/mail/mailer";
import { mailConfig } from "@/lib/mail/settings-server";
import { audienceRecipients, buildMailingEmail, processMailings, queueMailing, scheduleMailing, unsubscribeUrl, webVersionPath } from "@/lib/mail/mailings";
import { pendingReleaseNewsletter, readWeeklySettings } from "@/lib/mail/release-newsletter-server";
import { listDrafts, removeMailing } from "@/lib/mail/mailing-drafts";
import { nextWeeklySlot } from "@/lib/mail/release-newsletter";
import { currentAppVersion, releaseNoteFor } from "@/lib/release-notes";
import { formatSwedish, fromSwedishDateTimeInput } from "@/lib/swedish-time";
import { mailingDocumentSchema, mailingProblems } from "@/lib/mail/mailing-document";
import { SYSTEM_RETENTION } from "@/lib/workflow/system-cleanup";
import { publicInstance } from "@/lib/instance";
import { activeSubscriberCount } from "@/lib/mail/newsletter-subscribers";

export const dynamic = "force-dynamic";

// Utskick (2026-10-03): only the installation's superadmin writes and sends.
async function superadmin() {
  const ctx = await context();
  if (ctx.user.role !== "SUPERADMIN") throw new ApiError(403, "Bara installationens administratör kan göra det.");
  return ctx;
}

export async function GET() {
  try {
    await superadmin();
    const [newsletter, admins, mailings, config, weekly, release, drafts, subscribers] = await Promise.all([
      audienceRecipients("NEWSLETTER"), audienceRecipients("ADMINS"),
      // Drafts that wait for approval are listed apart (below); the history holds what is scheduled, sent or skipped.
      prisma.mailing.findMany({ where: { status: { not: "DRAFT" } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, subject: true, audience: true, status: true, createdAt: true, finishedAt: true, scheduledAt: true, releaseVersion: true, socialPostId: true } }),
      mailConfig(), readWeeklySettings(), pendingReleaseNewsletter(), listDrafts(),
      // Följ nyhetsbrevet (2026-11-12): only a count of the confirmed addresses from the landing page, never the list.
      activeSubscriberCount(),
    ]);
    const counts = await prisma.mailingRecipient.groupBy({ by: ["mailingId", "status"], where: { mailingId: { in: mailings.map((item) => item.id) } }, _count: { _all: true } });
    const countFor = (id: string, status: string) => counts.find((row) => row.mailingId === id && row.status === status)?._count._all ?? 0;
    return NextResponse.json({
      audiences: { NEWSLETTER: newsletter.length, ADMINS: admins.length },
      subscribers,
      blockedReason: config.blockedReason,
      keptMonths: SYSTEM_RETENTION.mailingsMonths,
      // Veckobrev (2026-10-06): the running version, what is new since the last newsletter and the weekly slot. Since
      // 2026-10-07 the slot only makes a draft; `drafts` are the ones waiting for the superadmin's approval.
      release: { current: currentAppVersion(), baseline: release.baseline, draft: release.draft },
      // Community (2026-11-10): no weekly letter; the page hides it.
      weekly: { available: publicInstance().features.releaseNewsletter, enabled: weekly.enabled, weekday: weekly.weekday, time: weekly.time, next: weekly.enabled ? nextWeeklySlot(weekly, new Date()).toISOString() : null },
      drafts: drafts.map((item) => ({ id: item.id, subject: item.subject, releaseVersion: item.releaseVersion, createdAt: item.createdAt.toISOString(), document: item.document })),
      mailings: mailings.map((item) => ({ ...item, webVersion: webVersionPath(item.id), sent: countFor(item.id, "SENT"), pending: countFor(item.id, "PENDING"), failed: countFor(item.id, "FAILED"), skipped: countFor(item.id, "SKIPPED") })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

// The mail as blocks (2026-10-03: "html-baserad med formulärseditorns egenskaper").
const input = z.object({
  action: z.enum(["test", "send", "schedule"]),
  audience: z.enum(["NEWSLETTER", "ADMINS"]),
  subject: z.string().trim().min(3, "Skriv ett ämne.").max(150),
  document: mailingDocumentSchema,
  /** Schemalägg: a datetime-local value read as Swedish time. */
  scheduledAt: z.string().max(40).optional(),
  /** The newest version whose notes the mailing carries (Skapa veckobrev). */
  releaseVersion: z.string().max(20).nullish().refine((value) => !value || Boolean(releaseNoteFor(value)), "Okänd version."),
});

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await superadmin();
    const command = input.parse(await body(request));
    const problems = mailingProblems(command.document);
    if (problems.length) throw new ApiError(400, problems[0]);
    const text = JSON.stringify(command.document);
    if (command.action === "test") {
      const config = await mailConfig();
      if (config.blockedReason) throw new ApiError(409, config.blockedReason);
      const mail = buildMailingEmail({ subject: command.subject, body: text, unsubscribe: command.audience === "NEWSLETTER" ? unsubscribeUrl(ctx.user.id) : null });
      try { await sendSystemEmail({ to: ctx.user.email, subject: `[Test] ${command.subject}`, ...mail }); }
      catch { throw new ApiError(502, "Testmejlet kunde inte skickas. Kontrollera inställningarna under E-post."); }
      return NextResponse.json({ ok: true, to: ctx.user.email });
    }
    const releaseVersion = command.audience === "NEWSLETTER" ? command.releaseVersion ?? null : null;
    if (command.action === "schedule") {
      const at = command.scheduledAt ? fromSwedishDateTimeInput(command.scheduledAt) : null;
      if (!at) throw new ApiError(400, "Välj dag och tid för utskicket.");
      if (at.getTime() < Date.now() + 60_000) throw new ApiError(400, "Välj en tid som inte har passerat.");
      if (at.getTime() > Date.now() + 365 * 86_400_000) throw new ApiError(400, "Välj en tid inom ett år.");
      const scheduled = await scheduleMailing({ subject: command.subject, body: text, audience: command.audience, actorId: ctx.user.id, scheduledAt: at, releaseVersion });
      await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "mailing_schedule",
        detail: `Schemalade utskicket ”${command.subject}” (${command.audience === "NEWSLETTER" ? "nyhetsbrev" : "viktig information"}) till ${formatSwedish(at, { dateStyle: "medium", timeStyle: "short" })}.` } });
      return NextResponse.json({ id: scheduled.id, scheduledAt: at.toISOString() });
    }
    let queued;
    try { queued = await queueMailing({ subject: command.subject, body: text, audience: command.audience, actorId: ctx.user.id, releaseVersion }); }
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

/** Removes a mailing and its recipient list from the history (they also go by themselves after 12 months). */
export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await superadmin();
    const id = new URL(request.url).searchParams.get("id") ?? "";
    // Never while it is being sent; a scheduled one is cancelled (only if it has not just been queued); a draft is
    // skipped in its own list (lib/mail/mailing-drafts.ts).
    const mailing = await removeMailing(id);
    await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "mailing_delete", detail: mailing.status === "SCHEDULED" ? `Avbröt det schemalagda utskicket ”${mailing.subject}”.` : `Tog bort utskicket ”${mailing.subject}” ur historiken.` } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
