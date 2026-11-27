import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { organizationModuleOn } from "@/lib/workflow/modules";
import { absoluteUrl } from "@/lib/env";
import { ApiError } from "@/lib/kfid/errors";
import { todayInSweden } from "@/lib/catalogue/snapshot";
import { sendSystemEmail } from "@/lib/mail/mailer";
import { mailConfig } from "@/lib/mail/settings-server";
import { buildQuoteLinkEmail } from "@/lib/mail/templates";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import { swedishDayKey } from "@/lib/swedish-time";
import { acceptanceStatement, DEFAULT_QUOTE_ACCEPTANCE_METHOD, QuoteAcceptanceError, quoteAcceptanceMethod } from "./acceptance";
import {
  canAnswerQuoteLink, customerAnswerSchema, decisionStatus, publicQuoteView, quoteLinkPath, quoteLinkState, quoteLinkStateText, sendQuoteLinkSchema, showsQuoteContents,
  type PublicQuotePage, type QuoteContent, type QuoteDecision, type QuoteLinkState,
} from "./customer-link";
import { createQuoteLinkToken, hashQuoteLinkToken, quoteContentHash } from "./customer-link-token";
import { effectiveQuoteStatus, placeAddress, numberText, QUOTE_VAT_PERCENT, quoteActionError, quoteLabel, quoteReverseVatOf, quoteRotOf, readLineCatalogue, quoteSendIssues, quoteTotals, quoteVersionDiff, type QuoteCustomerType, type QuoteLineKind, type QuoteLineView } from "./model";
import { createQuotePdf, type QuotePdfQuote } from "./quote-report";
import { workflowReportFont, workflowReportIdentity } from "@/lib/workflow/report-server";
import { parseQuoteNoticeKey, QUOTE_NOTICE_CHANNEL, QUOTE_NOTICE_LIMIT, quoteAnswerNotifications, quoteNoticeKey, quoteNoticeKeyPrefix, quoteNoticeRecipients } from "./quote-notice";
import { customerSnapshotData, quoteAccess, requireQuotes, sentCustomerDetails, type QuoteCaller } from "./server";

/**
 * Offert per e-post, steg E (2026-10-09) on the server.
 * - "Skicka till kund" (Offerter – redigera, Cloud): a draft is sent (locked) and gets a link, a sent quote that is still
 *   valid gets a new link that replaces the earlier ones. The token is random (32 bytes); only its sha256 is stored, with
 *   the quote version and the fingerprint of what the customer sees. The e-mail carries the link only. On a loopback
 *   test instance e-mail is never sent (lib/mail/settings.ts) – the link is returned to the page instead, to try it.
 * - The customer page reads the link (no login): the token resolves to exactly one link, and through its composite key
 *   to one quote of one company. Only the allow-listed customer view leaves the server (publicQuoteView).
 * - The customer's answer: accept with the link's method (lib/quotes/acceptance.ts) or decline with an optional reason,
 *   once. The link is marked used, the quote moves from Skickad to Accepterad or Avböjd, the answer is stored with time,
 *   IP address and browser, and the sender, the author and the admins get an unread notice.
 * Public reads and answers are rate-limited per IP address (and per link for answers), in the database.
 */

const lineSelect = { kind: true, name: true, quantity: true, unit: true, unitPrice: true, markupPercent: true, rotLabour: true, catalogue: true } as const;
const lineOrder = [{ position: "asc" as const }, { id: "asc" as const }];
const decimal = (value: Prisma.Decimal | null) => value === null ? null : Number(value.toString());

