import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/kfid/errors";
import { todayInSweden } from "@/lib/catalogue/snapshot";
import { openCompanyKey } from "@/lib/integrations/company-keys";
import { INSTANCE_DEFAULTS } from "@/lib/instance-defaults";
import { accountingSettingsOf, accountingSettingsSchema, FORTNOX_KEY_PLACE, type AccountingQuote, type AccountingSettings } from "./accounting";
import { effectiveQuoteStatus, QUOTE_VAT_PERCENT, quoteLabel, quoteReverseVatOf, readLineCatalogue, quoteRotOf, type QuoteLineKind } from "./model";

/** Omvänd byggmoms (2026-11-01), kept with the quote's lines. */
const reverseVatOfLines = (lines: readonly { catalogue: unknown }[]) => { const reverse = quoteReverseVatOf(lines.map((line) => readLineCatalogue(line.catalogue))); return reverse ? { reverseVat: true, buyerVatNumber: reverse.buyerVatNumber } : {}; };
import { requireQuotes, type QuoteCaller } from "./server";
import { customerTitle } from "@/lib/kfid/customer-name";

/**
 * Export av offert/fakturaunderlag on the server (steg D). Every read is bound to the caller's company and needs
 * Offerter – läsa (the export carries selling prices, which that right already shows). The account mapping is read by
 * the same people and changed only by the company's admin. The Fortnox key is the company's own external key; it is
 * opened only for the moment of a send and never leaves the server.
 */
export const EXPORT_MAX_QUOTES = 100;

export async function readAccountingSettings(organizationId: string): Promise<AccountingSettings> {
  const row = await prisma.workspaceSettings.findUnique({ where: { organizationId }, select: { accountingSettings: true } });
  return accountingSettingsOf(row?.accountingSettings);
}

export async function writeAccountingSettings(caller: Pick<QuoteCaller, "organizationId" | "admin">, input: unknown): Promise<AccountingSettings> {
  if (!caller.admin) throw new ApiError(403, "Bara en företagsadministratör kan göra det.");
  const settings = accountingSettingsSchema.parse(input);
  await prisma.workspaceSettings.upsert({
    where: { organizationId: caller.organizationId },
    create: { organizationId: caller.organizationId, accountingSettings: settings },
    update: { accountingSettings: settings },
  });
  return settings;
}

const decimal = (value: Prisma.Decimal | null) => value === null ? null : Number(value.toString());

