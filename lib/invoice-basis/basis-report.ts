import { formatSwedish } from "@/lib/swedish-time";
import { formatSek } from "@/lib/workflow/expenses";
import { continuationOf, createReportKit, REPORT_TONES, senderPayTo, type KitFact, type KitIdentity } from "@/lib/workflow/report-kit";
import type { ReportFontBytes } from "@/lib/workflow/report-fonts";
import { quoteLineNumbers } from "@/lib/quotes/model";
import { quoteSummary, specificationColumns, sumNotes } from "@/lib/quotes/quote-report";
import { pdfTexts } from "@/lib/pdf-templates/catalog";
import type { InvoiceBasisView } from "./model";

/**
 * Fakturaunderlaget som dokument (2026-11-01; the design Förslag B 2026-11-03, template 03-fakturaunderlag): drawn
 * with the report kit like every document, in the company's colours. The band "Internt underlag – ej faktura" says what it
 * is; the facts grid holds the customer, the work order, the project and the status; then the specification, the summary
 * box with "Att fakturera", the payment box (Förslag A) and the signature block for the attest and the invoice number. It
 * shows the selling prices only, never the purchase price, the markup or the internal note. With reverse VAT or ROT it
 * states the choice and its sums, counted by the quote's own rule.
 */
const percentText = (value: number) => String(value).replace(".", ",");
export const INVOICE_BASIS_NOT_INVOICE = "INTERNT UNDERLAG – EJ FAKTURA";

export async function createInvoiceBasisPdf(input: { identity: KitIdentity; fontBytes: ReportFontBytes; basis: InvoiceBasisView; createdAt?: Date }) {
  const { basis } = input;
  const createdAt = input.createdAt ?? new Date();
  const date = formatSwedish(basis.invoicedAt ?? createdAt, { dateStyle: "short" });
  // PDF-mallar (2026-11-03): the product owner's texts, today's words by default.
  const t = pdfTexts("invoice_basis", input.identity.templates);
  const title = t.text("title");
  const kit = await createReportKit({ identity: input.identity, fontBytes: input.fontBytes, createdAt, head: {
    kind: t.shown("kind") ? t.text("kind") : "", title, number: basis.label,
    dates: [[t.text("head.created"), formatSwedish(basis.createdAt || createdAt, { dateStyle: "short" })], ...(basis.invoicedAt ? [[t.text("head.invoiced"), date] as const] : [])],
    continuation: continuationOf(input.identity, `${title} ${basis.label}`),
  } });
  kit.pdf.setTitle(`${title} ${basis.label} – ${basis.title}`);
  kit.pdf.setAuthor(input.identity.company || "Workflow");
  kit.pdf.setCreator("Workflow");
  kit.pdf.setProducer("Workflow");
  kit.pdf.setCreationDate(createdAt);
  kit.firstPage();

  const tax = basis.tax;
  const customerRot = basis.customerType === "PRIVATE" && tax?.rotEnabled;
  const invoiced = basis.status === "INVOICED";
  const facts: KitFact[] = [
    { label: t.text("fact.customer"), span: 8, party: { name: basis.customer?.name || t.text("party.none"), lines: [basis.customer?.contactName ? t.text("party.attn", { kontakt: basis.customer.contactName }) : "", basis.customer?.address ?? ""].filter(Boolean) } },
    { label: t.text("fact.subject"), value: basis.title },
    ...(basis.task ? [{ label: t.text("fact.order"), value: basis.task.title }] : []),
    ...(basis.project ? [{ label: t.text("fact.project"), value: basis.project.name }] : []),
    { label: t.text("fact.status"), value: basis.status === "DRAFT" ? "Utkast" : invoiced ? "Fakturerat" : "Ej fakturerat", tone: invoiced ? REPORT_TONES.pass : REPORT_TONES.warning },
    ...(invoiced && basis.invoicedByName ? [{ label: t.text("fact.invoiced-by"), value: `${basis.invoicedByName}, ${date}` }] : []),
    ...(tax?.reverseVat && tax.buyerVatNumber ? [{ label: t.text("fact.buyer-vat"), value: tax.buyerVatNumber }] : []),
  ];
  kit.facts(facts, { cols: 3 });
  kit.band(basis.status === "DRAFT" ? `${t.text("band.draft")} · ${t.text("band.internal")}` : t.text("band.internal"));

  kit.section(t.text("section.spec"), { note: t.shown("spec.note") ? t.text("spec.note") : undefined, keep: 44 });
  if (basis.lines.length) {
    const numbered = basis.lines.some((line) => (line.articleNo ?? "").trim());
    kit.table({ title: t.text("section.spec"), columns: specificationColumns(numbered, t), rows: basis.lines.map((line, index) => {
      const numbers = quoteLineNumbers(line);
      const name = customerRot && line.rotLabour ? `${line.name} ${t.text("line.rot")}` : line.name;
      return [String(index + 1), ...(numbered ? [(line.articleNo ?? "").trim() || "—"] : []), name, line.quantity, line.unit, numbers.saleUnitPrice === null ? "" : formatSek(numbers.saleUnitPrice), numbers.amount === null ? "" : formatSek(numbers.amount)];
    }) });
  } else kit.paragraph(t.text("spec.empty"));

  const { totals } = basis;
  const notes = sumNotes(t, { reverseVat: Boolean(tax?.reverseVat), rot: Boolean(totals.rot), unpriced: totals.unpriced });
  const summary = quoteSummary(totals, { reverseVat: Boolean(tax?.reverseVat), rotPercent: tax?.rotPercent ?? null }, t.text("total.invoice"), t);
  const state = invoiced ? (basis.invoicedByName ? t.text("state.invoiced.by", { datum: date, namn: basis.invoicedByName }) : t.text("state.invoiced", { datum: date })) : t.shown("sum.pending") ? t.text("sum.pending") : "";
  kit.sumRow({ title: t.shown("sum.heading") ? t.text("sum.heading") : undefined, lines: state ? [state] : [], notes }, summary.rows, { ...summary.total, small: summary.total.small ?? t.text("total.incl") });
  kit.keep(() => {
    kit.payBox([
      { label: t.text("pay.basis"), value: basis.label },
      { label: t.text("pay.status"), value: basis.status === "DRAFT" ? "Utkast" : invoiced ? `Fakturerat ${date}` : "Ej fakturerat", key: true },
      { label: t.text("pay.vat"), value: tax?.reverseVat ? t.text("vat.reverse") : `${percentText(totals.vatPercent)} %` },
      // Under reverse charge no VAT is added, so the amount is not "inkl. moms".
      { label: t.text(totals.rot ? "pay.total.rot" : tax?.reverseVat ? "pay.total.reverse" : "pay.total"), value: `${formatSek(totals.rot ? totals.toPay : totals.gross)} kr`, key: true },
    ], senderPayTo(input.identity.sender, { bankgiro: t.text("pay.bankgiro"), plusgiro: t.text("pay.plusgiro") }));
    // invoicedAt and invoicedByName say who marked the basis as invoiced and when, no attest: that signature is left to be
    // written by hand, and the invoicing stands under its own line with room above for the invoice number.
    kit.signatures([
      { label: t.text("sign.attest") },
      { label: t.text("sign.invoice"), caps: invoiced ? [basis.invoicedByName || kit.common.text("sign.name"), date] : undefined },
    ]);
  });
  kit.footer();
  return kit.pdf.save();
}
