import assert from "node:assert/strict";
import test from "node:test";
import {
  actionTotal, attentionCustomers, customerCommercial, customerFacts, customerProgress, customerState, customerTotals, customersAccessRights, customersChip, customersSentence,
  customersTabAccess, deviationStats, lapsedCustomers, lapsedText, mergeCustomerFigures, quoteDaysText, sortActionRows, sortUpcomingRows, upcomingDay, workOrderState, workOrderStats,
  type CustomerActionRow, type CustomerFigures, type CustomersTabAccess, type WorkOrderStat,
} from "../lib/overview/customers-model";
import type { WorkflowPermissionGrant } from "../lib/workflow/permissions";

// Översikt – Kunder reworked (2026-10-29, the same way as Jag and Teamet): the pure rules behind
// lib/overview/customers-server.ts and the demo – what needs action, the coming week, each customer's state and progression.

const today = "2026-10-28";
const member = (...grants: WorkflowPermissionGrant[]) => ({ admin: false, workflowPermissions: { version: 1 as const, grants } });
const all: CustomersTabAccess = { customers: true, workOrders: true, quotes: true, prices: true, deviationsCompany: true };
const figures = (overrides: Partial<CustomerFigures>): CustomerFigures => ({
  customerId: "c", openWorkOrders: 0, overdueWorkOrders: 0, roundWorkOrders: 0, lastCompletedOn: null, inProgressWorkOrders: 0, needsActionWorkOrders: 0, completedRecent: 0,
  upcomingWorkOrders: 0, nextOn: null, openDeviations: 0, overdueDeviations: 0, quotesAwaiting: 0, quotesExpiringSoon: 0, invoiceDrafts: 0, invoiceDraftNet: 0, ...overrides,
});

test("deviations on Kunder follow the log's rule: the whole log for admins, the own entries for others", () => {
  assert.equal(customersTabAccess({ admin: true, workflowPermissions: { version: 1, grants: [] } }).deviationsCompany, true);
  assert.equal(customersTabAccess(member("customers:read", "work-order:read")).deviationsCompany, false);
  assert.equal(customersTabAccess(member("work-order:read")).deviationsCompany, false, "no Kunder, nothing inside it");
  assert.deepEqual(customersAccessRights(all), { workOrders: true, quotes: true, prices: true, deviations: "company" });
  assert.equal(customersAccessRights({ ...all, deviationsCompany: false }).deviations, "own");
});

test("a work order's state: late by the list's rule, then Behöver åtgärdas, closed ones never count", () => {
  assert.equal(workOrderState({ status: "PLANNED", dueDate: "2026-10-27" }, today), "overdue");
  assert.equal(workOrderState({ status: "NEEDS_ACTION", dueDate: "2026-10-27" }, today), "overdue", "late wins over Behöver åtgärdas, so it is listed once");
  assert.equal(workOrderState({ status: "NEEDS_ACTION", dueDate: "" }, today), "needsAction");
  assert.equal(workOrderState({ status: "IN_PROGRESS", dueDate: today }, today), "open", "due today is not late");
  assert.equal(workOrderState({ status: "COMPLETED", dueDate: "2026-10-01" }, today), "closed");
  assert.equal(workOrderState({ status: "CANCELLED", dueDate: "2026-10-01" }, today), "closed");
});

test("Närmaste veckan: a planned start within seven days, else a Klart senast within them", () => {
  const order = (plannedStartDate: string, dueDate: string, status = "PLANNED") => upcomingDay({ status, plannedStartDate, dueDate }, today);
  assert.deepEqual(order(today, ""), { day: today, starts: true });
  assert.deepEqual(order("2026-11-03", "2026-11-20"), { day: "2026-11-03", starts: true }, "the seventh day is in");
  assert.equal(order("2026-11-04", ""), null, "the eighth day is not");
  assert.deepEqual(order("", "2026-10-30"), { day: "2026-10-30", starts: false });
  assert.equal(order("2026-10-20", "2026-10-30"), null, "started earlier: its start is past, so not coming up");
  assert.equal(order("2026-10-30", "2026-10-27"), null, "a late one is in Kräver åtgärd");
  assert.equal(order("2026-10-30", "", "NEEDS_ACTION"), null, "Behöver åtgärdas is in Kräver åtgärd");
  assert.equal(order("2026-10-30", "", "COMPLETED"), null);
  assert.equal(order("", ""), null);
});

