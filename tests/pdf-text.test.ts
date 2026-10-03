import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { pdfText } from "../lib/import/pdf-text";

test("pdf text: a standard font (WinAnsi) with Swedish letters, line by line", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("Servicerapport vecka 41", { x: 50, y: 780, size: 16, font });
  page.drawText("1. Kontrollera jordfelsbrytare i källaren", { x: 50, y: 740, size: 11, font });
  page.drawText("2. Byt armatur i trapphus – plan 3", { x: 50, y: 720, size: 11, font });
  const text = pdfText(Buffer.from(await pdf.save()));
  assert.ok(text);
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  assert.deepEqual(lines, ["Servicerapport vecka 41", "1. Kontrollera jordfelsbrytare i källaren", "2. Byt armatur i trapphus – plan 3"]);
});

test("pdf text: an embedded font (ToUnicode, object streams), several pages", async () => {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(readFileSync("public/fonts/DejaVuSans.ttf"), { subset: true });
  const first = pdf.addPage([595, 842]);
  first.drawText("Kund: Elkraft i Småland AB", { x: 50, y: 780, size: 12, font });
  first.drawText("Adress: Strömgatan 5, 352 30 Växjö", { x: 50, y: 760, size: 12, font });
  pdf.addPage([595, 842]).drawText("Åtgärd: Isolationsmätning ≥ 1 MΩ godkänd", { x: 50, y: 780, size: 12, font });
  const text = pdfText(Buffer.from(await pdf.save({ useObjectStreams: true })));
  assert.ok(text);
  assert.match(text, /Kund: Elkraft i Småland AB/);
  assert.match(text, /Adress: Strömgatan 5, 352 30 Växjö/);
  assert.match(text, /Åtgärd: Isolationsmätning ≥ 1 MΩ godkänd/);
});

test("pdf text: not a PDF, or a PDF without text, gives null", async () => {
  assert.equal(pdfText(Buffer.from("hej")), null);
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  assert.equal(pdfText(Buffer.from(await pdf.save())), null);
});
