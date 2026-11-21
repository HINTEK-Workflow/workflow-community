import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { ZipWriter } from "@/lib/kfid/zip-writer";
import { customerTitle } from "@/lib/kfid/customer-name";
import { cloudExportPages, type CloudExportZip } from "@/lib/kfid/cloud-export";
import { quoteLabel } from "@/lib/quotes/model";
import { invoiceBasisLabel } from "@/lib/invoice-basis/model";

/**
 * Offerter och fakturaunderlag i företagets export: they have no place in the .hwf file, whose records are those of a Local
 * workspace and which Local reads and writes back, so they go out as a zip file of their own in the same kind of parts. The
 * records name customers, projects and jobs in words, because this file shares no ids with the .hwf file. Every read is bound
 * to the company. What is the system's and not the company's stays out: the customer links' tokens, ip addresses and browsers.
 */

const customerName = { select: { name: true, company: true, customerType: true } } as const;
const quoteInclude = {
  lines: { orderBy: { position: "asc" } },
  response: { select: { decision: true, acceptanceMethod: true, signerName: true, reason: true, evidence: true, quoteVersion: true, contentHash: true, createdAt: true } },
  customer: customerName, project: { select: { name: true } }, workOrder: { select: { title: true } },
} satisfies Prisma.QuoteInclude;
const basisInclude = { customer: customerName, project: { select: { name: true } }, task: { select: { title: true } } } satisfies Prisma.InvoiceBasisInclude;
type QuoteRow = Prisma.QuoteGetPayload<{ include: typeof quoteInclude }>;
type BasisRow = Prisma.InvoiceBasisGetPayload<{ include: typeof basisInclude }>;

const decimal = (value: { toString(): string } | null | undefined) => (value === null || value === undefined ? null : value.toString());
const time = (value: Date | null | undefined) => value?.toISOString() ?? null;
const named = (customer: QuoteRow["customer"]) => (customer ? customerTitle(customer) : null);

export function quoteExportRecord(quote: QuoteRow) {
  return {
    label: quoteLabel(quote), number: quote.number, version: quote.version, status: quote.status, title: quote.title, description: quote.description,
    customer: named(quote.customer), project: quote.project?.name ?? null, workOrder: quote.workOrder?.title ?? null,
    customerType: quote.customerType, validUntil: quote.validUntil, terms: quote.terms, vatPercent: decimal(quote.vatPercent),
    rotEnabled: quote.rotEnabled, rotPercent: decimal(quote.rotPercent), rotCap: decimal(quote.rotCap), changeOfVersion: quote.changeOfVersion,
    sentCustomer: { name: quote.sentCustomerName, contact: quote.sentCustomerContact, address: quote.sentCustomerAddress },
    createdAt: time(quote.createdAt), updatedAt: time(quote.updatedAt), sentAt: time(quote.sentAt), decidedAt: time(quote.decidedAt), supersededAt: time(quote.supersededAt),
    lines: quote.lines.map((line) => ({ position: line.position, kind: line.kind, name: line.name, quantity: decimal(line.quantity), unit: line.unit, unitPrice: decimal(line.unitPrice), markupPercent: decimal(line.markupPercent), rotLabour: line.rotLabour, catalogue: line.catalogue })),
    customerAnswer: quote.response ? { ...quote.response, createdAt: time(quote.response.createdAt) } : null,
  };
}

export function invoiceBasisExportRecord(basis: BasisRow) {
  return {
    label: invoiceBasisLabel(basis.number), number: basis.number, status: basis.status, title: basis.title,
    customer: named(basis.customer), project: basis.project?.name ?? null, job: basis.task?.title ?? null,
    vatPercent: decimal(basis.vatPercent), lines: basis.lines, note: basis.note,
    invoicedAt: time(basis.invoicedAt), invoicedByName: basis.invoicedByName, createdAt: time(basis.createdAt), updatedAt: time(basis.updatedAt),
  };
}

