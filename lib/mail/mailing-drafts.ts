import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { audienceRecipients, recipientRows } from "@/lib/mail/mailings";
import { mailingDocumentSchema, mailingProblems, parseMailingBody, type MailingDocument } from "@/lib/mail/mailing-document";
import { draftNotice } from "@/lib/mail/release-newsletter";
import { rememberCoveredVersion } from "@/lib/mail/release-newsletter-server";
import type { TaskNotification } from "@/lib/workflow/task-notifications";

/**
 * Veckobrev som utkast (2026-10-07): a newsletter is never sent by itself. The weekly job (or the superadmin's
 * "Spara som utkast") writes a mailing with status DRAFT and no recipients; the superadmin gets a notice in the bell,
 * reads it and approves it. Approving is the only thing here that queues a mailing: the draft gets its recipients and
 * the status QUEUED (or SCHEDULED for a chosen time) in one transaction, claimed first so it can never be approved twice.
 */
export type DraftContent = { subject: string; document: MailingDocument };

export const DRAFT_SUBJECT = { min: 3, max: 150 } as const;

function assertContent(content: Partial<DraftContent>, options: { complete: boolean }) {
  if (content.subject !== undefined) {
    const subject = content.subject.trim();
    if (subject.length < DRAFT_SUBJECT.min) throw new ApiError(400, "Skriv ett ämne.");
    if (subject.length > DRAFT_SUBJECT.max) throw new ApiError(400, "Ämnet är för långt.");
  }
  if (content.document) {
    const parsed = mailingDocumentSchema.safeParse(content.document);
    if (!parsed.success) throw new ApiError(400, "Utskicket innehåller ogiltiga block.");
    const problems = options.complete ? mailingProblems(parsed.data) : [];
    if (problems.length) throw new ApiError(400, problems[0]);
  }
}

/** The drafts that wait for approval, newest first, with their content for reading and editing. */
export async function listDrafts(take = 5) {
  const rows = await prisma.mailing.findMany({
    where: { status: "DRAFT" }, orderBy: { createdAt: "desc" }, take,
    select: { id: true, subject: true, body: true, audience: true, releaseVersion: true, createdAt: true },
  });
  return rows.map((row) => ({ id: row.id, subject: row.subject, audience: row.audience, releaseVersion: row.releaseVersion, createdAt: row.createdAt, document: parseMailingBody(row.body) }));
}

/** A draft the superadmin saves by hand (newsletter only); nothing about it is sent. */
export async function createDraft(input: DraftContent & { actorId: string; releaseVersion?: string | null }) {
  assertContent(input, { complete: false });
  return prisma.mailing.create({
    data: { subject: input.subject.trim(), body: JSON.stringify(input.document), audience: "NEWSLETTER", status: "DRAFT", createdById: input.actorId, releaseVersion: input.releaseVersion ?? null },
    select: { id: true },
  });
}

/** Saves the edits of a draft that still waits; an approved or skipped draft cannot be changed. */
export async function saveDraft(input: DraftContent & { id: string }) {
  assertContent(input, { complete: false });
  const saved = await prisma.mailing.updateMany({ where: { id: input.id, status: "DRAFT" }, data: { subject: input.subject.trim(), body: JSON.stringify(input.document) } });
  if (!saved.count) throw new ApiError(409, "Utkastet finns inte längre eller är redan hanterat.");
}

/**
 * Godkänn och skicka: the draft (with the edits the superadmin made while reading it) is queued for its recipients of
 * this moment, or – with `scheduledAt` – scheduled for that time, and who approved it and when is kept. Two approvals of
 * the same draft cannot both succeed: the status is claimed inside the transaction.
 */
