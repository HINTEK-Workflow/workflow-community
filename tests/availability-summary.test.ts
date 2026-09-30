import assert from "node:assert/strict";
import test from "node:test";
import { summarizeAvailability } from "../lib/workflow/availability-summary";

const booking = (id: string, startsAt: string, endsAt: string, userId = "member-a") => ({
  id, title: id, startsAt, endsAt, status: "PLANNED" as const,
  assignedToUserId: userId, assignedToUserIds: [userId],
});

test("availability warns for an active internal booking overlap", () => {
  const summary = summarizeAvailability([
    booking("Första", "2026-10-01T08:00:00.000Z", "2026-10-01T10:00:00.000Z"),
    booking("Andra", "2026-10-01T09:30:00.000Z", "2026-10-01T11:00:00.000Z"),
  ]);
  assert.equal(summary.conflicts.length, 1);
  assert.equal(summary.conflicts[0].userId, "member-a");
  assert.equal(summary.conflicts[0].minutes, 30);
});

test("availability uses an individual interval and does not treat adjacent bookings as a conflict", () => {
  const summary = summarizeAvailability([
    { ...booking("Gemensam", "2026-10-01T08:00:00.000Z", "2026-10-01T12:00:00.000Z"), assignments: [{ userId: "member-a", startsAt: "2026-10-01T09:00:00.000Z", endsAt: "2026-10-01T10:00:00.000Z" }] },
    booking("Nästa", "2026-10-01T10:00:00.000Z", "2026-10-01T11:00:00.000Z"),
  ]);
  assert.deepEqual(summary.conflicts, []);
});

test("availability excludes completed, cancelled, unallocated and external-only work", () => {
  const summary = summarizeAvailability([
    { ...booking("Klar", "2026-10-01T08:00:00.000Z", "2026-10-01T10:00:00.000Z"), status: "COMPLETED" as const },
    { ...booking("Inställd", "2026-10-01T08:00:00.000Z", "2026-10-01T10:00:00.000Z"), status: "CANCELED" as const },
    { ...booking("Oallokerad", "2026-10-01T08:00:00.000Z", "2026-10-01T10:00:00.000Z"), assignedToUserId: null, assignedToUserIds: [] },
    { ...booking("Extern", "2026-10-01T08:00:00.000Z", "2026-10-01T10:00:00.000Z"), assignedToUserId: null, assignedToUserIds: [] },
  ]);
  assert.deepEqual(summary.conflicts, []);
});
