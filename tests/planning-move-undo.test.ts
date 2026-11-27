import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Planeringskalendern (2026-11-20): "Flytten är ångrad." stayed under the calendar through later saves. After Ångra the row
// under the calendar is taken away and the message is the short toast every other saved event uses (lib/workflow/toast.ts
// notice, 3.5 s); the row itself still says where a booking was moved, with its Ångra, so the drag test finds it.

const source = readFileSync("features/kfid/workflow-projects.tsx", "utf8");

test("Ångra after a move clears the calendar row and says it in a short toast", () => {
  const undo = source.slice(source.indexOf("const undo = () => { void onSave({ id: activity.id, version: result.version"), source.indexOf("const conflicts = summarizeAvailability"));
  assert.match(undo, /\.then\(\(\) => \{ setMoveNotice\(null\); notice\("Flytten är ångrad\."\); \}\)/);
  assert.doesNotMatch(source, /setMoveNotice\(\{[^}]*Flytten är ångrad/, "the undone move is never a row that stays");
  assert.match(source, /import \{ announce, announceWarning, notice \} from "@\/lib\/workflow\/toast";/);
  // The move itself is still said in the row under the calendar, with Ångra (tests/planning-calendar-drag.browser.cjs).
  assert.match(source, /setMoveNotice\(conflicts\.length\s*\? \{ tone: "warning", text: `\$\{activity\.title\} flyttades till \$\{dayText\}/);
});
