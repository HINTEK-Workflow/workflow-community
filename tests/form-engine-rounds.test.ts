import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_FORMS } from "../lib/workflow/builtin-forms";
import { kfidFormDocument } from "../lib/workflow/builtin-kfid-form";
import { riskFormDocument } from "../lib/workflow/builtin-risk-form";
import { copyFormValues, evaluateForm, formActiveLeafBlocks, formCompletion, formDocumentSchema, formLimitLevel, formPlacedImageIds, formValuesSchema, initialFormValues, validateFormDocument } from "../lib/workflow/form-document";
import { formLimitObject, resolveFormLimits } from "../lib/workflow/form-limits";
import { nextOccurrence, scheduleOccurrences, scheduleOverview, scheduleRuleText, formScheduleRuleSchema } from "../lib/workflow/form-schedule";
import { formTrendKeys, formTrendSeries } from "../lib/workflow/form-trend";

/** The engine additions of 2026-09-28: conditions, remarks, limits, column validation, reviews, trends and schedules. */
const doc = (blocks: unknown[], extra: Record<string, unknown> = {}) => formDocumentSchema.parse({ schema: 2, blocks: [{ id: "s1", type: "section", title: "Rond", blocks }], ...extra });
const field = (key: string, input: string, extra: Record<string, unknown> = {}) => ({ id: `f-${key}`, type: "field", key, label: key, input, ...extra });

test("the built-in forms and a schema 1 form parse unchanged with the new defaults", () => {
  for (const form of [...BUILTIN_FORMS]) {
    const again = formDocumentSchema.parse(JSON.parse(JSON.stringify(form.document)));
    assert.deepEqual(again, form.document, form.meta.name);
    assert.deepEqual(validateFormDocument(form.document).issues, [], form.meta.name);
  }
  assert.deepEqual(validateFormDocument(kfidFormDocument).issues, []);
  assert.deepEqual(validateFormDocument(riskFormDocument).issues, []);
  const old = formDocumentSchema.parse({ blocks: [{ id: "a", type: "field", key: "a", label: "A", input: "text" }] });
  assert.equal(old.limits.length, 0);
  assert.deepEqual((old.blocks[0] as { showIf: unknown }).showIf, { key: "", op: "eq", value: "" });
  // Stored answers from before parse too, and the checklist's pictures stay absent.
  const values = formValuesSchema.parse({ checklists: { c: { p: { state: "OK", comment: "" } } } });
  assert.equal(values.checklists.c.p.images, undefined);
  assert.deepEqual(values.remarks, {});
  assert.equal(values.round, null);
});

test("a block and a section under a condition are shown, required and counted only while the condition is met", () => {
  const document = formDocumentSchema.parse({ schema: 2, blocks: [
    { id: "s1", type: "section", title: "Aggregat", blocks: [field("typ", "choice", { options: ["Kaplan", "Francis"] }), field("finns", "yesno"), field("ledskovel", "number", { required: true, showIf: { key: "typ", op: "eq", value: "Kaplan" } })] },
    { id: "s2", type: "section", title: "Reservkraft", showIf: { key: "finns", op: "eq", value: "YES" }, blocks: [field("timmar", "number", { required: true }), { id: "c1", type: "computed", key: "dubbelt", label: "Dubbelt", formula: "timmar * 2" }] },
  ] });
  assert.deepEqual(validateFormDocument(document).issues, []);
  const values = initialFormValues(document);
  const ids = () => formActiveLeafBlocks(document, values).map((block) => block.id);
  assert.ok(!ids().includes("f-ledskovel"));
  assert.ok(!ids().includes("f-timmar"));
  assert.ok(!formCompletion(document, values).issues.some((item) => item.message.includes("ledskovel")));
  values.fields.typ = "Kaplan";
  values.fields.finns = "YES";
  values.fields.timmar = 7;
  assert.ok(ids().includes("f-ledskovel") && ids().includes("f-timmar"));
  assert.ok(formCompletion(document, values).issues.some((item) => item.message === "Fyll i ledskovel."));
  assert.equal(evaluateForm(document, values).computed.dubbelt, 14);
  // Hidden again: its answers count as empty, also in formulas.
  values.fields.finns = "NO";
  assert.equal(evaluateForm(document, values).computed.dubbelt, null);
  // Numbers compare as numbers; an unknown field is reported.
  const numeric = doc([field("temp", "number"), field("larm", "text", { showIf: { key: "temp", op: "gt", value: "80" } })]);
  const answers = initialFormValues(numeric);
  answers.fields.temp = "85,5";
  assert.ok(formActiveLeafBlocks(numeric, answers).some((block) => block.id === "f-larm"));
  assert.ok(validateFormDocument(doc([field("x", "text", { showIf: { key: "saknas", op: "filled" } })])).issues.some((item) => item.message.includes("saknas")));
  assert.ok(validateFormDocument(doc([field("x", "text", { showIf: { key: "x", op: "filled" } })])).issues.some((item) => item.message.includes("av sig självt")));
  const selfHidden = formDocumentSchema.parse({ schema: 2, blocks: [{ id: "s", type: "section", title: "PI", showIf: { key: "pi", op: "eq", value: "YES" }, blocks: [field("pi", "yesno")] }] });
  assert.ok(validateFormDocument(selfHidden).issues.some((item) => item.message.includes("aldrig visas")));
});

