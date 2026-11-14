import assert from "node:assert/strict";
import test from "node:test";
import {
  compareListValues, countByFilter, listChipText, listPrefKey, listSearchMatches, listSortOptions, parseListPrefs, parseListSort, sortListItems, splitPage,
} from "../lib/list-filter";
import { listRounds, roundMatches, roundNeedsAttention, ROUND_SORTS, type RoundListEntry } from "../lib/workflow/round-list";
import { listStoreItems } from "../lib/maintenance/store-list";
import { DEVIATION_SORTS, sortDeviations } from "../lib/self-inspection/deviation-list";
import { QUOTE_SORTS } from "../lib/quotes/model";
import { PURCHASE_SORTS } from "../lib/purchases/model";
import { INVOICE_BASIS_SORTS } from "../lib/invoice-basis/model";

test("toppvisningen: sort words are shared and a sort is kept only when the list offers it", () => {
  assert.deepEqual(listSortOptions(["updated", "title"]), [{ value: "updated", label: "Senast ändrad" }, { value: "title", label: "Namn A–Ö" }]);
  assert.equal(parseListSort("title", QUOTE_SORTS), "title");
  assert.equal(parseListSort("balance", QUOTE_SORTS), "updated", "an unknown sort falls back to the list's first");
  assert.equal(parseListSort(null, PURCHASE_SORTS), "updated");
  assert.equal(parseListSort(undefined, INVOICE_BASIS_SORTS), "number", "Fakturaunderlag keeps the newest number first");
  assert.equal(parseListSort("due", DEVIATION_SORTS), "due");
  assert.equal(parseListSort("x", ROUND_SORTS), "due");
});

test("toppvisningen: chip texts and counts", () => {
  assert.equal(listChipText("Öppna", 12), "Öppna (12)");
  assert.equal(listChipText("Öppna", 0), "Öppna (0)");
  assert.equal(listChipText("Öppna", null), "Öppna", "no count while unknown or not given");
  const counts = countByFilter([1, 2, 3, 4], ["all", "even"] as const, (value, filter) => filter === "all" || value % 2 === 0);
  assert.deepEqual(counts, { all: 4, even: 2 });
});

test("toppvisningen: search matches every word in any text, Swedish case-insensitive", () => {
  assert.equal(listSearchMatches("", ["x"]), true);
  assert.equal(listSearchMatches("  ", []), true);
  assert.equal(listSearchMatches("ÅSKA pump", ["Åskskydd", "Pumpstation åska"]), true);
  assert.equal(listSearchMatches("åska el", ["Pumpstation åska"]), false, "every word must be found");
  assert.equal(listSearchMatches("kund", [null, undefined, "Kunden AB"]), true);
});

test("toppvisningen: sorting puts empty values last in either direction and uses Swedish order", () => {
  assert.equal(compareListValues("", "2026-01-01"), 1);
  assert.equal(compareListValues(null, "2026-01-01", "desc"), 1, "empty last also when descending");
  assert.equal(compareListValues("", null), 0);
  assert.ok(compareListValues("Ö", "A") > 0, "Ö after A");
  assert.ok(compareListValues("Å", "Z") > 0, "Å after Z");
  assert.ok(compareListValues("a", "B") < 0, "case ignored");
  assert.ok(compareListValues("Rad 10", "Rad 9") > 0, "numbers in text in number order");
  assert.ok(compareListValues(2, 10) < 0);
  const rows = [{ id: "a", day: "", name: "B" }, { id: "b", day: "2026-02-01", name: "C" }, { id: "c", day: "2026-01-01", name: "A" }, { id: "d", day: "2026-02-01", name: "A" }];
  assert.deepEqual(sortListItems(rows, [{ value: (row) => row.day }, { value: (row) => row.name }]).map((row) => row.id), ["c", "d", "b", "a"]);
  assert.deepEqual(rows.map((row) => row.id), ["a", "b", "c", "d"], "the input is not changed");
});

test("toppvisningen: a page across two ordered sets (Närmaste datum: dated first, then undated)", () => {
  assert.deepEqual(splitPage(30, 0, 21), { first: { skip: 0, take: 21 }, second: { skip: 0, take: 0 } });
  assert.deepEqual(splitPage(30, 20, 21), { first: { skip: 20, take: 10 }, second: { skip: 0, take: 11 } });
  assert.deepEqual(splitPage(30, 40, 21), { first: { skip: 30, take: 0 }, second: { skip: 10, take: 21 } });
  assert.deepEqual(splitPage(0, 0, 21), { first: { skip: 0, take: 0 }, second: { skip: 0, take: 21 } });
  assert.deepEqual(splitPage(20, 20, 21), { first: { skip: 20, take: 0 }, second: { skip: 0, take: 21 } });
});

test("toppvisningen: remembered view, sort and scope are read safely", () => {
  assert.equal(listPrefKey("quotes", "u1"), "hintek.list.quotes.u1");
  assert.equal(listPrefKey("store", ""), "hintek.list.store.local");
  assert.deepEqual(parseListPrefs(JSON.stringify({ view: "cards", sort: "title", scope: "mine" }), QUOTE_SORTS), { view: "cards", sort: "title", scope: "mine" });
  assert.deepEqual(parseListPrefs(JSON.stringify({ view: "grid", sort: "balance", scope: "team" }), QUOTE_SORTS), {}, "unknown values are dropped");
  assert.deepEqual(parseListPrefs("not json", QUOTE_SORTS), {});
  assert.deepEqual(parseListPrefs(null, QUOTE_SORTS), {});
});

