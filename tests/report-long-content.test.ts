import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont } from "pdf-lib";
import { drawingText, pdfDrawing, type PdfDrawing } from "./helpers/pdf-drawing";
import { createWorkflowPdfReport, defaultWorkflowReportOptions, type WorkflowReportTask } from "../lib/workflow/report";
import { createQuotePdf } from "../lib/quotes/quote-report";
import { quoteTotals, type QuoteLineView, type QuoteView } from "../lib/quotes/model";
import { createStaffRegisterPdf } from "../lib/staff-register/report";
import type { RegisterEvent } from "../lib/staff-register/model";
import { MARGIN, PAGE_HEIGHT, PAGE_WIDTH } from "../lib/workflow/report-kit";

// Granskning 2026-10-20: reports with long content in Swedish. Every row and sentence of the input is printed, the pages
// are numbered "n / N", empty fields read in Swedish, nothing like "undefined" is printed, and no text runs past the
// right margin or off the page. Fixed data and a fixed creation time only.
const fontBytes = new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf"));
const createdAt = new Date("2026-10-20T12:00:00.000Z");
const company = "Elfirma Åberg & Söner AB";
const squash = (value: string) => value.replace(/\s+/g, "");
const LEFTOVERS = /undefined|null|NaN|\[object Object\]|Invalid Date/;

let measure: PDFFont;
async function font() {
  if (!measure) { const doc = await PDFDocument.create(); doc.registerFontkit(fontkit); measure = await doc.embedFont(fontBytes, { subset: false }); }
  return measure;
}

/** Each drawn string with its position and width, from the text operators (Tf size, TL leading, Tm, T*, Tj). */
async function placed(drawing: PdfDrawing) {
  const f = await font();
  return drawing.pages.map((ops) => {
    let size = 10; let leading = 0; let x = 0; let y = 0;
    const out: { text: string; x: number; y: number; right: number }[] = [];
    for (const op of ops) {
      if (op.op === "Tf") size = op.nums.at(-1) ?? size;
      else if (op.op === "TL") leading = op.nums[0];
      else if (op.op === "Tm") { x = op.nums[4]; y = op.nums[5]; }
      else if (op.op === "Td") { x += op.nums[0]; y += op.nums[1]; }
      else if (op.op === "T*") y -= leading;
      else if (op.op === "Tj" && op.text) out.push({ text: op.text, x, y, right: x + f.widthOfTextAtSize(op.text, size) });
    }
    return out;
  });
}

async function checkPdf(bytes: Uint8Array, name: string) {
  const drawing = await pdfDrawing(bytes);
  const pages = drawingText(drawing);
  pages.forEach((page, index) => {
    assert.match(page, new RegExp(`Sida ${index + 1} av ${pages.length}\\s*$`), `${name}: page ${index + 1} ends with its number`);
    assert.doesNotMatch(page, LEFTOVERS, `${name}: page ${index + 1}`);
  });
  for (const [index, items] of (await placed(drawing)).entries()) for (const item of items) {
    assert.ok(item.x >= MARGIN - 1 && item.right <= PAGE_WIDTH - MARGIN + 1, `${name} page ${index + 1}: "${item.text}" runs outside the margins (${item.x.toFixed(1)}–${item.right.toFixed(1)})`);
    assert.ok(item.y >= 15 && item.y <= PAGE_HEIGHT - 15, `${name} page ${index + 1}: "${item.text}" is off the page (y ${item.y.toFixed(1)})`);
  }
  // The page frame – the head of a following page and the footer – is not part of the content the tests count.
  const frame = (line: string) => company.startsWith(line.replace(/…$/, "")) || /^Sida \d+ av \d+$/.test(line) || /Skapad i Workflow/.test(line) || / · fortsättning$/.test(line) || /^(Arbetsorderrapport|Projektrapport|Offert|Personalliggare)$/.test(line);
  return { pages, all: pages.map((page) => page.split("\n").filter((line) => !frame(line)).join("\n")).join("\n") };
}

const sentences = Array.from({ length: 60 }, (_, i) => `Mening ${String(i + 1).padStart(3, "0")}: åtgärdade jordfelsbrytare och märkte grupp ${i + 1} i centralen.`);
const materials = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, name: `Kabel EKKJ 3G1,5 rulle ${String(i + 1).padStart(3, "0")} åäö`, quantity: String(i + 1), unit: "m" }));
const workOrder: WorkflowReportTask = {
  id: "wo", kind: "WORK_ORDER", title: "Byte av elcentral – Åsa Öberg ”Hus B”", description: "Beskrivning med å ä ö", status: "COMPLETED", progress: 100,
  customerName: "Bostadsrättsföreningen Ängsbacken i Västerås", assignedToName: "", dueDate: "", totalDurationSec: 3 * 3600 + 15 * 60,
  data: { kind: "WORK_ORDER", details: { executionNotes: sentences.join(" "), deviations: "Lock saknas på dosa – åtgärdas.", materials, signature: { name: "Åsa Ödmark", confirmed: true, signedAt: "2026-10-20T08:00:00.000Z" }, closeNotes: "" } },
  attachments: [],
};

