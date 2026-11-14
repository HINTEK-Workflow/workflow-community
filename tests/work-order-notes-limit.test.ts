import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { failure } from "../lib/kfid/server";
import { WORK_ORDER_NOTES_MAX, workOrderDataSchema } from "../lib/workflow/task-model";

// A2 (review 2026-10-20): Utfört arbete and Avvikelser stop in the page where the server does, with a count near the
// limit; a longer text sent anyway is refused in Swedish and names the field.
test("the page and the server share the 10 000 character limit", async () => {
  assert.equal(WORK_ORDER_NOTES_MAX, 10_000);
  assert.equal(workOrderDataSchema.safeParse({ executionNotes: "x".repeat(10_000) }).success, true);
  const parsed = workOrderDataSchema.safeParse({ executionNotes: "x".repeat(10_001) });
  assert.equal(parsed.success, false);
  assert.equal(((await failure(parsed.error).json()) as { error: string }).error, "Utfört arbete får vara högst 10 000 tecken.");
  const editor = readFileSync("features/workflow/workflow-task-editor.tsx", "utf8");
  for (const label of ["Utfört arbete", "Avvikelser"])
    assert.match(editor, new RegExp(`aria-label="${label}"[^>]*maxLength=\\{WORK_ORDER_NOTES_MAX\\}`), `${label} has maxLength`);
});