test("a field's own remark can mark a deviation, which then needs the summary comment", () => {
  const document = doc([field("olja", "text", { remarks: true })]);
  const values = initialFormValues(document);
  values.remarks.olja = { comment: "Läckage vid packbox", deviation: true };
  const evaluation = evaluateForm(document, values);
  assert.equal(evaluation.deviations.length, 1);
  assert.equal(evaluation.deviations[0].kind, "remark");
  assert.match(evaluation.deviations[0].message, /Läckage vid packbox/);
  assert.ok(formCompletion(document, values).issues.some((item) => item.blockId === "deviations"));
});

test("configurable limits: outside the alarm range is a deviation, outside the warning range only a warning", () => {
  const document = doc([field("lager", "number", { unit: "°C", limitKey: "lagertemp", trend: true }), { id: "t", type: "table", key: "lager_tabell", label: "Lager", rowMode: "fixed", fixedRows: ["Lager 1", "Lager 2"],
    columns: [{ id: "c", key: "temp", label: "Temp", input: "number", unit: "°C", limitKey: "lagertemp", trend: true }] }],
  { limits: [{ key: "lagertemp", label: "Lagertemperatur", unit: "°C", warnHigh: 70, high: 80, source: "Tillverkarens anvisning" }] });
  assert.deepEqual(validateFormDocument(document).issues, []);
  const values = initialFormValues(document);
  values.fields.lager = 75;
  let evaluation = evaluateForm(document, values);
  assert.equal(evaluation.deviations.length, 0);
  assert.equal(evaluation.alerts.length, 1);
  assert.match(evaluation.alerts[0].message, /varningsgränsen högst 70 °C/);
  values.fields.lager = 85;
  values.tables.lager_tabell[1].cells.temp = 90;
  evaluation = evaluateForm(document, values);
  assert.equal(evaluation.deviations.filter((item) => item.kind === "limit").length, 2);
  assert.ok(evaluation.deviations.some((item) => /Lager 2: Temp 90 °C ligger utanför larmgränsen högst 80 °C/.test(item.message)));
  assert.ok(!evaluation.deviations.some((item) => /Lager 1/.test(item.message)), "an empty row is not judged");
  // The protocol's snapshot from the facility's profile wins over the form's own values.
  values.limits.lagertemp = { low: null, high: 95, warnLow: null, warnHigh: 88, source: "Vattendom", origin: "facility" };
  evaluation = evaluateForm(document, values);
  assert.equal(evaluation.deviations.length, 0);
  assert.equal(evaluation.alerts.length, 1);
  assert.equal(formLimitLevel({ low: 5, high: null, warnLow: 10, warnHigh: null }, 4), "alarm");
  assert.equal(formLimitLevel({ low: null, high: null, warnLow: null, warnHigh: null }, 4), "ok");
  assert.ok(validateFormDocument(doc([field("x", "number", { limitKey: "saknas" })])).issues.some((item) => item.message.includes("saknas")));
});

test("limit profiles resolve per object, then facility, then the form, and a copy starts without the snapshot", () => {
  const document = doc([field("aggregat", "text"), field("lager", "number", { limitKey: "lagertemp" })], { limitObjectKey: "aggregat", limits: [{ key: "lagertemp", label: "Lagertemperatur", unit: "°C", source: "Tillverkaren" }, { key: "vibration", label: "Vibration", unit: "mm/s" }] });
  const profiles = [
    { facilityId: "f1", objectName: "", values: { lagertemp: { low: null, high: 80, warnLow: null, warnHigh: 70, source: "" } } },
    { facilityId: "f1", objectName: "G2", values: { lagertemp: { low: null, high: 85, warnLow: null, warnHigh: 75, source: "Revision 2024" } } },
  ];
  const values = initialFormValues(document);
  values.fields.aggregat = "g2";
  assert.equal(formLimitObject(document, values), "g2");
  const resolved = resolveFormLimits(document, profiles, "f1", formLimitObject(document, values));
  assert.equal(resolved.lagertemp.high, 85);
  assert.equal(resolved.lagertemp.origin, "object");
  assert.equal(resolveFormLimits(document, profiles, "f1", "G1").lagertemp.origin, "facility");
  assert.equal(resolveFormLimits(document, profiles, "f1", "G1").lagertemp.source, "Tillverkaren");
  assert.equal(resolveFormLimits(document, profiles, null).vibration.origin, "form");
  values.limits = resolved;
  values.round = { scheduleId: "s", occurrence: "2026-09-28" };
  const copy = copyFormValues(values);
  assert.deepEqual(copy.limits, {});
  assert.equal(copy.round, null);
});

