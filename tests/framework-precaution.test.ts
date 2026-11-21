import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PROTOCOL_REVIEW_INSTRUCTIONS } from "../lib/ai/protocol-review";
import { KFID_MOMENT_HELP, LIMIT_HELP } from "../lib/kfid/guidance";
import { companyValueCatalog, SHARED_GROUP, suggestionInputs } from "../lib/workflow/company-values";
import { resolveFormLimits } from "../lib/workflow/form-limits";
import { HINTEK_LIMIT_SUGGESTIONS, RETIRED_LIMIT_KEYS, SUGGESTION_NOTE } from "../lib/workflow/limit-suggestions";
import { BUILTIN_FORMS } from "../lib/workflow/builtin-forms";
import { kfidForm } from "../lib/workflow/builtin-kfid-form";
import { riskForm } from "../lib/workflow/builtin-risk-form";
import { ROUND_FORMS } from "../lib/workflow/builtin-rounds";
import { formLeafBlocks, type FormColumn, type FormFieldBlock } from "../lib/workflow/form-document";
import { createPreset } from "../lib/workflow/form-presets";
import { emptyEditorDocument } from "../lib/workflow/form-editor";

/**
 * Copyright precaution (2026-10-06): Workflow is a framework until the rights are cleared. No organisation or
 * manufacturer names in the built-in forms, no limit values of our own (since the same evening not even the RCD times:
 * they are the company's values, Workflow's numbers only suggestions), and a row without a limit is never approved.
 */
const ALL = [kfidForm, riskForm, ...BUILTIN_FORMS, ...ROUND_FORMS];
const NAMES = /\bEBR\b|Ymer|Metrel|Eurotest|Megger|Fluke|FLIR|EL-Info|Energiföretagen|Svensk Energi|\bESA\b/;
// The keys of the limits a person enters per row or per protocol.
const LIMIT_KEYS = new Set(["limit", "grans", "krav", "zsmax", "grans_skarm", "grans_jord"]);

test("the built-in forms carry no organisation or manufacturer names", () => {
  for (const form of ALL) {
    assert.doesNotMatch(JSON.stringify(form.meta), NAMES, form.id);
    assert.doesNotMatch(JSON.stringify(form.document), NAMES, form.id);
  }
  assert.doesNotMatch(JSON.stringify(KFID_MOMENT_HELP), NAMES);
});

test("no built-in limit is pre-filled: limits are empty and say where they come from", () => {
  for (const form of ALL) {
    for (const limit of form.document.limits) assert.deepEqual([limit.low, limit.high, limit.warnLow, limit.warnHigh], [null, null, null, null], `${form.id}: ${limit.key}`);
    for (const block of formLeafBlocks(form.document)) {
      const entries: (FormColumn | FormFieldBlock)[] = block.type === "table" ? block.columns : block.type === "field" ? [block] : [];
      for (const entry of entries.filter((item) => LIMIT_KEYS.has(item.key))) {
        assert.equal(entry.defaultValue ?? null, null, `${form.id}: ${entry.label} has no default`);
        if ("exampleValue" in entry) assert.equal(entry.exampleValue ?? null, null, `${form.id}: ${entry.label} has no example value`);
        assert.ok(entry.help.includes(LIMIT_HELP), `${form.id}: ${entry.label} says where the limit comes from`);
      }
    }
  }
  // The form builder's generic measurement rows start without a limit too.
  const preset = createPreset("measurement_rows", emptyEditorDocument());
  assert.ok(preset.kind === "block" && preset.block.type === "table");
  const grans = preset.block.type === "table" ? preset.block.columns.find((column) => column.key === "grans") : undefined;
  assert.equal(grans?.defaultValue ?? null, null);
});

