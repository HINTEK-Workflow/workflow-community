import assert from "node:assert/strict";
import test from "node:test";
import { listWorkOrders, nextPlannedAt, type WorkOrderSource } from "../lib/workflow/work-orders";
import { selectFormHistory } from "../lib/workflow/form-history";
import { BUILTIN_FORMS } from "../lib/workflow/builtin-forms";
import { initialFormValues } from "../lib/workflow/form-document";

const order = (id: string, extra: Partial<WorkOrderSource> = {}): WorkOrderSource => ({
  id, kind: "WORK_ORDER", title: `Arbetsorder ${id}`, status: "PLANNED", progress: 0, assignedToUserId: null, assignedToName: "", createdBy: "me",
  dueDate: "", projectId: null, updatedAt: `2026-09-2${id}T08:00:00.000Z`, ...extra,
});

test("Mina arbetsordrar: mine versus all, filters, counts, search and pages", () => {
  const tasks = [
    order("1"), order("2", { assignedToUserId: "other", assignedToName: "Elis", status: "IN_PROGRESS" }), order("3", { assignedToUserId: "me", status: "COMPLETED", customerName: "Brf Kopparlunden" }),
    order("4", { createdBy: "other", status: "NEEDS_ACTION" }), { ...order("5"), kind: "RISK_ASSESSMENT" },
  ];
  const mine = listWorkOrders(tasks, { scope: "mine", filter: "all", q: "", page: 1, userId: "me" });
  assert.deepEqual(mine.items.map((item) => item.id), ["3", "1"], "assigned to me, or unassigned and created by me; newest first; no other kinds");
  assert.deepEqual(mine.counts, { open: 1, active: 0, planned: 1, action: 0, done: 1, all: 2 });
  const all = listWorkOrders(tasks, { scope: "all", filter: "open", q: "", page: 1, userId: "me" });
  assert.deepEqual(all.items.map((item) => item.id), ["4", "2", "1"]);
  assert.equal(all.counts.action, 1);
  assert.deepEqual(listWorkOrders(tasks, { scope: "all", filter: "all", q: "kopparlunden", page: 1, userId: "me" }).items.map((item) => item.id), ["3"]);
  const many = Array.from({ length: 30 }, (_, index) => order(String(index), { updatedAt: `2026-09-01T${String(index % 24).padStart(2, "0")}:00:00.000Z` }));
  const second = listWorkOrders(many, { scope: "mine", filter: "all", q: "", page: 3, userId: "me" });
  assert.equal(second.items.length, 6);
  assert.equal(second.pages, 3);
});

test("next planned occasion ignores removed and past activities", () => {
  const now = new Date("2026-09-26T12:00:00.000Z");
  assert.equal(nextPlannedAt([
    { startsAt: "2026-09-20T08:00:00.000Z", endsAt: "2026-09-20T09:00:00.000Z" },
    { startsAt: "2026-10-02T08:00:00.000Z", endsAt: "2026-10-02T09:00:00.000Z" },
    { startsAt: "2026-09-28T08:00:00.000Z", endsAt: "2026-09-28T09:00:00.000Z", deletedAt: "2026-09-25T08:00:00.000Z" },
    { startsAt: "2026-09-26T11:00:00.000Z", endsAt: "2026-09-26T13:00:00.000Z" },
  ], now), "2026-09-26T11:00:00.000Z");
  assert.equal(nextPlannedAt([], now), null);
});

test("earlier protocols of the same form for the same facility, with deviations and the next date", () => {
  const recurring = BUILTIN_FORMS.find((form) => form.id === "hintek-fortlopande-kontroll")!;
  const values = initialFormValues(recurring.document);
  values.fields.kontrolldatum = "2025-09-26";
  values.checklists.kontrollpunkter = { "kontrollpunkter-1": { state: "NOT_OK", comment: "Saknar märkning" } };
  const protocol = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "FORM", title: `Kontroll ${id}`, status: "COMPLETED", customerId: "c1", facilityId: "f1", completedAt: `2025-09-2${id}T10:00:00.000Z`,
    data: { kind: "FORM", details: { templateId: recurring.id, templateVersion: 1, templateName: "Fortlöpande kontroll", document: recurring.document, values } }, ...extra });
  const tasks = [protocol("1"), protocol("2", { facilityId: "f2" }), protocol("3", { data: { kind: "FORM", details: { templateId: "other" } } }), protocol("4")];
  const history = selectFormHistory(tasks, { taskId: "4", templateId: recurring.id, customerId: "c1", facilityId: "f1" });
  assert.deepEqual(history.map((item) => item.id), ["1"]);
  assert.equal(history[0].deviations, 1);
  assert.equal(history[0].nextDate, "2026-09-26");
  assert.deepEqual(selectFormHistory(tasks, { templateId: recurring.id, customerId: null, facilityId: null }), [], "no customer or facility, no history");
});
