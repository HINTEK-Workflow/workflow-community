import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_FORMS } from "../lib/workflow/builtin-forms";
import { ROUND_FORMS } from "../lib/workflow/builtin-rounds";
import { kfidForm } from "../lib/workflow/builtin-kfid-form";
import { riskForm } from "../lib/workflow/builtin-risk-form";
import { planningForm } from "../lib/workflow/builtin-planning-form";

// Card titles on one line (2026-10-07): a title must fit the narrowest card (three across at 1280 px, about 267 px
// of 16 px text, roughly 30 characters). Shorten the name rather than letting it wrap; the locked originals keep theirs.
const forms = [...BUILTIN_FORMS, ...ROUND_FORMS, kfidForm, riskForm, planningForm];

test("every built-in card title fits one line", () => {
  for (const form of forms) {
    const name = form.meta.displayName || form.meta.name;
    assert.ok(name.length <= 30, `${name} (${name.length} tecken) är för långt för en rad`);
  }
});

test("the locked originals keep their names", () => {
  assert.equal(kfidForm.meta.name, "Kontroll före idrifttagning");
  assert.equal(riskForm.meta.name, "Riskbedömning");
});