test("table columns validate hard like fields, and a review must be signed by someone else", () => {
  const document = doc([{ id: "t", type: "table", key: "m", label: "Mätning", columns: [{ id: "c", key: "v", label: "Värde", input: "number", allowedMin: 0, allowedMax: 10, decimals: 1 }] },
    { id: "a", type: "signature", key: "utford", label: "Utförd av" }, { id: "b", type: "signature", key: "granskad", label: "Granskad av", role: "reviewer", distinctFrom: "utford" }]);
  assert.deepEqual(validateFormDocument(document).issues, []);
  const values = initialFormValues(document);
  values.tables.m[0].cells.v = 12;
  assert.ok(formCompletion(document, values).issues.some((item) => item.message === "Mätning, rad 1: Värde: ange ett värde mellan 0 och 10."));
  values.tables.m[0].cells.v = 1.25;
  assert.ok(formCompletion(document, values).issues.some((item) => item.message.endsWith("högst 1 decimaler.")));
  values.signatures.utford = { name: "Elin Berg", confirmed: true, signedAt: null };
  values.signatures.granskad = { name: "elin berg ", confirmed: true, signedAt: null };
  assert.ok(formCompletion(document, values).issues.some((item) => item.message.includes("annan person")));
  values.signatures.granskad.name = "Elis Hammar";
  assert.ok(!formCompletion(document, values).issues.some((item) => item.message.includes("annan person")));
});

test("a checklist point's pictures are placed in the form and left out of a copy", () => {
  const document = doc([{ id: "l", type: "checklist", key: "rond", label: "Rond", photos: true, items: [{ id: "p1", text: "Galler rent" }] }]);
  const values = initialFormValues(document);
  values.checklists.rond = { p1: { state: "NOT_OK", comment: "Löv", images: ["bild-1"] } };
  assert.ok(formPlacedImageIds(document, values).has("bild-1"));
  assert.equal(copyFormValues(values).checklists.rond.p1.images, undefined);
  assert.equal(copyFormValues(values).checklists.rond.p1.state, "NOT_OK");
});

