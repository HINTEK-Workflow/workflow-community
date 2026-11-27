import assert from "node:assert/strict";
import test from "node:test";
import { glueDashes } from "../lib/workflow/glue-dashes";

const JOIN = "⁠";
const NBSP = " ";

test("glueDashes keeps a dash written against what follows with the words on both sides (QA 2026-10-10: \"plan –\" / \"1\")", () => {
  assert.equal(glueDashes("Installation av laddboxar plan –1"), `Installation av laddboxar plan${NBSP}–${JOIN}1`);
  assert.equal(glueDashes("Temperatur −20 °C"), `Temperatur${NBSP}−${JOIN}20 °C`);
  assert.equal(glueDashes("–5 grader"), `–${JOIN}5 grader`, "at the start of the text too");
});

test("glueDashes leaves dashes between words, inside words and in spans alone", () => {
  assert.equal(glueDashes("Kund – plats"), "Kund – plats");
  assert.equal(glueDashes("08:00–09:30"), "08:00–09:30");
  assert.equal(glueDashes("Jordfelsbrytare-byte"), "Jordfelsbrytare-byte");
  assert.equal(glueDashes(`plan${NBSP}–${JOIN}1`), `plan${NBSP}–${JOIN}1`, "already glued text is unchanged");
  assert.equal(glueDashes(""), "");
});
