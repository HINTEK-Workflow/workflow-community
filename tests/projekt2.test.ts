import assert from "node:assert/strict";
import { test } from "node:test";
import { closeTimeEntries } from "../lib/workflow/timer-server";
import { fitFooterText } from "../lib/workflow/report-kit";
import { dayViewAnchor } from "../lib/workflow/planning-calendar-summary";
import { buildOverviewWork, selectOverviewWork } from "../lib/workflow/overview-work";
import { swedishDayKey } from "../lib/swedish-time";

function fakeTx() {
  const calls = { deleted: [] as string[], updated: [] as { id: string; durationSec: number }[] };
  const tx = {
    workflowTimeEntry: {
      delete: async ({ where }: { where: { id: string } }) => { calls.deleted.push(where.id); },
      update: async ({ where, data }: { where: { id: string }; data: { durationSec: number } }) => { calls.updated.push({ id: where.id, durationSec: data.durationSec }); },
    },
    workflowTimeEntryEvent: { create: async () => ({}) },
    // Tidsperiod (2026-10-30): the month's lock and its status (no row = open).
    $executeRaw: async () => 0,
    timePeriod: { findMany: async () => [] },
  };
  return { tx: tx as never, calls };
}
const actor = { organizationId: "o", user: { id: "u", email: "a@b.se" } };

test("R2-PRJ-02: Spara ändå under en minut sparar minst en minut", async () => {
  const now = new Date("2026-10-18T10:00:04Z");
  const running = [{ id: "e1", userId: "u", startedAt: new Date("2026-10-18T10:00:00Z"), note: "" }];
  const kept = fakeTx();
  const stopped = await closeTimeEntries(kept.tx, actor, running, { id: "t", title: "Jobb" }, now, { keepShort: true });
  assert.deepEqual(kept.calls.updated, [{ id: "e1", durationSec: 60 }]);
  assert.equal(stopped[0].durationSec, 60);
  const thrown = fakeTx();
  assert.deepEqual(await closeTimeEntries(thrown.tx, actor, running, { id: "t", title: "Jobb" }, now), []);
  assert.deepEqual(thrown.calls.deleted, ["e1"]);
  const long = fakeTx();
  const later = new Date("2026-10-18T10:05:00Z");
  await closeTimeEntries(long.tx, actor, running, { id: "t", title: "Jobb" }, later, { keepShort: true });
  assert.equal(long.calls.updated[0].durationSec, 300, "a longer entry keeps its real length");
});

test("R2-PRJ-04: sidfotens långa namn kortas så vänster och höger inte skrivs över varandra", () => {
  const font = { widthOfTextAtSize: (text: string) => text.length * 3 };
  assert.equal(fitFooterText(font as never, "Kort", 100), "Kort");
  const cut = fitFooterText(font as never, "Projektrapport · ".concat("Mycket långt projektnamn ".repeat(8)), 150);
  assert.ok(cut.endsWith("…"));
  assert.ok(font.widthOfTextAtSize(cut) <= 150);
});

test("R2-PRJ-06: Dagvyn efter bläddring öppnar på idag eller periodens första dag", () => {
  const today = new Date("2026-10-18T10:00:00+02:00"); // söndag
  const nextWeek = new Date("2026-10-25T10:00:00+01:00");
  assert.equal(swedishDayKey(dayViewAnchor(nextWeek, "week", today)), "2026-10-19", "veckans första dag, inte söndagen");
  assert.equal(swedishDayKey(dayViewAnchor(today, "week", today)), "2026-10-18", "idag finns i veckan");
  assert.equal(swedishDayKey(dayViewAnchor(new Date("2026-11-15T12:00:00+01:00"), "month", today)), "2026-11-01");
  assert.equal(swedishDayKey(dayViewAnchor(today, "month", today)), "2026-10-18");
});

test("R2-PRJ-10: Översikt räknar försenade jobb med samma regel som nyckeltalet", () => {
  const items = buildOverviewWork({
    today: "2026-10-18",
    projects: [],
    tasks: [
      { id: "1", title: "A", kind: "WORK_ORDER", status: "IN_PROGRESS", progress: 10, dueDate: "2026-10-01", updatedAt: "2026-10-01" },
      { id: "2", title: "B", kind: "WORK_ORDER", status: "CANCELLED", progress: 0, dueDate: "2026-10-01", updatedAt: "2026-10-01" },
      { id: "3", title: "C", kind: "WORK_ORDER", status: "COMPLETED", progress: 100, dueDate: "2026-10-01", updatedAt: "2026-10-01" },
      { id: "4", title: "D", kind: "WORK_ORDER", status: "NEEDS_ACTION", progress: 0, dueDate: "", updatedAt: "2026-10-01" },
    ],
  });
  const page = selectOverviewWork(items, { filter: "all", sort: "updated", page: 1 });
  assert.equal(page.late, 1);
  assert.equal(page.counts.action, 2, "en försenad och en som behöver åtgärdas");
});