test("work orders per customer: open, late, under way, needs action, done lately, coming up and the next day", () => {
  const base = { customerId: "a", plannedStartDate: "", dueDate: "", roundScheduleId: null, completedOn: null };
  const [stat] = workOrderStats([
    { ...base, status: "PLANNED", dueDate: "2026-10-20" },
    { ...base, status: "IN_PROGRESS", plannedStartDate: "2026-10-30", roundScheduleId: "r1" },
    { ...base, status: "NEEDS_ACTION" },
    { ...base, status: "PLANNED", plannedStartDate: "2026-11-15" },
    { ...base, status: "COMPLETED", completedOn: "2026-10-10" },
    { ...base, status: "COMPLETED", completedOn: "2026-09-01" },
    { ...base, status: "CANCELLED", dueDate: "2026-10-01" },
  ], today);
  assert.deepEqual(stat, { customerId: "a", open: 4, overdue: 1, rounds: 1, lastCompletedOn: "2026-10-10", inProgress: 1, needsAction: 1, completedRecent: 1, upcoming: 1, nextOn: "2026-10-30" });
});

test("deviations per customer: open entries and the late ones by the log's rule", () => {
  assert.deepEqual(deviationStats([
    { customerId: "a", status: "OPEN", dueDate: "2026-10-01" },
    { customerId: "a", status: "IN_PROGRESS", dueDate: "" },
    { customerId: "a", status: "DONE", dueDate: "2026-10-01" },
    { customerId: "b", status: "OPEN", dueDate: "2026-11-01" },
  ], today), [{ customerId: "a", open: 2, overdue: 1 }, { customerId: "b", open: 1, overdue: 0 }]);
});

test("customers with only a deviation are listed; deviations late put the customer first", () => {
  const stat = { rounds: 0, lastCompletedOn: null, inProgress: 0, needsAction: 0, completedRecent: 0, upcoming: 0, nextOn: null };
  const rows = mergeCustomerFigures({
    access: all,
    workOrders: [{ customerId: "busy", open: 5, overdue: 0, ...stat }],
    quotes: [], invoices: [],
    deviations: [{ customerId: "dev", open: 1, overdue: 1 }, { customerId: "quiet", open: 1, overdue: 0 }],
  });
  assert.deepEqual(rows.map((row) => row.customerId), ["dev", "busy", "quiet"]);
  assert.equal(attentionCustomers(rows), 1);
  const noWork = mergeCustomerFigures({ access: { ...all, workOrders: false }, workOrders: [{ customerId: "busy", open: 5, overdue: 2, ...stat }], quotes: [], invoices: [], deviations: [] });
  assert.deepEqual(noWork, [], "work orders are not read without the right");
});

test("a customer's state, progression and money side", () => {
  assert.deepEqual(customerState(figures({ openWorkOrders: 2, overdueWorkOrders: 1, inProgressWorkOrders: 1 })), { label: "Förfallet", tone: "danger" });
  assert.deepEqual(customerState(figures({ openDeviations: 1, overdueDeviations: 1 })), { label: "Förfallet", tone: "danger" });
  assert.deepEqual(customerState(figures({ openWorkOrders: 1, needsActionWorkOrders: 1 })), { label: "Behöver åtgärd", tone: "danger" });
  assert.deepEqual(customerState(figures({ openWorkOrders: 2, inProgressWorkOrders: 1 })), { label: "Pågår", tone: "info" });
  assert.deepEqual(customerState(figures({ openWorkOrders: 2 })), { label: "Planerat", tone: "neutral" });
  assert.deepEqual(customerState(figures({ openDeviations: 1 })), { label: "Avvikelse", tone: "warning" });
  assert.equal(customerState(figures({ quotesAwaiting: 1 })), null, "only a quote: no work state");
  assert.deepEqual(customerProgress(figures({ openWorkOrders: 2, completedRecent: 3 })), { done: 3, total: 5, percent: 60 });
  assert.equal(customerProgress(figures({ openWorkOrders: null, completedRecent: null })), null, "no progression without the work-order right");
  assert.equal(customerProgress(figures({})), null);
  assert.deepEqual(customerCommercial(figures({ quotesAwaiting: 2, quotesExpiringSoon: 1, invoiceDrafts: 1 })), { label: "Offert går ut", tone: "warning" });
  assert.deepEqual(customerCommercial(figures({ quotesAwaiting: 1, invoiceDrafts: 1 })), { label: "Väntar på svar", tone: "info" });
  assert.deepEqual(customerCommercial(figures({ invoiceDrafts: 1 })), { label: "Att fakturera", tone: "success" });
  assert.equal(customerCommercial(figures({ quotesAwaiting: null, invoiceDrafts: null })), null);
});

