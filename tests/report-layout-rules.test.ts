import assert from "node:assert/strict";
import test from "node:test";
import { createReportKit, CONTINUED_ROOM, TOP, wrap, wrapHanging } from "@/lib/workflow/report-kit";
import { createFormProtocolPdf } from "@/lib/workflow/form-report";
import { defaultWorkflowReportOptions, protocolNumberOf, type WorkflowReportTask } from "@/lib/workflow/report";
import { sampleFormValues } from "@/lib/workflow/form-sample";
import { ROUND_FORMS } from "@/lib/workflow/builtin-rounds";
import { drawingText, pdfDrawing } from "./helpers/pdf-drawing";
import { reportFontBytes } from "./helpers/report-font";

// Every character is as wide as its count, so a line break can be predicted exactly.
const chars = { widthOfTextAtSize: (text: string) => text.length };
const lines = (text: string, width: number) => wrap(chars, text, 1, width);

test("a number stays with its unit at a line break", () => {
  assert.deepEqual(lines("debiteras löpande 695 kr/h.", 22), ["debiteras löpande", "695 kr/h."]);
  assert.deepEqual(lines("och ommätt till 0,27 Ω.", 19), ["och ommätt till", "0,27 Ω."]);
  assert.deepEqual(lines("Kompletteringsgrad: 100 %", 22), ["Kompletteringsgrad:", "100 %"]);
  assert.deepEqual(lines("Spänningen är 230 Vac", 18), ["Spänningen är", "230 Vac"]);
});

test("a legal reference and the groups of a number stay whole", () => {
  assert.deepEqual(lines("enligt ELSÄK-FS 2017:3 3 kap. 13 §", 24), ["enligt ELSÄK-FS 2017:3", "3 kap. 13 §"]);
  assert.deepEqual(lines("Att betala nu 22 287,50 kr", 18), ["Att betala nu", "22 287,50 kr"]);
});

test("the wrap gives up a pair that cannot fit, and leaves other words free to part", () => {
  assert.deepEqual(lines("1000000 kr/h", 8), ["1000000", "kr/h"]);
  assert.deepEqual(lines("Grupp 7 diskmaskin", 8), ["Grupp 7", "diskmaskin".slice(0, 8), "diskmaskin".slice(8)]);
  assert.deepEqual(lines("Plan 3 hus", 7), ["Plan 3", "hus"]);
});

test("the separator never starts or ends a line", () => {
  assert.deepEqual(lines("Vägen 1 · 070-000 00 00 · info@example.se", 25), ["Vägen 1 · 070-000 00 00", "info@example.se"]);
  assert.deepEqual(lines("Vägen 1 · 070-000", 8), ["Vägen 1", "070-000"]);
  assert.deepEqual(lines("A · B · C", 20), ["A · B · C"], "inside a line it stays");
  for (let width = 6; width < 40; width++) for (const line of lines("Exempelvägen 1 · 123 45 Stad · 070-000 00 00 · info@example.se", width)) assert.doesNotMatch(line, /^·|·$/, `at width ${width}: "${line}"`);
});

test("a list item hangs under its own text", () => {
  const item = wrapHanging(chars, "• Rätt skyddsutrustning finns, är hel och används", 1, 24);
  assert.equal(item.marker, "•");
  assert.equal(item.indent, 2);
  assert.ok(item.lines.length >= 2);
  assert.ok(item.lines.every((line) => line.length <= 22 && !line.startsWith("•")), "every line has room for the indent");
  assert.deepEqual(wrapHanging(chars, "1.  Ett steg", 1, 40), { marker: "1.", indent: 3, lines: ["Ett steg"] });
  assert.deepEqual(wrapHanging(chars, "Inget märke", 1, 40), { marker: "", indent: 0, lines: ["Inget märke"] });
});

async function testKit() {
  const kit = await createReportKit({ identity: { company: "QA" }, fontBytes: reportFontBytes(), head: { kind: "", title: "T", number: "N" }, createdAt: new Date("2026-11-04T08:00:00Z") });
  kit.firstPage();
  return kit;
}
const fill = (kit: Awaited<ReturnType<typeof testKit>>, roomLeft: number) => { kit.y = roomLeft + 70.87; kit.last = "other"; };

test("a block kept together moves whole to the next page when it does not fit", async () => {
  const kit = await testKit();
  fill(kit, 100);
  const block = () => { kit.section("Rubrik"); for (let n = 0; n < 12; n++) kit.paragraph(`Rad ${n}`); };
  kit.keep(block);
  assert.equal(kit.pageNumber, 2);
  assert.ok(kit.y < TOP && kit.y > 70.87);
});

test("a block that fits stays, measuring leaves no trace, and one too tall for a page flows from where it is", async () => {
  const kit = await testKit();
  const before = { y: kit.y, page: kit.pageNumber, last: kit.last, heading: kit.lastHeading };
  const height = kit.measure(() => { kit.section("Rubrik"); kit.paragraph("En rad"); kit.table({ title: "T", columns: [{ key: "a", label: "A", width: 200 }], rows: [["x"]] }); }).height;
  assert.ok(height > 0);
  assert.deepEqual({ y: kit.y, page: kit.pageNumber, last: kit.last, heading: kit.lastHeading }, before);
  assert.equal(kit.pdf.getPageCount(), 1);
  kit.keep(() => kit.paragraph("Kort text"));
  assert.equal(kit.pageNumber, 1);
  fill(kit, 100);
  const tall = () => { for (let n = 0; n < 80; n++) kit.paragraph(`Rad ${n}`, { after: 0 }); };
  assert.ok(kit.measure(tall).height > CONTINUED_ROOM);
  const page = kit.pageNumber;
  const yBefore = kit.y;
  kit.makeRoom(kit.measure(tall));
  assert.equal(kit.pageNumber, page, "too tall to keep: no empty rest of the page");
  assert.equal(kit.y, yBefore);
});

