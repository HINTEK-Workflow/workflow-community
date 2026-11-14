import { formatPrice } from "@/lib/workflow/expenses";
import { CONTENT_WIDTH, continuationOf, createReportKit, mm, type KitFact, type KitIdentity, type KitSumRow } from "@/lib/workflow/report-kit";
import type { ReportFontBytes } from "@/lib/workflow/report-fonts";
import { pdfDocumentDef, pdfTexts, type PdfDocumentType } from "@/lib/pdf-templates/catalog";
import { traceOf, tracedTemplates, type PdfTexts } from "@/lib/pdf-templates/model";
import { frozenCommonTemplates, frozenPdfTexts, signedSek, type InvoiceContent } from "./model";

/**
 * Fakturan och kreditfakturan som dokument (owner's decision 2026-11-04), drawn with the report kit like every document:
 * Förslag B, the company's logo or name, Manrope, the payment box. Everything on it comes from the locked snapshot, so the
 * document reads the same whenever it is taken out. The identity number is given separately, opened only for the document, and
 * is printed only on a ROT invoice. `preview` adds a band: no number has been given yet and nothing is issued. `proforma` (2026-11-05) is no invoice: no number from the series, no due date, no payment box and never an identity number.
 */
type Words = PdfTexts;
const LINE_FIXED = { row: mm(8), article: mm(20), quantity: mm(14), unit: mm(12), price: mm(22), vat: mm(13), amount: mm(24) };
function columns(t: Words, numbered: boolean, rates: boolean) {
  const fixed = LINE_FIXED.row + (numbered ? LINE_FIXED.article : 0) + LINE_FIXED.quantity + LINE_FIXED.unit + LINE_FIXED.price + (rates ? LINE_FIXED.vat : 0) + LINE_FIXED.amount;
  return [
    { key: "row", label: t.text("col.row"), width: LINE_FIXED.row, align: "center" as const },
    ...(numbered ? [{ key: "articleNo", label: t.text("col.article"), width: LINE_FIXED.article }] : []),
    { key: "name", label: t.text("col.name"), width: CONTENT_WIDTH - fixed },
    { key: "quantity", label: t.text("col.quantity"), width: LINE_FIXED.quantity, align: "right" as const },
    { key: "unit", label: t.text("col.unit"), width: LINE_FIXED.unit },
    { key: "price", label: t.text("col.price"), width: LINE_FIXED.price, align: "right" as const },
    ...(rates ? [{ key: "vat", label: t.text("col.vat"), width: LINE_FIXED.vat, align: "right" as const }] : []),
    { key: "amount", label: t.text("col.amount"), width: LINE_FIXED.amount, align: "right" as const },
  ];
}

const quantityText = (value: number) => `${value < 0 ? "−" : ""}${formatPrice(Math.abs(value))}`;

