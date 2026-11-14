import assert from "node:assert/strict";
import test from "node:test";
import { outsideWindow, placeTimed, timelineStart, TIMELINE_HOURS } from "../lib/overview/timeline";
import type { PlanItem } from "../lib/overview/me";

const post = (id: string, start?: string, end?: string): PlanItem => ({ id, date: "2026-10-29", kind: "activity", title: id, href: "/", state: "planned", ...(start ? { start } : {}), ...(end ? { end } : {}) });

test("Dagens tidslinje: only timed posts are placed, a start alone lasts half an hour, overlapping posts share the width", () => {
  const placed = placeTimed([post("a", "08:00", "11:00"), post("b", "09:00", "10:00"), post("c", "11:00", "12:00"), post("d"), post("e", "13:00")]);
  const byId = new Map(placed.map((item) => [item.item.id, item]));
  assert.equal(placed.length, 4, "the post without a time is listed under the day, not placed");
  assert.deepEqual([byId.get("a")!.lane, byId.get("a")!.lanes], [0, 2]);
  assert.deepEqual([byId.get("b")!.lane, byId.get("b")!.lanes], [1, 2]);
  assert.deepEqual([byId.get("c")!.lane, byId.get("c")!.lanes], [0, 1], "starting when the group ends is a new group");
  assert.deepEqual([byId.get("e")!.from, byId.get("e")!.to], [13 * 60, 13 * 60 + 30]);
});

test("Dagens tidslinje: always eight hours of the working day; work at other times is counted for Hela dygnet", () => {
  assert.equal(TIMELINE_HOURS, 8);
  assert.equal(timelineStart([]), 7, "an empty day shows 07-15");
  assert.equal(timelineStart(placeTimed([post("a", "08:00", "12:00")])), 7, "a day inside 07-15 keeps 07");
  assert.equal(timelineStart(placeTimed([post("a", "06:00", "07:00"), post("b", "13:00", "14:00")])), 6, "an early start moves the window");
  assert.equal(timelineStart(placeTimed([post("a", "22:00", "23:30")])), 16, "never past 16-24");
  const day = placeTimed([post("a", "09:00", "10:00"), post("night", "02:00", "04:00"), post("late", "18:00", "19:00")]);
  assert.equal(timelineStart(day), 2);
  assert.equal(outsideWindow(day, 7), 2, "the night and the evening post lie outside 07-15");
});

test("Min plan: every post with somewhere to put time carries its job, a finished one too; a booking without job or project has none", async () => {
  const { buildPlan } = await import("../lib/overview/me-plan");
  const range = { from: "2026-10-01", to: "2026-10-31" };
  const at = (day: string, hour: number) => `${day}T${String(hour - 1).padStart(2, "0")}:00:00.000Z`;
  const items = buildPlan({
    range, today: "2026-10-29", user: { id: "u", admin: false },
    workOrders: [{ id: "wo-done", title: "Klar order", status: "COMPLETED", dueDate: "2026-10-20", plannedStartDate: "2026-10-20" }],
    activities: [
      { id: "meet", title: "Byggmöte", status: "PLANNED", startsAt: at("2026-10-28", 10), endsAt: at("2026-10-28", 11), workflowTask: null, projectId: "p1" },
      { id: "lunch", title: "Lunch", status: "PLANNED", startsAt: at("2026-10-28", 12), endsAt: at("2026-10-28", 13), workflowTask: null, projectId: null },
    ],
    rounds: [], projects: [{ id: "p2", name: "Projekt", dueDate: "2026-10-30" }],
  });
  const job = (prefix: string) => items.find((item) => item.id.startsWith(prefix))?.job ?? null;
  assert.deepEqual(job("work-order:wo-done"), { id: "wo-done", kind: "WORK_ORDER" }, "a finished work order can still be chosen");
  assert.deepEqual(job("activity:meet"), { id: "p1", kind: "PROJECT" }, "a meeting in a project is project time");
  assert.equal(job("activity:lunch"), null, "a booking without job or project has nowhere to put time");
  assert.deepEqual(job("milestone:p2"), { id: "p2", kind: "PROJECT" });
});
