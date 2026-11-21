import { z } from "zod";
import { swedishDayKey } from "@/lib/swedish-time";
import { formatPrice } from "@/lib/workflow/expenses";
import {
  QUOTE_LINE_KIND_LABELS, quoteLabel, quoteLineNumbers, quoteRotOf, quoteTotals, quoteVersionDiff,
  type QuoteCustomerType, type QuoteLineKind, type QuoteStatus,
} from "./model";

/**
 * Offert per e-post, steg E (2026-10-09): "Skicka till kund" mails the customer a link; the customer opens the
 * quote without an account and accepts (name + one tick box) or declines it (optional reason). Pure rules shared by the
 * server, the customer page, the demo and the tests – no database, no crypto (the hashing is in customer-link-token.ts):
 * - the link's state: open, answered through this link, answered otherwise, replaced by a newer version or changed
 *   contents, replaced by a newer link, expired with the quote's valid-until date, or not found;
 * - the fingerprint of what the customer sees, which binds a link to one quote version;
 * - the customer's quote as an explicit allow-list: never the purchase price, the markup, the catalogue copy, internal
 *   ids, the project or anything else that is not built here field by field;
 * - the input schemas of the sending and of the customer's answer.
 */

/** 32 random bytes as base64url: 43 characters. Anything else is never looked up. */
export const QUOTE_LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const isQuoteLinkToken = (value: unknown): value is string => typeof value === "string" && QUOTE_LINK_TOKEN_PATTERN.test(value);
/** The customer page's address (relative); the token is only in the e-mail. */
export const quoteLinkPath = (token: string) => `/offert/${token}`;

export const QUOTE_LINK_STATES = ["open", "accepted", "declined", "decided", "replaced", "revoked", "expired", "invalid"] as const;
export type QuoteLinkState = (typeof QUOTE_LINK_STATES)[number];
export type QuoteDecision = "ACCEPTED" | "DECLINED";

type DateLike = Date | string | null | undefined;
export type QuoteLinkStateInput = {
  link: { quoteVersion: number; contentHash: string; validUntil: string; revokedAt?: DateLike; usedAt?: DateLike } | null;
  quote: { status: QuoteStatus; version: number; validUntil: string; superseded: boolean } | null;
  /** The quote's answer from a customer, and whether it came through this link. */
  response: { decision: QuoteDecision; viaThisLink: boolean } | null;
  /** The fingerprint of the quote's contents now. */
  contentHash: string;
  today: string;
};

/**
 * What the link can do now. An answer through this very link is always shown as given. Otherwise a newer version or
 * changed contents (the link is bound to the version it was sent for), a newer link, an answer given otherwise (by the
 * company, or through another link) and a passed valid-until date each make it read only. Only "open" can be answered.
 */
export function quoteLinkState(input: QuoteLinkStateInput): QuoteLinkState {
  const { link, quote, response } = input;
  if (!link || !quote) return "invalid";
  if (response?.viaThisLink) return response.decision === "ACCEPTED" ? "accepted" : "declined";
  if (link.usedAt) return "decided";
  if (quote.superseded || quote.version !== link.quoteVersion || !input.contentHash || input.contentHash !== link.contentHash) return "replaced";
  if (link.revokedAt) return "revoked";
  if (quote.status === "ACCEPTED" || quote.status === "DECLINED") return "decided";
  if (quote.status === "EXPIRED" || (link.validUntil && link.validUntil < input.today) || (quote.validUntil && quote.validUntil < input.today)) return "expired";
  if (quote.status !== "SENT") return "invalid";
  return "open";
}

/** Only an open link is answered; the quote itself moves from Skickad to Accepterad or Avböjd. */
export const canAnswerQuoteLink = (state: QuoteLinkState) => state === "open";
export const decisionStatus = (decision: QuoteDecision): QuoteStatus => decision === "ACCEPTED" ? "ACCEPTED" : "DECLINED";
/** The quote is shown to the customer while the link is open, and after they answered through it. */
export const showsQuoteContents = (state: QuoteLinkState) => state === "open" || state === "accepted" || state === "declined";

