import assert from "node:assert/strict";
import test from "node:test";
import { projectMaterialsCsv, summarizeProjectMaterials, workOrderMaterialSources } from "../lib/workflow/project-materials";
import { MATERIAL_UNIT_SUGGESTIONS } from "../lib/workflow/expenses";

const row = (name: string, quantity: string, unit: string, kind?: "material" | "expense") => ({ name, quantity, unit, ...(kind ? { kind } : {}) });

test("material rows are summed per Benämning and Enhet, case-insensitively, with the jobs they come from", () => {
  const summary = summarizeProjectMaterials([
    { id: "wo-2", title: "Kök", materials: [row("Kabel EKK 3G1,5", "12,5", "m"), row("Dosa", "2", "st")] },
    { id: "wo-1", title: "Hall", materials: [row("kabel  ekk 3g1,5", "7,5", "M"), row("Dosa", "1", "st"), row("Dosa", "3", "förp")] },
  ]);
  assert.equal(summary.total, 3);
  assert.equal(summary.truncated, false);
  const [dosaForp, dosaSt, cable] = summary.lines;
  assert.deepEqual([dosaForp.name, dosaForp.unit, dosaForp.quantity], ["Dosa", "förp", "3"]);
  assert.deepEqual([dosaSt.quantity, dosaSt.total, dosaSt.rows], ["3", 3, 2]);
  assert.deepEqual(dosaSt.jobs.map((job) => job.title), ["Kök", "Hall"]);
  // The first spelling (the newest work order first) is shown.
  assert.deepEqual([cable.name, cable.unit, cable.quantity, cable.total], ["Kabel EKK 3G1,5", "m", "20", 20]);
});

test("expense rows and rows without Benämning are left out", () => {
  const summary = summarizeProjectMaterials([{ id: "wo", title: "Jobb", materials: [row("Parkering", "2", "h", "expense"), row("  ", "4", "st"), row("Säkring", "4", "st", "material")] }]);
  assert.deepEqual(summary.lines.map((line) => line.name), ["Säkring"]);
});

test("an Antal that is not a number is kept as written, never guessed", () => {
  const summary = summarizeProjectMaterials([
    { id: "a", title: "A", materials: [row("Buntband", "10", "st"), row("Buntband", "ca 20", "st"), row("Buntband", "CA 20", "st"), row("Buntband", "", "st")] },
  ]);
  assert.equal(summary.lines[0].quantity, "10 + ca 20");
  assert.equal(summary.lines[0].total, 10);
  assert.equal(summary.lines[0].rows, 4);
  const onlyText = summarizeProjectMaterials([{ id: "a", title: "A", materials: [row("Tejp", "", "rulle"), row("Tejp", "några", "rulle")] }]);
  assert.equal(onlyText.lines[0].quantity, "några");
  assert.equal(onlyText.lines[0].total, null);
  const none = summarizeProjectMaterials([{ id: "a", title: "A", materials: [row("Tejp", "", "")] }]);
  assert.equal(none.lines[0].quantity, "");
});

test("decimals are summed without floating-point noise", () => {
  const summary = summarizeProjectMaterials([{ id: "a", title: "A", materials: [row("Rör", "0,1", "m"), row("Rör", "0.2", "m")] }]);
  assert.equal(summary.lines[0].quantity, "0,3");
});

test("the summary is bounded and says so", () => {
  const materials = Array.from({ length: 12 }, (_, index) => row(`Artikel ${String(index).padStart(2, "0")}`, "1", "st"));
  const summary = summarizeProjectMaterials([{ id: "a", title: "A", materials }], 5);
  assert.equal(summary.lines.length, 5);
  assert.equal(summary.total, 12);
  assert.equal(summary.truncated, true);
});

test("Local and demo tasks: only work orders give material sources", () => {
  const sources = workOrderMaterialSources([
    { id: "w", title: "Arbetsorder", data: { kind: "WORK_ORDER", details: { materials: [row("Dosa", "1", "st")] } } },
    { id: "r", title: "Risk", data: { kind: "RISK_ASSESSMENT", details: { risks: [] } } },
    { id: "x", title: "Trasig", data: { kind: "WORK_ORDER", details: {} } },
  ]);
  assert.deepEqual(sources.map((source) => source.id), ["w"]);
});

test("the CSV has the row's own column names and guards against spreadsheet formulas", () => {
  const csv = projectMaterialsCsv(summarizeProjectMaterials([{ id: "a", title: "=Jobb", materials: [row("=HYPERLINK(\"x\")", "-2", "st")] }]));
  const [header, line] = csv.split("\r\n");
  assert.equal(header, "\"Benämning\";\"Antal\";\"Enhet\";\"Rader\";\"Jobb\"");
  assert.equal(line, "\"'=HYPERLINK(\"\"x\"\")\";\"-2\";\"st\";\"1\";\"'=Jobb\"");
});

test("the unit suggestions are the agreed list", () => {
  assert.deepEqual([...MATERIAL_UNIT_SUGGESTIONS], ["st", "m", "m²", "m³", "kg", "l", "h", "rulle", "förp"]);
});
