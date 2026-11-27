// Exportera på Avvikelser (2026-10-30): the pure parts of lib/self-inspection/deviation-export.ts – which entries a
// file may hold (the read rule again, whoever calls it), the CSV's columns and rows per chosen part, the file names, the
// photos a PDF draws, and that the PDF is made with the report kit and holds no authority text.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  authorityText, createDeviationsPdf, DEVIATION_EXPORT_PHOTO_MAX, deviationCsvHeader, deviationCsvRow, deviationEntryLabel, deviationExportFilename, deviationsCsv,
  exportableDeviations, exportPhotoIds, type DeviationExportEntry,
} from "../lib/self-inspection/deviation-export";
import { SERIOUS_NOTICE } from "../lib/self-inspection/incidents";
import { drawingText, pdfDrawing } from "./helpers/pdf-drawing";

const base: DeviationExportEntry = {
  id: "d1", number: 1, kind: "DEVIATION", title: "Saknad märkning", description: "Gruppförteckning saknas", category: "ROUTINE", systematic: false, status: "OPEN",
  action: "Märk centralen", responsibleId: "resp", responsibleName: "Rune Ansvarig", dueDate: "2026-11-01", followUp: "", reportedById: "worker", reportedByName: "Mats Montör",
  createdAt: "2026-10-30T08:00:00.000Z", updatedAt: "2026-10-30T08:00:00.000Z", closedAt: null, source: null, type: "SELF_INSPECTION",
};
const nearMiss: DeviationExportEntry = { ...base, id: "d2", number: 2, title: "Stege gled", type: "NEAR_MISS", responsibleId: "lead", responsibleName: "Lena Ledare", reportedById: "worker",
  occurredAt: "2026-10-29T13:15:00.000Z", whatHappened: "Gled på vått golv", cause: "Spill", serious: true, electrical: true, reportedToAuthorityAt: "2026-10-30T09:00:00.000Z", reportedToAuthorityByName: "Berit Chef",
  attachments: [{ id: "p1", phase: "BEFORE", filename: "stege.jpg", mimeType: "image/jpeg", size: 10, createdById: "worker", createdAt: "2026-10-30T08:00:00.000Z" },
    { id: "p2", phase: "AFTER", filename: "klar.webp", mimeType: "image/webp", size: 10, createdById: "lead", createdAt: "2026-10-30T10:00:00.000Z" }] };
const others: DeviationExportEntry = { ...base, id: "d3", number: 3, title: "Annans post", reportedById: "someone", responsibleId: null, responsibleName: "" };
const all = [nearMiss, base, others];

test("a file holds only entries asked for that the reader may read – an incident only for its reporter, admins and Teamet", () => {
  const ids = all.map((entry) => entry.id);
  assert.deepEqual(exportableDeviations(all, ids, { id: "boss", admin: true }).map((entry) => entry.id), ["d2", "d1", "d3"], "admin: all, in the log's order");
  assert.deepEqual(exportableDeviations(all, ids, { id: "worker", admin: false }).map((entry) => entry.id), ["d2", "d1"], "the reporter: own entries");
  assert.deepEqual(exportableDeviations(all, ids, { id: "resp", admin: false }).map((entry) => entry.id), ["d1"], "responsible without Teamet: never the near miss");
  assert.deepEqual(exportableDeviations(all, ids, { id: "lead", admin: false }).map((entry) => entry.id), [], "responsible for the near miss but without Teamet: nothing");
  assert.deepEqual(exportableDeviations(all, ids, { id: "lead", admin: false, team: true }).map((entry) => entry.id), ["d2"], "Teamet: the incident, not the others' entries");
  assert.deepEqual(exportableDeviations(all, ["d1", "unknown"], { id: "boss", admin: true }).map((entry) => entry.id), ["d1"], "only what was asked for; an unknown id is ignored");
});