/** What the customer page says in each state (plain, short, never why internally). */
export function quoteLinkStateText(state: QuoteLinkState, context: { company: string; validUntil: string; answeredAt?: string }) {
  const company = context.company || "företaget";
  switch (state) {
    case "open": return "";
    case "accepted": return `Du accepterade offerten${context.answeredAt ? ` ${context.answeredAt}` : ""}. Tack! ${company} har fått ditt svar.`;
    case "declined": return `Du avböjde offerten${context.answeredAt ? ` ${context.answeredAt}` : ""}. ${company} har fått ditt svar.`;
    case "decided": return `Offerten är redan besvarad. Kontakta ${company} om du har frågor.`;
    case "replaced": return `Offerten har ersatts av en nyare version. Använd länken i det senaste e-postmeddelandet från ${company}.`;
    case "revoked": return `Det finns en nyare länk till offerten. Använd länken i det senaste e-postmeddelandet från ${company}.`;
    case "expired": return `Offerten gällde${context.validUntil ? ` till och med ${context.validUntil}` : ""} och kan inte längre accepteras. Kontakta ${company} om du vill ha en ny offert.`;
    case "invalid": return "Länken fungerar inte. Den kan vara felskriven eller borttagen.";
  }
}

// ---------- the fingerprint of what the customer sees ----------

type ContentLine = { articleNo?: string; kind: QuoteLineKind; name: string; quantity: number | string; unit: string; unitPrice: number | string | null; markupPercent: number | string | null; rotLabour?: boolean };
export type QuoteContent = {
  number: number; version: number; title: string; description: string; validUntil: string; terms: string;
  vatPercent: number; customerType: QuoteCustomerType; rotEnabled: boolean; rotPercent: number | null; rotCap: number | null; changeOfVersion: number | null;
  lines: readonly ContentLine[];
  /** Omvänd byggmoms (2026-11-01). */
  reverseVat?: boolean; buyerVatNumber?: string;
};

const fixed = (value: number | null | undefined, digits: number) => value === null || value === undefined || !Number.isFinite(value) ? null : value.toFixed(digits);

/**
 * The quote's customer-facing contents as one canonical text: number, version, texts, VAT and ROT, and per line its
 * kind, benämning, antal, enhet, the selling price and amount and the ROT mark. The link stores the hash of it when
 * sent; a different text later means the customer would see something else, so the link no longer accepts.
 */
export function quoteContentFingerprint(quote: QuoteContent): string {
  return JSON.stringify([
    "quote-content-v1", quote.number, quote.version, quote.title, quote.description, quote.validUntil, quote.terms,
    fixed(quote.vatPercent, 2), quote.customerType, quote.rotEnabled, fixed(quote.rotPercent, 2), fixed(quote.rotCap, 2), quote.changeOfVersion,
    quote.lines.map((line) => {
      const numbers = quoteLineNumbers(line);
      // The article number is part of what the customer sees only when the line has one, so earlier links stay valid.
      return [line.kind, line.name, fixed(numbers.quantity, 4), line.unit, fixed(numbers.saleUnitPrice, 2), fixed(numbers.amount, 2), Boolean(line.rotLabour), ...((line.articleNo ?? "").trim() ? [(line.articleNo ?? "").trim()] : [])];
    }),
    // Only on a quote that has it, so earlier links stay valid.
    ...(quote.reverseVat ? [["reverse-vat", quote.buyerVatNumber ?? ""]] : []),
  ]);
}

// ---------- the customer's quote: an explicit allow-list ----------

