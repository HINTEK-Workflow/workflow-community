import assert from "node:assert/strict";
import test from "node:test";
import { economyActionCount, economyFigures, economySentence, invoicedStatus, invoicedTimeShare, materialRowsText, unbilledTone } from "../lib/overview/economy-headline";
import { companyEstimate, groupEstimate, materialSourceKeys, mergeUnbilled, unbilledMaterialGroups, unbilledRows, type EconomyTabData, type MaterialJob, type UnbilledRow } from "../lib/overview/economy-model";
import { rowSourceKey } from "../lib/invoice-basis/model";

/** Läget i ekonomin (2026-10-29): the figures and the sentence on top of Ekonomi come from the tab's own answer. */
const row = (id: string, oldestDays: number, seconds = 3600, invoicedSeconds = 0): UnbilledRow => ({
  kind: "task", id, title: id, customer: "", seconds, entries: 1, oldestDays, invoicedSeconds, materialRows: 0, estimate: null, href: `/x/${id}`, canCreate: true,
});

function tab(over: Partial<EconomyTabData> = {}): EconomyTabData {
  return {
    cloud: true, today: "2026-10-29", monthName: "oktober",
    access: { prices: true, readBases: true, createBases: true, readQuotes: true },
    goals: { invoicedPerMonth: null, quoteWinRatePercent: null },
    invoiced: { months: [{ key: "2026-10", label: "okt", count: 0, net: 0 }], partial: false },
    drafts: { count: 0, net: 0 },
    unbilled: { hourlyRate: true, totalSeconds: 0, totalEstimate: 0, groups: 0, rows: [], hidden: 0, more: 0 },
    quotes: { awaiting: { count: 0, net: 0 }, expiring: { count: 0, rows: [] }, acceptedThisMonth: { count: 0, net: 0 }, winRate: { won: 0, lost: 0, percent: null, months: 12 }, withoutWorkOrder: { count: 0, rows: [] } },
    credits: null,
    ...over,
  };
}

test("Fakturerat av upparbetat: the share of finished time already billed, never 100 while time is left", () => {
  assert.equal(invoicedTimeShare(3600, 0), 0);
  assert.equal(invoicedTimeShare(3600, 3600), 50);
  assert.equal(invoicedTimeShare(1, 100_000), 99, "time still left is never shown as done");
  assert.equal(invoicedTimeShare(0, 3600), 100);
  assert.equal(invoicedTimeShare(-5, -5), 0, "nonsense counts as nothing");
  assert.equal(invoicedStatus(0), "Ej fakturerat");
  assert.equal(invoicedStatus(60), "Delvis fakturerat");
});

test("Ofakturerad tid: red from 30 days, amber from 14", () => {
  assert.equal(unbilledTone(0), "neutral");
  assert.equal(unbilledTone(14), "warning");
  assert.equal(unbilledTone(30), "danger");
});

test("unbilledRows carries the group's billed time to the row (0 when the query has none)", () => {
  const names = { tasks: new Map([["a", { title: "A", customer: "" }], ["b", { title: "B", customer: "" }]]), projects: new Map() };
  const access = { prices: false, createBases: false, readWorkOrders: true, readProjects: true };
  const now = new Date("2026-10-29T12:00:00Z");
  const { rows } = unbilledRows([
    { kind: "task", id: "a", seconds: 3600, entries: 1, oldest: new Date("2026-10-01T00:00:00Z"), invoicedSeconds: 7200 },
    { kind: "task", id: "b", seconds: 60, entries: 1, oldest: new Date("2026-10-02T00:00:00Z") },
  ], names, access, null, now);
  assert.deepEqual(rows.map((item) => [item.id, item.invoicedSeconds, item.materialRows]), [["a", 7200, 0], ["b", 0, 0]]);
});

test("Läget i ekonomin: one calm sentence when nothing waits", () => {
  const data = tab();
  assert.equal(economyActionCount(economyFigures(data)), 0);
  assert.equal(economySentence(data), "Allt färdigt arbete finns i ett fakturaunderlag och inga offerter behöver följas upp.");
});

