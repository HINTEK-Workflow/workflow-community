import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_FORMS } from "../lib/workflow/builtin-forms";
import { kfidFormDocument } from "../lib/workflow/builtin-kfid-form";
import { riskFormDocument } from "../lib/workflow/builtin-risk-form";
import { evaluateForm, formActiveLeafBlocks, formLeafBlocks, formCanDeviate, formCompletion, initialFormValues, newFormRow, type FormTableBlock } from "../lib/workflow/form-document";

/** HINTEK's controls: short, with what is always measured or judged (slimmed 2026-10-02). */
const form = (id: string) => BUILTIN_FORMS.find((item) => item.id === id)!.document;
const table = (document: ReturnType<typeof form>, key: string) => formLeafBlocks(document).find((block): block is FormTableBlock => block.type === "table" && block.key === key)!;

test("thermography: ΔT is a configurable limit, never a number of our own", () => {
  const document = form("hintek-termografering");
  assert.deepEqual(document.limits.map((limit) => [limit.key, limit.high, limit.warnHigh, limit.low, limit.warnLow]), [["delta_ref", null, null, null, null]]);
  const values = initialFormValues(document);
  values.fields.omgivning = 20;
  values.tables.objekt[0].cells = { objekt: "Central A1", maxtemp: 68, reftemp: 30, last: 5, bedomning: "Åtgärda planerat" };
  // A company sets its classification: ΔT over 15 K a warning and over 40 K an alarm.
  values.limits = { delta_ref: { low: null, high: 40, warnLow: null, warnHigh: 15, source: "Företagets klassning", origin: "facility" } };
  const evaluation = evaluateForm(document, values);
  assert.equal(evaluation.cells.objekt[values.tables.objekt[0].id].deltat, 38);
  assert.ok(evaluation.alerts.some((item) => item.message.includes("Temperaturskillnad ΔT 38 K")));
  assert.equal(table(document, "objekt").workOrders, true);
});

test("insulation: a row per measurement, judged against the requirement the person enters", () => {
  const document = form("hintek-isolationsmatning-ebr");
  assert.equal(document.limits.length, 0);
  const values = initialFormValues(document);
  values.tables.matningar = [
    { ...newFormRow(table(document, "matningar"), "a"), cells: { objekt: "Gruppcentral A1", matning: "L1+L2+L3+N–PE", uppmatt: 250, krav: 1 } },
    { ...newFormRow(table(document, "matningar"), "b"), cells: { objekt: "Huvudledning", matning: "L1–PE", uppmatt: 0.3, krav: 1 } },
  ];
  const evaluation = evaluateForm(document, values);
  assert.equal(evaluation.cells.matningar.a.godkand, true);
  assert.equal(evaluation.cells.matningar.b.godkand, false);
  assert.equal(evaluation.computed.lagsta, 0.3);
  assert.equal(evaluation.computed.underkanda, 1);
  assert.equal(evaluation.deviations.length, 1);
});

test("follow wire (Ymer): the quotient I y / I mät judges the screen connection and the outer earth connections", () => {
  const document = form("hintek-foljelinematning-ebr");
  const values = initialFormValues(document);
  // The usual limits are filled in and visible, and can be changed in the protocol.
  assert.equal(values.fields.grans_skarm, 0.9);
  assert.equal(values.fields.grans_jord, 0.3);
  values.tables.matpunkter = [
    { ...newFormRow(table(document, "matpunkter"), "a"), cells: { fran: "Station 1", till: "Station 2", imat: 20, iy: 12, umat: 10 } },
    { ...newFormRow(table(document, "matpunkter"), "b"), cells: { fran: "Station 2", till: "Station 3", imat: 20, iy: 19 } },
    { ...newFormRow(table(document, "matpunkter"), "c"), cells: { fran: "Station 3", till: "Station 4", imat: 20, iy: 4 } },
  ];
  const evaluation = evaluateForm(document, values);
  assert.equal(evaluation.cells.matpunkter.a.kvot, 0.6);
  assert.deepEqual([evaluation.cells.matpunkter.a.skarm_ok, evaluation.cells.matpunkter.a.jord_ok], [true, true]);
  assert.deepEqual([evaluation.cells.matpunkter.b.skarm_ok, evaluation.cells.matpunkter.b.jord_ok], [false, true], "0,95: the screen connection is to be inspected");
  assert.deepEqual([evaluation.cells.matpunkter.c.skarm_ok, evaluation.cells.matpunkter.c.jord_ok], [true, false], "0,2: the outer earth connections are to be inspected");
  assert.equal(evaluation.computed.besiktiga_skarm, 1);
  assert.equal(evaluation.computed.besiktiga_jord, 1);
  assert.equal(evaluation.deviations.length, 2);
});

