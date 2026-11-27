import assert from "node:assert/strict";
import test from "node:test";
import { movedTimeTypeOrder, rangeAtSave, rangeForLength, resolveTimeType, selectableTimeTypes, STARTING_TIME_TYPES, timeTypeChoiceProblem, timeTypeInputSchema, timeTypeRemoveProblem, timeTypeSaveProblem, type TimeTypeView } from "../lib/workflow/time-types";
import { exportGaps, exportRows, exportTemplateSchema, PRESET_TEMPLATES } from "../lib/payroll/export";

const types: TimeTypeView[] = [
  { id: "ord", name: "Ordinarie", payrollCode: "100", active: true, isDefault: true, sortOrder: 0 },
  { id: "ot", name: "Övertid", payrollCode: "310", active: true, isDefault: false, sortOrder: 1 },
  { id: "res", name: "Restid", payrollCode: "", active: true, isDefault: false, sortOrder: 2 },
  { id: "old", name: "Gammal", payrollCode: "", active: false, isDefault: false, sortOrder: 3 },
];

test("Tidstyper: a neutral starting list with one standard type and no codes or agreement words", () => {
  assert.deepEqual(STARTING_TIME_TYPES.map((type) => type.name), ["Ordinarie", "Övertid", "Restid", "Jour"]);
  assert.equal(STARTING_TIME_TYPES.filter((type) => type.isDefault).length, 1);
  assert.ok(!STARTING_TIME_TYPES.some((type) => /%|avtal|ob\b|tillägg/i.test(type.name)), "no percentages, agreement names or supplements");
});

test("Tidstyper: an entry without a type, or with one that is gone, is the standard type", () => {
  assert.equal(resolveTimeType(types, null)?.id, "ord");
  assert.equal(resolveTimeType(types, undefined)?.id, "ord");
  assert.equal(resolveTimeType(types, "borta")?.id, "ord");
  assert.equal(resolveTimeType(types, "ot")?.name, "Övertid");
  assert.equal(resolveTimeType([], null), undefined, "Local has no list");
});

test("Tidstyper: saving checks names, the standard type and the limit", () => {
  assert.equal(timeTypeSaveProblem(types, timeTypeInputSchema.parse({ name: " övertid ", payrollCode: "" })), "Det finns redan en tidstyp med det namnet.");
  assert.equal(timeTypeSaveProblem(types, timeTypeInputSchema.parse({ id: "ot", name: "Övertid", payrollCode: "320" })), null, "the same type keeps its name");
  assert.match(timeTypeSaveProblem(types, timeTypeInputSchema.parse({ id: "ord", name: "Ordinarie", active: false })) ?? "", /kan inte stängas av/);
  assert.equal(timeTypeSaveProblem(types, timeTypeInputSchema.parse({ id: "x", name: "Ny" })), "Tidstypen finns inte.");
  const many = Array.from({ length: 30 }, (_, index) => ({ ...types[1], id: `t${index}`, name: `Typ ${index}`, isDefault: index === 0 }));
  assert.match(timeTypeSaveProblem(many, timeTypeInputSchema.parse({ name: "En till" })) ?? "", /Högst 30/);
  assert.equal(timeTypeInputSchema.safeParse({ name: "", payrollCode: "" }).success, false);
  assert.equal(timeTypeInputSchema.safeParse({ name: "Jour", payrollCode: "J;1" }).success, false, "no delimiter in a code that goes into a file");
  assert.equal(timeTypeInputSchema.safeParse({ name: "Jour", payrollCode: "J-1/2 a_b.c" }).success, true);
  assert.equal(timeTypeInputSchema.safeParse({ name: "x".repeat(41) }).success, false);
});