test("a long work order: every sentence and material row, three numbered pages, Swedish time and empty fields", async () => {
  const { pages, all } = await checkPdf(await createWorkflowPdfReport({ company, tasks: [workOrder], options: defaultWorkflowReportOptions, fontBytes, createdAt }), "work order");
  assert.ok(pages.length >= 3);
  for (const sentence of sentences) assert.ok(squash(all).includes(squash(sentence)), sentence);
  for (const row of materials) assert.equal(all.split(row.name).length - 1, 1, `${row.name} printed once`);
  assert.match(pages[0], /Skapad\s+2026-10-20 14:00/, "the creation time in Swedish time (CEST)");
  assert.match(pages[0], /Inte tilldelad/);
  assert.match(all, /Åsa Ödmark/);
  assert.match(all, /3 h 15 min/);
  assert.match(pages[1], /fortsättning/);
});

test("a project report with a risk assessment of 25 risks prints every risk", async () => {
  const risks = Array.from({ length: 25 }, (_, i) => ({ hazard: `Risk ${String(i + 1).padStart(2, "0")}: spänningsförande del i fack ${i + 1} – åtkomlig`, likelihood: 1 + (i % 5), consequence: 1 + ((i * 2) % 5), protectiveMeasure: `Åtgärd ${i + 1}: bryt och lås, mät spänningslöshet`, residualLikelihood: 1, residualConsequence: 1 + (i % 3) }));
  const risk: WorkflowReportTask = { id: "ra", kind: "RISK_ASSESSMENT", title: "Riskbedömning Hus B", description: "", status: "COMPLETED", progress: 100, assignedToName: "Åsa Ödmark", dueDate: "2026-10-30", totalDurationSec: 0,
    data: { kind: "RISK_ASSESSMENT", details: { risks, generalMeasures: "Avspärrning och skyltning.", approval: { name: "Örjan Ågren", confirmed: true, approvedAt: "2026-10-19T06:00:00.000Z" } } }, attachments: [] };
  const { all } = await checkPdf(await createWorkflowPdfReport({ company, projectName: "Projekt Ängsbacken", tasks: [workOrder, risk], options: defaultWorkflowReportOptions, fontBytes, createdAt }), "project report");
  for (const item of risks) {
    assert.ok(squash(all).includes(squash(item.hazard)), item.hazard);
    assert.ok(squash(all).includes(squash(item.protectiveMeasure)), item.protectiveMeasure);
  }
  assert.match(all, /Örjan Ågren/);
});

test("a quote with 60 lines prints every line and its sum, never the purchase price", async () => {
  const lines: QuoteLineView[] = Array.from({ length: 60 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, kind: i % 6 === 5 ? "LABOUR" : "MATERIAL", name: `Rad ${String(i + 1).padStart(2, "0")} – Jordfelsbrytare åäö`, quantity: "2", unit: i % 6 === 5 ? "h" : "st", unitPrice: "123,45", markupPercent: "20" }));
  const quote: QuoteView = {
    id: "q", number: 42, version: 1, label: "O-0042", revision: 1, title: "Offert elcentral Ängsbacken", description: "Omfattning: byte av central.", status: "DRAFT", storedStatus: "DRAFT",
    validUntil: "2026-11-20", terms: "Betalning 30 dagar netto.", vatPercent: 25, customer: { id: "c", name: "Brf Ängsbacken" }, facility: null, project: null, lines,
    totals: quoteTotals(lines, 25), sentAt: null, decidedAt: null, createdAt: "2026-10-20T07:00:00.000Z", updatedAt: "2026-10-20T08:00:00.000Z", superseded: false,
    versions: [], actions: [], canEdit: true, customerType: "COMPANY", rotEnabled: false, rotPercent: 30, rotCap: 50000, changeOfVersion: null, change: null, workOrder: null, workOrders: [], canCreateWorkOrder: false,
  } as unknown as QuoteView;
  const { pages, all } = await checkPdf(await createQuotePdf({ identity: { company }, fontBytes, quote, createdAt }), "quote");
  assert.ok(pages.length >= 2);
  for (const line of lines) assert.equal(all.split(line.name).length - 1, 1, `${line.name} printed once`);
  assert.ok(!all.includes("123,45"), "the purchase price is never printed");
});

test("a staff register with 150 events prints every event in order", async () => {
  const at = (minutes: number) => new Date(Date.parse("2026-10-24T22:00:00.000Z") + minutes * 60_000);
  const events: RegisterEvent[] = Array.from({ length: 150 }, (_, i) => ({ id: `e${i}`, personId: `p${i % 15}`, personName: `Person ${String(i % 15 + 1).padStart(2, "0")} Åström`, idNumber: `19800101-${String(1000 + (i % 15))}`, employerName: "Elfirma Åberg & Söner AB", employerOrgNo: "556000-0000",
    kind: i % 2 ? "OUT" : "IN", occurredAt: at(i * 7), registeredAt: at(i * 7), registeredByName: "Åsa Ödmark", correctsId: null, reason: "", siteId: "ABC123" }));
  const { pages, all } = await checkPdf(await createStaffRegisterPdf({ identity: { company }, fontBytes, projectName: "Projekt Ängsbacken", siteId: "ABC123", company: { name: company, orgNo: "556000-0000" }, from: "2026-10-25", to: "2026-10-25", events, onSite: [], now: createdAt }), "staff register");
  assert.ok(pages.length >= 3);
  for (let person = 1; person <= 15; person += 1) assert.ok(squash(all).includes(squash(`Person ${String(person).padStart(2, "0")} Åström`)));
  // The night of the October change: 02:00–02:59 happens twice and both are printed as they happened.
  // Events every 7 minutes from 00:00: 8 fall in the first 02-hour and 9 in the second; each prints its time and its registration time.
  assert.equal((all.match(/2026:10:25\s+02:/g) ?? []).length, 17 * 2, "events in both 02-hours are printed (time and registration time)");
});
