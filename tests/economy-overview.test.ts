import assert from "node:assert/strict";
import test from "node:test";
import { canViewEconomy, type WorkflowPermissionGrant, type WorkflowPermissionProfile } from "../lib/workflow/permissions";
import {
  FIGURE_KIND_LABEL, TIME_SOURCE_PREFIX, daysUntil, economyAccess, estimateValue, expiresText, goalShare, hourlyRateOf, hoursText, invoicedPerMonth, isUnbilledEntry, monthKeys, quoteWinRate,
  unbilledRows, type UnbilledGroup,
} from "../lib/overview/economy-model";
import { creditLotActive, creditSummary, creditSummaryLines, EMPTY_CREDIT_SUMMARY } from "../lib/credits/wallet-summary";
import { INVOICE_BASIS_MAX_PAGE, invoiceBasisListQuery, invoiceBasisNumberSearch, timeSourceKey } from "../lib/invoice-basis/model";
import { menuKeyOfView } from "../lib/workflow/menu-items";
import { breadcrumbTrail, viewGroupLabel } from "../lib/workflow/navigation";

/** Översikt → Ekonomi, its pure rules (2026-10-28). The database parts are in the outline of the report. */
const profile = (...grants: WorkflowPermissionGrant[]): WorkflowPermissionProfile => ({ version: 1, grants });
const member = (...grants: WorkflowPermissionGrant[]) => ({ admin: false, workflowPermissions: profile(...grants) });

test("Ekonomi: the tab needs admin or economy:read; team:read alone does not reach it", () => {
  assert.equal(canViewEconomy({ admin: true, workflowPermissions: profile() }), true);
  assert.equal(canViewEconomy(member("economy:read")), true);
  assert.equal(canViewEconomy(member("team:read")), false);
  assert.equal(canViewEconomy(member("quotes:read", "quotes:edit")), false, "handling bases is not the summary");
  assert.equal(economyAccess(member("team:read")).view, false);
});

test("Ekonomi: economy:read alone sees the summary but cannot handle bases, open quotes or see kronor", () => {
  const access = economyAccess(member("economy:read"));
  assert.deepEqual({ view: access.view, prices: access.prices, readBases: access.readBases, createBases: access.createBases, readQuotes: access.readQuotes }, { view: true, prices: false, readBases: false, createBases: false, readQuotes: false });
  const handler = economyAccess(member("economy:read", "quotes:read", "quotes:edit", "work-order:read"));
  assert.deepEqual([handler.prices, handler.readBases, handler.createBases, handler.readQuotes, handler.readWorkOrders, handler.readProjects], [true, true, true, true, true, false]);
  const admin = economyAccess({ admin: true, workflowPermissions: profile() });
  assert.ok(admin.view && admin.prices && admin.createBases && admin.readProjects);
});

test("Ofakturerad tid: a finished entry is unbilled until a basis has taken its time:<id> source", () => {
  assert.equal(TIME_SOURCE_PREFIX, "time:", "the query's prefix is the proposal's own key");
  assert.equal(TIME_SOURCE_PREFIX + "e1", timeSourceKey("e1"));
  const taken = new Set([timeSourceKey("e2")]);
  const entries = [
    { id: "e1", durationSec: 3600, endedAt: new Date() },
    { id: "e2", durationSec: 1800, endedAt: new Date() },
    { id: "e3", durationSec: 600, endedAt: null },
    { id: "e4", durationSec: 0, endedAt: new Date() },
  ];
  assert.deepEqual(entries.filter((entry) => isUnbilledEntry(entry, taken)).map((entry) => entry.id), ["e1"]);
});

