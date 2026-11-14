import { formatSwedish } from "@/lib/swedish-time";
import { formatSek } from "@/lib/workflow/expenses";
import { CONTENT_WIDTH, continuationOf, createReportKit, mm, senderPayTo, type KitFact, type KitIdentity, type KitSumRow, type KitSumTotal } from "@/lib/workflow/report-kit";
import type { ReportFontBytes } from "@/lib/workflow/report-fonts";
import { pdfTexts, rowCount } from "@/lib/pdf-templates/catalog";
import type { PdfTexts } from "@/lib/pdf-templates/model";
import { QUOTE_STATUS_LABELS, quoteChangeWithVat, quoteLineNumbers, type QuoteView } from "./model";

/**
 * Offertens PDF (2026-10-09, steg B; the design Förslag B 2026-11-03, template 01-offert / 18-ÄTA): drawn with the
 * report kit like every other document, in the company's colours with its logo. It is the customer's document, so it shows
 * only the selling prices – never the purchase price or the markup. The head carries the number, the date and the validity;
 * the facts grid the receiver and the references; then Omfattning, the specification with row numbers, the summary box with
 * the approval text beside it, the payment box (from Förslag A) with the total, the terms and the signature block. A draft
 * is marked with a band. Steg C + moms/ROT: the VAT rate is the quote's own; a private person's quote with ROT shows the
 * labour basis incl. VAT, the preliminary deduction and the sum after it. An ÄTA is titled ÄTA and lists its changes.
 */
const percentText = (value: number) => String(value).replace(".", ",");
const sek = (value: number | null) => value === null ? "" : formatSek(value);
const day = (value: string | Date | null | undefined, fallback: Date) => formatSwedish(value ?? fallback, { dateStyle: "short" });

/**
 * What the PDF reads of a quote: the company's full view, or (plan 1D, the customer's "Ladda ner som PDF") the same
 * fields built from the sent version and its customer snapshot, so the customer gets exactly the company's document.
 */
export type QuotePdfQuote = Pick<QuoteView, "label" | "title" | "description" | "status" | "storedStatus" | "validUntil" | "terms" | "customerType" | "rotPercent" | "reverseVat" | "buyerVatNumber" | "changeOfVersion" | "change" | "customer" | "facility" | "project" | "lines" | "totals" | "sentAt">;

/** The specification's columns: row number, article number when any line has one, name, quantity, unit, unit price, amount. */
export function specificationColumns(numbered: boolean, t: PdfTexts = pdfTexts("quote")) {
  const fixed = mm(8) + (numbered ? mm(20) : 0) + mm(14) + mm(12) + mm(22) + mm(24);
  return [
    { key: "row", label: t.text("col.row"), width: mm(8), align: "center" as const },
    ...(numbered ? [{ key: "articleNo", label: t.text("col.article"), width: mm(20) }] : []),
    { key: "name", label: t.text("col.name"), width: CONTENT_WIDTH - fixed },
    { key: "quantity", label: t.text("col.quantity"), width: mm(14), align: "right" as const },
    { key: "unit", label: t.text("col.unit"), width: mm(12) },
    { key: "price", label: t.text("col.price"), width: mm(22), align: "right" as const },
    { key: "amount", label: t.text("col.amount"), width: mm(24), align: "right" as const },
  ];
}

/** The summary rows and total of a quote or an invoice basis, by the same rules (reverse VAT, ROT). */
export function quoteSummary(totals: QuotePdfQuote["totals"], tax: { reverseVat: boolean; rotPercent: number | null }, totalLabel: string, t: PdfTexts = pdfTexts("quote")): { rows: KitSumRow[]; total: KitSumTotal } {
  const rows: KitSumRow[] = [
    { label: t.text("sum.net"), value: formatSek(totals.net) },
    tax.reverseVat ? { label: t.text("sum.vat"), value: t.text("vat.reverse") } : { label: t.text("sum.vat.percent", { procent: percentText(totals.vatPercent) }), value: formatSek(totals.vat) },
  ];
  if (totals.rot) {
    rows.push({ label: t.text("sum.gross"), value: formatSek(totals.gross) });
    rows.push({ label: t.text("sum.rot-base"), value: formatSek(totals.rotBaseInclVat) });
    rows.push({ label: `${t.text("sum.rot", { procent: percentText(tax.rotPercent ?? 0) })}${totals.rotCapped ? ` ${t.text("sum.rot.cap")}` : ""}`, value: `−${formatSek(totals.rot)}` });
    return { rows, total: { label: totalLabel, value: `${formatSek(totals.toPay)} kr`, small: t.text("sum.after-rot") } };
  }
  return { rows, total: { label: totalLabel, value: `${formatSek(totals.gross)} kr`, small: tax.reverseVat ? t.text("sum.reverse") : undefined } };
}

