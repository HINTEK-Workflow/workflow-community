import assert from "node:assert/strict";
import test from "node:test";
import { ageInDays, awaitsWorkOrder, countDeviations, roundSafetyChanged, selectRiskBeforeStart, teamTabAccess, type RiskCandidate } from "../lib/overview/team-model";
import { customersTabAccess, invoiceStats, mergeCustomerFigures, quoteAnswerState, quoteStats } from "../lib/overview/customers-model";
import type { WorkflowPermissionGrant } from "../lib/workflow/permissions";

// Översikt – Teamet och Kunder with real data (2026-10-28, 0.29.0): the pure rules behind lib/overview/*-server.ts.

const member = (...grants: WorkflowPermissionGrant[]) => ({ admin: false, workflowPermissions: { version: 1 as const, grants } });
const admin = { admin: true, workflowPermissions: { version: 1 as const, grants: [] as WorkflowPermissionGrant[] } };
const today = "2026-10-28";

test("Teamet opens only for admins and team:read; each section follows its own module right", () => {
  assert.equal(teamTabAccess(member("projects:read", "work-order:read")).team, false, "module rights alone never open Teamet");
  const all = teamTabAccess(admin);
  assert.deepEqual(all, { team: true, workOrders: true, projects: true, quotes: true, rounds: true, prices: true, deviationsCompany: true });
  const lead = teamTabAccess(member("team:read", "projects:read"));
  assert.equal(lead.team, true);
  assert.equal(lead.projects, true);
  assert.equal(lead.workOrders, false, "no work-order right: no risk list");
  assert.equal(lead.quotes, false);
  assert.equal(lead.prices, false, "amounts need the price right");
  assert.equal(lead.rounds, false);
  assert.equal(lead.deviationsCompany, false, "a team:read member sees the deviation log's own scope, not the whole company");
  const seller = teamTabAccess(member("team:read", "quotes:read"));
  assert.equal(seller.quotes && seller.prices, true);
  assert.equal(teamTabAccess(member("team:read", "forms:read")).rounds, true);
  // Without Teamet nothing inside it opens, whatever the module rights.
  assert.deepEqual(teamTabAccess(member("quotes:read", "work-order:read")), { team: false, workOrders: false, projects: false, quotes: false, rounds: false, prices: false, deviationsCompany: false });
});

test("Kunder needs the customer register; columns follow quotes, work orders and prices", () => {
  assert.equal(customersTabAccess(member("work-order:read")).customers, false);
  assert.deepEqual(customersTabAccess(member("customers:read")), { customers: true, workOrders: false, quotes: false, prices: false, deviationsCompany: false });
  assert.deepEqual(customersTabAccess(member("customers:read", "work-order:read", "quotes:read")), { customers: true, workOrders: true, quotes: true, prices: true, deviationsCompany: false });
  assert.deepEqual(customersTabAccess(admin), { customers: true, workOrders: true, quotes: true, prices: true, deviationsCompany: true });
  // catalogue:read gives prices, but invoice bases still need the quotes right.
  assert.deepEqual(customersTabAccess(member("customers:read", "catalogue:read")), { customers: true, workOrders: false, quotes: false, prices: false, deviationsCompany: false });
});

const order = (overrides: Partial<RiskCandidate>): RiskCandidate => ({
  id: "o1", title: "Byte av central", kind: "WORK_ORDER", status: "PLANNED", plannedStartDate: "2026-10-30", started: false, customerName: "Kund AB", extended: null,
  data: { riskStep: true }, ...overrides,
});
const confirmed = { riskStep: true, riskCheck: { level: "simplified", answers: { deenergized: "yes", competence: "yes", height: "yes", others: "yes", special: "yes" }, confirmedBy: "A", confirmedAt: "2026-10-27T08:00:00.000Z" } };

