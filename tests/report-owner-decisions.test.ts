import assert from "node:assert/strict";
import test from "node:test";
import { createQuotePdf, type QuotePdfQuote } from "@/lib/quotes/quote-report";
import { quoteChangeWithVat, quoteTotals, quoteVersionDiff, type QuoteLineView } from "@/lib/quotes/model";
import { createFormProtocolPdf } from "@/lib/workflow/form-report";
import { createWorkflowPdfReport, defaultWorkflowReportOptions, protocolNumberOf, type WorkflowReportTask } from "@/lib/workflow/report";
import { sampleFormValues } from "@/lib/workflow/form-sample";
import { BUILTIN_FORMS } from "@/lib/workflow/builtin-forms";
import { ROUND_FORMS } from "@/lib/workflow/builtin-rounds";
import { pdfTexts } from "@/lib/pdf-templates/catalog";
import { withoutRate } from "@/lib/workflow/expenses";
import { drawingText, pdfDrawing } from "./helpers/pdf-drawing";
import { reportFontBytes } from "./helpers/report-font";

const createdAt = new Date("2026-11-04T08:00:00.000Z");
const fontBytes = reportFontBytes();
const textOf = async (bytes: Uint8Array) => drawingText(await pdfDrawing(bytes)).join("\n").replace(/ /g, " ").replace(/\s+/g, " ");

const line = (id: string, name: string, quantity: string, unitPrice: string): QuoteLineView => ({ id, kind: "MATERIAL", name, quantity, unit: "st", unitPrice, markupPercent: "" }) as QuoteLineView;
const accepted = [line("a", "Armatur", "2", "1000"), line("b", "Sensor", "4", "500")];
function quote(lines: QuoteLineView[], patch: Partial<QuotePdfQuote> = {}, base: QuoteLineView[] | null = accepted, vat = 25): QuotePdfQuote {
  return {
    label: "O-1 v2", title: "Arbete", description: "", status: "SENT", storedStatus: "SENT", validUntil: "2026-12-01", terms: "", customerType: "COMPANY", rotPercent: null, reverseVat: false, buyerVatNumber: "",
    changeOfVersion: base ? 1 : null, change: base ? quoteVersionDiff(base, lines) : null, customer: null, facility: null, project: null, lines, totals: quoteTotals(lines, vat), sentAt: "2026-11-03T08:00:00.000Z", ...patch,
  } as QuotePdfQuote;
}
const quoteText = async (input: QuotePdfQuote) => textOf(await createQuotePdf({ identity: { company: "QA" }, fontBytes, quote: input, createdAt }));

test("an ÄTA's change including VAT is the difference between the versions' totals, rounded as a total is", () => {
  assert.equal(quoteChangeWithVat({ netBefore: 4000, netAfter: 5000 }, 25), 1250);
  assert.equal(quoteChangeWithVat({ netBefore: 5000, netAfter: 4000 }, 25), -1250);
  assert.equal(quoteChangeWithVat({ netBefore: 10, netAfter: 10.03 }, 25), 0.04);
  assert.equal(quoteChangeWithVat({ netBefore: 4000, netAfter: 5000 }, 0), 1000);
});

test("an ÄTA says Ny total inkl. moms and the change in both boxes, with a real difference", async () => {
  const text = await quoteText(quote([...accepted, line("c", "Nödljus", "1", "1000")]));
  assert.equal(text.match(/Ny total inkl\. moms/g)?.length, 2, "the summary box and the payment box");
  assert.equal(text.match(/Ändring inkl\. moms/g)?.length, 2);
  assert.ok(text.includes("+1 250,00 kr"));
  assert.ok(text.includes("6 250,00 kr"));
  assert.ok(!text.includes("Att betala") && !text.includes("Totalt inkl. moms"));
});

test("a negative change has its minus sign", async () => {
  const text = await quoteText(quote([accepted[0], line("b", "Sensor", "2", "500")]));
  assert.ok(text.includes("-1 250,00 kr"));
  assert.ok(!text.includes("+"));
});

test("a reverse-charge ÄTA has no inkl. moms in its total or change", async () => {
  const text = await quoteText(quote([...accepted, line("c", "Nödljus", "1", "1000")], { reverseVat: true, buyerVatNumber: "SE556000000201" }, accepted, 0));
  assert.equal(text.match(/Ny total/g)?.length, 2);
  assert.ok(!/inkl\. moms/.test(text));
  assert.ok(text.includes("+1 000,00 kr"));
});

test("a normal quote reads as before", async () => {
  const text = await quoteText(quote(accepted, {}, null));
  assert.ok(text.includes("Totalt inkl. moms") && text.includes("Att betala inkl. moms"));
  assert.ok(!/Ny total|Ändring inkl/.test(text));
});

test("a car cost's rate is left out of its name, and the rest stays", () => {
  assert.equal(withoutRate("Bilkostnad: tur och retur 2 × 18 km (fågelvägen) × 35 kr/mil"), "Bilkostnad: tur och retur 2 × 18 km (fågelvägen)");
  assert.equal(withoutRate("Bilkostnad: enkel resa 23,4 km (längs väg) × 3,5 kr/km"), "Bilkostnad: enkel resa 23,4 km (längs väg)");
  assert.equal(withoutRate("Parkering"), "Parkering");
});

