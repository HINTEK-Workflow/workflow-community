import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_FORMS } from "../lib/workflow/builtin-forms";
import { kfidFormDocument } from "../lib/workflow/builtin-kfid-form";
import { riskFormDocument } from "../lib/workflow/builtin-risk-form";
import { evaluateForm, formActiveLeafBlocks, formLeafBlocks, formCanDeviate, formCompletion, initialFormValues, newFormRow, type FormTableBlock } from "../lib/workflow/form-document";

/** HINTEK's controls improved from public sources (2026-09-28, docs/kallor/). */
const form = (id: string) => BUILTIN_FORMS.find((item) => item.id === id)!.document;
const table = (document: ReturnType<typeof form>, key: string) => formLeafBlocks(document).find((block): block is FormTableBlock => block.type === "table" && block.key === key)!;

test("thermography: ΔT and the lowest load are configurable limits, never numbers of our own", () => {
  const document = form("hintek-termografering");
  assert.deepEqual(document.limits.map((limit) => [limit.key, limit.high, limit.warnHigh, limit.low, limit.warnLow]), [["delta_ref", null, null, null, null], ["delta_omg", null, null, null, null], ["lastgrad", null, null, null, null]]);
  const values = initialFormValues(document);
  values.fields.omgivning = 20;
  values.tables.objekt[0].cells = { objekt: "Central A1", maxtemp: 68, reftemp: 30, last: 5, markstrom: 16, bedomning: "Åtgärda planerat" };
  // A company sets its classification: ΔT over 15 K a warning and over 40 K an alarm; load under 40 % a warning.
  values.limits = { delta_ref: { low: null, high: 40, warnLow: null, warnHigh: 15, source: "SBF 1031", origin: "facility" }, lastgrad: { low: null, high: null, warnLow: 40, warnHigh: null, source: "", origin: "facility" } };
  const evaluation = evaluateForm(document, values);
  assert.equal(evaluation.cells.objekt[values.tables.objekt[0].id].deltat_omg, 48);
  assert.ok(evaluation.alerts.some((item) => item.message.includes("Temperaturskillnad ΔT 38 K")));
  assert.ok(evaluation.alerts.some((item) => item.message.includes("Belastningsgrad 31 %")));
  assert.equal(table(document, "objekt").workOrders, true);
});

test("insulation: PI and DAR only when time-dependent measuring was done, and the mantle test on request", () => {
  const document = form("hintek-isolationsmatning-ebr");
  const values = initialFormValues(document);
  const shown = () => formActiveLeafBlocks(document, values).map((block) => "key" in block ? block.key : block.type);
  assert.ok(!shown().includes("tidsberoende_matning") && !shown().includes("mantel"));
  values.fields.tidsberoende = "YES"; values.fields.mantelprov = "YES";
  assert.ok(shown().includes("tidsberoende_matning") && shown().includes("mantel"));
  values.tables.tidsberoende_matning = [{ ...newFormRow(table(document, "tidsberoende_matning"), "p1"), cells: { objekt: "Motor 1", r30: 400, r60: 520, r600: 1300 } }];
  const cells = evaluateForm(document, values).cells.tidsberoende_matning.p1;
  assert.equal(cells.dar, 1.3);
  assert.equal(cells.pi, 2.5);
});

test("follow wire: a Ymer point outside the green area is a deviation; resistance points keep their requirement", () => {
  const document = form("hintek-foljelinematning-ebr");
  const values = initialFormValues(document);
  values.tables.matpunkter = [
    { ...newFormRow(table(document, "matpunkter"), "a"), cells: { punkt: "Station 1", metod: "Ymer strömkvot", imat: 10, iy: 8.2, gront: "Nej" } },
    { ...newFormRow(table(document, "matpunkter"), "b"), cells: { punkt: "Station 2", metod: "Slingresistanstång", resistans: 0.4, krav: 1 } },
  ];
  const evaluation = evaluateForm(document, values);
  assert.equal(evaluation.cells.matpunkter.a.kvot, 0.82);
  assert.equal(evaluation.computed.resultat, "Avvikelse");
  assert.equal(evaluation.deviations.length, 1);
  assert.match(evaluation.deviations[0].message, /Inom grönt område – Nej/);
  // Ymer settings show only for the Ymer method.
  values.fields.metod = "Ymer strömkvot";
  assert.ok(formActiveLeafBlocks(document, values).some((block) => "key" in block && block.key === "stromomrade"));
});

test("recurring control: points judged with a camera, registered as remarks that can become work orders; F200 and the routine", () => {
  const document = form("hintek-fortlopande-kontroll");
  const points = formActiveLeafBlocks(document, {}).find((block) => block.type === "checklist")!;
  assert.ok(points.type === "checklist" && points.mode === "assessment" && points.photos && points.deviationTable === "anmarkningar");
  assert.equal(points.type === "checklist" && points.items.length, 16);
  const remarks = table(document, "anmarkningar");
  assert.deepEqual(remarks.columns.find((column) => column.key === "klass")?.options, ["Observation", "Åtgärdas snarast", "Omedelbar fara"]);
  assert.equal(remarks.workOrders, true);
  const values = initialFormValues(document);
  values.fields.rutin = "NO";
  assert.ok(evaluateForm(document, values).deviations.some((item) => item.key === "rutin"));
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
  assert.equal(areas.length, 14);
  assert.equal(areas.filter((area) => values.sections[area.id]).length, 11, "trucks, lone work and the organisational environment are chosen when they apply");
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

test("the hydropower template: no fixed limits, every limit names its source, limits per unit and trends", async () => {
  const { ROUND_FORMS } = await import("../lib/workflow/builtin-rounds");
  const { formTrendKeys } = await import("../lib/workflow/form-trend");
  const document = ROUND_FORMS.find((item) => item.id === "hintek-driftrond-vattenkraft")!.document;
  assert.ok(document.limits.length >= 20);
  assert.ok(document.limits.every((limit) => limit.low === null && limit.high === null && limit.warnLow === null && limit.warnHigh === null && limit.source.length > 5));
  assert.equal(document.limitObjectKey, "aggregat");
  assert.ok(formTrendKeys(document).some((key) => key.key === "barlager"));
  assert.ok(JSON.stringify(document).includes("Generell mall baserad på offentliga källor"));
  const values = initialFormValues(document);
  values.fields.ovy = 102.4; values.fields.nvy = 96.1;
  values.limits.ovy = { low: 101.2, high: 102.2, warnLow: null, warnHigh: 102.0, source: "Vattendom", origin: "object" };
  const evaluation = evaluateForm(document, values);
  assert.equal(Math.round(Number(evaluation.computed.fallhojd) * 10) / 10, 6.3);
  assert.ok(evaluation.deviations.some((item) => item.kind === "limit" && item.message.includes("Övre vattennivå")));
});
