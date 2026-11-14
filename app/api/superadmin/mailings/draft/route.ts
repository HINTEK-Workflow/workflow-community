import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { approveDraft, createDraft, dismissDraft, saveDraft } from "@/lib/mail/mailing-drafts";
import { mailingDocumentSchema } from "@/lib/mail/mailing-document";
import { processMailings } from "@/lib/mail/mailings";
import { createReleaseDraft } from "@/lib/mail/release-newsletter-server";
import { releaseNoteFor } from "@/lib/release-notes";
import { formatSwedish, fromSwedishDateTimeInput } from "@/lib/swedish-time";

export const dynamic = "force-dynamic";

/**
 * Veckobrev som utkast (2026-10-07): a newsletter is never sent by itself. A draft is written by the weekly job
 * or here, read by the superadmin and approved with "Godkänn och skicka" – the only thing that queues it. Only the
 * installation's superadmin, Origin checked on every call.
 */
async function superadmin() {
  const ctx = await context();
  if (ctx.user.role !== "SUPERADMIN") throw new ApiError(403, "Systemadministratör krävs.");
  return ctx;
}

const id = z.string().min(1).max(60);
const subject = z.string().trim().min(3, "Skriv ett ämne.").max(150);
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), subject, document: mailingDocumentSchema, releaseVersion: z.string().max(20).nullish().refine((value) => !value || Boolean(releaseNoteFor(value)), "Okänd version.") }),
  z.object({ action: z.literal("make") }),
  z.object({ action: z.literal("save"), id, subject, document: mailingDocumentSchema }),
  z.object({ action: z.literal("approve"), id, subject: subject.optional(), document: mailingDocumentSchema.optional(), scheduledAt: z.string().max(40).optional() }),
  z.object({ action: z.literal("dismiss"), id }),
]);

const WHY: Record<string, string> = {
  "nothing-new": "Det finns inga nya versionsnyheter att göra ett veckobrev av.",
  "draft-waiting": "Ett veckobrev väntar redan på godkännande.",
  "no-recipients": "Det finns inga mottagare: ingen har sagt ja till nyheter.",
  "no-superadmin": "Det finns ingen systemadministratör som kan stå för utkastet.",
};

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await superadmin();
    const input = command.parse(await body(request));
    const log = (action: string, detail: string) => prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action, detail } });
    if (input.action === "create") {
      const created = await createDraft({ subject: input.subject, document: input.document, actorId: ctx.user.id, releaseVersion: input.releaseVersion ?? null });
      await log("mailing_draft", `Sparade utkastet ”${input.subject}”.`);
      return NextResponse.json({ id: created.id });
    }
    if (input.action === "make") {
      const made = await createReleaseDraft({ actorId: ctx.user.id });
      if (!made.drafted) throw new ApiError(409, WHY[made.reason] ?? "Utkastet kunde inte göras.");
      await log("mailing_draft", `Gjorde ett veckobrevsutkast med versionsnyheterna till och med version ${made.version}.`);
      return NextResponse.json({ id: made.id, version: made.version });
    }
    if (input.action === "save") {
      await saveDraft({ id: input.id, subject: input.subject, document: input.document });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "dismiss") {
      const done = await dismissDraft(input.id);
      await log("mailing_dismiss", `Hoppade över utkastet ”${done.subject}”.`);
      return NextResponse.json({ ok: true });
    }
    // Godkänn och skicka (or schedule): the superadmin's explicit approval, with the edits made while reading it.
    let at: Date | null = null;
    if (input.scheduledAt) {
      at = fromSwedishDateTimeInput(input.scheduledAt);
      if (!at) throw new ApiError(400, "Välj dag och tid för utskicket.");
      if (at.getTime() < Date.now() + 60_000) throw new ApiError(400, "Välj en tid som inte har passerat.");
      if (at.getTime() > Date.now() + 365 * 86_400_000) throw new ApiError(400, "Välj en tid inom ett år.");
    }
    const approved = await approveDraft({ id: input.id, actorId: ctx.user.id, content: { subject: input.subject, document: input.document }, scheduledAt: at });
    await log("mailing_approve", at
      ? `Godkände veckobrevet ”${approved.subject}” och schemalade det till ${formatSwedish(at, { dateStyle: "medium", timeStyle: "short" })}.`
      : `Godkände veckobrevet ”${approved.subject}” och skickade det till ${approved.recipients} mottagare.`);
    // The first batch goes at once; the rest is worked off by the queue job every five minutes.
    if (!at) void processMailings().catch(() => undefined);
    return NextResponse.json({ id: approved.id, recipients: approved.recipients, scheduledAt: at?.toISOString() ?? null });
  } catch (error) {
    return failure(error);
  }
}