export async function approveDraft(input: { id: string; actorId: string; content?: Partial<DraftContent>; scheduledAt?: Date | null }, now = new Date()) {
  const draft = await prisma.mailing.findUnique({ where: { id: input.id }, select: { id: true, status: true, audience: true, subject: true, body: true } });
  if (!draft || draft.status !== "DRAFT") throw new ApiError(409, "Utkastet finns inte längre eller är redan hanterat.");
  const subject = (input.content?.subject ?? draft.subject).trim();
  const document = input.content?.document ?? parseMailingBody(draft.body);
  assertContent({ subject, document }, { complete: true });
  const recipients = input.scheduledAt ? [] : await audienceRecipients(draft.audience);
  if (!input.scheduledAt && !recipients.length) throw new ApiError(409, "Det finns inga mottagare för det här utskicket.");
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.mailing.updateMany({
      where: { id: draft.id, status: "DRAFT" },
      data: { status: input.scheduledAt ? "SCHEDULED" : "QUEUED", scheduledAt: input.scheduledAt ?? null, subject, body: JSON.stringify(document), approvedById: input.actorId, approvedAt: now },
    });
    if (!claimed.count) throw new ApiError(409, "Utkastet är redan godkänt eller borttaget.");
    if (recipients.length) await tx.mailingRecipient.createMany({ data: recipientRows(recipients).map((row) => ({ ...row, mailingId: draft.id })), skipDuplicates: true });
    return { id: draft.id, subject, recipients: recipients.length, scheduled: Boolean(input.scheduledAt) };
  });
}

/**
 * Hoppa över: the draft is not sent. A veckobrev draft is kept as skipped (without recipients) so the same version notes
 * are not drafted again; a draft saved by hand without a version is simply removed.
 */
export async function dismissDraft(id: string) {
  const draft = await prisma.mailing.findUnique({ where: { id }, select: { status: true, releaseVersion: true, subject: true } });
  if (!draft || draft.status !== "DRAFT") throw new ApiError(409, "Utkastet finns inte längre eller är redan hanterat.");
  const done = draft.releaseVersion
    ? await prisma.mailing.updateMany({ where: { id, status: "DRAFT" }, data: { status: "DISMISSED", finishedAt: new Date() } })
    : await prisma.mailing.deleteMany({ where: { id, status: "DRAFT" } });
  if (!done.count) throw new ApiError(409, "Utkastet är redan hanterat.");
  return { subject: draft.subject, kept: Boolean(draft.releaseVersion) };
}

/**
 * Removes a mailing from the history (a scheduled one is cancelled). A draft is skipped instead (dismissDraft), a skipped
 * one goes by itself after twelve months, and one that is being sent stays until it is done. A newsletter that was sent
 * keeps its version counted as told, so removing it never makes the same notes drafted again.
 */
export async function removeMailing(id: string) {
  const mailing = await prisma.mailing.findUnique({ where: { id }, select: { subject: true, status: true, releaseVersion: true } });
  if (!mailing) throw new ApiError(404, "Utskicket finns inte.");
  if (mailing.status === "DRAFT") throw new ApiError(409, "Ett utkast hoppas över i listan över utkast som väntar på godkännande.");
  if (mailing.status === "DISMISSED") throw new ApiError(409, "Ett överhoppat utkast tas bort av sig självt efter tolv månader.");
  if (mailing.status === "QUEUED") throw new ApiError(409, "Utskicket skickas fortfarande. Ta bort det när det är klart.");
  if (mailing.status === "SENT" && mailing.releaseVersion) await rememberCoveredVersion(mailing.releaseVersion);
  // Only if it has not changed status meanwhile (a scheduled one may just have been queued).
  const removed = await prisma.mailing.deleteMany({ where: { id, status: mailing.status } });
  if (!removed.count) throw new ApiError(409, "Utskicket skickas fortfarande. Ta bort det när det är klart.");
  return mailing;
}

/** The bell's notice for the superadmin while a veckobrev draft waits; null when none does. */
export async function waitingDraftNotice(): Promise<TaskNotification | null> {
  const draft = await prisma.mailing.findFirst({ where: { status: "DRAFT", audience: "NEWSLETTER" }, orderBy: { createdAt: "desc" }, select: { id: true, subject: true, createdAt: true } });
  return draft ? draftNotice(draft) : null;
}