test("a forced page break inside a block is not kept", async () => {
  const kit = await testKit();
  fill(kit, 40);
  assert.equal(kit.measure(() => { kit.paragraph("Före"); kit.addPage(); kit.paragraph("Efter"); }).breaks, 1);
  assert.equal(kit.pdf.getPageCount(), 1, "measuring adds no page");
});

test("the wrap keeps a price, a row reference, a regulation and a date with its time", () => {
  assert.deepEqual(lines("debiteras löpande à 695 kr/h.", 24), ["debiteras löpande", "à 695 kr/h."]);
  assert.deepEqual(lines("Rättar rad 7: Glömde", 12), ["Rättar", "rad 7:", "Glömde"]);
  assert.deepEqual(lines("enligt ELSÄK-FS 2017:3, 3 kap. 2 §", 18), ["enligt", "ELSÄK-FS 2017:3,", "3 kap. 2 §"]);
  assert.deepEqual(lines("2026:11:02 06:31:00, Erik Exempel", 20), ["2026:11:02 06:31:00,", "Erik Exempel"]);
});

test("names in a signature row stand on one line, whatever each signer has", async () => {
  const kit = await testKit();
  const before = kit.y;
  kit.signatures([{ label: "A", name: "2026-11-02 15:10" }, { label: "B", name: "Anna Påhitt", note: "Kvitterat" }]);
  assert.equal(kit.pageNumber, 1);
  const { pages } = await pdfDrawing(await kit.pdf.save());
  const yOf = (text: string) => { const at = pages[0].findIndex((op) => op.text === text); return pages[0].slice(0, at).reverse().find((op) => op.op === "Tm" || op.op === "Td")?.nums.at(-1); };
  assert.ok(before > kit.y);
  assert.equal(yOf("2026-11-02 15:10"), yOf("Anna Påhitt"));
});

test("a list keeps room for what must follow its last items, and only those move", async () => {
  const kit = await testKit();
  fill(kit, 140);
  kit.list(["• Ett", "• Två", "• Tre", "• Fyra", "• Fem"], { keepAfter: 100 });
  assert.equal(kit.pageNumber, 2, "the last two items go to the next page with what follows");
  const rest = kit.y;
  const fresh = await testKit();
  fresh.addPage();
  assert.ok(fresh.y - rest < 40, "only the last two items stand on the new page");
});

test("a list keeps its last two items together and ends with a paragraph's air", async () => {
  const kit = await testKit();
  fill(kit, 40);
  kit.list(["• Ett", "• Två", "• Tre"]);
  // Two lines fit in the 40 points, three do not: the last item may not stand alone, so the second goes with it.
  assert.equal(kit.pageNumber, 2);
  assert.ok(Math.abs(kit.gapBelow - (2.5 * 72) / 25.4) < 0.01);
});

test("a divider is not drawn right after a page break", async () => {
  const kit = await testKit();
  // The block's own lines end just above the page's foot, so the break comes right before its divider.
  fill(kit, 70);
  kit.gapBelow = 100;
  kit.drawObject({ title: "Objekt", result: null, metrics: [], comment: "Rad 1\nRad 2\nRad 3" }, {});
  assert.equal(kit.pageNumber, 2);
  const fresh = await testKit();
  fresh.addPage();
  assert.equal(kit.y, fresh.y, "nothing is drawn at the top of the new page, the rule's room included");
  // Elsewhere the divider and its room are there.
  const elsewhere = await testKit();
  const top = elsewhere.y;
  elsewhere.drawObject({ title: "Objekt", result: null, metrics: [], comment: null }, {});
  assert.equal(elsewhere.pageNumber, 1);
  assert.ok(top - elsewhere.y > 25);
});

test("the end of a protocol is not alone: the summary and the signatures stay on one page", async () => {
  const form = ROUND_FORMS.find((item) => /pumpstation/i.test(item.meta.name))!;
  const id = "prot-layout-1";
  const task: WorkflowReportTask = {
    id, kind: "FORM", formArea: "forms", title: "Pumpstation", description: "", status: "COMPLETED", progress: 100, customerName: "Kund", projectName: "Projekt", facilityName: "Plats", workOrderTitle: "Order",
    assignedToName: "Tekniker", dueDate: "2026-11-05", totalDurationSec: 60, protocolNumber: protocolNumberOf(id), completedAt: "2026-11-02T14:10:00.000Z", customerReceipt: { name: "Kund", at: "2026-11-02T14:15:00.000Z" }, attachments: [],
    data: { kind: "FORM", details: { templateName: form.meta.name, templateVersion: 3, document: form.document, values: sampleFormValues(form.document, { deviations: true, today: "2026-11-02" }) } },
  };
  const bytes = await createFormProtocolPdf({ identity: { company: "QA" }, fontBytes: reportFontBytes(), task, options: defaultWorkflowReportOptions, createdAt: new Date("2026-11-03T08:00:00Z") });
  const pages = drawingText(await pdfDrawing(bytes));
  const of = (word: string) => pages.findIndex((page) => page.includes(word));
  assert.ok(of("Slutomdöme") >= 0);
  assert.equal(of("Slutomdöme"), pages.findIndex((page) => page.includes("Kundens kvittens")));
  assert.equal(of("Kompletteringsgrad"), of("Slutomdöme"), "the summary's last lines stand with the verdict and the signatures");
});
