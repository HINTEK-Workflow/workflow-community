import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { formDocumentSchema } from "../lib/workflow/form-document";
import { PAPER_FREE_TABLE_ROWS, paperFooterLine, paperModel, paperRange, paperSheets } from "../lib/workflow/round-paper";
import { breadcrumbTrail, roundPaperHref, VIEW_LABEL } from "../lib/workflow/navigation";

const text = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const plain = (value: string) => value.replace(/\s/g, " ");

const form = formDocumentSchema.parse({
  schema: 2,
  blocks: [
    { id: "f0", type: "field", key: "anlaggning", label: "Anläggning", input: "text" },
    { id: "s1", type: "section", title: "Pumpstation", blocks: [
      { id: "c1", type: "checklist", key: "visuellt", label: "Visuell kontroll", items: [{ id: "i1", text: "Inget läckage" }, { id: "i2", text: "Inga onormala ljud" }] },
      { id: "n1", type: "field", key: "tryck", label: "Tryck", input: "number", unit: "bar", min: 2, max: 5 },
      { id: "y1", type: "field", key: "larm", label: "Larm provat", input: "yesno", allowNotApplicable: false },
      { id: "o1", type: "field", key: "lage", label: "Läge", input: "choice", options: ["Auto", "Hand"] },
      { id: "h1", type: "field", key: "dold", label: "Dold i uppgiften", input: "text", visibility: { task: false, pdf: true } },
      { id: "k1", type: "computed", key: "summa", label: "Summa", formula: "tryck * 2" },
      { id: "im", type: "images", key: "bilder", label: "Bilder" },
      { id: "sg", type: "signature", key: "sign", label: "Kontrollerad av" },
    ] },
    { id: "s2", type: "section", title: "Mätningar", blocks: [
      { id: "t1", type: "table", key: "matning", label: "Mätvärden", rowMode: "fixed", fixedRows: ["L1", "L2"], columns: [
        { id: "a", key: "varde", label: "Värde", input: "number", unit: "A" },
        { id: "b", key: "formel", label: "Beräknat", input: "formula", formula: "varde * 2" },
      ] },
      { id: "t2", type: "table", key: "fria", label: "Fria rader", columns: [{ id: "x", key: "notis", label: "Notis", input: "text" }] },
    ] },
    { id: "s3", type: "section", title: "Bara info", blocks: [{ id: "nt", type: "note", title: "Läs först", text: "Text" }] },
  ],
});

// Rondprotokoll på papper (0.92.0): the form's points to tick by hand, in order, with the form's own limits only.
test("round paper: the form's points become rows to fill in by hand, in order", () => {
  const model = paperModel(form, "Pumptillsyn");
  assert.deepEqual(model.sections.map((section) => section.title), ["Pumptillsyn", "Pumpstation", "Mätningar"], "an untitled first part gets the form's name; an empty section is left out");
  const rows = model.sections[1].rows;
  assert.deepEqual(rows.map((row) => row.kind), ["check", "check", "value", "yesno", "choice"], "formulas, pictures and fields hidden in the task are not printed");
  assert.deepEqual(rows.slice(0, 2).map((row) => row.label), ["Inget läckage", "Inga onormala ljud"]);
  const value = rows[2];
  assert.equal(value.kind === "value" && value.unit, "bar");
  assert.equal(value.kind === "value" && value.range, "Godkänt 2–5 bar", "the form's own interval");
  assert.equal(rows[3].kind === "yesno" && rows[3].notApplicable, false);
  assert.deepEqual(rows[4].kind === "choice" ? rows[4].options : null, ["Auto", "Hand"]);
  const [fixed, free] = model.sections[2].rows;
  assert.ok(fixed.kind === "table" && free.kind === "table");
  assert.deepEqual(fixed.kind === "table" ? [fixed.rows, fixed.columns.map((column) => column.label)] : null, [["L1", "L2"], ["Värde"]], "a fixed table keeps its rows; a formula column is left out");
  assert.equal(free.kind === "table" ? free.rows.length : 0, PAPER_FREE_TABLE_ROWS, "a free table gets empty rows");
  assert.deepEqual(model.signatures, [{ label: "Kontrollerad av" }], "the form's own signature");
  assert.equal(model.rowCount, 8);
});

test("round paper: without a signature in the form the sheet still asks who did the round", () => {
  const bare = formDocumentSchema.parse({ schema: 2, blocks: [{ id: "c", type: "checklist", key: "lista", label: "Lista", items: [{ id: "a", text: "Dörr stängd" }] }] });
  const model = paperModel(bare, "Kvällsrond");
  assert.deepEqual(model.signatures, [{ label: "Utförd av" }]);
  assert.equal(model.sections[0].title, "Kvällsrond");
  assert.equal(paperModel(formDocumentSchema.parse({ schema: 2, blocks: [] }), "Tom").rowCount, 0, "an empty form has no rows, the sheet only date and signature");
});

test("round paper: ranges, sheets and the footer line", () => {
  assert.equal(paperRange(null, null, "bar"), "", "no limit of our own invention");
  assert.equal(paperRange(2, null, ""), "Godkänt minst 2");
  assert.equal(plain(paperRange(null, 1.5, "MΩ")), "Godkänt högst 1,5 MΩ");
  const points = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(paperSheets(points, new Set(["c", "a"])), [{ id: "a" }, { id: "c" }], "one sheet per chosen point, in the tree's order");
  assert.deepEqual(paperSheets(points, new Set()), [null], "nothing chosen: one sheet for the round");
  assert.deepEqual(paperSheets([], new Set()), [null]);
  const line = paperFooterLine({ sheet: 2, sheets: 3, printedAt: "2026-11-28 10:15" });
  assert.match(line, /Blad 2 av 3/);
  assert.match(line, /Utskrivet 2026-11-28 10:15 i Workflow/);
});

test("round paper: its own page under Driftronder, read within the round's visibility, printed alone", () => {
  assert.equal(roundPaperHref("r 1"), "/?view=round_paper&roundId=r%201");
  assert.equal(VIEW_LABEL.round_paper, "Rondprotokoll på papper");
  assert.deepEqual(breadcrumbTrail({ view: "round_paper", params: { roundId: "r1" } }).map((crumb) => crumb.label), ["Översikt", "Driftronder", "Rondprotokoll på papper"]);
  const server = text("lib/kfid/rounds-server.ts");
  assert.match(server, /export async function loadRoundPaper[\s\S]*?loadRoundLabelPlaces\(ctx, roundId\)/, "the round as its QR sheet reads it: within the round's visibility");
  assert.match(server, /formSchedule\.findFirst\(\{ where: \{ id: roundId, organizationId: ctx\.organizationId/, "only the company's own round");
  assert.match(text("app/api/form-schedules/route.ts"), /params\.get\("paper"\)/);
  const page = text("features/workflow/round-paper.tsx");
  assert.match(page, /body > \*:not\(\.round-paper-print\) \{ display: none !important; \}/, "only the sheets are printed");
  assert.match(page, /data\.company\.legal/, "the documents' footer");
  assert.doesNotMatch(page, /https?:\/\//, "nothing from outside");
  assert.match(text("features/workflow/form-rounds.tsx"), /roundPaperHref\(schedule\.id\)/, "reached from the round");
});