test("risk before start: open, not started work orders within a week whose required risk step is not done", () => {
  const rows = selectRiskBeforeStart([
    order({ id: "soon" }),
    order({ id: "late", plannedStartDate: "2026-10-20", title: "Försenad" }),
    order({ id: "far", plannedStartDate: "2026-11-05" }),
    order({ id: "edge", plannedStartDate: "2026-11-04" }),
    order({ id: "done", data: confirmed }),
    order({ id: "old", data: {} }),
    order({ id: "started", started: true }),
    order({ id: "closed", status: "COMPLETED" }),
    order({ id: "cancelled", status: "CANCELLED" }),
    order({ id: "nodate", plannedStartDate: "" }),
    order({ id: "risk", kind: "RISK_ASSESSMENT" }),
  ], today);
  assert.deepEqual(rows.map((row) => row.id), ["late", "soon", "edge"]);
  assert.equal(rows[0].late, true);
  assert.equal(rows[1].late, false);
  assert.match(rows[1].hint, /Svara på frågorna/);
});

test("risk before start: an extended assessment counts when the linked one is completed", () => {
  const extended = { riskStep: true, riskCheck: { level: "extended", answers: {}, confirmedBy: "", confirmedAt: null, extendedTaskId: "r1" } };
  assert.equal(selectRiskBeforeStart([order({ data: extended, extended: { id: "r1", title: "Risk", status: "IN_PROGRESS" } })], today).length, 1);
  assert.equal(selectRiskBeforeStart([order({ data: extended, extended: { id: "r1", title: "Risk", status: "COMPLETED" } })], today).length, 0);
  assert.equal(selectRiskBeforeStart([order({ data: extended, extended: { id: "other", title: "Risk", status: "COMPLETED" } })], today).length, 1, "only the linked one counts");
});

test("accepted quotes without a work order: latest version, no order, not an ÄTA version", () => {
  const base = { status: "ACCEPTED", supersededAt: null, workOrderId: null, changeOfVersion: null };
  assert.equal(awaitsWorkOrder(base), true);
  assert.equal(awaitsWorkOrder({ ...base, workOrderId: "w1" }), false);
  assert.equal(awaitsWorkOrder({ ...base, supersededAt: new Date() }), false);
  assert.equal(awaitsWorkOrder({ ...base, changeOfVersion: 1 }), false);
  assert.equal(awaitsWorkOrder({ ...base, status: "SENT" }), false);
});

test("deviation counts use the log's own rules", () => {
  const counts = countDeviations([
    { status: "OPEN", dueDate: "2026-10-01", responsibleUserId: null, systematic: true },
    { status: "IN_PROGRESS", dueDate: "2026-11-01", responsibleUserId: "u1", systematic: false },
    { status: "OPEN", dueDate: "", responsibleUserId: null, systematic: false },
    { status: "DONE", dueDate: "2026-10-01", responsibleUserId: null, systematic: true },
  ], today);
  assert.deepEqual(counts, { open: 3, overdue: 1, withoutResponsible: 2, systematic: 1, reportable: 0, reportableOnTime: 0 });
  // Anmälningspliktig (användartest 2026-10-31, fel 3): a serious near miss or accident not marked reported, counted once.
  const reportable = countDeviations([
    { status: "OPEN", dueDate: "", responsibleUserId: null, systematic: false, type: "NEAR_MISS", serious: true, reportedToAuthorityAt: null },
    { status: "OPEN", dueDate: "2026-10-01", responsibleUserId: null, systematic: false, type: "ACCIDENT", serious: true, reportedToAuthorityAt: null },
    { status: "OPEN", dueDate: "", responsibleUserId: null, systematic: false, type: "ACCIDENT", serious: true, reportedToAuthorityAt: "2026-10-28T08:00:00.000Z" },
    { status: "OPEN", dueDate: "", responsibleUserId: null, systematic: false, type: "SELF_INSPECTION", serious: true, reportedToAuthorityAt: null },
    { status: "DONE", dueDate: "", responsibleUserId: null, systematic: false, type: "NEAR_MISS", serious: true, reportedToAuthorityAt: null },
  ], today);
  assert.equal(reportable.reportable, 2, "open, serious, an incident, not marked reported");
  assert.equal(reportable.reportableOnTime, 1, "the late one is already counted as overdue");
  assert.equal(ageInDays("2026-10-20", today), 8);
  assert.equal(ageInDays("2026-10-30", today), 0);
});

