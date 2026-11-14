import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createFormProtocolPdf } from "../lib/workflow/form-report";
import { defaultWorkflowReportOptions } from "../lib/workflow/report";
import { pdfDrawing } from "./helpers/pdf-drawing";
import { kfidFull, kfidTemplate } from "./fixtures/kfid-answers";
import { kfidTask, REFERENCE_COMPANY } from "./fixtures/report-references";

// Plats in Kontroll före idrifttagning (2026-10-11): a typed "Projekt / anläggning" stays when a place is chosen,
// so the report names the place on a row of its own – once, and not when the field already says it.
const font = () => new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf"));
const place = "Brf Kopparlunden › Garage Elvägen 4, Elvägen 4, 123 41 Elstad";
const texts = async (bytes: Uint8Array) => (await pdfDrawing(bytes)).pages[0].map((op) => op.text ?? "").filter(Boolean).join("\n");
// Values wrap in the facts grid, so a text is looked for with the line breaks turned into spaces.
const flat = (text: string) => text.replace(/\n+/g, " ");
const render = (task: ReturnType<typeof kfidTask>, blank = false) =>
  createFormProtocolPdf({ identity: { company: REFERENCE_COMPANY }, fontBytes: font(), task, options: defaultWorkflowReportOptions, createdAt: new Date("2026-10-11T08:00:00Z"), blank });
const count = (text: string, part: string) => flat(text).split(part).length - 1;

test("a typed Projekt / anläggning keeps its text and the place gets a Plats row", async () => {
  const text = await texts(await render({ ...kfidTask(kfidFull), facilityName: place }));
  assert.ok(flat(text).includes(kfidFull.meta.proj), "the typed text stays");
  assert.ok(/^Plats$/m.test(text), "a Plats row");
  assert.equal(count(text, "Garage Elvägen 4"), 1, "the place once");
});

test("a field filled from the place is not repeated as Plats", async () => {
  const text = await texts(await render({ ...kfidTask({ ...kfidFull, meta: { ...kfidFull.meta, proj: place } }), facilityName: place }));
  assert.equal(count(text, "Garage Elvägen 4"), 1, "the place once");
  assert.ok(!/^Plats$/m.test(text), "no Plats row");
});

test("no place and a blank form draw no Plats row", async () => {
  assert.ok(!/^Plats$/m.test(await texts(await render(kfidTask(kfidFull)))));
  assert.ok(!/^Plats$/m.test(await texts(await render({ ...kfidTask(kfidTemplate), facilityName: place }, true))));
});