const round = (id: string, extra: Partial<Omit<RoundListEntry, "overview">> & { overview?: Partial<RoundListEntry["overview"]> } = {}): RoundListEntry => ({
  id, title: `Rond ${id}`, active: true, assignedToUserId: null, updatedAt: `2026-10-0${id}T08:00:00Z`, ...extra,
  overview: { today: null, missed: 0, notDone: 0, openDeviations: 0, current: null, next: null, ...extra.overview },
});

test("Driftronder: chips, Behöver åtgärd as before, Mina, search, counts and sort", () => {
  const rounds = [
    round("1", { overview: { today: { state: "due" }, current: { date: "2026-10-31" } } }),
    round("2", { overview: { missed: 2, current: { date: "2026-10-29" } }, assignedToUserId: "me" }),
    round("3", { overview: { next: "2026-11-05" }, assignedToUserId: "me", title: "Pumpstation" }),
    round("4", { active: false, overview: { missed: 3 } }),
    round("5", { overview: { today: { state: "done" }, openDeviations: 1, next: "2026-11-01" } }),
  ];
  assert.equal(roundNeedsAttention(rounds[0]), true, "today's round not done");
  assert.equal(roundNeedsAttention(rounds[2]), false);
  assert.equal(roundNeedsAttention(rounds[3]), false, "a paused round never needs attention");
  assert.equal(roundNeedsAttention(rounds[4]), true, "a fault without a work order");
  assert.equal(roundMatches(rounds[4], "today"), false, "today's done round is not Idag");
  assert.equal(roundMatches(rounds[3], "paused"), true);
  assert.equal(roundMatches(rounds[3], "missed"), false, "a paused round is not counted as missed");
  const all = listRounds(rounds, { scope: "all", personId: "me", filter: "all", q: "", sort: "due" });
  assert.deepEqual(all.counts, { all: 5, attention: 3, today: 1, missed: 1, paused: 1 });
  assert.deepEqual(all.items.map((item) => item.id), ["2", "1", "5", "3", "4"], "nearest occasion first, paused (no day) last");
  const mine = listRounds(rounds, { scope: "mine", personId: "me", filter: "all", q: "", sort: "title" });
  assert.deepEqual(mine.items.map((item) => item.id), ["3", "2"], "Mina = responsible; Namn A–Ö");
  assert.equal(mine.counts.all, 2, "the counts follow the scope");
  assert.deepEqual(listRounds(rounds, { scope: null, personId: "", filter: "all", q: "pump", sort: "updated" }).items.map((item) => item.id), ["3"]);
  assert.deepEqual(listRounds(rounds, { scope: null, personId: "", filter: "all", q: "", sort: "updated" }).items.map((item) => item.id), ["5", "4", "3", "2", "1"]);
  assert.deepEqual(listRounds(rounds, { scope: "mine", personId: "", filter: "all", q: "", sort: "due" }).items, [], "no person, no Mina");
});

test("Förråd: Alla | Lågt saldo | Slut with counts and the sorts", () => {
  const items = [
    { id: "a", name: "Säkring 10A", articleNo: "200", total: 4, low: true },
    { id: "b", name: "Kabel", articleNo: "", total: 0, low: true },
    { id: "c", name: "Ändskydd", articleNo: "100", total: 12, low: false },
    { id: "d", name: "Olja", articleNo: "300", total: 0, low: false },
  ];
  const all = listStoreItems(items, { filter: "all", sort: "name" });
  assert.deepEqual(all.counts, { all: 4, low: 2, out: 2 });
  assert.deepEqual(all.items.map((item) => item.id), ["b", "d", "a", "c"], "Benämning A–Ö, Ä after S");
  assert.deepEqual(listStoreItems(items, { filter: "low", sort: "name" }).items.map((item) => item.id), ["b", "a"]);
  assert.deepEqual(listStoreItems(items, { filter: "out", sort: "name" }).items.map((item) => item.id), ["b", "d"], "Slut: nothing left, with or without a lowest balance");
  assert.deepEqual(listStoreItems(items, { filter: "all", sort: "articleNo" }).items.map((item) => item.id), ["c", "a", "d", "b"], "no article number last");
  assert.deepEqual(listStoreItems(items, { filter: "all", sort: "balance" }).items.map((item) => item.id), ["b", "d", "a", "c"], "lowest balance first, then name");
});

test("Avvikelser: the sorts, Nummer (newest first) by default as before", () => {
  const items = [
    { id: "a", number: 1, title: "Öppen lucka", updatedAt: "2026-10-30T10:00:00Z", dueDate: "" },
    { id: "b", number: 3, title: "Kabel", updatedAt: "2026-10-01T10:00:00Z", dueDate: "2026-11-10" },
    { id: "c", number: 2, title: "Avskärmning", updatedAt: "2026-10-20T10:00:00Z", dueDate: "2026-11-01" },
  ];
  assert.deepEqual(sortDeviations(items, "number").map((item) => item.id), ["b", "c", "a"]);
  assert.deepEqual(sortDeviations(items, "updated").map((item) => item.id), ["a", "c", "b"]);
  assert.deepEqual(sortDeviations(items, "due").map((item) => item.id), ["c", "b", "a"], "no Klart senast last");
  assert.deepEqual(sortDeviations(items, "title").map((item) => item.id), ["c", "b", "a"]);
});