test("the CSV: one row per entry, columns per chosen part, Excel-safe cells", () => {
  const sections = { description: true, action: true, investigation: true, history: true, photos: true };
  const header = deviationCsvHeader(sections);
  const row = deviationCsvRow(nearMiss, sections);
  assert.equal(row.length, header.length, "every row has the header's columns");
  const cell = (name: string) => row[header.indexOf(name)];
  assert.equal(cell("Nummer"), "Tillbud 2");
  assert.equal(cell("Typ"), "Tillbud");
  assert.equal(cell("Status"), "Öppen");
  assert.equal(cell("Vad hände"), "Gled på vått golv");
  assert.equal(cell("Anmälningspliktig"), "Ja");
  assert.equal(cell("Anmälan"), "Anmäld 2026-10-30 av Berit Chef");
  assert.equal(cell("Bilder"), "2");
  const plain = deviationCsvRow(base, sections);
  assert.equal(plain[header.indexOf("Klass")], "Rutinöversyn");
  assert.equal(plain[header.indexOf("Vad hände")], "", "no investigation for an Elinstallation entry");

  const lean = { description: false, action: false, investigation: false, history: false, photos: false };
  assert.deepEqual(deviationCsvHeader(lean), ["Nummer", "Typ", "Rubrik", "Allvarlighetsgrad", "Status", "Klass", "Rapporterad", "Rapporterad av", "Ansvarig", "Klart senast", "Åtgärdad"], "the head is always there");
  assert.equal(deviationCsvRow(nearMiss, lean).length, 11);
  assert.equal(deviationCsvRow({ ...nearMiss, severity: "ACUTE" }, lean)[3], "Akut");
  assert.equal(deviationCsvRow(base, lean)[3], "Normal", "an entry without the field is Normal");
  assert.equal(deviationCsvRow({ ...base, kind: "IMPROVEMENT", severity: "HIGH" }, lean)[3], "", "a Förbättring has none");

  const csv = deviationsCsv([{ ...base, title: "=SUMMA(A1)" }, nearMiss], sections);
  assert.ok(csv.startsWith("﻿"), "a BOM so Excel reads å, ä and ö");
  assert.equal(csv.trimEnd().split("\r\n").length, 3, "header and one row per entry");
  assert.ok(csv.includes(`"'=SUMMA(A1)"`), "a formula is never run (CSV injection)");
});

test("labels, file names and the authority mark", () => {
  assert.equal(deviationEntryLabel(base), "Avvikelse 1");
  assert.equal(deviationEntryLabel({ ...base, kind: "IMPROVEMENT" }), "Förbättring 1");
  assert.equal(deviationEntryLabel({ ...base, type: "RISK_OBSERVATION" }), "Riskobservation 1");
  assert.equal(deviationExportFilename([base, nearMiss], "csv", "2026-10-30"), "avvikelser-2026-10-30.csv");
  assert.equal(deviationExportFilename([{ ...nearMiss, title: "Stege/gled?" }], "pdf"), "Tillbud 2 - Stege-gled-.pdf");
  assert.equal(authorityText(base), "", "nothing to report for an Elinstallation entry");
  assert.equal(authorityText({ ...nearMiss, reportedToAuthorityAt: null }), "Inte markerad som anmäld");
});

test("the PDF draws JPG and PNG only, at most DEVIATION_EXPORT_PHOTO_MAX", () => {
  assert.deepEqual(exportPhotoIds([nearMiss]), ["p1"], "WebP cannot be held by a PDF");
  const many = { ...nearMiss, attachments: Array.from({ length: 40 }, (_, index) => ({ ...nearMiss.attachments![0]!, id: `x${index}` })) };
  assert.equal(exportPhotoIds([many, { ...many, id: "d9" }]).length, DEVIATION_EXPORT_PHOTO_MAX);
});

test("the PDF is made with the report kit: one page per short list, the company's name, no authority text", async () => {
  const fontBytes = new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf"));
  const bytes = await createDeviationsPdf({ identity: { company: "Bolaget AB" }, fontBytes, entries: [nearMiss, base], sections: { description: true, action: true, investigation: true, history: true, photos: true },
    photos: new Map(), scope: "Alla · Alla typer", createdAt: new Date("2026-10-30T12:00:00Z") });
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 1);
  assert.equal(pdf.getTitle(), "Avvikelser");
  // No "Företag" box: the name stands in the heading (PDF review 2026-11-03, finding 11).
  const text = drawingText(await pdfDrawing(bytes)).join(" ");
  assert.match(text, /Bolaget AB/);
  assert.doesNotMatch(text, /Företag\s+Bolaget AB/, "no box with the label and the name");
  assert.match(text, /Tillbud och olycksfall/);
  const single = await PDFDocument.load(await createDeviationsPdf({ identity: { company: "Bolaget AB" }, fontBytes, entries: [nearMiss], sections: {}, createdAt: new Date("2026-10-30T12:00:00Z") }));
  assert.equal(single.getTitle(), "Tillbud 2 · Stege gled", "one entry is titled by itself");
  // The text is subset-encoded; the notice's words never reach the drawing code, which is checked on the source instead.
  assert.ok(!readFileSync("lib/self-inspection/deviation-export.ts", "utf8").includes("SERIOUS_NOTICE") && SERIOUS_NOTICE.length > 0, "no authority text in the export");
});
