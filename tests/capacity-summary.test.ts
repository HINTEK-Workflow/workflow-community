import assert from "node:assert/strict";
import test from "node:test";
import { capacityWeek, plannedMinutesByProject, plannedMinutesForUserInWindow, summarizeWeeklyCapacity } from "../lib/workflow/capacity-summary";

test("weekly capacity keeps planned and reported time separate", () => {
  const summary = summarizeWeeklyCapacity({
    anchor: new Date("2026-09-23T12:00:00"),
    weeklyWorkMinutes: 2_400,
    userId: "member-1",
    activities: [
      { assignedToUserId: "member-1", projectId: "project-a", status: "PLANNED", startsAt: "2026-09-21T08:00:00.000Z", endsAt: "2026-09-21T18:00:00.000Z" },
      { assignedToUserId: "member-1", projectId: "project-a", status: "COMPLETED", startsAt: "2026-09-23T08:00:00.000Z", endsAt: "2026-09-23T12:00:00.000Z" },
      { assignedToUserId: null, projectId: "project-b", status: "IN_PROGRESS", startsAt: "2026-09-24T08:00:00.000Z", endsAt: "2026-09-24T10:00:00.000Z" },
    ],
    timeEntries: [
      { startedAt: "2026-09-22T08:00:00.000Z", durationSec: 3_600 },
      { startedAt: "2026-09-20T08:00:00.000Z", durationSec: 7_200 },
    ],
  });
  assert.equal(summary.plannedMinutes, 600);
  assert.equal(summary.unassignedPlannedMinutes, 120);
  assert.equal(summary.reportedMinutes, 60);
  assert.equal(summary.remainingPlannedMinutes, 1_800);
  assert.equal(summary.overplannedMinutes, 0);
});

test("capacity clips a booking to the visible week and flags overplanning", () => {
  const anchor = new Date(2026, 8, 23, 12);
  const week = capacityWeek(anchor);
  const startsAt = new Date(week.startsAt); startsAt.setHours(startsAt.getHours() - 1);
  const endsAt = new Date(week.startsAt); endsAt.setHours(endsAt.getHours() + 3);
  const summary = summarizeWeeklyCapacity({
    anchor, weeklyWorkMinutes: 120, userId: "member-1", timeEntries: [],
    activities: [{ assignedToUserId: "member-1", projectId: "project-a", status: "PLANNED", startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }],
  });
  assert.equal(summary.plannedMinutes, 180);
  assert.equal(summary.overplannedMinutes, 60);
  assert.equal(summary.plannedPercent, 100);
});

test("a shared activity consumes the full interval for each selected member while unallocated work stays separate", () => {
  const input = {
    anchor: new Date("2026-09-23T12:00:00"), weeklyWorkMinutes: 2_400, timeEntries: [],
    activities: [
      { assignedToUserId: null, assignedToUserIds: ["member-1", "member-2"], projectId: "project-a", status: "PLANNED" as const, startsAt: "2026-09-22T08:00:00.000Z", endsAt: "2026-09-22T10:00:00.000Z" },
      { assignedToUserId: null, assignedToUserIds: [], projectId: "project-a", status: "PLANNED" as const, startsAt: "2026-09-23T08:00:00.000Z", endsAt: "2026-09-23T09:30:00.000Z" },
    ],
  };
  assert.equal(summarizeWeeklyCapacity({ ...input, userId: "member-1" }).plannedMinutes, 120);
  assert.equal(summarizeWeeklyCapacity({ ...input, userId: "member-2" }).plannedMinutes, 120);
  assert.equal(summarizeWeeklyCapacity({ ...input, userId: "member-1" }).unassignedPlannedMinutes, 90);
});