export type PublicQuoteLine = { articleNo?: string; kind: QuoteLineKind; kindLabel: string; name: string; quantity: string; unit: string; price: number | null; amount: number | null; rotLabour: boolean };
export type PublicQuoteTotals = {
  material: number; labour: number; other: number; net: number; vatPercent: number; vat: number; gross: number;
  rotPercent: number | null; rotBaseInclVat: number; rot: number; rotCapped: boolean; toPay: number;
};
export type PublicQuoteChange = {
  ofVersion: number; netDelta: number;
  lines: { kind: QuoteLineKind; name: string; unit: string; change: "added" | "removed" | "changed"; quantityBefore: number | null; quantityAfter: number | null; amountDelta: number }[];
};
export type PublicQuoteView = {
  label: string; title: string; description: string; validUntil: string; terms: string; sentDate: string;
  customerType: QuoteCustomerType; customerName: string; placeName: string;
  /** Omvänd byggmoms (2026-11-01): the document says so, and names the buyer's VAT number when it is given. */
  reverseVat: boolean; buyerVatNumber: string;
  /** The customer's contact person and address (2026-10-10): the customer's own details, as on the PDF; may be empty. */
  customerContact: string; customerAddress: string;
  company: { name: string; email: string; senderName: string };
  lines: PublicQuoteLine[]; totals: PublicQuoteTotals; change: PublicQuoteChange | null;
};

export type PublicQuoteSource = {
  quote: QuoteContent & { sentAt: DateLike };
  /** ÄTA: the accepted version's lines, to show what is changed. */
  baseLines?: readonly ContentLine[] | null;
  customerName: string; placeName: string;
  customerContact?: string; customerAddress?: string;
  company: { name: string; email: string };
  senderName: string;
};

const text = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : "";

/**
 * The quote as the customer may see it. Every field is copied by name from what the customer sees on the PDF; nothing
 * is spread from the source, so the purchase price, the markup, the catalogue copy, the project, ids, revision, who
 * created it and any internal field never reach the customer page or its API, whatever the source carries.
 */
export function publicQuoteView(source: PublicQuoteSource): PublicQuoteView {
  const { quote } = source;
  const rot = quoteRotOf({ customerType: quote.customerType, rotEnabled: quote.rotEnabled, rotPercent: quote.rotPercent, rotCap: quote.rotCap });
  const totals = quoteTotals(quote.lines.map((line) => ({ kind: line.kind, quantity: line.quantity, unitPrice: line.unitPrice, markupPercent: line.markupPercent, rotLabour: Boolean(line.rotLabour) })), quote.vatPercent, rot);
  const change = quote.changeOfVersion && source.baseLines ? quoteVersionDiff(
    source.baseLines.map((line) => ({ kind: line.kind, name: line.name, unit: line.unit, quantity: line.quantity, unitPrice: line.unitPrice, markupPercent: line.markupPercent })),
    quote.lines.map((line) => ({ kind: line.kind, name: line.name, unit: line.unit, quantity: line.quantity, unitPrice: line.unitPrice, markupPercent: line.markupPercent })),
  ) : null;
  const sent = quote.sentAt ? new Date(quote.sentAt) : null;
  return {
    label: quoteLabel(quote), title: text(quote.title, 200), description: text(quote.description, 5000), validUntil: text(quote.validUntil, 10), terms: text(quote.terms, 5000),
    sentDate: sent && Number.isFinite(sent.getTime()) ? swedishDayKey(sent) : "",
    customerType: quote.customerType === "PRIVATE" ? "PRIVATE" : "COMPANY", customerName: text(source.customerName, 200), placeName: text(source.placeName, 200),
    reverseVat: Boolean(quote.reverseVat), buyerVatNumber: text(quote.buyerVatNumber, 40),
    customerContact: text(source.customerContact, 200), customerAddress: text(source.customerAddress, 400),
    company: { name: text(source.company.name, 200), email: text(source.company.email, 254), senderName: text(source.senderName, 120) },
    lines: quote.lines.map((line): PublicQuoteLine => {
      const numbers = quoteLineNumbers(line);
      return {
        ...((line.articleNo ?? "").trim() ? { articleNo: text(line.articleNo ?? "", 60) } : {}),
        kind: line.kind, kindLabel: QUOTE_LINE_KIND_LABELS[line.kind] ?? "", name: text(line.name, 300),
        quantity: numbers.quantity === null ? "" : formatPrice(numbers.quantity), unit: text(line.unit, 40),
        price: numbers.saleUnitPrice, amount: numbers.amount, rotLabour: Boolean(rot && line.rotLabour),
      };
    }),
    totals: {
      material: totals.byKind.MATERIAL, labour: totals.byKind.LABOUR, other: totals.byKind.OTHER,
      net: totals.net, vatPercent: totals.vatPercent, vat: totals.vat, gross: totals.gross,
      rotPercent: rot ? rot.percent : null, rotBaseInclVat: totals.rotBaseInclVat, rot: totals.rot, rotCapped: totals.rotCapped, toPay: totals.toPay,
    },
    change: change && quote.changeOfVersion ? {
      ofVersion: quote.changeOfVersion, netDelta: change.netDelta,
      lines: change.lines.map((line) => ({ kind: line.kind, name: line.name, unit: line.unit, change: line.change, quantityBefore: line.before?.quantity ?? null, quantityAfter: line.after?.quantity ?? null, amountDelta: line.amountDelta })),
    } : null,
  };
}