test("a customer's facts, the most urgent first, red when something is late", () => {
  assert.deepEqual(customerFacts(figures({ openWorkOrders: 3, overdueWorkOrders: 2, overdueDeviations: 1, openDeviations: 2, nextOn: "2026-11-03", quotesAwaiting: 1, invoiceDrafts: 2, lastCompletedOn: "2026-10-12" })), {
    text: "2 förfallna · 1 förfallen avvikelse · 3 öppna arbetsordrar · Nästa 3 nov · 1 offert väntar på svar · 2 underlag · Senast på plats 12 okt", late: true,
  });
  assert.deepEqual(customerFacts(figures({ openWorkOrders: 1, needsActionWorkOrders: 1, openDeviations: 1 })), { text: "1 behöver åtgärd · 1 öppen avvikelse · 1 öppen arbetsorder", late: false });
});

test("Kräver åtgärd: late first by day, then Behöver åtgärdas, then quotes going out soon", () => {
  const row = (key: string, reason: CustomerActionRow["reason"], day: string): CustomerActionRow => ({ key, reason, day, id: key, title: key, href: "#", customerName: "Kund" });
  assert.deepEqual(sortActionRows([
    row("quote", "quote", "2026-10-29"), row("needs", "needsAction", ""), row("late2", "overdue", "2026-10-20"), row("dev", "deviation", "2026-10-10"), row("late1", "overdue", "2026-10-15"),
  ]).map((item) => item.key), ["dev", "late1", "late2", "needs", "quote"]);
  assert.equal(quoteDaysText("2026-11-02", today), "Giltig till 2 nov (5 dagar)");
  assert.equal(quoteDaysText("2026-10-29", today), "Giltig till 29 okt (1 dag)");
  assert.equal(quoteDaysText(today, today), "Giltig till 28 okt (sista dagen)");
  const upcoming = (id: string, day: string, starts: boolean) => ({ id, title: id, href: "#", customerName: "", day, starts, status: "PLANNED", progress: 0, round: false });
  assert.deepEqual(sortUpcomingRows([upcoming("b", "2026-10-30", false), upcoming("a", "2026-10-30", true), upcoming("c", today, false)]).map((item) => item.id), ["c", "a", "b"]);
});