test("Ofakturerad tid: rows the person may read, oldest first; estimates only with prices and a rate", () => {
  const now = new Date("2026-10-28T10:00:00Z");
  const groups: UnbilledGroup[] = [
    { kind: "project", id: "p1", seconds: 7200, entries: 2, oldest: new Date("2026-10-20T10:00:00Z") },
    { kind: "task", id: "t1", seconds: 5400, entries: 1, oldest: new Date("2026-09-20T10:00:00Z") },
    { kind: "task", id: "gone", seconds: 60, entries: 1, oldest: new Date("2026-10-01T10:00:00Z") },
  ];
  const names = { tasks: new Map([["t1", { title: "AO 1", customer: "Kund AB" }]]), projects: new Map([["p1", { title: "Projekt 1", customer: "" }]]) };
  const full = { prices: true, createBases: true, readWorkOrders: true, readProjects: true };
  const { rows, hidden } = unbilledRows(groups, names, full, 650, now);
  assert.deepEqual(rows.map((row) => [row.id, row.estimate, row.oldestDays]), [["t1", 975, 38], ["p1", 1300, 8]]);
  assert.equal(hidden, 1, "a job gone since the query is not listed");
  assert.match(rows[0].href, /view=workflow_task&taskId=t1/);
  assert.match(rows[1].href, /view=project&projectId=p1/);
  const noPrices = unbilledRows(groups, names, { ...full, prices: false, createBases: false, readProjects: false }, 650, now);
  assert.deepEqual(noPrices.rows.map((row) => [row.id, row.estimate, row.canCreate]), [["t1", null, false]]);
  assert.equal(noPrices.hidden, 2);
});

test("Verkligt och uppskattat: the labels, the rate and the estimate", () => {
  assert.deepEqual(FIGURE_KIND_LABEL, { actual: "Verkligt", estimate: "Uppskattning" });
  assert.equal(hourlyRateOf("650,50"), 650.5);
  assert.equal(hourlyRateOf(""), null);
  assert.equal(hourlyRateOf("0"), null);
  assert.equal(estimateValue(5400, null), null, "no rate: hours only");
  assert.equal(estimateValue(5400, 600), 900);
  assert.equal(estimateValue(0, 600), 0);
  assert.equal(hoursText(5400), "1,5 h");
  assert.equal(goalShare(50_000, 200_000), 25);
  assert.equal(goalShare(50_000, null), null);
  assert.equal(goalShare(null, 100), null);
});

test("Fakturerat per månad: the last six Swedish months, kronor only with the price right", () => {
  assert.deepEqual(monthKeys("2026-02-10", 4), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  const keys = monthKeys("2026-10-28", 2);
  const bases = [{ day: "2026-10-01", net: 1000.4 }, { day: "2026-10-31", net: 500 }, { day: "2026-09-30", net: 200 }, { day: "2026-08-15", net: 9 }];
  assert.deepEqual(invoicedPerMonth(bases, keys, true).map((month) => [month.key, month.label, month.count, month.net]), [["2026-09", "sep", 1, 200], ["2026-10", "okt", 2, 1500]]);
  assert.deepEqual(invoicedPerMonth(bases, keys, false).map((month) => month.net), [null, null]);
});

test("Offerter: the win rate per quote number, an ÄTA not counted again, open quotes not counted", () => {
  const today = "2026-10-28";
  const rate = quoteWinRate([
    // O-1: declined v1, accepted v2 → won once.
    { number: 1, status: "DECLINED", validUntil: "", superseded: true, changeOfVersion: null },
    { number: 1, status: "ACCEPTED", validUntil: "", superseded: false, changeOfVersion: null },
    // An ÄTA of O-1, declined: not a lost quote.
    { number: 1, status: "DECLINED", validUntil: "", superseded: false, changeOfVersion: 2 },
    // O-2: sent, ran out yesterday → lost.
    { number: 2, status: "SENT", validUntil: "2026-10-27", superseded: false, changeOfVersion: null },
    // O-3: sent and still valid → not decided.
    { number: 3, status: "SENT", validUntil: "2026-11-30", superseded: false, changeOfVersion: null },
    // O-4: declined.
    { number: 4, status: "DECLINED", validUntil: "", superseded: false, changeOfVersion: null },
  ], today);
  assert.deepEqual(rate, { won: 1, lost: 2, percent: 33 });
  assert.deepEqual(quoteWinRate([], today), { won: 0, lost: 0, percent: null });
  assert.equal(daysUntil(today, "2026-11-01"), 4);
  assert.equal(expiresText(0), "Går ut i dag");
  assert.equal(expiresText(1), "Går ut i morgon");
  assert.equal(expiresText(5), "Går ut om 5 dagar");
});

test("AI-krediter: expired lots leave the balance at once, before the sweep; the earliest active expiry is shown", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  const wallet = { balance: 150, purchasedBalance: 120, testMode: false, expiryEnabled: true };
  const lots = [
    { origin: "PURCHASE", remaining: 20, expiresAt: new Date("2026-10-27T12:00:00Z") },
    { origin: "PURCHASE", remaining: 100, expiresAt: new Date("2027-10-12T10:00:00Z") },
    { origin: "COMPENSATION", remaining: 30, expiresAt: null },
    { origin: "PURCHASE", remaining: 0, expiresAt: new Date("2026-01-01T00:00:00Z") },
  ];
  const summary = creditSummary(wallet, lots, now);
  assert.deepEqual(summary, { balance: 130, purchased: 100, other: 30, expiresAt: "2027-10-12T10:00:00.000Z", expiredPending: 20, testMode: false });
  assert.deepEqual(creditSummaryLines(summary), { split: "Köpta 100 · Övriga 30", validity: "Gäller till 2027-10-12" });
  assert.equal(creditLotActive(lots[0], true, now), false);
  assert.equal(creditLotActive(lots[0], false, now), true, "a wallet without expiry keeps every lot");
  // Exactly at the expiry the lot is gone (the sweep's `expiresAt <= now`).
  assert.equal(creditLotActive({ origin: "PURCHASE", remaining: 5, expiresAt: now }, true, now), false);
  assert.deepEqual(creditSummary(null, [], now), EMPTY_CREDIT_SUMMARY);
  assert.equal(creditSummaryLines({ ...EMPTY_CREDIT_SUMMARY, expiresAt: "2027-01-01T00:00:00Z" }).validity, "", "nothing left: no validity line");
  assert.equal(creditSummary({ ...wallet, balance: 10, purchasedBalance: 10 }, [{ origin: "PURCHASE", remaining: 30, expiresAt: "2026-01-01T00:00:00Z" }], now).balance, 0, "never below zero");
});