test("schedules: daily, every other day, chosen weekdays every second week and monthly on the last day", () => {
  const rule = (input: Record<string, unknown>) => formScheduleRuleSchema.parse(input);
  assert.deepEqual(scheduleOccurrences(rule({ frequency: "DAILY", startDate: "2026-09-28" }), "2026-09-27", "2026-09-30"), ["2026-09-28", "2026-09-29", "2026-09-30"]);
  assert.deepEqual(scheduleOccurrences(rule({ frequency: "DAILY", interval: 2, startDate: "2026-09-28" }), "2026-09-29", "2026-10-04"), ["2026-09-30", "2026-10-02", "2026-10-04"]);
  // 2026-09-28 is a Monday: Monday and Thursday every second week.
  assert.deepEqual(scheduleOccurrences(rule({ frequency: "WEEKLY", interval: 2, weekdays: [4, 1], startDate: "2026-09-28" }), "2026-09-28", "2026-10-15"), ["2026-09-28", "2026-10-01", "2026-10-12", "2026-10-15"]);
  assert.deepEqual(scheduleOccurrences(rule({ frequency: "MONTHLY", startDate: "2026-01-31" }), "2026-01-01", "2026-04-30"), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.deepEqual(scheduleOccurrences(rule({ frequency: "DAILY", startDate: "2026-09-28", endDate: "2026-09-29" }), "2026-09-01", "2026-12-31"), ["2026-09-28", "2026-09-29"]);
  assert.equal(nextOccurrence(rule({ frequency: "WEEKLY", startDate: "2026-09-28" }), "2026-09-29"), "2026-10-05");
  assert.equal(scheduleRuleText(rule({ frequency: "WEEKLY", interval: 2, weekdays: [1, 4], startDate: "2026-09-28" })), "Var 2:a vecka mån, tors");
  assert.equal(scheduleRuleText(rule({ frequency: "DAILY", startDate: "2026-09-28" })), "Dagligen");
  assert.throws(() => rule({ frequency: "DAILY", startDate: "2026-09-28", endDate: "2026-09-01" }));
});

test("a schedule's overview: done, started, missed, due today and the next occurrences", () => {
  const rule = formScheduleRuleSchema.parse({ frequency: "DAILY", startDate: "2026-09-20" });
  const overview = scheduleOverview(rule, [{ taskId: "a", status: "COMPLETED", occurrence: "2026-09-26" }, { taskId: "b", status: "IN_PROGRESS", occurrence: "2026-09-27" }], "2026-09-28", { pastDays: 5, upcoming: 2 });
  assert.equal(overview.today?.state, "due");
  assert.deepEqual(overview.history.map((item) => item.state), ["started", "done", "missed", "missed", "missed"]);
  assert.equal(overview.missed, 3);
  assert.deepEqual(overview.upcoming.map((item) => item.date), ["2026-09-29", "2026-09-30"]);
  assert.equal(overview.current?.date, "2026-09-28");
  const done = scheduleOverview(rule, [{ taskId: "c", status: "COMPLETED", occurrence: "2026-09-28" }], "2026-09-28", { pastDays: 1 });
  assert.equal(done.current?.date, "2026-09-27");
});

test("trends follow a number over earlier protocols of the same form, each read with its own copy", () => {
  const document = doc([field("datum", "date"), field("niva", "number", { unit: "m", trend: true, limitKey: "niva" }), { id: "t", type: "table", key: "lager", label: "Lager", rowMode: "fixed", fixedRows: ["L1"], columns: [{ id: "c", key: "temp", label: "Temp", input: "number", trend: true }] }],
    { limits: [{ key: "niva", label: "Nivå", unit: "m", low: 101.2, high: 104.5 }] });
  assert.deepEqual(formTrendKeys(document).map((item) => item.key), ["niva", "lager.temp@L1"]);
  const protocol = (id: string, date: string, level: number, temp: number) => {
    const values = initialFormValues(document);
    values.fields.datum = date; values.fields.niva = level; values.tables.lager[0].cells.temp = temp;
    return { id, updatedAt: "2026-09-28T10:00:00Z", data: { kind: "FORM", details: { document, values } } };
  };
  const series = formTrendSeries(document, null, [protocol("b", "2026-09-27", 103.1, 41), protocol("a", "2026-09-26", 102.9, 40), { id: "x", data: { details: { document: "trasig" } } }]);
  assert.deepEqual(series[0].points.map((point) => [point.taskId, point.value]), [["a", 102.9], ["b", 103.1]]);
  assert.equal(series[0].limit?.high, 104.5);
  assert.deepEqual(series[1].points.map((point) => point.value), [40, 41]);
});

test("the protocol's PDF prints the limits it was judged by, warnings, a field's remark and hides blocks under an unmet condition", async () => {
  const { readFileSync } = await import("node:fs");
  const { createWorkflowPdfReport, defaultWorkflowReportOptions } = await import("../lib/workflow/report");
  const { pdfDrawing, drawingText } = await import("./helpers/pdf-drawing");
  const document = doc([field("datum", "date"), field("drift", "yesno"), field("orsak", "text", { showIf: { key: "drift", op: "eq", value: "NO" } }),
    field("lager", "number", { unit: "°C", limitKey: "lagertemp", remarks: true }), { id: "sum", type: "summary" }],
  { limits: [{ key: "lagertemp", label: "Lagertemperatur", unit: "°C", warnHigh: 70, high: 80, source: "Tillverkarens anvisning" }] });
  const values = initialFormValues(document);
  values.fields = { datum: "2026-09-28", drift: "YES", orsak: "Revision", lager: 74 };
  values.remarks.lager = { comment: "Stiger sedan i går", deviation: false };
  values.limits.lagertemp = { low: null, high: 80, warnLow: null, warnHigh: 70, source: "Tillverkarens anvisning", origin: "facility" };
  const bytes = await createWorkflowPdfReport({
    company: "HINTEK Power Solutions AB", fontBytes: new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf")), options: defaultWorkflowReportOptions,
    tasks: [{ id: "p1", kind: "FORM", title: "Daglig tillsyn", description: "", status: "IN_PROGRESS", progress: 60, assignedToName: "", dueDate: "", totalDurationSec: 0, attachments: [],
      data: { kind: "FORM", details: { templateName: "Daglig tillsyn", templateVersion: 1, document, values } } }],
  });
  const text = drawingText(await pdfDrawing(bytes)).join("\n");
  for (const expected of ["Gränsvärden", "Lagertemperatur (°C)", "högst 80 °C", "högst 70 °C", "Anläggningen", "Kommentar: Stiger sedan i går", "• Varning: lager 74 °C ligger utanför varningsgränsen högst 70 °C."])
    assert.ok(text.includes(expected), `saknar ${expected}`);
  assert.ok(!text.includes("Revision"), "a block under an unmet condition is not printed");
});