export async function createCustomerInvoicePdf(input: { identity: KitIdentity; fontBytes: ReportFontBytes; content: InvoiceContent; personalNumber?: string; preview?: boolean; proforma?: boolean; createdAt?: Date }) {
  const { content } = input;
  const credit = content.kind === "CREDIT";
  const type: PdfDocumentType = credit ? "credit_invoice" : "invoice";
  // The template editor's example (only it has a trace) reads the same texts through the catalogue, so its words can be clicked; a real invoice reads its locked snapshot.
  const trace = traceOf(input.identity.templates);
  const t = trace ? pdfTexts(type, input.identity.templates) : frozenPdfTexts(content.texts, pdfDocumentDef(type)!.blocks);
  // What the kit prints on every document ("common"): the editor's example shows the owner's edits, a real invoice the common texts of its snapshot (an old snapshot has none: the defaults).
  const templates = trace ? tracedTemplates(input.identity.templates, trace) : frozenCommonTemplates(content.common, pdfDocumentDef("common")!.blocks);
  const createdAt = input.createdAt ?? new Date(`${content.issuedOn}T12:00:00Z`);
  const proforma = Boolean(input.proforma);
  const title = t.text(proforma ? "title.proforma" : "title");
  const number = proforma ? content.basisLabel : input.preview ? t.text("number.preview") : content.label;
  const { seller, buyer } = content;
  const kit = await createReportKit({
    // The seller on the document is the snapshot's; the logo and colours are the company's own.
    identity: { ...input.identity, company: seller.name, sender: { organizationNumber: seller.organizationNumber, vatNumber: seller.vatNumber, fSkatt: seller.fSkatt, address: seller.address, phone: seller.phone, email: seller.email, registeredOffice: seller.registeredOffice }, templates },
    fontBytes: input.fontBytes, createdAt,
    head: {
      kind: t.shown("kind") ? t.text("kind") : "", title, number,
      dates: [[t.text("date.issued"), content.issuedOn], ...(content.dueOn && !proforma ? [[t.text("date.due"), content.dueOn] as const] : [])],
      continuation: continuationOf({ company: seller.name, templates }, `${title} ${number}`),
    },
  });
  kit.pdf.setTitle(`${title} ${number} – ${content.title}`);
  kit.pdf.setAuthor(seller.name || "Workflow");
  kit.pdf.setCreator("Workflow");
  kit.pdf.setProducer("Workflow");
  kit.pdf.setCreationDate(createdAt);
  kit.firstPage();
  if (proforma) kit.band(t.text("band.proforma"));
  else if (input.preview) kit.band(t.text("band.preview"));

  const sellerLines = [
    seller.address,
    [seller.organizationNumber ? `${t.text("party.org")} ${seller.organizationNumber}` : "", seller.registeredOffice ? `${t.text("party.seat")} ${seller.registeredOffice}` : ""].filter(Boolean).join(" · "),
    seller.vatNumber ? `${t.text("party.vat")} ${seller.vatNumber}` : "",
    seller.fSkatt ? t.text("note.f-tax") : "",
  ].filter(Boolean);
  const performed = [content.performedFrom, content.performedOn].filter(Boolean).join(" – ");
  kit.facts([
    { label: t.text("fact.buyer"), party: { name: buyer.name, lines: [buyer.contactName ? `${t.text("party.att")} ${buyer.contactName}` : "", buyer.address, content.buyerVatNumber ? `${t.text("fact.buyer-vat")} ${content.buyerVatNumber}` : ""].filter(Boolean) } },
    { label: t.text("fact.seller"), party: { name: seller.name, lines: sellerLines } },
  ], { cols: 2 });
  const facts: KitFact[] = [
    ...(content.creditOf ? [
      { label: t.text("fact.credits"), value: `${content.creditOf.label}, ${content.creditOf.issuedOn}` },
      { label: t.text("fact.reason"), value: content.creditOf.reason, span: 8 },
    ] : []),
    { label: t.text("fact.subject"), value: content.title },
    { label: t.text("fact.performed"), value: performed },
    ...(content.paymentDays !== null && !proforma ? [{ label: t.text("fact.terms"), value: t.text("terms.days", { dagar: content.paymentDays }) }] : []),
  ];
  kit.facts(facts, { cols: 3 });

  kit.section(t.text("section.spec"), { note: t.shown("spec.note") ? t.text("spec.note") : undefined, keep: 44 });
  const numbered = content.lines.some((line) => line.articleNo);
  const rates = content.vatRows.length > 1;
  kit.table({ title: t.text("section.spec"), columns: columns(t, numbered, rates), rows: content.lines.map((line, index) => [
    String(index + 1), ...(numbered ? [line.articleNo || "—"] : []),
    content.rot && line.rotLabour ? `${line.name} ${t.text("line.rot")}` : line.name,
    quantityText(line.quantity), line.unit, signedSek(line.unitPrice),
    ...(rates ? [`${formatPrice(line.vatPercent)} %`] : []), signedSek(line.amount),
  ]) });

  // The ROT details stand together beside the sums they belong to.
  const rotLines = content.rot ? [
    ...(proforma ? [] : [`${t.text("fact.personal-number")}: ${input.personalNumber || "—"}`]),
    ...(content.rot.propertyDesignation ? [`${t.text("fact.property")}: ${content.rot.propertyDesignation}`] : [`${t.text("fact.brf")}: ${content.rot.brfOrganizationNumber}`, `${t.text("fact.apartment")}: ${content.rot.apartmentNumber}`]),
    `${t.text("fact.work-place")}: ${content.rot.workPlace}`,
    `${t.text("fact.performer")}: ${seller.name}`,
  ] : [];

  const rows: KitSumRow[] = [{ label: t.text("sum.net"), value: signedSek(content.net) }];
  if (content.reverseVat) rows.push({ label: t.text("sum.vat"), value: t.text("sum.reverse") });
  else if (seller.vatExempt) rows.push({ label: t.text("sum.vat"), value: signedSek(0) });
  else for (const row of content.vatRows) {
    if (rates) rows.push({ label: t.text("sum.base-rate", { sats: formatPrice(row.percent) }), value: signedSek(row.net) });
    rows.push({ label: t.text("sum.vat-rate", { sats: formatPrice(row.percent) }), value: signedSek(row.vat) });
  }
  if (content.rot) {
    rows.push({ label: t.text("sum.gross"), value: signedSek(content.gross) });
    rows.push({ label: t.text("sum.labour"), value: signedSek(content.rot.labourInclVat) });
    rows.push({ label: t.text("sum.other"), value: signedSek(content.rot.otherInclVat) });
    rows.push({ label: `${t.text("sum.rot", { sats: formatPrice(content.rot.percent) })}${content.rot.capped ? ` ${t.text("sum.rot-cap")}` : ""}`, value: signedSek(-content.rot.deduction) });
  }
  const totalLabel = t.text(proforma ? "total.proforma" : credit ? "total.credit" : "total.pay");
  const notes = [
    ...(content.reverseVat ? [t.text("note.reverse-vat")] : []),
    ...(seller.vatExempt ? [t.text("note.vat-exempt")] : []),
    ...(content.exemptionText ? [content.exemptionText] : []),
    ...(content.rot ? [t.text("note.rot")] : []),
  ];
  kit.sumRow(content.rot ? { title: t.text("section.rot"), lines: rotLines, notes } : { notes }, rows, { label: totalLabel, value: `${signedSek(content.toPay)} kr`, small: content.rot ? t.text("small.rot") : content.reverseVat ? t.text("small.reverse") : seller.vatExempt ? undefined : t.text("small.vat") });

  kit.keep(() => {
    // A credit invoice asks for no payment, so it has no payment box: the amount and the reference stand above.
    if (credit || proforma) return;
    const ways = [
      ...(seller.bankgiro ? [{ label: t.text("pay.bankgiro"), value: seller.bankgiro }] : []),
      ...(seller.plusgiro ? [{ label: t.text("pay.plusgiro"), value: seller.plusgiro }] : []),
      ...(seller.iban ? [{ label: t.text("pay.iban"), value: seller.iban }] : []),
    ];
    kit.payBox([
      { label: totalLabel, value: `${signedSek(content.toPay)} kr`, key: true },
      { label: t.text("date.due"), value: content.dueOn ?? "", key: true },
      ...(ways[0] ? [ways[0]] : []),
      { label: t.text(content.ocr ? "pay.ocr" : "pay.reference"), value: input.preview ? t.text("pay.preview") : content.reference },
    ]);
    const others = [...ways.slice(1), ...(seller.bic ? [{ label: t.text("pay.bic"), value: seller.bic }] : [])];
    if (others.length) kit.facts(others, { cols: 3 });
    kit.paragraph(content.lateTerms || t.text("pay.late"), { size: 9, after: mm(1) });
  });
  kit.footer();
  return kit.pdf.save();
}