test("individual allocations consume each member's own minutes and project total is their sum", () => {
  const activities = [{
    assignedToUserId: null, assignedToUserIds: ["member-a", "member-b"], projectId: "project-a", status: "PLANNED" as const,
    startsAt: "2026-09-22T08:00:00.000Z", endsAt: "2026-09-22T12:00:00.000Z",
    assignments: [
      { userId: "member-a", plannedMinutes: 90, startsAt: null, endsAt: null },
      { userId: "member-b", plannedMinutes: null, startsAt: null, endsAt: null },
    ],
  }];
  const base = { anchor: new Date("2026-09-23T12:00:00"), weeklyWorkMinutes: 2_400, timeEntries: [], activities };
  assert.equal(summarizeWeeklyCapacity({ ...base, userId: "member-a" }).plannedMinutes, 90);
  assert.equal(summarizeWeeklyCapacity({ ...base, userId: "member-b" }).plannedMinutes, 240);
  assert.equal(plannedMinutesByProject(activities).get("project-a"), 330);
});

test("an individual interval takes precedence for capacity and can be shorter than the shared activity", () => {
  const summary = summarizeWeeklyCapacity({
    anchor: new Date("2026-09-23T12:00:00"), weeklyWorkMinutes: 2_400, userId: "member-a", timeEntries: [],
    activities: [{ assignedToUserId: null, assignedToUserIds: ["member-a"], projectId: "project-a", status: "PLANNED", startsAt: "2026-09-22T08:00:00.000Z", endsAt: "2026-09-22T12:00:00.000Z", assignments: [{ userId: "member-a", plannedMinutes: 60, startsAt: "2026-09-22T09:00:00.000Z", endsAt: "2026-09-22T10:00:00.000Z" }] }],
  });
  assert.equal(summary.plannedMinutes, 60);
});

test("calendar capacity uses the same allocation rules for an individual displayed day", () => {
  const activities = [{
    assignedToUserId: null, assignedToUserIds: ["member-a", "member-b"], projectId: "project-a", status: "PLANNED" as const,
    startsAt: "2026-09-22T08:00:00.000Z", endsAt: "2026-09-23T08:00:00.000Z",
    assignments: [
      { userId: "member-a", plannedMinutes: 120, startsAt: null, endsAt: null },
      { userId: "member-b", plannedMinutes: null, startsAt: "2026-09-22T10:00:00.000Z", endsAt: "2026-09-22T12:00:00.000Z" },
    ],
  }];
  const firstDay = { startsAt: new Date("2026-09-22T00:00:00.000Z"), endsAt: new Date("2026-09-23T00:00:00.000Z") };
  const secondDay = { startsAt: new Date("2026-09-23T00:00:00.000Z"), endsAt: new Date("2026-09-24T00:00:00.000Z") };
  assert.equal(plannedMinutesForUserInWindow({ activities, userId: "member-a", ...firstDay }), 80);
  assert.equal(plannedMinutesForUserInWindow({ activities, userId: "member-a", ...secondDay }), 40);
  assert.equal(plannedMinutesForUserInWindow({ activities, userId: "member-b", ...firstDay }), 120);
});

test("project planning totals exclude completed, cancelled and malformed bookings", () => {
  const totals = plannedMinutesByProject([
    { assignedToUserId: "member-1", projectId: "project-a", status: "PLANNED", startsAt: "2026-09-22T08:00:00.000Z", endsAt: "2026-09-22T10:30:00.000Z" },
    { assignedToUserId: "member-1", projectId: "project-a", status: "COMPLETED", startsAt: "2026-09-22T11:00:00.000Z", endsAt: "2026-09-22T12:00:00.000Z" },
    { assignedToUserId: "member-1", projectId: "project-b", status: "CANCELED", startsAt: "2026-09-22T11:00:00.000Z", endsAt: "2026-09-22T12:00:00.000Z" },
    { assignedToUserId: "member-1", projectId: "project-b", status: "IN_PROGRESS", startsAt: "bad", endsAt: "2026-09-22T12:00:00.000Z" },
  ]);
  assert.equal(totals.get("project-a"), 150);
  assert.equal(totals.has("project-b"), false);
});