test("recurring control: ten points judged with a camera, registered as remarks that can become work orders", () => {
  const document = form("hintek-fortlopande-kontroll");
  const points = formActiveLeafBlocks(document, {}).find((block) => block.type === "checklist")!;
  assert.ok(points.type === "checklist" && points.mode === "assessment" && points.photos && points.deviationTable === "anmarkningar");
  assert.equal(points.type === "checklist" && points.items.length, 10);
  const remarks = table(document, "anmarkningar");
  assert.deepEqual(remarks.columns.find((column) => column.key === "klass")?.options, ["Observation", "Åtgärdas snarast", "Omedelbar fara"]);
  assert.equal(remarks.workOrders, true);
  const values = initialFormValues(document);
  values.fields.tidigare_atgardade = "NO";
  assert.ok(evaluateForm(document, values).deviations.some((item) => item.key === "tidigare_atgardade"));
});

// Short enough to get done in the field (2026-10-02): the customer builds on the control in Skapa formulär.
test("the controls are short and name no standards or sources", async () => {
  const { ROUND_FORMS } = await import("../lib/workflow/builtin-rounds");
  for (const item of [...BUILTIN_FORMS, ...ROUND_FORMS]) {
    const leaves = formLeafBlocks(item.document);
    const points = leaves.reduce((sum, block) => sum + (block.type === "checklist" ? block.items.length : block.type === "table" ? block.columns.length : 1), 0);
    assert.ok(points <= 60, `${item.meta.name}: ${points} fields, points and columns`);
    assert.doesNotMatch(JSON.stringify(item.document), /ELSÄK|AFS \d|SBF|NETA|RIDAS|IEEE|ISO \d|EBR-anvisning|SS \d{3}|docs\/kallor|offentliga källor/, item.meta.name);
  }
});

test("the risk assessment has an action plan per risk and a decision, and still no deviation box", () => {
  const risks = table(riskFormDocument, "risker");
  assert.deepEqual(risks.columns.filter((column) => column.group === "Handlingsplan").map((column) => column.key), ["allvarlig", "ansvarig", "klart", "genomford"]);
  assert.equal(formCanDeviate(riskFormDocument), false);
  const values = initialFormValues(riskFormDocument);
  const shown = () => formActiveLeafBlocks(riskFormDocument, values).map((block) => "key" in block ? block.key : block.type);
  assert.ok(!shown().includes("arbetsmetod"));
  values.fields.elarbete = "YES"; values.fields.arbetsmetod = "Arbete utan spänning";
  assert.ok(["arbetsmetod", "frankopplat", "jordat"].every((key) => shown().includes(key)));
  // None of the new questions is required, so today's completion rules are unchanged.
  assert.ok(!formCompletion(riskFormDocument, values).issues.some((item) => /Allvarlig|Arbetet får|elarbete/i.test(item.message)));
});

test("the control gets optional moments that are off until chosen, so today's control is unchanged", () => {
  const values = initialFormValues(kfidFormDocument);
  assert.equal(values.sections["kfid-zs"], false);
  values.sections["kfid-zs"] = true;
  values.fields.auto = "YES";
  values.tables.zs = [{ ...newFormRow(table(kfidFormDocument, "zs"), "z1"), cells: { krets: "Grupp 3", skydd: "Dvärgbrytare B", in: 16, zs: 3.1, zsmax: 2.73 } }];
  assert.equal(evaluateForm(kfidFormDocument, values).cells.zs.z1.ok, false);
});