test("round safety: only a confirmed check with an unsafe answer counts as changed", () => {
  const check = (answers: Record<string, string>, confirmedAt: string | null = "2026-10-27T08:00:00.000Z") => ({ roundSafety: { answers, confirmedBy: "A", confirmedAt, riskRef: null } });
  assert.equal(roundSafetyChanged(check({ stillValid: "yes", changed: "no", newRisks: "no" })), false);
  assert.equal(roundSafetyChanged(check({ stillValid: "no", changed: "no", newRisks: "no" })), true);
  assert.equal(roundSafetyChanged(check({ stillValid: "yes", changed: "yes", newRisks: "no" })), true);
  assert.equal(roundSafetyChanged(check({ stillValid: "yes", changed: "no", newRisks: "yes" }, null)), false, "an unconfirmed check is not counted");
  assert.equal(roundSafetyChanged({}), false);
});

test("quotes per customer: waiting and going out soon, as the quote list reads the status", () => {
  assert.equal(quoteAnswerState({ status: "SENT", validUntil: "" }, today), "awaiting");
  assert.equal(quoteAnswerState({ status: "SENT", validUntil: "2026-12-31" }, today), "awaiting");
  assert.equal(quoteAnswerState({ status: "SENT", validUntil: "2026-11-11" }, today), "expiringSoon");
  assert.equal(quoteAnswerState({ status: "SENT", validUntil: today }, today), "expiringSoon");
  assert.equal(quoteAnswerState({ status: "SENT", validUntil: "2026-10-27" }, today), null, "past Giltig till is Utgången");
  assert.equal(quoteAnswerState({ status: "ACCEPTED", validUntil: "" }, today), null);
  assert.deepEqual(quoteStats([
    { customerId: "a", status: "SENT", validUntil: "2026-11-01" },
    { customerId: "a", status: "SENT", validUntil: "" },
    { customerId: "b", status: "DRAFT", validUntil: "" },
  ], today), [{ customerId: "a", awaiting: 2, expiringSoon: 1 }]);
  assert.deepEqual(invoiceStats([{ customerId: "a", net: 100.1 }, { customerId: "a", net: 0.2 }]), [{ customerId: "a", drafts: 2, net: 100.3 }]);
});

test("customer figures: only customers with something going on, columns left out without the right, most urgent first", () => {
  const stat = { inProgress: 0, needsAction: 0, completedRecent: 0, upcoming: 0, nextOn: null };
  const input = {
    workOrders: [
      { customerId: "calm", open: 2, overdue: 0, rounds: 1, lastCompletedOn: "2026-10-20", ...stat },
      { customerId: "late", open: 1, overdue: 1, rounds: 0, lastCompletedOn: null, ...stat },
      { customerId: "history", open: 0, overdue: 0, rounds: 0, lastCompletedOn: "2026-09-01", ...stat },
    ],
    quotes: [{ customerId: "quote", awaiting: 1, expiringSoon: 1 }],
    invoices: [{ customerId: "calm", drafts: 1, net: 500 }],
  };
  // The quote going out soon needs action (Kräver åtgärd, 2026-10-29), so it comes before a customer with only open work.
  const full = mergeCustomerFigures({ ...input, access: { customers: true, workOrders: true, quotes: true, prices: true, deviationsCompany: true } });
  assert.deepEqual(full.map((row) => row.customerId), ["late", "quote", "calm"]);
  assert.equal(full[2].invoiceDraftNet, 500);
  assert.equal(full[2].lastCompletedOn, "2026-10-20");
  const register = mergeCustomerFigures({ ...input, access: { customers: true, workOrders: false, quotes: false, prices: false, deviationsCompany: false } });
  assert.deepEqual(register, [], "without work orders or quotes nothing is counted");
  const noPrices = mergeCustomerFigures({ ...input, access: { customers: true, workOrders: false, quotes: true, prices: false, deviationsCompany: false } });
  assert.deepEqual(noPrices.map((row) => row.customerId), ["quote", "calm"]);
  assert.equal(noPrices[1].invoiceDraftNet, null, "no sum without the price right");
  assert.equal(noPrices[1].openWorkOrders, null, "no work-order column without the right");
});