type ContentRow = {
  number: number; version: number; title: string; description: string; validUntil: string; terms: string; vatPercent: Prisma.Decimal;
  customerType: string; rotEnabled: boolean; rotPercent: Prisma.Decimal | null; rotCap: Prisma.Decimal | null; changeOfVersion: number | null;
  lines: { kind: string; name: string; quantity: Prisma.Decimal; unit: string; unitPrice: Prisma.Decimal | null; markupPercent: Prisma.Decimal | null; rotLabour: boolean; catalogue?: unknown }[];
};
const contentLines = (lines: ContentRow["lines"]) => lines.map((line) => ({ kind: line.kind as QuoteLineKind, name: line.name, quantity: decimal(line.quantity) ?? 0, unit: line.unit, unitPrice: decimal(line.unitPrice), markupPercent: decimal(line.markupPercent), rotLabour: line.rotLabour }));
/** The stored quote as the pure rules read it (numbers, not Decimals). */
export function quoteContentOf(row: ContentRow): QuoteContent {
  // Omvänd byggmoms (2026-11-01): kept with the lines; part of what the customer sees only when the quote has it.
  const reverse = quoteReverseVatOf(row.lines.map((line) => readLineCatalogue(line.catalogue)));
  return {
    ...(reverse ? { reverseVat: true, buyerVatNumber: reverse.buyerVatNumber } : {}),
    number: row.number, version: row.version, title: row.title, description: row.description, validUntil: row.validUntil, terms: row.terms,
    vatPercent: decimal(row.vatPercent) ?? QUOTE_VAT_PERCENT, customerType: (row.customerType === "PRIVATE" ? "PRIVATE" : "COMPANY") as QuoteCustomerType,
    rotEnabled: row.rotEnabled, rotPercent: decimal(row.rotPercent), rotCap: decimal(row.rotCap), changeOfVersion: row.changeOfVersion,
    lines: contentLines(row.lines),
  };
}

/** The company's name and contact address as on its reports (Inställningar), falling back to the company's name. */
async function companyIdentity(organizationId: string, fallbackName: string) {
  const settings = await prisma.workspaceSettings.findUnique({ where: { organizationId }, select: { companyName: true, contactEmail: true } });
  return { name: settings?.companyName || fallbackName, email: settings?.contactEmail ?? "" };
}

// ---------- sending ----------

export type QuoteLinkSender = { id: string; name: string | null; email: string };
export type QuoteLinkMail = { to: string; subject: string; html: string; text: string; headers?: Record<string, string> };
export type SendQuoteLinkDeps = {
  /** The real e-mail by default; tests pass their own. */
  send?: (mail: QuoteLinkMail) => Promise<unknown>;
  /** The mail settings' block (a loopback test instance never sends); read from the settings by default. */
  blockedReason?: string | null;
  now?: Date;
  today?: string;
};
export type SendQuoteLinkResult = { ok: true; status: "SENT"; email: string; sentAt: string; validUntil: string; testUrl?: string; notice?: string };

const STALE = "Offerten har ändrats av någon annan. Läs in den senaste versionen.";

