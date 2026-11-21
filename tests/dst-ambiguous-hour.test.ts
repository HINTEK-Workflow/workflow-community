import assert from "node:assert/strict";
import test from "node:test";
import { fromSwedishDateTimeInput, fromSwedishDateTimeInputKeeping, swedishRepeatedHour, toSwedishDateTimeInput } from "../lib/swedish-time";
import { registerTime } from "../lib/staff-register/model";

// Granskning 2026-10-20, fixed 2026-10-21. On 2026-10-25 the clock shows 02:00–02:59 twice. A time in the first of them
// (summer time) is shown in a datetime-local field as "02:15", and the digits alone read back as the second 02:15
// (winter time). The decision: an edit dialog keeps the saved instant while the field is unchanged (time entries,
// maintenance fields, the staff register's correction); only a changed time is read anew. The staff register names the
// hour so that 02:55 → 02:02 can be understood.
test("a saved time shown in a datetime field is kept through the October night when the field is not changed", () => {
  const moved: string[] = [];
  for (let at = Date.parse("2026-10-24T22:00:00Z"); at <= Date.parse("2026-10-25T03:00:00Z"); at += 15 * 60_000) {
    const shown = toSwedishDateTimeInput(new Date(at));
    const back = fromSwedishDateTimeInputKeeping(shown, new Date(at))!.getTime();
    if (back !== at) moved.push(`${new Date(at).toISOString()} shown ${shown} read back ${new Date(back).toISOString()}`);
  }
  assert.deepEqual(moved, []);
});

test("a changed time is read anew, and the digits alone mean the second (winter time) 02:30", () => {
  const saved = new Date("2026-10-25T00:30:00.000Z"); // 02:30 summer time
  assert.equal(fromSwedishDateTimeInputKeeping("2026-10-25T02:45", saved)?.toISOString(), "2026-10-25T01:45:00.000Z");
  assert.equal(fromSwedishDateTimeInput("2026-10-25T02:30")?.toISOString(), "2026-10-25T01:30:00.000Z");
  assert.equal(fromSwedishDateTimeInputKeeping("2026-10-25T02:30", null)?.toISOString(), "2026-10-25T01:30:00.000Z");
  assert.equal(fromSwedishDateTimeInputKeeping("2026-10-25T02:30", "")?.toISOString(), "2026-10-25T01:30:00.000Z");
});

test("the repeated hour is named: summer time first, winter time second, nothing on ordinary times", () => {
  assert.equal(swedishRepeatedHour(new Date("2026-10-25T00:30:00Z")), "summer");
  assert.equal(swedishRepeatedHour(new Date("2026-10-25T01:30:00Z")), "winter");
  assert.equal(swedishRepeatedHour(new Date("2026-10-25T02:30:00Z")), null);
  assert.equal(swedishRepeatedHour(new Date("2026-10-24T23:59:00Z")), null);
  assert.equal(registerTime(new Date("2026-10-25T00:55:00Z")), "2026:10:25 02:55:00 (sommartid)");
  assert.equal(registerTime(new Date("2026-10-25T01:02:00Z")), "2026:10:25 02:02:00 (vintertid)");
  assert.equal(registerTime(new Date("2026-10-25T02:02:00Z")), "2026:10:25 03:02:00");
});