export const SALES_EXPORT_PART_SIZE = 200;
export const SALES_EXPORT_FOLDERS = { quotes: "offerter", invoiceBases: "fakturaunderlag", customerInvoices: "fakturor" } as const;
export const salesExportPartName = (section: keyof typeof SALES_EXPORT_FOLDERS, part: number) => `${SALES_EXPORT_FOLDERS[section]}/del-${String(part).padStart(4, "0")}.json`;

const ascending = [{ createdAt: "asc" as const }, { id: "asc" as const }];

/** The company's records page by page: only this company's, whichever register is read. */
export async function* salesExportRecords(organizationId: string, size = SALES_EXPORT_PART_SIZE) {
  for await (const page of cloudExportPages((args) => prisma.quote.findMany({ where: { organizationId }, orderBy: ascending, include: quoteInclude, ...args }), size))
    yield { section: "quotes" as const, records: page.map(quoteExportRecord) };
  for await (const page of cloudExportPages((args) => prisma.invoiceBasis.findMany({ where: { organizationId }, orderBy: ascending, include: basisInclude, ...args }), size))
    yield { section: "invoiceBases" as const, records: page.map(invoiceBasisExportRecord) };
  // Fakturor (2026-11-04): the locked content and its log. The identity number stays sealed; the export shows it masked.
  for (let offset = 0; ; offset += size) {
    const rows = await prisma.$queryRaw<{ label: string; title: string; customer: string; kind: string; issuedOn: string; dueOn: string | null; paidOn: string | null; identityMasked: string; content: unknown; createdByName: string; createdAt: Date }[]>`SELECT "label", "title", "buyerName" AS "customer", "kind"::text AS "kind", "issuedOn", "dueOn", "paidOn", "identityMasked", "content", "createdByName", "createdAt" FROM "CustomerInvoice" WHERE "organizationId" = ${organizationId} ORDER BY "createdAt" ASC, "id" ASC LIMIT ${size} OFFSET ${offset}`;
    if (!rows.length) break;
    yield { section: "customerInvoices" as const, records: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) };
    if (rows.length < size) break;
  }
}

const running = new Set<string>();

async function* zipChunks(source: { organizationId: string; organizationName: string }, exportedAt: string, release: () => void): AsyncGenerator<Uint8Array> {
  try {
    const zip = new ZipWriter({ date: new Date(exportedAt) });
    const encoder = new TextEncoder();
    const json = (name: string, value: unknown) => zip.file(name, encoder.encode(JSON.stringify(value)), { compress: true });
    const sections = { quotes: { count: 0, parts: [] as string[] }, invoiceBases: { count: 0, parts: [] as string[] }, customerInvoices: { count: 0, parts: [] as string[] } };
    for await (const { section, records } of salesExportRecords(source.organizationId)) {
      const name = salesExportPartName(section, sections[section].parts.length + 1);
      sections[section].parts.push(name);
      sections[section].count += records.length;
      yield* json(name, { format: "HWF_SALES_EXPORT_PART", schemaVersion: 1, section, part: sections[section].parts.length, records });
    }
    yield* json("innehall.json", { format: "HWF_SALES_EXPORT", schemaVersion: 1, exportedAt, organization: source.organizationName, sections });
    yield* zip.file("LASMIG.txt", encoder.encode([
      "Offerter och fakturaunderlag",
      "",
      `Skapad ${exportedAt}.`,
      "innehall.json listar alla delar. Varje post är en offertversion eller ett fakturaunderlag med sina rader.",
      "Kunder, projekt och jobb står med namn. Övrig data finns med serverlagring-kopian och i företagsarkivet.",
      "",
    ].join("\r\n")), { compress: true });
    yield zip.finish();
  } finally {
    release();
  }
}

/** One export at a time per company; the bytes are made as they are read, so a large company stays out of memory. */
export function prepareSalesExportZip(source: { organizationId: string; organizationName: string }): CloudExportZip {
  if (running.has(source.organizationId)) throw new ApiError(429, "En export pågår redan för företaget. Försök igen när den är klar.");
  running.add(source.organizationId);
  const exportedAt = new Date().toISOString();
  const release = () => { running.delete(source.organizationId); };
  return { chunks: zipChunks(source, exportedAt, release), exportedAt, release };
}