export async function createQuotePdf(input: { identity: KitIdentity; fontBytes: ReportFontBytes; quote: QuotePdfQuote; createdAt?: Date }) {
  const { quote } = input;
  const createdAt = input.createdAt ?? new Date();
  const ata = quote.changeOfVersion !== null && quote.changeOfVersion !== undefined;
  // PDF-mallar (2026-11-03): the texts below are the product owner's template, today's words by default.
  const t = pdfTexts("quote", input.identity.templates);
  const own = (id: string) => t.text(ata ? `${id}.ata` : id);
  // The document's own word in its title, on the continuation pages and in the metadata: an ÄTA is no "Offert" there.
  const kind = own("title");
  const date = day(quote.sentAt, createdAt);
  const kit = await createReportKit({ identity: input.identity, fontBytes: input.fontBytes, createdAt, head: {
    kind: t.shown(ata ? "kind.ata" : "kind") ? own("kind") : "", title: kind, number: quote.label,
    dates: [[t.text("head.date"), date], ...(quote.validUntil ? [[t.text("head.valid"), quote.validUntil] as const] : [])],
    continuation: continuationOf(input.identity, `${kind} ${quote.label}`),
  } });
  kit.pdf.setTitle(`${kind} ${quote.label} – ${quote.title}`);
  kit.pdf.setAuthor(input.identity.company || "Workflow");
  kit.pdf.setCreator("Workflow");
  kit.pdf.setProducer("Workflow");
  kit.pdf.setCreationDate(createdAt);
  kit.firstPage();
  if (quote.storedStatus === "DRAFT") kit.band(t.text("band.draft"));

  const customer = quote.customer;
  const facts: KitFact[] = [
    { label: own("fact.receiver"), span: 8, party: { name: customer?.name || t.text("party.none"), lines: [customer?.contactName ? t.text("party.attn", { kontakt: customer.contactName }) : "", customer?.address ?? ""].filter(Boolean) } },
    { label: t.text("fact.subject"), value: quote.title },
    ...(quote.project ? [{ label: t.text("fact.project"), value: quote.project.name }] : []),
    ...(quote.facility ? [{ label: t.text("fact.place"), value: [quote.facility.name, quote.facility.address].filter(Boolean).join(", ") }] : []),
    // Kundtyp only when ROT applies, by the same condition as the ROT sums below (PDF review 2026-11-03, finding 15).
    ...(quote.customerType === "PRIVATE" && quote.totals.rot ? [{ label: t.text("fact.customer-type"), value: t.text("fact.customer-type.rot") }] : []),
    ...(quote.reverseVat && quote.buyerVatNumber ? [{ label: t.text("fact.buyer-vat"), value: quote.buyerVatNumber }] : []),
    ...(ata ? [{ label: t.text("fact.changes"), value: t.text("fact.changes.value", { version: quote.changeOfVersion }) }] : []),
    { label: t.text("fact.vat"), value: quote.reverseVat ? t.text("vat.reverse") : t.text("fact.vat.value", { procent: percentText(quote.totals.vatPercent) }) },
    ...(quote.storedStatus !== "DRAFT" && quote.storedStatus !== "SENT" ? [{ label: t.text("fact.status"), value: QUOTE_STATUS_LABELS[quote.status] }] : []),
  ];
  kit.facts(facts, { cols: 3 });

  if (quote.description.trim() && t.shown(ata ? "section.scope.ata" : "section.scope")) {
    kit.section(own("section.scope"), { keep: 30 });
    for (const text of quote.description.trim().split(/\n{2,}/)) kit.paragraph(text, { after: mm(3) });
  }

  kit.section(t.text("section.spec"), { note: t.shown("spec.note") ? t.text("spec.note") : undefined, keep: 44 });
  if (quote.lines.length) {
    // Art.nr (2026-10-11): the column is drawn only when a line has an article number; never the purchase price or markup.
    const numbered = quote.lines.some((line) => (line.articleNo ?? "").trim());
    kit.table({ title: t.text("section.spec"), columns: specificationColumns(numbered, t), rows: quote.lines.map((line, index) => {
      const numbers = quoteLineNumbers(line);
      return [String(index + 1), ...(numbered ? [(line.articleNo ?? "").trim() || "—"] : []), line.name, line.quantity, line.unit, sek(numbers.saleUnitPrice), sek(numbers.amount)];
    }) });
  } else kit.paragraph(t.text("spec.empty"));

  const totals = quote.totals;
  const notes = sumNotes(t, { reverseVat: Boolean(quote.reverseVat), rot: Boolean(totals.rot), unpriced: totals.unpriced });
  const shownText = (id: string, values?: Record<string, string>) => t.shown(id) ? t.text(id, values) : "";
  const approval = ata
    ? shownText("approval.ata")
    : [quote.validUntil ? shownText("approval.valid", { giltig_till: quote.validUntil }) : "", quote.storedStatus === "DRAFT" ? t.text("approval.draft") : shownText("approval.sent")].filter(Boolean).join(" ");
  // An ÄTA is a new version of the whole quote: the amount is the new total, and the change against the accepted version stands beside it.
  const reverse = Boolean(quote.reverseVat);
  const ataTotal = !ata ? "" : t.text(reverse ? "total.ata.reverse" : totals.rot ? "total.ata.rot" : "total.ata");
  const delta = ata && quote.change ? quoteChangeWithVat(quote.change, reverse ? 0 : totals.vatPercent) : null;
  const changeRow = delta === null ? null : { label: t.text(reverse ? "change.ata.reverse" : totals.rot ? "change.ata.rot" : "change.ata"), value: `${delta > 0 ? "+" : ""}${formatSek(delta)} kr` };
  const summary = quoteSummary(totals, { reverseVat: reverse, rotPercent: quote.rotPercent }, ataTotal || t.text(reverse || totals.rot ? "total.to-pay" : "total.incl"), t);
  kit.sumRow({ title: shownText("approval.heading") || undefined, lines: approval ? [approval] : [], notes }, summary.rows, changeRow ? { ...summary.total, after: [changeRow] } : summary.total);
  const drawPayBox = () => kit.payBox([
    { label: own("pay.number"), value: quote.label },
    { label: t.text("pay.valid"), value: quote.validUntil || "—", key: true },
    { label: t.text("pay.vat"), value: quote.reverseVat ? t.text("vat.reverse") : `${percentText(totals.vatPercent)} %` },
    ...(changeRow ? [changeRow] : []),
    // Under reverse charge no VAT is added, so the amount is not "inkl. moms".
    { label: ataTotal || t.text(totals.rot ? "pay.total.rot" : quote.reverseVat ? "pay.total.reverse" : "pay.total"), value: `${formatSek(totals.rot ? totals.toPay : totals.gross)} kr`, key: true },
  ], senderPayTo(input.identity.sender, { bankgiro: t.text("pay.bankgiro"), plusgiro: t.text("pay.plusgiro") }));
  const drawSignatures = () => kit.signatures([
    { label: t.text("sign.company", { företag: kit.company }), caps: [kit.common.text("sign.name"), kit.common.text("sign.date")] },
    { label: t.text("sign.customer"), caps: [kit.common.text("sign.name"), kit.common.text("sign.place-date")] },
  ]);
  // Ändringar and Villkor in the template's order (the group "end"); the last of them stands with the signatures, so these
  // are never alone on a page. Without either, the payment box does.
  const ends = t.order("end").flatMap((part) => part === "section.changes" && ata && quote.change ? [drawChanges] : part === "section.terms" && quote.terms.trim() ? [drawTerms] : []);
  const last = ends.pop();
  if (last) {
    drawPayBox();
    for (const part of ends) part();
    kit.keep(() => { last(); drawSignatures(); });
  } else kit.keep(() => { drawPayBox(); drawSignatures(); });
  kit.footer();
  return kit.pdf.save();

  function drawChanges() {
    if (!ata || !quote.change) return;
    kit.section(t.text("section.changes"), { note: t.shown("changes.note") ? t.text("changes.note", { version: quote.changeOfVersion ?? "" }) : undefined, keep: 44 });
    if (quote.change.lines.length) {
      const changeLabel = { added: t.text("changes.added"), removed: t.text("changes.removed"), changed: t.text("changes.changed") };
      const qty = (side: { quantity: number } | null) => side ? String(side.quantity).replace(".", ",") : "–";
      const fixed = mm(22) + mm(20) + mm(20) + mm(24);
      kit.table({ title: t.text("changes.title"), columns: [
        { key: "name", label: t.text("changes.col.name"), width: CONTENT_WIDTH - fixed }, { key: "change", label: t.text("changes.col.change"), width: mm(22) },
        { key: "before", label: t.text("changes.col.before"), width: mm(20), align: "right" }, { key: "after", label: t.text("changes.col.after"), width: mm(20), align: "right" }, { key: "delta", label: t.text("changes.col.amount"), width: mm(24), align: "right" }],
      rows: quote.change.lines.map((line) => [line.name, changeLabel[line.change], qty(line.before), qty(line.after), `${line.amountDelta > 0 ? "+" : ""}${formatSek(line.amountDelta)}`]),
      total: [t.text("changes.total"), "", "", "", `${quote.change.netDelta > 0 ? "+" : ""}${formatSek(quote.change.netDelta)}`] });
    } else kit.paragraph(t.text("changes.empty"));
  }

  function drawTerms() {
    if (!quote.terms.trim()) return;
    kit.section(t.text("section.terms"), { keep: 30 });
    for (const text of quote.terms.trim().split(/\n+/)) kit.paragraph(text, { after: mm(1.5) });
  }
}

/**
 * The notes beside the summary of a quote or an invoice basis: the reverse VAT's legal line first, then the template's
 * group "notes" (ROT and rows without a price) in its order.
 */
export function sumNotes(t: PdfTexts, input: { reverseVat: boolean; rot: boolean; unpriced: number }): string[] {
  return [
    ...(input.reverseVat ? [t.text("note.reverse-vat")] : []),
    ...t.order("notes").flatMap((id) => id === "note.rot" ? (input.rot ? [t.text(id)] : []) : id === "note.unpriced" ? (input.unpriced ? [t.text(id, { antal_rader: rowCount(input.unpriced) })] : []) : []),
  ];
}