/** Keys that must never appear anywhere in what the customer page or its API returns (checked by the tests). */
export const PUBLIC_QUOTE_FORBIDDEN_KEYS = [
  "unitPrice", "markupPercent", "markup", "purchase", "margin", "catalogue", "cost", "notes", "internal", "revision",
  "organizationId", "createdById", "sentById", "decidedById", "updatedById", "projectId", "project", "customerId", "facilityId",
  "workOrderId", "workOrder", "tokenHash", "contentHash", "ipAddress", "userAgent", "saleUnitPrice", "unpriced", "evidence",
] as const;

/** What the customer page gets: the state, the message, and the quote only when it may be shown. */
export type PublicQuotePage = {
  state: QuoteLinkState;
  message: string;
  company: string;
  label: string;
  quote: PublicQuoteView | null;
  /** The answer given through this link. */
  answer: { decision: QuoteDecision; name: string; date: string } | null;
  /** How the customer confirms an open link: the method's kind and the statement to tick. */
  method: { id: string; kind: "form" | "external"; statement: string } | null;
};

// ---------- input ----------

const token = z.string().refine(isQuoteLinkToken, "Länken fungerar inte.");
/** The customer's answer (the public API): accept with the method's input, or decline with an optional reason. */
export const customerAnswerSchema = z.discriminatedUnion("decision", [
  z.object({ token, decision: z.literal("accept"), name: z.string().max(200).default(""), agree: z.boolean().default(false) }),
  z.object({ token, decision: z.literal("decline"), name: z.string().trim().max(120).default(""), reason: z.string().trim().max(1000, "Skriv högst 1000 tecken.").default("") }),
]);
export type CustomerAnswer = z.output<typeof customerAnswerSchema>;

/** "Skicka till kund": the address and an optional message from the company (plain text). */
export const sendQuoteLinkSchema = z.object({
  email: z.email("Skriv en giltig e-postadress.").max(254),
  message: z.string().trim().max(2000, "Meddelandet får vara högst 2000 tecken.").default(""),
});

/** The company's view of the latest link: to whom, when, opened, and whether it still works. */
export type QuoteCustomerLinkView = {
  email: string; sentAt: string; validUntil: string; openedAt: string | null;
  state: "active" | "used" | "revoked" | "expired" | "replaced";
  /** Only on a loopback test instance, where e-mail is never sent: the link to try. */
  testUrl?: string;
  /** The demo: nothing is sent; the answer can be simulated. */
  demo?: boolean;
};
export type QuoteCustomerResponseView = { decision: QuoteDecision; name: string; reason: string; method: string; methodLabel: string; at: string };

/** The latest link's state for the company. */
export function customerLinkSummaryState(link: { usedAt?: DateLike; revokedAt?: DateLike; validUntil: string; quoteVersion: number }, quote: { version: number; superseded: boolean }, today: string): QuoteCustomerLinkView["state"] {
  if (link.usedAt) return "used";
  if (link.revokedAt) return "revoked";
  if (quote.superseded || quote.version !== link.quoteVersion) return "replaced";
  if (link.validUntil && link.validUntil < today) return "expired";
  return "active";
}
export const CUSTOMER_LINK_STATE_LABELS: Record<QuoteCustomerLinkView["state"], string> = { active: "Länken fungerar", used: "Besvarad via länken", revoked: "Ersatt av en nyare länk", expired: "Länken har gått ut", replaced: "Ersatt av en nyare version" };