test("Fakturaunderlag list: filter, page and search from the address are bounded", () => {
  const read = (query: string) => invoiceBasisListQuery(new URLSearchParams(query));
  const plain = { mine: false, sort: "number", counts: false };
  assert.deepEqual(read("list=1"), { filter: "all", page: 1, q: "", ...plain });
  assert.deepEqual(read("status=DRAFT&page=3&q=  Kund "), { filter: "DRAFT", page: 3, q: "Kund", ...plain });
  assert.deepEqual(read("filter=INVOICED"), { filter: "INVOICED", page: 1, q: "", ...plain });
  // Toppvisningen (2026-10-31): Mina, a known sort (else the newest number first) and the chips' counts.
  assert.deepEqual(read("mine=1&sort=title&counts=1"), { filter: "all", page: 1, q: "", mine: true, sort: "title", counts: true });
  assert.equal(read("sort=amount").sort, "number");
  assert.equal(read("status=deleted").filter, "all");
  assert.equal(read("page=-4").page, 1);
  assert.equal(read("page=abc").page, 1);
  assert.equal(read("page=999999").page, INVOICE_BASIS_MAX_PAGE);
  assert.equal(read(`q=${"x".repeat(300)}`).q.length, 100);
  assert.equal(invoiceBasisNumberSearch("F-0012"), 12);
  assert.equal(invoiceBasisNumberSearch("12"), 12);
  assert.equal(invoiceBasisNumberSearch("Kund AB"), null);
});

test("Fakturaunderlag list: under Fakturor when that button exists, else under Offerter (kundresa 2026-11-07, M39)", () => {
  assert.equal(menuKeyOfView("invoice_bases"), "quotes");
  assert.equal(menuKeyOfView("invoice_bases", true), "customer_invoices");
  assert.equal(menuKeyOfView("quotes", true), "quotes");
  assert.equal(viewGroupLabel("invoice_bases"), "Offerter");
  assert.deepEqual(breadcrumbTrail({ view: "invoice_bases" }).map((crumb) => crumb.label), ["Översikt", "Offerter", "Fakturaunderlag"]);
  assert.deepEqual(breadcrumbTrail({ view: "invoice_bases", params: { invoices: "1" } }).map((crumb) => crumb.label), ["Översikt", "Fakturor", "Fakturaunderlag"]);
});
