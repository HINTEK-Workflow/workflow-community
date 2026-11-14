import { Prisma, type CompanyClosure } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isHintekOrganization } from "@/lib/branding";
import { absoluteUrl } from "@/lib/env";
import type { CloudAgreementState } from "@/lib/extensions/types";
import { publicInstance } from "@/lib/instance";
import { sendSystemEmail } from "@/lib/mail/mailer";
import { mailConfig } from "@/lib/mail/settings-server";
import { swedishDayKey } from "@/lib/swedish-time";
import type { TaskNotification } from "@/lib/workflow/task-notifications";
import {
  closureDateText, closureDueAt, closureExclusion, closureMailSubject, closureNoticeText, closureStep, DAY_0, ERASE_LIMIT_PER_RUN,
  postponeProblem, type ClosureCompany, type ClosureStep, type ReminderStage,
} from "./rule";

/**
 * Radering efter avslut (2026-10-10): the nightly job, the superadmin's list and the bell's notice. The rule is
 * in ./rule.ts. Every step is written to the company's administration history (notice sent, postponed, cancelled,
 * erased); erasure itself is lib/auth/erasure.ts eraseCompany, which keeps the accounting and the staff register as the
 * law requires and removes this countdown row with the company's other rows. Billing is reached only through
 * lib/extensions (`cloudAgreementState`); without ee/ it always says NOT_BILLING and nothing is ever erased.
 *
 * SAFETY: the job erases only while SystemSettings.autoEraseEndedCompanies is on (off by default; the superadmin turns
 * it on under Installation → Kundföretag after seeing the list). Off, it only counts down and notifies. At
 * most ERASE_LIMIT_PER_RUN companies per run, each checked again just before erasure.
 */
export const CLOSURE_ACTOR = "system:company-closure";
export const CLOSURE_ACTIONS = {
  notice: "company_closure_notice",
  postponed: "company_closure_postponed",
  cancelled: "company_closure_cancelled",
  erased: "company_closure_erased",
  failed: "company_closure_failed",
  switched: "company_closure_auto_erase",
} as const;

type AgreementFn = (organizationId: string, now: Date) => Promise<CloudAgreementState>;
type Mail = { to: string; subject: string; text: string; html: string };
export type ClosureDeps = {
  /** Billing's answer; defaults to lib/extensions (ee/ or none). */
  agreement?: AgreementFn;
  /** Sends one e-mail; defaults to the system mail (never from a loopback QA instance). Returns why nothing was sent, or null. */
  send?: (mail: Mail) => Promise<string | null>;
  erase?: (organizationId: string, actorId: string) => Promise<{ records: number; people: number; files: number }>;
};

async function defaultAgreement(organizationId: string, now: Date) {
  // Loaded on use so the module can be imported by the job without the route layer at start.
  const { serverExtensions } = await import("@/lib/extensions/server");
  return serverExtensions.cloudAgreementState(organizationId, now);
}

async function defaultSend(mail: Mail) {
  const config = await mailConfig();
  if (config.blockedReason) return config.blockedReason;
  await sendSystemEmail(mail);
  return null;
}

export async function autoEraseEnabled() {
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { autoEraseEndedCompanies: true } });
  return row?.autoEraseEndedCompanies === true;
}

/** "Automatisk radering påslagen" – only the superadmin, logged in the history of the superadmin's own company. */
export async function setAutoErase(input: { enabled: boolean; actorId: string; organizationId: string }) {
  await prisma.$transaction([
    prisma.systemSettings.upsert({ where: { id: "global" }, create: { id: "global", autoEraseEndedCompanies: input.enabled }, update: { autoEraseEndedCompanies: input.enabled } }),
    prisma.administrationEvent.create({ data: { actorId: input.actorId, organizationId: input.organizationId, action: CLOSURE_ACTIONS.switched,
      detail: input.enabled ? "Automatisk radering efter avslutat Cloud-avtal slogs på." : "Automatisk radering efter avslutat Cloud-avtal slogs av. Jobbet räknar ned och meddelar men raderar inget." } }),
  ]);
}

const companySelect = { id: true, name: true, slug: true, domain: true, storageMode: true, members: { where: { isActive: true, user: { role: "SUPERADMIN" } }, select: { userId: true }, take: 1 } } as const;
type CompanyRow = Prisma.OrganizationGetPayload<{ select: typeof companySelect }>;
const toCompany = (row: CompanyRow): ClosureCompany => ({
  id: row.id, name: row.name, slug: row.slug, domain: row.domain, storageMode: row.storageMode,
  hintek: isHintekOrganization(row), superadminMember: row.members.length > 0,
});