test("the RCD choices refer to the standards by designation; the times and Uc limits are the company's values, Workflow's numbers only suggestions", () => {
  const rcd = formLeafBlocks(kfidForm.document).find((block) => block.type === "table" && block.key === "rcd");
  assert.ok(rcd && rcd.type === "table");
  const std = rcd.columns.find((column) => column.key === "std");
  // Since 2026-10-10 only EN 61008 / EN 61009 is offered; TN/IT and TT stay in the condition and among the limits
  // for older protocols that hold them.
  assert.deepEqual(std?.options, ["EN 61008 / EN 61009"]);
  assert.equal(std?.defaultValue, "EN 61008 / EN 61009");
  assert.ok((rcd.columns.find((column) => column.key === "ok")?.formula ?? "").includes(`"IEC 60364-4-41 TN/IT"; gräns.rcd_t1_tnit; "IEC 60364-4-41 TT"; gräns.rcd_t1_tt; "EN"; gräns.rcd_t1_en; "TNIT"; gräns.rcd_t1_tnit; "TT"; gräns.rcd_t1_tt`));
  assert.deepEqual(RETIRED_LIMIT_KEYS, ["rcd_t1_tnit", "rcd_t1_tt"]);
  // 2026-10-06: no limit value in the form – not in a help text, a note or a condition.
  const text = JSON.stringify(kfidForm.document);
  assert.doesNotMatch(text, /\b(300|400|200|40) ms\b|<= 40\b|; (25|50|200|300|400)[;)]/);
  const keys = kfidForm.document.limits.map((limit) => limit.key);
  for (const key of Object.keys(HINTEK_LIMIT_SUGGESTIONS)) assert.ok(keys.includes(key), `${key} is a limit of the form`);
  assert.match(rcd.columns.find((column) => column.key === "ok")?.formula ?? "", /gräns\.rcd_t1_en.*gräns\.rcd_t5.*gräns\.rcd_uc_25/);
  // The suggestions live in one place.
  assert.equal(HINTEK_LIMIT_SUGGESTIONS.rcd_t1_en.high, 300);
  assert.ok(!("rcd_t1_tnit" in HINTEK_LIMIT_SUGGESTIONS) && !("rcd_t1_tt" in HINTEK_LIMIT_SUGGESTIONS), "nothing is suggested for the standards no longer offered");
  assert.equal(SUGGESTION_NOTE, "Förslag från Workflow – kontrollera mot er standard");
  // The help texts point to Värden och referenser instead of giving numbers.
  assert.match(LIMIT_HELP, /Värden och referenser/);
  assert.doesNotMatch(JSON.stringify(KFID_MOMENT_HELP), /\d+ ms|Ω\b/);
});

test("Värden och referenser: one value per key for every form, suggestions only fill empty rows, nothing is filled in by itself", () => {
  const groups = companyValueCatalog(ALL.map((form) => ({ name: form.meta.name, document: form.document })));
  const rows = groups.flatMap((group) => group.rows);
  const isolation = rows.find((row) => row.key === "isolation_min");
  assert.deepEqual(isolation?.usedIn, ["Isolationsmätning – kabelnät", "Kontroll före idrifttagning"]);
  assert.equal(groups[0].title, SHARED_GROUP);
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length, "each key once");
  const own = [{ key: "rcd_t1_en", low: null, high: 250, warnLow: null, warnHigh: null, source: "Egen rutin", reference: "2026", version: 1, updatedByName: "" }];
  const inputs = suggestionInputs(groups, own);
  assert.ok(!inputs.some((input) => input.key === "rcd_t1_en"), "a value the company entered is never replaced");
  assert.deepEqual(inputs.find((input) => input.key === "rcd_t5"), { key: "rcd_t5", low: null, high: 40, warnLow: null, warnHigh: null, source: "Förslag från Workflow", reference: "", version: undefined });
  assert.ok(!inputs.some((input) => input.key === "rcd_t1_tt"), "no suggestion for a standard the row no longer offers");
  assert.ok(!inputs.some((input) => input.key === "isolation_min"), "Workflow suggests nothing for insulation");
  // Without the company's values every form's limit is empty: the rows say Ej bedömd.
  for (const form of ALL) for (const value of Object.values(resolveFormLimits(form.document, [], null))) assert.deepEqual([value.low, value.high], [null, null]);
});

test("the AI is given no publisher's interpretation or default limits", () => {
  assert.doesNotMatch(PROTOCOL_REVIEW_INSTRUCTIONS, /Ymer|förval 0,9|0,95|grans_skarm/);
  assert.match(PROTOCOL_REVIEW_INSTRUCTIONS, /hitta aldrig på egna gränser/);
  assert.doesNotMatch(readFileSync("lib/ai/workflow-assistant.ts", "utf8"), /instrumentet Ymer|förval 0,9|Kvoten tolkas/);
});