const workOrder = (id: string): WorkflowReportTask => ({
  id, kind: "WORK_ORDER", title: `Order ${id}`, description: "", status: "COMPLETED", progress: 100, assignedToName: "QA", dueDate: "", totalDurationSec: 3600, completedAt: "2026-11-02T14:00:00.000Z", attachments: [],
  billedLabour: { standardSec: 3600, own: [{ name: "Restid", seconds: 1800, rate: 450 }] },
  data: { kind: "WORK_ORDER", details: { executionNotes: "Bytt", deviations: "", closeNotes: "", signature: { name: "QA", confirmed: true, signedAt: "2026-11-02T14:00:00.000Z" }, materials: [
    { name: "Kabel", quantity: "10", unit: "m", unitPrice: "12,5", markupPercent: "20" },
    { name: "Parkering", quantity: "1", unit: "st", kind: "expense", unitPrice: "60,00", amount: "60,00" },
    { name: "Bilkostnad: tur och retur 2 × 18 km (fågelvägen) × 35 kr/mil", quantity: "36", unit: "km", kind: "expense", unitPrice: "3,50", amount: "126,00", carCost: { distanceKm: 18, roundTrip: true, pricePerKm: 3.5, basis: "straight_line" } },
  ] } },
}) as WorkflowReportTask;
const AMOUNTS = /\d,\d{2}\b|\bkr\b|kr\/|À-pris|Belopp|Summa utgifter|Totalt|exkl\. moms/;

test("with prices off no amount appears in a work order report or a project report", async () => {
  const options = defaultWorkflowReportOptions;
  const single = await textOf(await createWorkflowPdfReport({ company: "QA", tasks: [workOrder("a")], options, fontBytes, hourlyRate: 720, createdAt }));
  const project = await textOf(await createWorkflowPdfReport({ company: "QA", title: "Projektrapport", projectName: "Projekt", tasks: [workOrder("a"), workOrder("b")], options, fontBytes, hourlyRate: 720, createdAt }));
  for (const text of [single, project]) {
    assert.doesNotMatch(text, AMOUNTS);
    assert.ok(text.includes("Parkering") && text.includes("Bilkostnad: tur och retur 2 × 18 km (fågelvägen)"), "what the expense is stays");
  }
  // The same report with the option on has them all.
  const priced = await textOf(await createWorkflowPdfReport({ company: "QA", tasks: [workOrder("a")], options: { ...options, prices: true }, fontBytes, hourlyRate: 720, createdAt }));
  assert.ok(priced.includes("Summa utgifter") && priced.includes("35 kr/mil") && priced.includes("Totalt"));
});

function formTask(form: (typeof ROUND_FORMS)[number], id: string): WorkflowReportTask {
  return { id, kind: "FORM", formArea: "forms", title: "T", description: "", status: "COMPLETED", progress: 100, assignedToName: "QA", dueDate: "", totalDurationSec: 0, protocolNumber: protocolNumberOf(id), completedAt: "2026-11-02T14:00:00.000Z", attachments: [],
    data: { kind: "FORM", details: { templateName: form.meta.name, templateVersion: 1, document: form.document, values: sampleFormValues(form.document, { deviations: false, today: "2026-11-02" }) } } } as WorkflowReportTask;
}

test("the end's heading follows the form's definition, not what is filled in", async () => {
  const own = BUILTIN_FORMS.find((form) => form.meta.name === "Fortlöpande kontroll")!;
  const t = pdfTexts("protocol");
  assert.equal(t.text("section.signing.own"), "Färdigställande och kvittens");
  const filled = formTask(own, "own-1");
  const text = await textOf(await createFormProtocolPdf({ identity: { company: "QA" }, fontBytes, task: filled, options: defaultWorkflowReportOptions, createdAt }));
  assert.ok(text.includes("Färdigställande och kvittens"));
  // The same form with its signature fields empty says the same.
  const details = (filled.data as Extract<WorkflowReportTask["data"], { kind: "FORM" }>).details;
  const empty = { ...filled, data: { kind: "FORM", details: { ...details, values: { ...details.values, signatures: {} } } } } as WorkflowReportTask;
  assert.ok((await textOf(await createFormProtocolPdf({ identity: { company: "QA" }, fontBytes, task: empty, options: defaultWorkflowReportOptions, createdAt }))).includes("Färdigställande och kvittens"));
  // A form without signature fields keeps Signering.
  const none = { ...own, document: { ...own.document, blocks: own.document.blocks.map((block) => block.type === "section" ? { ...block, blocks: block.blocks.filter((item) => item.type !== "signature") } : block) } };
  const plain = await textOf(await createFormProtocolPdf({ identity: { company: "QA" }, fontBytes, task: formTask(none as (typeof ROUND_FORMS)[number], "own-2"), options: defaultWorkflowReportOptions, createdAt }));
  assert.ok(plain.includes("Signering") && !plain.includes("Färdigställande och kvittens"));
});