/** The quotes (latest or older versions alike) of the caller's company, in the order asked for; unknown ids are left out. */
export async function accountingQuotes(caller: QuoteCaller, ids: readonly string[], today = todayInSweden()): Promise<AccountingQuote[]> {
  requireQuotes(caller, "read");
  const unique = [...new Set(ids)].slice(0, EXPORT_MAX_QUOTES);
  if (!unique.length) return [];
  const rows = await prisma.quote.findMany({
    where: { organizationId: caller.organizationId, id: { in: unique } },
    include: {
      customer: { select: { name: true, company: true, customerType: true, accountingCustomerNumber: true } },
      project: { select: { name: true } },
      lines: { orderBy: [{ position: "asc" }, { id: "asc" }], select: { kind: true, name: true, quantity: true, unit: true, unitPrice: true, markupPercent: true, catalogue: true, rotLabour: true } },
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return unique.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    const when = row.decidedAt ?? row.sentAt ?? row.createdAt;
    return [{
      id: row.id, label: quoteLabel(row), title: row.title,
      status: effectiveQuoteStatus({ status: row.status, validUntil: row.validUntil }, today),
      date: todayInSweden(when),
      // The customer as it was when sent (plan 1D), else the register; the id for the accounting number (plan 1L).
      customerName: row.sentCustomerName ?? (row.customer ? customerTitle(row.customer) : ""), customerId: row.customerId, customerNumber: row.customer?.accountingCustomerNumber.trim() ?? "", projectName: row.project?.name ?? "",
      vatPercent: decimal(row.vatPercent) ?? QUOTE_VAT_PERCENT,
      lines: row.lines.map((line) => ({ articleNo: readLineCatalogue(line.catalogue).articleNo ?? "", kind: line.kind as QuoteLineKind, name: line.name, quantity: decimal(line.quantity) ?? 0, unit: line.unit, unitPrice: decimal(line.unitPrice), markupPercent: decimal(line.markupPercent), rotLabour: line.rotLabour })),
      // ROT (steg C): the receivable is split into the customer's share and the ROT claim.
      rot: quoteRotOf({ customerType: row.customerType, rotEnabled: row.rotEnabled, rotPercent: decimal(row.rotPercent), rotCap: decimal(row.rotCap) }),
      ...reverseVatOfLines(row.lines),
    }];
  });
}

/** Company name and organisation number for the SIE header (the company's own profile). */
export async function companyMeta(organizationId: string, fallbackName: string) {
  const row = await prisma.workspaceSettings.findUnique({ where: { organizationId }, select: { companyName: true, profile: true } });
  const profile = row?.profile && typeof row.profile === "object" && !Array.isArray(row.profile) ? row.profile as Record<string, unknown> : {};
  return { company: row?.companyName || fallbackName, organizationNumber: typeof profile.organizationNumber === "string" ? profile.organizationNumber : "" };
}

// ---------- Fortnox key ----------

async function activeFortnoxKey(organizationId: string, now = new Date()) {
  return prisma.integrationKey.findFirst({
    where: { organizationId, kind: "EXTERNAL", provider: "fortnox", revokedAt: null, encryptedValue: { not: null }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, encryptedValue: true },
  });
}

/** Whether a Fortnox key is saved, by name only – the page never sees the key. */
export async function fortnoxKeyName(organizationId: string): Promise<string | null> {
  return (await activeFortnoxKey(organizationId))?.name ?? null;
}

/** The key, opened for one send; a key that can no longer be opened is reported as missing. */
export async function openFortnoxKey(organizationId: string): Promise<string> {
  const key = await activeFortnoxKey(organizationId);
  if (!key?.encryptedValue) throw new ApiError(409, `Lägg till företagets Fortnox-nyckel under ${FORTNOX_KEY_PLACE} först.`);
  // Opened with the company's own data key only (lib/integrations/company-keys.ts): another company's value never opens here.
  try { return await openCompanyKey(organizationId, key.id, key.encryptedValue); } catch { throw new ApiError(409, `Fortnox-nyckeln kan inte läsas. Lägg in den igen under ${FORTNOX_KEY_PLACE}.`); }
}

/** Nothing leaves a local QA instance (Workflow's rule, as for e-mail): a send is stopped and says why. */
export function externalSendBlocked(): string | null {
  let loopback = false;
  try { loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(env.APP_URL).hostname); } catch { loopback = false; }
  return INSTANCE_DEFAULTS.loopbackTestDatabase && loopback ? "Inget skickas till Fortnox från en lokal testinstans." : null;
}

export async function recordAccountingEvent(organizationId: string, actorId: string, detail: string) {
  await prisma.administrationEvent.create({ data: { organizationId, actorId, action: "accounting_export", detail: detail.slice(0, 500) } });
}

// ---------- Kundnummer i bokföringen (plan 1L, 2026-10-11) ----------

const ACCOUNTING_NUMBER_MAX = 60;

/** The customer's number in the company's accounting system as kept on the customer (Customer.accountingCustomerNumber); "" without one. */
export async function customerAccountingNumber(organizationId: string, customerId: string | null | undefined): Promise<string> {
  if (!customerId) return "";
  const row = await prisma.customer.findFirst({ where: { id: customerId, organizationId }, select: { accountingCustomerNumber: true } });
  return row?.accountingCustomerNumber.trim() ?? "";
}

/**
 * After a successful send to Fortnox: the number the person sent is kept on the customer, so the next send is filled in
 * – only when the customer had none or the person changed it. Never a key, never on another company's customer.
 */
export async function rememberCustomerAccountingNumber(organizationId: string, customerId: string | null | undefined, number: string): Promise<boolean> {
  const value = number.trim().slice(0, ACCOUNTING_NUMBER_MAX);
  if (!customerId || !value) return false;
  const changed = await prisma.customer.updateMany({ where: { id: customerId, organizationId, deletedAt: null, NOT: { accountingCustomerNumber: value } }, data: { accountingCustomerNumber: value } });
  return changed.count > 0;
}