test("Läget i ekonomin: unbilled work, the late ones, drafts, won quotes and expiring quotes in words", () => {
  const data = tab({
    unbilled: { hourlyRate: true, totalSeconds: 45_000, totalEstimate: 8125, groups: 3, rows: [row("a", 40), row("b", 31), row("c", 2)], hidden: 0, more: 0 },
    drafts: { count: 2, net: 5000 },
    quotes: { ...tab().quotes!, expiring: { count: 1, rows: [] }, withoutWorkOrder: { count: 1, rows: [] } },
  });
  const figures = economyFigures(data);
  assert.deepEqual([figures.unbilled, figures.late, figures.drafts, figures.withoutWorkOrder, figures.expiring], [3, 2, 2, 1, 1]);
  assert.equal(economyActionCount(figures), 7);
  assert.equal(economySentence(data), "Tre jobb har färdig tid utan fakturaunderlag, 12,5 h (≈ 8 125\u00a0kr). Två av dem har väntat över 30 dagar – börja där. "
    + "Två utkast är inte fakturerade. En vunnen offert saknar arbetsorder. En offert går ut inom 14 dagar.");
});

test("Läget i ekonomin: no amounts without the price right or a rate; the goal only with both", () => {
  const unbilled = { hourlyRate: false, totalSeconds: 3600, totalEstimate: null, groups: 1, rows: [row("a", 1)], hidden: 0, more: 0 };
  assert.equal(economySentence(tab({ unbilled })), "Ett jobb har färdig tid utan fakturaunderlag, 1 h.");
  const goal = tab({ goals: { invoicedPerMonth: 100_000, quoteWinRatePercent: null }, invoiced: { months: [{ key: "2026-10", label: "okt", count: 3, net: 70_000 }], partial: false } });
  assert.equal(economyFigures(goal).goalShare, 70);
  assert.match(economySentence(goal), /70 % av månadens mål är fakturerat\.$/);
  const noPrices = tab({ access: { prices: false, readBases: false, createBases: false, readQuotes: false }, goals: { invoicedPerMonth: 100_000, quoteWinRatePercent: null }, invoiced: { months: [{ key: "2026-10", label: "okt", count: 3, net: null }], partial: false } });
  assert.equal(economyFigures(noPrices).goalShare, null, "no kronor, no share of a kronor goal");
  assert.doesNotMatch(economySentence(noPrices), /mål/);
});

test("Läget i ekonomin: an older answer without withoutWorkOrder still reads", () => {
  const quotes = { ...tab().quotes! };
  delete quotes.withoutWorkOrder;
  assert.equal(economyFigures(tab({ quotes })).withoutWorkOrder, 0);
});

// ---------- ofakturerat material (2026-10-29) ----------

const at = (day: string) => new Date(`${day}T12:00:00Z`);
const jobs: MaterialJob[] = [
  { taskId: "wo1", projectId: null, completedAt: at("2026-10-20"), materials: [
    { id: "m1", name: "Dosa", quantity: "2", unit: "st", unitPrice: "100", markupPercent: "15" },
    { id: "m2", name: "Kabel", quantity: "10", unit: "m", unitPrice: "", markupPercent: "" },
    { id: "m3", name: "  ", quantity: "1", unit: "st", unitPrice: "50", markupPercent: "" },
    { id: "e1", name: "Parkering", quantity: "", unit: "", kind: "expense", amount: "500" },
  ] },
  { taskId: "wo2", projectId: "p1", completedAt: at("2026-10-10"), materials: [{ id: "m1", name: "Brytare", quantity: "1", unit: "st", unitPrice: "1000", markupPercent: "" }] },
  { taskId: "wo3", projectId: "p1", completedAt: at("2026-10-15"), materials: [{ id: "m1", name: "Säkring", quantity: "1", unit: "st", unitPrice: "200", markupPercent: "" }] },
];

