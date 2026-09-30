import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blankControl,
  evaluate,
  normalizeControl,
  totals,
  validateForCompletion,
  visualFields,
} from "../lib/kfid/model";
test("V1 thresholds retain equality, comma decimals, and reject blank or negative measurements", () => {
  assert.equal(evaluate("iso", { mohm: "1,0", limit: 1 }), true);
  assert.equal(evaluate("iso", { mohm: 0.99, limit: 1 }), false);
  assert.equal(evaluate("cont", { ohm: 0.5, limit: 0.5 }), true);
  assert.equal(evaluate("cont", { ohm: 0.51, limit: 0.5 }), false);
  for (const value of ["", null, " ", true, -1, "NaN"])
    assert.equal(evaluate("cont", { ohm: value, limit: 1 }), false);
  for (const value of ["230 Vac", "400 Vac"])
    assert.equal(evaluate("volt", { status: value }), true);
  assert.equal(evaluate("volt", { status: "Saknas" }), false);
});
test("RCD profiles and mandatory test button reproduce V1 thresholds", () => {
  for (const [std, max] of Object.entries({ EN: 300, TNIT: 400, TT: 200 })) {
    const row = { std, t1p: max, t1n: max, t5p: 40, t5n: 40, btnok: true };
    assert.equal(evaluate("rcd", row), true);
    assert.equal(evaluate("rcd", { ...row, t1p: max + 1 }), false);
    assert.equal(evaluate("rcd", { ...row, t5p: 41 }), false);
    assert.equal(evaluate("rcd", { ...row, btnok: false }), false);
    assert.equal(evaluate("rcd", { ...row, t1n: "" }), false);
  }
});
test("V1 numeric voltages normalize; duplicate identifiers regenerate; manual assessments survive", () => {
  const data = blankControl();
  data.active.iso = true;
  data.meta.autoOn = true;
  data.iso.rows = [
    { uid: "same", u: 500, mohm: 2, limit: 1 },
    { uid: "same", u: "1000", mohm: 0, limit: 1 },
  ];
  const result = normalizeControl(data);
  assert.equal(result.iso.rows[0].u, "500 V");
  assert.notEqual(result.iso.rows[0].uid, result.iso.rows[1].uid);
  assert.equal(totals(result)[0].ok, 1);
  data.meta.autoOn = false;
  data.iso.rows[0].ok = false;
  assert.equal(normalizeControl(data).iso.rows[0].ok, false);
  data.iso.rows[0].mohm = "-2";
  assert.throws(() => normalizeControl(data));
});

test("completion validation separates missing work from non-blocking warnings", () => {
  const data = blankControl();
  data.active.iso = true;
  data.active.vis = true;
  data.meta.autoOn = true;
  data.meta.proj = "Central A";
  data.meta.perf = "Montör";
  data.iso.rows = [
    {
      uid: "iso-1",
      objekt: "Grupp 1",
      u: "500 V",
      mohm: 2,
      limit: 1,
      ok: true,
      comment: "",
    },
  ];
  data.vis.checks = Object.fromEntries(visualFields.map((field) => [field.key, true]));

  const result = validateForCompletion(data, { attachmentCount: 0 });
  assert.equal(result.complete, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.progress.percent, 100);
  assert.ok(result.warnings.some((issue) => issue.code === "attachments.empty"));
  assert.ok(result.warnings.some((issue) => issue.code === "meta.instrument"));
});

test("completion blocks examples, missing active rows and undocumented deviations", () => {
  const data = blankControl();
  data.active.iso = true;
  data.active.vis = true;
  data.meta.autoOn = true;
  data.meta.proj = "Central B";
  data.meta.perf = "Montör";
  data.iso.rows = [
    {
      uid: "example",
      example: true,
      objekt: "Exempel",
      u: "500 V",
      mohm: 2,
      limit: 1,
      ok: true,
    },
  ];
  let result = validateForCompletion(data);
  assert.equal(result.complete, false);
  assert.ok(result.errors.some((issue) => issue.code === "iso.examples"));
  assert.match(
    result.errors.find((issue) => issue.code === "iso.examples")?.message ?? "",
    /test-\/exempelrad.*räknas inte som en verklig kontrollrad/i,
  );
  assert.ok(result.errors.some((issue) => issue.code === "iso.rows"));

  data.iso.rows = [
    {
      uid: "failed",
      objekt: "Grupp 2",
      u: "500 V",
      mohm: 0.5,
      limit: 1,
      ok: false,
    },
  ];
  data.vis.checks = Object.fromEntries(visualFields.map((field) => [field.key, true]));
  result = validateForCompletion(data);
  assert.ok(result.errors.some((issue) => issue.code === "summary.deviation"));
  data.vis.comment = "Isolationsvärdet avviker och ska åtgärdas.";
  assert.equal(validateForCompletion(data).complete, true);
});

test("manual assessment permits documented RCD special cases without automatic time fields", () => {
  const data = blankControl();
  data.meta.proj = "Specialanläggning";
  data.meta.perf = "Montör";
  data.meta.autoOn = false;
  data.active = { iso: false, cont: false, volt: false, rcd: true, vis: false };
  data.rcd.rows = [
    {
      uid: "rcd-manual",
      place: "JFB 1",
      std: "EN",
      type: "B",
      idn: 30,
      ok: false,
    },
  ];
  data.vis.comment = "Manuell bedömning enligt anläggningens underlag.";
  assert.equal(validateForCompletion(data).complete, true);
});

test("blank controls start at zero progress and example rows do not count as control points", () => {
  const data = blankControl();
  data.meta.perf = "Montör";
  assert.equal(validateForCompletion(data).progress.percent, 0);
  data.active.iso = true;
  data.iso.rows = [
    { uid: "example", example: true, mohm: 2, limit: 1, ok: true },
  ];
  assert.deepEqual(totals(data).map(({ total, ok }) => ({ total, ok })), [
    { total: 0, ok: 0 },
  ]);
});