export type ClosureEvaluation = { company: ClosureCompany; row: CompanyClosure | null; agreement: CloudAgreementState | null; step: ClosureStep };

/**
 * Every company the job looks at: the Cloud companies and every company with a countdown. Billing is asked only for
 * those not excluded by the core's own rule.
 */
export async function evaluateClosures(now: Date, agreement: AgreementFn = defaultAgreement): Promise<ClosureEvaluation[]> {
  const rows = await prisma.companyClosure.findMany({ take: 5000 });
  const rowByCompany = new Map(rows.map((row) => [row.organizationId, row]));
  const companies = await prisma.organization.findMany({
    where: { OR: [{ storageMode: "HINTEK_CLOUD" }, { id: { in: [...rowByCompany.keys()] } }] },
    orderBy: { name: "asc" }, take: 5000, select: companySelect,
  });
  const result: ClosureEvaluation[] = [];
  for (const raw of companies) {
    const company = toCompany(raw);
    const row = rowByCompany.get(company.id) ?? null;
    const state = closureExclusion(company) ? null : await agreement(company.id, now);
    result.push({ company, row, agreement: state, step: closureStep({ company, agreement: state, row, now }) });
  }
  return result;
}

async function recipientsOf(organizationId: string) {
  const admins = await prisma.organizationMember.findMany({
    where: { organizationId, isActive: true, role: { in: ["OWNER", "ADMIN"] }, user: { isActive: true } },
    select: { userId: true, user: { select: { email: true } } },
  });
  return admins.map((item) => item.user.email);
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Bell and e-mail together: the bell shows the notice from the row; the e-mail goes to every owner and admin. */
async function mailNotice(organizationId: string, kind: "start" | ReminderStage, dueAt: Date, send: NonNullable<ClosureDeps["send"]>) {
  const to = await recipientsOf(organizationId);
  const link = absoluteUrl("/?view=company&section=billing");
  const lines = [closureNoticeText(dueAt), "Ett nytt Cloud-avtal före dess avbryter raderingen. Bokföringsunderlag och personalliggaren sparas så länge lagen kräver."];
  const text = `${lines.join("\n\n")}\n\nLadda ned en Cloud-kopia under Abonnemang:\n${link}`;
  const html = `${lines.map((line) => `<p>${escape(line)}</p>`).join("")}<p>Ladda ned en Cloud-kopia under <a href="${link}">Abonnemang</a>.</p>`;
  const subject = `[${publicInstance().name}] ${closureMailSubject(kind)}`;
  let sent = 0;
  let skipped: string | null = null;
  for (const address of to) {
    try {
      const reason = await send({ to: address, subject, text, html });
      if (reason) { skipped = reason; break; }
      sent++;
    } catch { skipped = "E-post kunde inte skickas."; }
  }
  return { recipients: to.length, sent, skipped };
}

const mailLine = (mail: { recipients: number; sent: number; skipped: string | null }) =>
  mail.recipients === 0 ? "Ingen ägare eller administratör att mejla; notisen visas i klockan."
    : mail.skipped && mail.sent === 0 ? `E-post skickades inte (${mail.skipped}); notisen visas i klockan.`
      : `E-post till ${mail.sent} av ${mail.recipients} ägare och administratörer${mail.skipped ? ` (${mail.skipped})` : ""}.`;

export type ErasurePreview = { members: number; anonymised: number; customers: number; projects: number; tasks: number; quotes: number; files: number; keptRegisterRows: number; keptInvoices: number };

/** What erasing the company would remove, as counts only (dry-run); never names or content. */
export async function erasurePreview(organizationId: string): Promise<ErasurePreview> {
  const members = await prisma.organizationMember.findMany({ where: { organizationId }, select: { userId: true, user: { select: { role: true } } } });
  let anonymised = 0;
  for (const member of members) {
    if (member.user.role === "SUPERADMIN") continue;
    if (!(await prisma.organizationMember.count({ where: { userId: member.userId, organizationId: { not: organizationId }, isActive: true } }))) anonymised++;
  }
  const [customers, projects, tasks, quotes, keptRegisterRows, keptInvoices, files] = await Promise.all([
    prisma.customer.count({ where: { organizationId } }),
    prisma.project.count({ where: { organizationId } }),
    prisma.workflowTask.count({ where: { organizationId } }),
    prisma.quote.count({ where: { organizationId } }),
    prisma.staffRegisterEvent.count({ where: { organizationId } }),
    prisma.$queryRaw<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM "CustomerInvoice" WHERE "organizationId" = ${organizationId}`.then((rows) => rows[0]?.count ?? 0),
    prisma.$queryRaw<{ count: bigint }[]>`SELECT (
      (SELECT count(*) FROM "Attachment" WHERE "organizationId" = ${organizationId}) +
      (SELECT count(*) FROM "WorkflowTaskAttachment" WHERE "organizationId" = ${organizationId}) +
      (SELECT count(*) FROM "ImportedFile" WHERE "organizationId" = ${organizationId}) +
      (SELECT count(*) FROM "GeneratedResult" WHERE "organizationId" = ${organizationId}) +
      (SELECT count(*) FROM "SelfInspectionCredentialFile" WHERE "organizationId" = ${organizationId}) +
      (SELECT count(*) FROM "SelfInspectionDeviationAttachment" WHERE "organizationId" = ${organizationId}) +
      (SELECT count(*) FROM "MachinePartImage" WHERE "organizationId" = ${organizationId}) +
      (SELECT count(*) FROM "ReportArchiveEntry" WHERE "organizationId" = ${organizationId})) AS count`.then((rows) => Number(rows[0]?.count ?? 0)),
  ]);
  return { members: members.length, anonymised, customers, projects, tasks, quotes, files, keptRegisterRows, keptInvoices };
}

export type ClosureRunReport = {
  dryRun: boolean;
  autoErase: boolean;
  started: string[];
  reminded: string[];
  cancelled: string[];
  due: string[];
  erased: string[];
  failed: string[];
  /** Due companies left for a later run because of the batch limit. */
  waiting: number;
};

/**
 * The nightly job. Idempotent: a countdown is created once (one row per company), each notice is claimed in the row
 * before it is mailed (never twice), and an erased company is renamed by eraseCompany and never looked at again.
 * `dryRun` writes and sends nothing and erases nothing; it returns what a real run would do.
 */
export async function runCompanyClosures(options: { now?: Date; dryRun?: boolean; limit?: number; deps?: ClosureDeps } = {}): Promise<ClosureRunReport> {
  const now = options.now ?? new Date();
  const agreement = options.deps?.agreement ?? defaultAgreement;
  const send = options.deps?.send ?? defaultSend;
  // Loaded on use: the bell route imports this module and never erases.
  const erase = options.deps?.erase ?? (async (organizationId: string, actorId: string) => (await import("@/lib/auth/erasure")).eraseCompany(organizationId, actorId));
  const limit = Math.max(0, Math.min(options.limit ?? ERASE_LIMIT_PER_RUN, ERASE_LIMIT_PER_RUN));
  const dryRun = options.dryRun === true;
  const report: ClosureRunReport = { dryRun, autoErase: await autoEraseEnabled(), started: [], reminded: [], cancelled: [], due: [], erased: [], failed: [], waiting: 0 };
  const evaluations = await evaluateClosures(now, agreement);

  for (const { company, row, step } of evaluations) {
    if (step.kind === "cancel" && row) {
      report.cancelled.push(company.id);
      if (dryRun) continue;
      const removed = await prisma.companyClosure.deleteMany({ where: { organizationId: company.id } });
      if (removed.count) await prisma.administrationEvent.create({ data: { actorId: CLOSURE_ACTOR, organizationId: company.id, action: CLOSURE_ACTIONS.cancelled,
        detail: `Radering efter avslut avbröts. ${step.reason}` } });
    } else if (step.kind === "start") {
      report.started.push(company.id);
      if (dryRun) continue;
      try {
        await prisma.companyClosure.create({ data: { organizationId: company.id, endedAt: step.endedAt, exportUntil: step.exportUntil, noticesSent: [DAY_0], firstNoticeAt: now } });
      } catch (error) {
        // Another run created it in the meantime: that run sends the notice.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") { report.started.pop(); continue; }
        throw error;
      }
      const mail = await mailNotice(company.id, "start", step.exportUntil, send);
      await prisma.administrationEvent.create({ data: { actorId: CLOSURE_ACTOR, organizationId: company.id, action: CLOSURE_ACTIONS.notice,
        detail: `Besked om radering efter avslut (dag 0): Cloud-avtalet upphörde ${swedishDayKey(step.endedAt)}; export fram till ${swedishDayKey(step.exportUntil)}, därefter raderas företagets data. ${mailLine(mail)}` } });
    } else if (step.kind === "remind" && row) {
      report.reminded.push(company.id);
      if (dryRun) continue;
      // Claimed in the row first, so a notice is never sent twice even if two runs overlap.
      const claimed = await prisma.companyClosure.updateMany({ where: { organizationId: company.id, NOT: { noticesSent: { has: step.key } } }, data: { noticesSent: { push: step.key } } });
      if (!claimed.count) { report.reminded.pop(); continue; }
      const mail = await mailNotice(company.id, step.stage, step.dueAt, send);
      await prisma.administrationEvent.create({ data: { actorId: CLOSURE_ACTOR, organizationId: company.id, action: CLOSURE_ACTIONS.notice,
        detail: `Påminnelse om radering efter avslut (${step.stage === "REMINDER_7" ? "en vecka kvar" : "dagen före"}): raderas efter ${swedishDayKey(step.dueAt)}. ${mailLine(mail)}` } });
    } else if (step.kind === "due" && row) {
      report.due.push(company.id);
    }
  }

  // Erasure: only with the switch on, at most `limit` per run, each one checked again just before.
  if (!report.autoErase || dryRun) return report;
  const dueIds = report.due;
  report.waiting = Math.max(0, dueIds.length - limit);
  for (const organizationId of dueIds.slice(0, limit)) {
    // The switch may have been turned off while the job ran.
    if (!(await autoEraseEnabled())) { report.waiting += 1; continue; }
    const raw = await prisma.organization.findUnique({ where: { id: organizationId }, select: companySelect });
    const row = await prisma.companyClosure.findUnique({ where: { organizationId } });
    if (!raw || !row) continue;
    const company = toCompany(raw);
    // Billing is asked again: an agreement renewed while the job ran stops the erasure.
    const fresh = closureExclusion(company) ? null : await agreement(organizationId, now);
    const step = closureStep({ company, agreement: fresh, row, now });
    if (step.kind !== "due") continue;
    const summary = `Cloud-avtalet upphörde ${swedishDayKey(row.endedAt)}, besked ${row.firstNoticeAt ? swedishDayKey(row.firstNoticeAt) : "–"}, påminnelser ${Math.max(0, row.noticesSent.length - 1)}, raderingsdatum ${swedishDayKey(closureDueAt(row))}${row.postponedUntil ? " (uppskjutet)" : ""}.`;
    try {
      const result = await erase(organizationId, CLOSURE_ACTOR);
      report.erased.push(organizationId);
      await prisma.administrationEvent.create({ data: { actorId: CLOSURE_ACTOR, organizationId, action: CLOSURE_ACTIONS.erased,
        detail: `Raderat automatiskt efter avslutat Cloud-avtal: ${result.records} poster, ${result.files} filer, ${result.people} personer anonymiserade. ${summary}` } });
    } catch (error) {
      report.failed.push(organizationId);
      await prisma.administrationEvent.create({ data: { actorId: CLOSURE_ACTOR, organizationId, action: CLOSURE_ACTIONS.failed,
        detail: `Automatisk radering efter avslut misslyckades och görs om nästa natt: ${error instanceof Error ? error.message.slice(0, 300) : "okänt fel"}` } });
    }
  }
  return report;
}

export type ClosureListItem = {
  organizationId: string;
  name: string;
  /** COUNTING – nedräkning; DUE – raderas (eller väntar på påslaget); STARTS – nedräkningen börjar nästa körning; CANCELS – avbryts nästa körning. */
  status: "COUNTING" | "DUE" | "STARTS" | "CANCELS";
  endedAt: string | null;
  firstNoticeAt: string | null;
  exportUntil: string | null;
  postponedUntil: string | null;
  postponeReason: string;
  dueAt: string | null;
  reminders: number;
  note: string;
};

/** Installation → Kundföretag → Radering efter avslut: the countdowns, the due companies and what starts next run. */
export async function closureOverview(now = new Date(), deps: Pick<ClosureDeps, "agreement"> = {}) {
  const evaluations = await evaluateClosures(now, deps.agreement ?? defaultAgreement);
  const items: ClosureListItem[] = evaluations.flatMap(({ company, row, step }): ClosureListItem[] => {
    if (step.kind === "none") return [];
    const base = { organizationId: company.id, name: company.name, postponeReason: row?.postponeReason ?? "", reminders: Math.max(0, (row?.noticesSent.length ?? 1) - 1),
      endedAt: row?.endedAt.toISOString() ?? null, firstNoticeAt: row?.firstNoticeAt?.toISOString() ?? null, exportUntil: row?.exportUntil.toISOString() ?? null,
      postponedUntil: row?.postponedUntil?.toISOString() ?? null, dueAt: row ? closureDueAt(row).toISOString() : null };
    if (step.kind === "start") return [{ ...base, status: "STARTS", endedAt: step.endedAt.toISOString(), exportUntil: step.exportUntil.toISOString(), dueAt: step.exportUntil.toISOString(),
      note: "Avtalet har upphört. Nedräkningen och första beskedet börjar vid nästa körning." }];
    if (step.kind === "cancel") return [{ ...base, status: "CANCELS", note: step.reason }];
    if (step.kind === "due") return [{ ...base, status: "DUE", note: "Exporttiden är slut. Raderas av jobbet när automatisk radering är påslagen." }];
    return [{ ...base, status: "COUNTING", note: `Raderas efter ${closureDateText(step.dueAt)}.` }];
  });
  return { autoErase: await autoEraseEnabled(), items };
}

/** Dry-run for the superadmin: what the next run would do, with counts of what each due company would lose. */
export async function closureDryRun(now = new Date(), deps: Pick<ClosureDeps, "agreement"> = {}) {
  const report = await runCompanyClosures({ now, dryRun: true, deps });
  const names = new Map((await prisma.organization.findMany({ where: { id: { in: [...report.started, ...report.reminded, ...report.cancelled, ...report.due] } }, select: { id: true, name: true } })).map((item) => [item.id, item.name]));
  const named = (ids: string[]) => ids.map((id) => ({ organizationId: id, name: names.get(id) ?? id }));
  const erase = [];
  for (const id of report.due.slice(0, ERASE_LIMIT_PER_RUN)) erase.push({ organizationId: id, name: names.get(id) ?? id, preview: await erasurePreview(id) });
  return {
    autoErase: report.autoErase, limit: ERASE_LIMIT_PER_RUN,
    erase, laterRuns: Math.max(0, report.due.length - ERASE_LIMIT_PER_RUN),
    start: named(report.started), remind: named(report.reminded), cancel: named(report.cancelled),
  };
}

/** Skjut upp: a later erasure date with a required reason, written to the company's administration history. */
export async function postponeClosure(input: { organizationId: string; until: Date | null; reason: string; actorId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const row = await prisma.companyClosure.findUnique({ where: { organizationId: input.organizationId } });
  if (!row) return { error: "Företaget har ingen pågående radering efter avslut." } as const;
  const problem = postponeProblem({ until: input.until, reason: input.reason, currentDueAt: closureDueAt(row), now });
  if (problem || !input.until) return { error: problem ?? "Ange ett giltigt datum." } as const;
  const reason = input.reason.trim().slice(0, 300);
  await prisma.$transaction([
    prisma.companyClosure.update({ where: { id: row.id }, data: { postponedUntil: input.until, postponeReason: reason } }),
    prisma.administrationEvent.create({ data: { actorId: input.actorId, organizationId: input.organizationId, action: CLOSURE_ACTIONS.postponed,
      detail: `Radering efter avslut uppskjuten från ${swedishDayKey(closureDueAt(row))} till ${swedishDayKey(input.until)}. Skäl: ${reason}` } }),
  ]);
  return { ok: true, dueAt: input.until.toISOString() } as const;
}

/** The bell's notice for the company's owners and admins while a countdown runs (after the day-0 notice). */
export async function closureNotification(organizationId: string, now = new Date()): Promise<TaskNotification | null> {
  const row = await prisma.companyClosure.findUnique({ where: { organizationId } });
  if (!row || !row.noticesSent.includes(DAY_0)) return null;
  const dueAt = closureDueAt(row);
  return {
    id: `CLOSURE:${organizationId}`, title: "Ert Cloud-avtal har upphört", kind: "CLOSURE",
    detail: closureNoticeText(dueAt, now), href: "/?view=company&section=billing",
    dueDate: swedishDayKey(dueAt), deadline: now >= dueAt ? "OVERDUE" : "DUE_SOON", needsAction: true,
  };
}