test("every control can be filled in, judged and printed – as a protocol and as a blank template", async () => {
  const { readFileSync } = await import("node:fs");
  const { sampleFormValues } = await import("../lib/workflow/form-sample");
  const { createFormProtocolPdf } = await import("../lib/workflow/form-report");
  const { defaultWorkflowReportOptions } = await import("../lib/workflow/report");
  const { kfidForm } = await import("../lib/workflow/builtin-kfid-form");
  const { riskForm } = await import("../lib/workflow/builtin-risk-form");
  const fontBytes = new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf"));
  const { ROUND_FORMS } = await import("../lib/workflow/builtin-rounds");
  for (const item of [kfidForm, riskForm, ...BUILTIN_FORMS, ...ROUND_FORMS]) {
    const values = sampleFormValues(item.document);
    const completion = formCompletion(item.document, values);
    assert.ok(completion.percent > 0, `${item.meta.name}: something counts`);
    for (const blank of [false, true]) {
      const bytes = await createFormProtocolPdf({ identity: { company: "HINTEK Power Solutions AB" }, fontBytes, options: defaultWorkflowReportOptions, blank,
        task: { id: "p", kind: "FORM", title: item.meta.name, description: "", status: "IN_PROGRESS", progress: 50, assignedToName: "", dueDate: "", totalDurationSec: 0, attachments: [],
          data: { kind: "FORM", details: { templateName: item.meta.name, templateVersion: 2, document: item.document, values } } } });
      assert.ok(bytes.length > 4000, `${item.meta.name} ${blank ? "blank" : "filled"}`);
    }
  }
});

test("the safety round: areas chosen per workplace, points judged with a camera, deficiencies with risk, action and follow-up", async () => {
  const { ROUND_FORMS } = await import("../lib/workflow/builtin-rounds");
  const { deviationRow } = await import("../features/workflow/form-checklist");
  const document = ROUND_FORMS.find((item) => item.id === "hintek-skyddsrond")!.document;
  const values = initialFormValues(document);
  const areas = document.blocks.filter((block) => block.type === "section" && block.optional);
  assert.equal(areas.length, 6);
  assert.equal(areas.filter((area) => values.sections[area.id]).length, 6, "every area is on until the person switches it off");
  const deficiencies = table(document, "avvikelser");
  assert.ok(deficiencies.workOrders && deficiencies.columns.some((column) => column.key === "klart") && deficiencies.columns.some((column) => column.input === "images"));
  // A point that is not OK becomes a deficiency row with its text and comment.
  values.checklists.el = { "el-1": { state: "NOT_OK", comment: "Central A1 öppen" } };
  const row = deviationRow(deficiencies, "el", { id: "el-1", text: "Elcentraler är stängda" }, values.checklists.el["el-1"]);
  assert.equal(row.cells.punkt, "Elcentraler är stängda");
  assert.equal(row.cells.beskrivning, "Central A1 öppen");
  values.tables.avvikelser = [{ ...row, cells: { ...row.cells, allvarlighet: "Hög" } }];
  const evaluation = evaluateForm(document, values);
  assert.ok(evaluation.deviations.some((item) => item.message.includes("Hög")));
  assert.equal(evaluation.computed.hoga, 1);
});

test("the hydropower template: no fixed limits, limits per unit and trends", async () => {
  const { ROUND_FORMS } = await import("../lib/workflow/builtin-rounds");
  const { formTrendKeys } = await import("../lib/workflow/form-trend");
  const document = ROUND_FORMS.find((item) => item.id === "hintek-driftrond-vattenkraft")!.document;
  assert.ok(document.limits.length >= 8);
  assert.ok(document.limits.every((limit) => limit.low === null && limit.high === null && limit.warnLow === null && limit.warnHigh === null && limit.source.length > 5));
  assert.equal(document.limitObjectKey, "aggregat");
  assert.ok(formTrendKeys(document).some((key) => key.key === "barlager"));
  const values = initialFormValues(document);
  values.fields.ovy = 102.4; values.fields.nvy = 96.1;
  values.limits.ovy = { low: 101.2, high: 102.2, warnLow: null, warnHigh: 102.0, source: "Vattendom", origin: "object" };
  const evaluation = evaluateForm(document, values);
  assert.equal(Math.round(Number(evaluation.computed.fallhojd) * 10) / 10, 6.3);
  assert.ok(evaluation.deviations.some((item) => item.kind === "limit" && item.message.includes("Övre vattennivå")));
});
