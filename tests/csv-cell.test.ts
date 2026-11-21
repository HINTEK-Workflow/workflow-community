import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { csvCell } from "../lib/csv/cell";

// R2 (review 2026-10-20): every CSV export neutralises a cell that Excel would run as a formula.
test("a cell that starts like a formula gets an apostrophe; numbers and plain text stay as they are", () => {
  for (const value of ["=1+1", "+46 70", "@SUM(A1)", "-x", "\tA", "=HYPERLINK(\"http://x\")"])
    assert.ok(csvCell(value).startsWith("\"'"), value);
  assert.equal(csvCell("-12,50"), "\"-12,50\"");
  assert.equal(csvCell(42), "\"42\"");
  assert.equal(csvCell("Anna \"Ankan\" Svensson"), "\"Anna \"\"Ankan\"\" Svensson\"");
});

test("the newsletter list and the behaviour analysis use the shared cell", () => {
  assert.match(readFileSync("app/api/newsletter/route.ts", "utf8"), /import \{ csvCell \} from "@\/lib\/csv\/cell"/);
  assert.doesNotMatch(readFileSync("app/api/newsletter/route.ts", "utf8"), /const csvCell =/);
  assert.match(readFileSync("lib/analytics/report.ts", "utf8"), /const cell = csvCell;/);
});