test("Tidstyper: removing, choosing and ordering", () => {
  assert.match(timeTypeRemoveProblem(types[0], 0) ?? "", /Standardtypen/);
  assert.match(timeTypeRemoveProblem(types[1], 3) ?? "", /Stäng av typen i stället/);
  assert.equal(timeTypeRemoveProblem(types[2], 0), null);
  assert.equal(timeTypeRemoveProblem(undefined, 0), "Tidstypen finns inte.");
  assert.equal(timeTypeChoiceProblem(types, null), null, "no type = the standard type");
  assert.equal(timeTypeChoiceProblem(types, "ot"), null);
  assert.equal(timeTypeChoiceProblem(types, "annan-firma"), "Tidstypen finns inte.");
  assert.match(timeTypeChoiceProblem(types, "old") ?? "", /används inte längre/);
  assert.equal(timeTypeChoiceProblem(types, "old", "old"), null, "an old entry keeps its switched-off type");
  assert.deepEqual(selectableTimeTypes(types).map((type) => type.id), ["ord", "ot", "res"]);
  assert.deepEqual(selectableTimeTypes(types, "old").map((type) => type.id), ["ord", "ot", "res", "old"]);
  assert.deepEqual(movedTimeTypeOrder(types, "res", -1).map((item) => item.id), ["ord", "res", "ot", "old"]);
  assert.deepEqual(movedTimeTypeOrder(types, "ord", -1).map((item) => item.sortOrder), [0, 1, 2, 3], "the first one stays");
});

test("Tid i efterhand räknas bakåt: the end is now and a length moves the start (2026-10-29)", () => {
  const now = new Date("2026-10-29T14:00:00.000Z");
  const start = new Date("2026-10-29T13:00:00.000Z"); const end = new Date("2026-10-29T13:30:00.000Z");
  assert.deepEqual(rangeForLength({ start, end, hours: 2, anchor: "now", now }), { start: new Date("2026-10-29T12:00:00.000Z"), end: now }, "untouched: now and two hours back");
  assert.deepEqual(rangeForLength({ start, end, hours: 0.25, anchor: "end", now }), { start: new Date("2026-10-29T13:15:00.000Z"), end }, "the person set the end: it stays");
  assert.deepEqual(rangeForLength({ start, end, hours: 1, anchor: "start", now }), { start, end: new Date("2026-10-29T14:00:00.000Z") }, "the person set the start: it stays");
  assert.equal(rangeForLength({ start, end, hours: 0, anchor: "now", now }), null);
  assert.equal(rangeForLength({ start: null, end, hours: 1, anchor: "start", now }), null);
  // A form left open: saved untouched it still ends at the moment of saving, with the same length.
  const later = new Date("2026-10-29T14:20:00.000Z");
  assert.deepEqual(rangeAtSave({ start: new Date("2026-10-29T12:00:00.000Z"), end: now, anchor: "now", now: later }), { start: new Date("2026-10-29T12:20:00.000Z"), end: later });
  assert.deepEqual(rangeAtSave({ start, end, anchor: "end", now: later }), { start, end }, "what the person entered is kept");
});

test("Export: time per day and type with the type's code; per day only the day's total", () => {
  const people = [{ userId: "anna", name: "Anna", email: "a@example.invalid", employeeNumber: "1001", weeklyWorkMinutes: 2400 }];
  const entry = (day: string, seconds: number, timeType: string, timeTypeCode: string) => ({ userId: "anna", day, seconds, project: "P", workOrder: "AO", customer: "", timeType, timeTypeCode });
  const entries = [entry("2026-11-02", 3600 * 6, "Ordinarie", "100"), entry("2026-11-02", 3600 * 2, "Ordinarie", "100"), entry("2026-11-02", 5400, "Övertid", "310"), entry("2026-11-03", 3600, "Jour", "")];
  const template = PRESET_TEMPLATES.find((item) => item.id === "preset-worked-day-type")!;
  assert.ok(exportTemplateSchema.safeParse(template).success);
  const rows = exportRows({ template, from: "2026-11-01", to: "2026-11-30", people, entries });
  assert.deepEqual(rows, [["1001", "2026-11-02", "100", "8,00"], ["1001", "2026-11-02", "310", "1,50"], ["1001", "2026-11-03", "", "1,00"]]);
  assert.deepEqual(exportGaps(template, rows), { withoutNumber: 0, withoutCode: 1 });
  const perDay = exportRows({ template: { ...PRESET_TEMPLATES.find((item) => item.id === "preset-worked-day")!, columns: [{ field: "date", header: "", value: "" }, { field: "timeTypeCode", header: "", value: "" }, { field: "hours", header: "", value: "" }] }, from: "2026-11-01", to: "2026-11-30", people, entries });
  assert.deepEqual(perDay, [["2026-11-02", "", "9,50"], ["2026-11-03", "", "1,00"]], "a mixed day has no single code");
  assert.equal(exportTemplateSchema.safeParse({ ...PRESET_TEMPLATES[0], rowsPer: "dayType" }).success, false, "absence is never per type");
});