export async function sendQuoteLink(caller: QuoteCaller, sender: QuoteLinkSender, id: string, revision: number | undefined, raw: unknown, deps: SendQuoteLinkDeps = {}): Promise<SendQuoteLinkResult> {
  requireQuotes(caller, "edit");
  const input = sendQuoteLinkSchema.parse(raw);
  const now = deps.now ?? new Date();
  const today = deps.today ?? todayInSweden();
  const blockedReason = deps.blockedReason !== undefined ? deps.blockedReason : (await mailConfig()).blockedReason;
  if (!(await hitRateLimit(RATE_RULES.quoteSendOrganization, caller.organizationId)).allowed) throw new ApiError(429, "Företaget har skickat många offerter den senaste timmen. Vänta en stund.");
  if (!(await hitRateLimit(RATE_RULES.quoteSendQuote, `${caller.organizationId}:${id}`)).allowed) throw new ApiError(429, "Offerten har skickats flera gånger nyss. Vänta en stund innan du skickar igen.");

  const token = createQuoteLinkToken();
  const tokenHash = hashQuoteLinkToken(token)!;
  const sent = await prisma.$transaction(async (tx) => {
    const row = await tx.quote.findFirst({
      where: { id, organizationId: caller.organizationId },
      include: { lines: { orderBy: lineOrder, select: lineSelect }, organization: { select: { name: true } }, customer: { select: { name: true, company: true, customerType: true, address: true, postalCode: true, city: true } } },
    });
    if (!row) throw new ApiError(404, "Offerten hittades inte.");
    const superseded = Boolean(row.supersededAt);
    const wasDraft = row.status === "DRAFT";
    if (wasDraft) {
      const error = quoteActionError({ status: row.status, validUntil: row.validUntil, superseded }, "send", today);
      if (error) throw new ApiError(409, error);
      const issues = quoteSendIssues({ lines: contentLines(row.lines), validUntil: row.validUntil, vatPercent: decimal(row.vatPercent) ?? QUOTE_VAT_PERCENT, customerType: row.customerType, rotEnabled: row.rotEnabled, rotPercent: decimal(row.rotPercent), rotCap: decimal(row.rotCap) }, today);
      if (issues.length) throw new ApiError(422, issues.join(" "));
      if (revision !== undefined && revision !== row.revision) throw new ApiError(409, STALE);
      // Sending takes the customer's snapshot (plan 1D): the quote shows the customer as it was when sent, for ever.
      const changed = await tx.quote.updateMany({
        where: { id, organizationId: caller.organizationId, status: "DRAFT", revision: row.revision },
        data: { status: "SENT", sentAt: now, sentById: sender.id, updatedById: sender.id, revision: { increment: 1 }, ...customerSnapshotData(row.customer) },
      });
      if (!changed.count) throw new ApiError(409, STALE);
    } else {
      // A sent quote that can still be answered gets a new link; a decided, expired or replaced one cannot.
      const error = quoteActionError({ status: row.status, validUntil: row.validUntil, superseded }, "accept", today);
      if (error) throw new ApiError(409, row.status === "SENT" || superseded ? error : "Offerten är redan besvarad och skickas inte igen.");
    }
    const content = quoteContentOf(row);
    // The earlier links of this quote stop working: only the newest e-mail's link can be answered.
    await tx.quoteLink.updateMany({ where: { organizationId: caller.organizationId, quoteId: id, revokedAt: null, usedAt: null }, data: { revokedAt: now } });
    const link = await tx.quoteLink.create({
      data: {
        organizationId: caller.organizationId, quoteId: id, tokenHash, quoteVersion: row.version, contentHash: quoteContentHash(content),
        acceptanceMethod: DEFAULT_QUOTE_ACCEPTANCE_METHOD, email: input.email, validUntil: row.validUntil, sentById: sender.id, sentAt: now,
      },
      select: { id: true },
    });
    return { linkId: link.id, wasDraft, label: quoteLabel(row), title: row.title, validUntil: row.validUntil, organizationName: row.organization.name };
  });

  const url = absoluteUrl(quoteLinkPath(token));
  if (!blockedReason) {
    const company = await companyIdentity(caller.organizationId, sent.organizationName);
    const mail = buildQuoteLinkEmail({ company: company.name, senderName: sender.name?.trim() ?? "", label: sent.label, title: sent.title, message: input.message, quoteUrl: url, validUntil: sent.validUntil });
    try {
      await (deps.send ?? sendSystemEmail)({
        to: input.email, subject: `Offert ${sent.label} från ${company.name}: ${sent.title}`.replace(/[\r\n]+/g, " ").slice(0, 200), ...mail,
        // A reply goes to the person who sent it, not to the system address.
        ...(sender.email ? { headers: { "Reply-To": sender.email } } : {}),
      });
    } catch {
      await prisma.quoteLink.updateMany({ where: { id: sent.linkId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new ApiError(502, sent.wasDraft ? "Offerten är markerad som skickad, men e-posten gick inte iväg. Försök igen med Skicka till kund." : "E-posten gick inte iväg. Försök igen.");
    }
  }
  await prisma.administrationEvent.create({ data: { actorId: sender.id, organizationId: caller.organizationId, action: "quote_link_sent", detail: `Skickade offert ${sent.label} till ${input.email}`.slice(0, 500) } });
  return {
    ok: true, status: "SENT", email: input.email, sentAt: now.toISOString(), validUntil: sent.validUntil,
    // A loopback test instance: no e-mail, the link is shown to the tester instead.
    ...(blockedReason ? { testUrl: url, notice: blockedReason } : {}),
  };
}

// ---------- the customer page ----------

async function loadLink(token: unknown) {
  const tokenHash = hashQuoteLinkToken(token);
  if (!tokenHash) return null;
  return prisma.quoteLink.findUnique({
    where: { tokenHash },
    include: {
      organization: { select: { name: true, isActive: true, storageMode: true, disabledModules: true } },
      // The composite key [quoteId, organizationId]: the link's quote is always the link's company's.
      quote: {
        include: {
          lines: { orderBy: lineOrder, select: lineSelect },
          customer: { select: { name: true, company: true, customerType: true, address: true, postalCode: true, city: true } },
          facility: { select: { name: true, address: true, postalCode: true, city: true } },
          // The project's name is on the company's PDF (plan 1D: the customer's download is the same document).
          project: { select: { name: true } },
          response: { select: { decision: true, linkId: true, signerName: true, createdAt: true } },
        },
      },
    },
  });
}
type FoundLink = NonNullable<Awaited<ReturnType<typeof loadLink>>>;

function stateOf(found: FoundLink | null, today: string): QuoteLinkState {
  if (!found || !found.organization.isActive || found.organization.storageMode !== "HINTEK_CLOUD") return "invalid";
  const { quote } = found;
  return quoteLinkState({
    link: found,
    quote: { status: quote.status, version: quote.version, validUntil: quote.validUntil, superseded: Boolean(quote.supersededAt) },
    response: quote.response ? { decision: quote.response.decision, viaThisLink: quote.response.linkId === found.id } : null,
    contentHash: quoteContentHash(quoteContentOf(quote)),
    today,
  });
}

const INVALID: PublicQuotePage = { state: "invalid", message: quoteLinkStateText("invalid", { company: "", validUntil: "" }), company: "", label: "", quote: null, answer: null, method: null };

async function pageOf(found: FoundLink | null, state: QuoteLinkState): Promise<PublicQuotePage> {
  if (!found || state === "invalid") return INVALID;
  const { quote } = found;
  const company = await companyIdentity(found.organizationId, found.organization.name);
  const label = quoteLabel(quote);
  const answered = quote.response && quote.response.linkId === found.id ? quote.response : null;
  const answeredAt = answered ? swedishDayKey(answered.createdAt) : undefined;
  let view: PublicQuotePage["quote"] = null;
  if (showsQuoteContents(state)) {
    const [base, sender] = await Promise.all([
      quote.changeOfVersion ? prisma.quote.findFirst({ where: { organizationId: found.organizationId, number: quote.number, version: quote.changeOfVersion }, select: { lines: { orderBy: lineOrder, select: lineSelect } } }) : null,
      found.sentById ? prisma.organizationMember.findFirst({ where: { organizationId: found.organizationId, userId: found.sentById }, select: { user: { select: { name: true } } } }) : null,
    ]);
    // The customer as it was when the quote was sent (plan 1D), else the register for an older quote. Only the customer's
    // own name, contact person and address (2026-10-10), never notes, e-mail or phone.
    const customer = sentCustomerDetails(quote, quote.customer);
    view = publicQuoteView({
      quote: { ...quoteContentOf(quote), sentAt: quote.sentAt },
      baseLines: base ? contentLines(base.lines) : null,
      customerName: customer.name,
      placeName: quote.facility?.name ?? "",
      customerContact: customer.contactName, customerAddress: customer.address,
      company, senderName: sender?.user.name ?? "",
    });
  }
  const method = state === "open" ? quoteAcceptanceMethod(found.acceptanceMethod) : null;
  return {
    state, message: quoteLinkStateText(state, { company: company.name, validUntil: quote.validUntil, answeredAt }),
    company: company.name, label, quote: view,
    answer: answered ? { decision: answered.decision, name: answered.signerName, date: swedishDayKey(answered.createdAt) } : null,
    method: method ? { id: method.id, kind: method.kind, statement: acceptanceStatement({ label, title: quote.title, company: company.name }) } : null,
  };
}

export type PublicRequestMeta = { ip: string; userAgent?: string };

/** The customer page: the quote behind the link, as the customer may see it. Rate-limited per IP address. */
export async function readQuoteByToken(token: unknown, meta: PublicRequestMeta, options: { now?: Date; today?: string } = {}): Promise<PublicQuotePage> {
  if (!(await hitRateLimit(RATE_RULES.quoteLinkRead, meta.ip)).allowed) throw new ApiError(429, "För många försök. Vänta en stund och försök igen.");
  const found = await loadLink(token);
  const state = stateOf(found, options.today ?? todayInSweden());
  // The first time an open link is read: the company sees that the customer opened it.
  if (found && state === "open" && !found.openedAt) await prisma.quoteLink.updateMany({ where: { id: found.id, openedAt: null }, data: { openedAt: options.now ?? new Date() } });
  return pageOf(found, state);
}

/**
 * "Ladda ner som PDF" on the customer's page (plan 1D, 2026-10-11): the same PDF the company sends, drawn with
 * the company's report identity from the version the link was sent for and the customer snapshot taken then. Reached
 * only through a link in a state that shows the quote (the same checks as the page: hash, version, contents, validity);
 * rate-limited per IP address like the page, and every download is logged for the company as a viewing of the link.
 * The PDF prints selling prices only (lib/quotes/quote-report.ts); the purchase price and markup never leave the server.
 */
export async function quotePdfByToken(token: unknown, meta: PublicRequestMeta, options: { now?: Date; today?: string } = {}): Promise<{ bytes: Uint8Array; fileName: string }> {
  if (!(await hitRateLimit(RATE_RULES.quoteLinkRead, meta.ip)).allowed) throw new ApiError(429, "För många försök. Vänta en stund och försök igen.");
  const found = await loadLink(token);
  const state = stateOf(found, options.today ?? todayInSweden());
  if (!found || !showsQuoteContents(state)) throw new ApiError(404, quoteLinkStateText(state === "invalid" ? "invalid" : state, { company: found?.organization.name ?? "", validUntil: found?.quote.validUntil ?? "" }) || INVALID.message);
  const { quote } = found;
  const now = options.now ?? new Date();
  const [identity, fontBytes, base] = await Promise.all([
    workflowReportIdentity(found.organizationId, found.organization.name), workflowReportFont(),
    quote.changeOfVersion ? prisma.quote.findFirst({ where: { organizationId: found.organizationId, number: quote.number, version: quote.changeOfVersion }, select: { lines: { orderBy: lineOrder, select: lineSelect } } }) : null,
  ]);
  const customer = sentCustomerDetails(quote, quote.customer);
  const content = quoteContentOf(quote);
  const lines: QuoteLineView[] = quote.lines.map((line, index) => ({ id: String(index), kind: line.kind as QuoteLineKind, name: line.name, quantity: numberText(line.quantity), unit: line.unit, unitPrice: numberText(line.unitPrice), markupPercent: numberText(line.markupPercent), ...(line.rotLabour ? { rotLabour: true } : {}) }));
  const label = quoteLabel(quote);
  const pdf: QuotePdfQuote = {
    label, title: quote.title, description: quote.description, status: effectiveQuoteStatus({ status: quote.status, validUntil: quote.validUntil }, options.today ?? todayInSweden()), storedStatus: quote.status,
    validUntil: quote.validUntil, terms: quote.terms, customerType: content.customerType, rotPercent: content.rotPercent, changeOfVersion: quote.changeOfVersion,
    reverseVat: content.reverseVat, buyerVatNumber: content.buyerVatNumber,
    change: base ? quoteVersionDiff(contentLines(base.lines), content.lines) : null,
    customer: customer.name || customer.contactName || customer.address ? { id: "", ...customer } : null,
    facility: quote.facility ? { id: "", name: quote.facility.name, address: placeAddress(quote.facility) } : null, project: quote.project ? { id: "", name: quote.project.name } : null,
    lines, totals: quoteTotals(content.lines, content.vatPercent, quoteRotOf(content)), sentAt: quote.sentAt?.toISOString() ?? null,
  };
  const bytes = await createQuotePdf({ identity, fontBytes, quote: pdf });
  // Logged as a viewing: the first open marks the link, and every download is written to the company's history.
  if (state === "open" && !found.openedAt) await prisma.quoteLink.updateMany({ where: { id: found.id, openedAt: null }, data: { openedAt: now } });
  await prisma.administrationEvent.create({ data: { actorId: found.sentById ?? quote.createdById ?? "", organizationId: found.organizationId, action: "quote_link_pdf", detail: `Kunden laddade ner offert ${label} som PDF via länken.`.slice(0, 500), createdAt: now } });
  const fileName = `offert-${label.replace(/\s+/g, "-")}-${quote.title}`.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").slice(0, 120);
  return { bytes, fileName: `${fileName}.pdf` };
}

const uniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
const ALREADY = "Offerten är redan besvarad.";
const oneLine = (value: string, max: number) => value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max);

/**
 * The customer's answer through the link: once, only while the link is open. Accepting needs the link's method (name +
 * tick box for "simple"); declining takes an optional reason. Everything is written in one transaction: the link is
 * used, the quote moves from Skickad, the answer is stored and the notices are made – or nothing is.
 */
export async function answerQuoteByToken(raw: unknown, meta: PublicRequestMeta, options: { now?: Date; today?: string } = {}): Promise<PublicQuotePage> {
  if (!(await hitRateLimit(RATE_RULES.quoteAnswerIp, meta.ip)).allowed) throw new ApiError(429, "För många försök. Vänta en stund och försök igen.");
  const input = customerAnswerSchema.parse(raw);
  if (!(await hitRateLimit(RATE_RULES.quoteAnswerLink, hashQuoteLinkToken(input.token)!)).allowed) throw new ApiError(429, "För många försök. Vänta en stund och försök igen.");
  const now = options.now ?? new Date();
  const today = options.today ?? todayInSweden();
  const found = await loadLink(input.token);
  const state = stateOf(found, today);
  if (!found || state === "invalid") throw new ApiError(404, INVALID.message);
  const { quote } = found;
  const company = await companyIdentity(found.organizationId, found.organization.name);
  if (!canAnswerQuoteLink(state)) throw new ApiError(409, quoteLinkStateText(state, { company: company.name, validUntil: quote.validUntil }));
  // Företagets moduler (0.39.0): with Offerter off nobody can answer, and the customer is told whom to ask, nothing about the company's settings.
  if (!organizationModuleOn(found.organization, "quotes")) throw new ApiError(409, `Offerten kan inte besvaras här just nu. Kontakta ${company.name}.`);
  // The customer may answer a quote already sent even when the company's Cloud is closed for writing because of an
  // unpaid Workflow invoice (2026-10-10: a failed card payment must not punish the company's customer). The company
  // itself still cannot send new quotes while closed.

  const decision: QuoteDecision = input.decision === "accept" ? "ACCEPTED" : "DECLINED";
  let signerName = "", evidence: Record<string, string> = {}, reason = "";
  if (input.decision === "accept") {
    const method = quoteAcceptanceMethod(found.acceptanceMethod);
    if (!method || method.kind !== "form") throw new ApiError(409, `Offerten kan inte accepteras här. Kontakta ${company.name}.`);
    try {
      ({ signerName, evidence } = await method.verify({ name: input.name, agree: input.agree }, { label: quoteLabel(quote), title: quote.title, company: company.name }));
    } catch (error) {
      if (error instanceof QuoteAcceptanceError) throw new ApiError(422, error.message);
      throw error;
    }
  } else {
    signerName = oneLine(input.name, 120);
    reason = input.reason.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").trim().slice(0, 1000);
  }

  try {
    await prisma.$transaction(async (tx) => {
      const used = await tx.quoteLink.updateMany({ where: { id: found.id, organizationId: found.organizationId, usedAt: null, revokedAt: null }, data: { usedAt: now } });
      if (!used.count) throw new ApiError(409, ALREADY);
      const moved = await tx.quote.updateMany({
        where: { id: quote.id, organizationId: found.organizationId, status: "SENT", supersededAt: null, version: found.quoteVersion },
        data: { status: decisionStatus(decision), decidedAt: now, decidedById: null, revision: { increment: 1 } },
      });
      if (!moved.count) throw new ApiError(409, ALREADY);
      await tx.quoteResponse.create({ data: {
        organizationId: found.organizationId, quoteId: quote.id, linkId: found.id, decision, acceptanceMethod: found.acceptanceMethod,
        signerName, reason, evidence, quoteVersion: found.quoteVersion, contentHash: found.contentHash,
        ipAddress: meta.ip.slice(0, 100), userAgent: (meta.userAgent ?? "").slice(0, 500), createdAt: now,
      } });
      // The sender, the author and the admins – active members of this company only.
      const members = await tx.organizationMember.findMany({ where: { organizationId: found.organizationId, isActive: true }, select: { userId: true, role: true } });
      const recipients = quoteNoticeRecipients({
        sentById: found.sentById, createdById: quote.createdById,
        adminIds: members.filter((member) => member.role === "OWNER" || member.role === "ADMIN").map((member) => member.userId),
        activeMemberIds: new Set(members.map((member) => member.userId)),
      });
      if (recipients.length) await tx.noticeDelivery.createMany({ data: recipients.map((userId) => ({ organizationId: found.organizationId, userId, key: quoteNoticeKey(quote.id, decision), channel: QUOTE_NOTICE_CHANNEL })), skipDuplicates: true });
    });
  } catch (error) {
    if (uniqueViolation(error)) throw new ApiError(409, ALREADY);
    throw error;
  }
  // När något händer (Agenter, 2026-11-21): the customer's answer may start a mission (accepted or declined, once per quote version).
  void import("@/lib/agents/events").then(({ emitAgentEvent }) => emitAgentEvent({ organizationId: found.organizationId, key: decisionStatus(decision) === "ACCEPTED" ? "quote_accepted" : "quote_declined", id: `quote:${quote.id}:${found.quoteVersion}`, recordId: quote.id, title: quote.title ?? "Offert", href: `/?view=quote&quoteId=${encodeURIComponent(quote.id)}`, actorId: null })).catch(() => undefined);
  const after = await loadLink(input.token);
  return pageOf(after, stateOf(after, today));
}

// ---------- the company's side: notices ----------

/** The person opened the quote: their "Offert besvarad" for it is read. */
export async function markQuoteNoticeSeen(input: { organizationId: string; userId: string; quoteId: string }) {
  await prisma.noticeDelivery.deleteMany({ where: { organizationId: input.organizationId, userId: input.userId, channel: QUOTE_NOTICE_CHANNEL, key: { startsWith: quoteNoticeKeyPrefix(input.quoteId) } } });
}

/** The bell's unread "Offert besvarad" for one person, only where they may read quotes (Cloud). */
export async function loadQuoteAnswerNotifications(caller: Pick<QuoteCaller, "organizationId" | "userId" | "admin" | "permissions" | "storageMode">) {
  if (caller.storageMode !== "HINTEK_CLOUD" || !quoteAccess(caller).read) return [];
  const rows = await prisma.noticeDelivery.findMany({
    where: { organizationId: caller.organizationId, userId: caller.userId, channel: QUOTE_NOTICE_CHANNEL },
    orderBy: { createdAt: "desc" }, take: QUOTE_NOTICE_LIMIT, select: { key: true, createdAt: true },
  });
  if (!rows.length) return [];
  const ids = [...new Set(rows.flatMap((row) => { const key = parseQuoteNoticeKey(row.key); return key ? [key.quoteId] : []; }))];
  const quotes = await prisma.quote.findMany({
    where: { organizationId: caller.organizationId, id: { in: ids } },
    select: { id: true, number: true, version: true, title: true, response: { select: { decision: true, signerName: true, createdAt: true } } },
  });
  const byId = new Map(quotes.map((quote) => [quote.id, quote]));
  return quoteAnswerNotifications(rows.map((row) => ({ ...row, quote: byId.get(parseQuoteNoticeKey(row.key)?.quoteId ?? "") ?? null })));
}