test("the demo answers Kunder like Cloud: refused without customers:read, parts left out without their right", async () => {
  const { createDemoDatabase } = await import("../features/demo/demo-data");
  const { demoOverview, DemoOverviewError } = await import("../features/demo/demo-overview");
  const { hasWorkflowPermission } = await import("../lib/workflow/permissions");
  // Today's date: the demo's deviation log is seeded from the clock (its garage entry is two days late).
  const now = new Date();
  const db = createDemoDatabase(now);
  const run = (admin: boolean, grants: WorkflowPermissionGrant[], userIndex = 1) => {
    const user = { ...db.users[userIndex], permissions: { version: 1 as const, grants } };
    return demoOverview({ db, user, admin, now, can: (subject, action) => admin || hasWorkflowPermission(user.permissions, subject, action),
      roundViews: () => [], planningRounds: () => [], booked: new Set(), attention: () => { throw new Error("not used"); } }, new URL("http://demo/api/overview?tab=customers"));
  };
  await assert.rejects(run(false, ["work-order:read", "quotes:read"]), (error: unknown) => error instanceof DemoOverviewError && error.status === 403, "no customers:read, no Kunder");
  const full = (await run(true, [])).data as import("../lib/overview/customers-server").CustomersTabData;
  assert.ok(full.rows.length > 0, "the invented customers have open work");
  assert.equal(full.action.total, actionTotal(full.totals), "the list counts what the totals say");
  assert.ok(full.upcoming !== null);
  assert.ok(full.action.rows.some((row) => row.reason === "deviation" && row.customerName === "Nollpunkten Fastigheter AB"), "the garage deviation is tied to the customer through its work order");
  assert.ok(full.lapsed !== null && full.lapsed.rows.every((row) => !full.rows.some((active) => active.customerId === row.customerId)), "Länge sedan never lists a customer with something going on");
  const register = (await run(false, ["customers:read"])).data as import("../lib/overview/customers-server").CustomersTabData;
  assert.equal(register.upcoming, null, "no work-order right: no Närmaste veckan");
  assert.equal(register.lapsed, null, "no work-order right: no Länge sedan");
  const elin = (await run(false, ["customers:read"], 0)).data as import("../lib/overview/customers-server").CustomersTabData;
  assert.equal(elin.totals.overdueDeviations, 1, "a member sees the late deviation she is responsible for");
  assert.equal(register.totals.openWorkOrders, null);
  assert.equal(register.totals.quotesAwaiting, null);
  assert.ok(register.action.rows.every((row) => row.reason === "deviation"), "only deviations the person may read");
});

test("Länge sedan: worked for, nothing färdigställt for 12 months and nothing open, the most recent first", () => {
  const stat = (customerId: string, open: number, lastCompletedOn: string | null): WorkOrderStat => ({ customerId, open, overdue: 0, rounds: 0, lastCompletedOn, inProgress: 0, needsAction: 0, completedRecent: 0, upcoming: 0, nextOn: null });
  assert.deepEqual(lapsedCustomers([
    stat("old", 0, "2024-03-01"),
    stat("year", 0, "2025-10-28"),
    stat("recent", 0, "2025-10-29"),
    stat("open", 1, "2024-01-01"),
    stat("never", 0, null),
    stat("quote", 0, "2024-05-01"),
  ], new Set(["quote"]), today), [{ customerId: "year", lastCompletedOn: "2025-10-28" }, { customerId: "old", lastCompletedOn: "2024-03-01" }]);
  assert.equal(lapsedText("2025-10-28", today), "Senast på plats 28 okt 2025 · 12 mån sedan");
  assert.equal(lapsedText("2024-03-29", today), "Senast på plats 29 mar 2024 · 30 mån sedan");
});

test("totals, the chip and the sentence say the same as the list", () => {
  const rows = [
    figures({ customerId: "a", openWorkOrders: 3, overdueWorkOrders: 1, needsActionWorkOrders: 1, upcomingWorkOrders: 1, quotesAwaiting: 2, quotesExpiringSoon: 1, invoiceDrafts: 1, invoiceDraftNet: 100 }),
    figures({ customerId: "b", openWorkOrders: 1, openDeviations: 1, overdueDeviations: 1 }),
  ];
  const totals = customerTotals(rows, all);
  assert.equal(totals.customers, 2);
  assert.equal(totals.openWorkOrders, 4);
  assert.equal(actionTotal(totals), 4, "1 late + 1 Behöver åtgärdas + 1 late deviation + 1 quote going out");
  assert.equal(customersChip(totals), "4 att åtgärda");
  assert.equal(customersChip(customerTotals([figures({ openWorkOrders: 1 })], all)), null, "no chip when nothing needs action");
  assert.equal(customersSentence({ totals, attentionCustomers: 2 }),
    "Fyra saker kräver åtgärd hos två kunder – börja där. Fyra arbetsordrar är öppna, en kommer den närmaste veckan. Två offerter väntar på svar. Ett fakturaunderlag är inte fakturerat än.");
  const limited = customerTotals(rows, { ...all, workOrders: false, quotes: false, prices: false });
  assert.equal(limited.openWorkOrders, null);
  assert.equal(limited.quotesAwaiting, null);
  assert.equal(customersSentence({ totals: { ...limited, overdueDeviations: 0 }, attentionCustomers: 0 }), "Inget kräver åtgärd hos kunderna.", "nothing the person may not read is mentioned");
});