test("Ofakturerat material: the proposal's rows – named rows only, priced as the proposal, a project's work orders together", () => {
  assert.deepEqual(materialSourceKeys(jobs), [rowSourceKey("wo1", "m1"), rowSourceKey("wo1", "m2"), rowSourceKey("wo1", "e1"), rowSourceKey("wo2", "m1"), rowSourceKey("wo3", "m1")], "a row without a name is not billable");
  const groups = unbilledMaterialGroups(jobs, new Set(), true);
  const wo1 = groups.find((group) => group.id === "wo1")!;
  assert.deepEqual([wo1.kind, wo1.rows, wo1.net], ["task", 3, 730], "2 × 100 kr + 15 % = 230 kr, the row without a price 0 kr, the expense 500 kr");
  const project = groups.find((group) => group.id === "p1")!;
  assert.deepEqual([project.kind, project.rows, project.net, project.oldest.toISOString().slice(0, 10)], ["project", 2, 1200, "2026-10-10"]);
  assert.equal(unbilledMaterialGroups(jobs, new Set(), false)[0].net, null, "no kronor without the price right");
});

test("Ofakturerat material: a row a basis has taken is gone; a job with everything taken is not listed", () => {
  const taken = new Set([rowSourceKey("wo1", "m1"), rowSourceKey("wo1", "m2"), rowSourceKey("wo1", "e1"), rowSourceKey("wo2", "m1")]);
  assert.deepEqual(unbilledMaterialGroups(jobs, taken, true).map((group) => [group.id, group.rows, group.net]), [["p1", 1, 200]]);
});

test("Ofakturerat material: merged with the time – one row per job, a job with material only shows too", () => {
  const time = [{ kind: "project" as const, id: "p1", seconds: 7200, entries: 2, invoicedSeconds: 3600, oldest: at("2026-10-12") }];
  const merged = mergeUnbilled(time, unbilledMaterialGroups(jobs, new Set(), true));
  assert.deepEqual(merged.map((group) => [group.id, group.seconds, group.materialRows, group.materialNet]), [["p1", 7200, 2, 1200], ["wo1", 0, 3, 730]], "oldest first");
  assert.equal(merged[0].oldest.toISOString().slice(0, 10), "2026-10-10", "the older of the time and the material");
  assert.equal(merged[0].invoicedSeconds, 3600);
  const names = { tasks: new Map([["wo1", { title: "Bara material", customer: "" }]]), projects: new Map([["p1", { title: "Projekt", customer: "" }]]) };
  const { rows } = unbilledRows(merged, names, { prices: true, createBases: true, readWorkOrders: true, readProjects: true }, 650, at("2026-10-29"));
  assert.deepEqual(rows.map((item) => [item.id, item.materialRows, item.estimate]), [["p1", 2, 2 * 650 + 1200], ["wo1", 3, 730]]);
});

test("Ofakturerat material: the estimate needs the rate only for time", () => {
  assert.equal(groupEstimate({ seconds: 0, materialNet: 730 }, null), 730, "material alone needs no hourly rate");
  assert.equal(groupEstimate({ seconds: 3600, materialNet: 730 }, null), null, "time without a rate gives no sum (it would look complete)");
  assert.equal(groupEstimate({ seconds: 3600, materialNet: null }, 650), 650);
  assert.equal(companyEstimate(7200, [{ materialNet: 100 }, { materialNet: null }], 500), 1100);
  assert.equal(materialRowsText(1), "1 materialrad");
  assert.equal(materialRowsText(3), "3 materialrader");
});

test("Läget i ekonomin: material in the sentence", () => {
  const both = tab({ unbilled: { hourlyRate: true, totalSeconds: 7200, totalEstimate: 2030, totalMaterialRows: 3, groups: 2, rows: [row("a", 1)], hidden: 0, more: 0 } });
  assert.equal(economySentence(both), "Två jobb har färdig tid eller material utan fakturaunderlag, 2 h och 3 materialrader (≈ 2 030\u00a0kr).");
  const only = tab({ unbilled: { hourlyRate: false, totalSeconds: 0, totalEstimate: 730, totalMaterialRows: 1, groups: 1, rows: [row("a", 1, 0)], hidden: 0, more: 0 } });
  assert.equal(economySentence(only), "Ett jobb har material utan fakturaunderlag, 1 materialrad (≈ 730\u00a0kr).");
  assert.equal(economyFigures(tab({ access: { prices: false, readBases: false, createBases: false, readQuotes: false }, unbilled: only.unbilled })).unbilledEstimate, null);
});
