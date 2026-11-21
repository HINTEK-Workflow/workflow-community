import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CARDS, cardDefinition, layoutSchema, normalizeLayout, type BoardLayout } from "../lib/boards/model";
import { defaultSource, SOURCE_CARD_TYPES, sourceFileIds, sourceOfCard } from "../lib/boards/cards";
import { calendarShape, linesFor, maskCalendar, peopleFit, SCHEDULE_TEXT_EM, scheduleColumns, scheduleFit, scheduleHours, shortDay, shortName, timeWidthEm } from "../lib/boards/cards/calendar";
import { sheetNumber, sheetSeries, sheetTable } from "../lib/boards/cards/file";
import { faultsShape } from "../lib/boards/cards/faults";
import { daySummarySeries, machineEventsShape, machineStateOf, signalSeries, signalValueOf } from "../lib/boards/cards/machines";
import { periodLabel, trendMoments, trendPeriod, TREND_METRICS } from "../lib/boards/cards/trend";
import { upkeepShape } from "../lib/boards/cards/upkeep";
import { METRIC_BETTER } from "../lib/boards/metric-shapes";
import { METRICS } from "../lib/boards/metrics";
import { initialsOf, layoutHasPersonalData, maskPeople } from "../lib/boards/privacy";
import { periodRange } from "../lib/boards/period";

/**
 * Tavlans nyare kort (2026-11-19): files, the calendar, the machines, Underhåll, Felanmälan and trends – the pure rules the
 * server and the demo share.
 */
const now = new Date("2026-11-19T10:00:00Z"); // Thursday 11:00 in Sweden

test("every new card type has a plain Swedish name, a description, a sensible start and a default where it can have one", () => {
  for (const type of SOURCE_CARD_TYPES) {
    const card = cardDefinition(type);
    assert.ok(card && card.label && card.description.length > 20, type);
    assert.ok(card.start.w >= card.size.minW && card.start.h >= card.size.minH, type);
    assert.doesNotMatch(`${card.label} ${card.description}`, /dashboard|widget/i);
    const source = defaultSource(type);
    if (type === "pdf" || type === "sheet") assert.equal(source, null, "a file card waits for its file");
    else assert.equal(source?.type, type);
  }
  assert.equal(CARDS.length, 19);
});

test("a new card is stored with its own source, never one of another type, and the data reference is checked", () => {
  const layout = layoutSchema.parse({ version: 1, orientation: "landscape", rows: 14, cards: [
    { id: "k-1", type: "calendar", x: 0, y: 0, w: 12, h: 8 },
    { id: "k-2", type: "machines", x: 12, y: 0, w: 12, h: 6, data: { kind: "source", source: { type: "calendar" } } },
    { id: "k-3", type: "pdf", x: 0, y: 8, w: 8, h: 6, data: { kind: "source", source: { type: "pdf", fileId: "fil-1", cycleSeconds: 10 } } },
  ] });
  assert.deepEqual(layout.cards[0]!.data, { kind: "source", source: { type: "calendar", range: "today", view: "list" } });
  assert.deepEqual(layout.cards[1]!.data, { kind: "source", source: { type: "machines" } }, "a source of another type gives way to the card's own default");
  assert.deepEqual(sourceOfCard({ type: "machines", data: { kind: "source", source: { type: "calendar" } } } as never), null, "and is never read");
  assert.deepEqual(layout.cards.flatMap((card) => sourceFileIds(sourceOfCard(card))), ["fil-1"], "a screen may fetch the PDF on its board and nothing else");
  assert.match(readFileSync("lib/boards/feed-server.ts", "utf8"), /sourceFileIds\(sourceOfCard\(card\)\)/, "the file route answers only for files on the board");
  assert.deepEqual(sourceFileIds({ type: "sheet", fileId: "x" }), [], "a sheet is read on the server");
  assert.throws(() => layoutSchema.parse({ version: 1, orientation: "landscape", rows: 14, cards: [{ id: "k-1", type: "trend", x: 0, y: 0, w: 12, h: 6, data: { kind: "source", source: { type: "trend", metrics: ["salaries"] } } }] }));
  assert.throws(() => layoutSchema.parse({ version: 1, orientation: "landscape", rows: 14, cards: [{ id: "k-1", type: "pdf", x: 0, y: 0, w: 8, h: 6, data: { kind: "source", source: { type: "pdf", fileId: "" } } }] }));
  const same: BoardLayout = normalizeLayout(layout);
  assert.deepEqual(same, layout);
});

test("Kalender: bookings cut to each day, in time order, a column per person, and names hidden or shortened outside the app", () => {
  const rows = [
    { startsAt: "2026-11-19T12:00:00Z", endsAt: "2026-11-19T14:00:00Z", title: "Service pump", people: ["Elna Strömtång"] },
    { startsAt: "2026-11-19T06:30:00Z", endsAt: "2026-11-19T08:00:00Z", title: "Möte", people: ["Elis Hammarström", "Elna Strömtång"] },
    { startsAt: "2026-11-18T20:00:00Z", endsAt: "2026-11-20T09:00:00Z", title: "Jour", people: [] },
  ];
  const today = calendarShape(rows, { range: "today", view: "schedule" }, now);
  assert.deepEqual(today.items.map((item) => `${item.start}–${item.end} ${item.title}`), ["00:00–24:00 Jour", "07:30–09:00 Möte", "13:00–15:00 Service pump"]);
  assert.deepEqual(scheduleColumns(today).map((column) => column.label), ["Elis Hammarström", "Elna Strömtång", "Utan person"]);
  assert.deepEqual(scheduleHours(today.items), { from: 0, to: 24 });
  const week = calendarShape(rows, { range: "week" }, now);
  assert.equal(week.days.length, 7);
  assert.deepEqual(week.items.filter((item) => item.title === "Jour").map((item) => item.day), ["2026-11-18", "2026-11-19", "2026-11-20"], "a booking over several days is on each");
  assert.equal(scheduleColumns(week).length, 5, "the week's schedule has the working days");
  const layout = layoutSchema.parse({ version: 1, orientation: "landscape", rows: 14, cards: [{ id: "k-1", type: "calendar", x: 0, y: 0, w: 12, h: 8 }] });
  assert.equal(layoutHasPersonalData(layout), true, "the calendar's names are personal data");
  const hidden = maskPeople(today, ["people"], "hidden");
  assert.ok(hidden.kind === "calendar" && hidden.items.every((item) => !item.people.length));
  const short = maskCalendar(today, "initials", initialsOf);
  assert.deepEqual(short.items[1]!.people, ["EH", "ES"]);
});

test("Kalender: a time or a name is never cut in the middle – the start time alone, \"Elis H.\" or fewer columns (filmed 2026-11-20)", () => {
  assert.equal(shortName("Elis Hammarström"), "Elis H.");
  assert.equal(shortName("Anna Maria Berg"), "Anna B.");
  assert.equal(shortName("Kalle"), "Kalle");
  assert.equal(shortDay("mån 17 nov"), "mån 17");
  assert.equal(linesFor("Elis Hammarström", 7), 2, "first and last name on two lines");
  assert.equal(linesFor("Elis Hammarström", 5), Infinity, "a word wider than the column does not fit");
  const people = [{ label: "Elis Hammarström", short: "Elis H." }, { label: "Elna Strömtång", short: "Elna S." }, { label: "Utan person", short: "Utan person" }];
  // A wide card: full names, the whole range, every hour.
  assert.deepEqual(scheduleFit({ widthEm: 40, heightEm: 30, labels: people, hours: 10 }), { columns: 3, names: "full", time: "range", hourStep: 1 });
  // The filmed card: about 4.5 em a column – "07:00–08:00" does not fit, so the start time alone; "Hammarström" does not, so "Elis H.".
  const narrow = scheduleFit({ widthEm: 16, heightEm: 6, labels: people, hours: 10 });
  assert.deepEqual([narrow.columns, narrow.names, narrow.time], [3, "short", "start"]);
  assert.ok(narrow.hourStep >= 2, "fewer hour marks on a low card");
  assert.equal(timeWidthEm("07:00") * SCHEDULE_TEXT_EM <= (16 - 1.9 - 0.4) / 3 - 0.88, true, "the start time fits its column");
  // Too narrow even for that: fewer columns, never a cut one.
  assert.equal(scheduleFit({ widthEm: 8, heightEm: 10, labels: people, hours: 10 }).columns, 1);
  assert.equal(peopleFit(["Elis Hammarström", "Elna Strömtång"], 40), "Elis Hammarström, Elna Strömtång");
  assert.equal(peopleFit(["Elis Hammarström", "Elna Strömtång"], 10), "Elis H., Elna S.");
  assert.equal(peopleFit(["Elis Hammarström", "Elna Strömtång"], 7), "Elis H. +1");
  assert.equal(peopleFit(["Elis Hammarström"], 2), "", "nothing rather than a cut name");
});

test("Kalkylblad: numbers read in Swedish, a table with typed columns and a chart of the chosen columns", () => {
  assert.equal(sheetNumber("1 234,5"), 1234.5);
  assert.equal(sheetNumber("12 %"), 12);
  assert.equal(sheetNumber("v. 47"), null);
  const headers = ["Skift", "Tillverkat", "Kasserat"];
  const rows = [["Fm", "412", "6"], ["Em", "398", ""]];
  const table = sheetTable(headers, rows);
  assert.deepEqual(table.columns.map((column) => column.type), ["text", "number", "number"]);
  assert.equal(table.rows[1]!.c2, null);
  const series = sheetSeries(headers, rows, { valueColumns: ["Kasserat"] });
  assert.deepEqual(series, { kind: "series", labels: ["Fm", "Em"], series: [{ name: "Kasserat", values: [6, null] }] });
  assert.equal(sheetSeries(["A", "B"], [["x", "y"]], {}), null, "no number column, no chart");
});

test("Maskiner: the machine page's status as a lamp, events newest first and values only where they were received", () => {
  assert.deepEqual(machineStateOf({ tone: "danger", label: "Larm: 1 öppen automatisk arbetsorder", stateAt: null }, "I drift", false).state, "alarm");
  assert.equal(machineStateOf({ tone: "warning", label: "Stoppad", stateAt: "2026-11-19T08:00:00Z" }, "I drift", false).state, "stopped");
  assert.equal(machineStateOf({ tone: "success", label: "I drift", stateAt: null }, "I drift", false).state, "running");
  assert.deepEqual(machineStateOf(null, "Ur drift", true), { state: "stopped", label: "Ur drift", at: null });
  assert.equal(machineStateOf(null, "I drift", false).label, "Ingen maskinkoppling");
  const events = machineEventsShape([
    { occurredAt: "2026-11-19T08:00:00Z", type: "alarm", code: "E21", severity: "fault", state: "raised", text: "Överström motor", machine: "Pump P2" },
    { occurredAt: "2026-11-19T07:00:00Z", type: "state", code: "RUN", severity: "info", state: "stopped", text: "", machine: "Pump P2" },
  ], true);
  assert.equal(events.items.length, 1, "only alarms");
  assert.equal(events.items[0]!.level, "error");
  assert.match(events.items[0]!.detail ?? "", /Pump P2 · Larm E21 · Utlöst/);
  assert.equal(signalValueOf({ tilluft_c: 19.4, text: "x" }, "tilluft_c"), 19.4);
  assert.equal(signalValueOf({ tilluft_c: "19" }, "tilluft_c"), null);
  const series = signalSeries([{ at: "2026-11-19T07:10:00Z", value: 18 }, { at: "2026-11-19T07:40:00Z", value: 20 }], "today", now, "Tilluft", "°C");
  assert.equal(series.labels.length, 24);
  assert.equal(series.series[0]!.values[8], 19, "the mean of the hour 08");
  assert.equal(series.series[0]!.values[9], null, "an hour without values stays empty");
  const days = daySummarySeries([{ day: "2026-11-17", alarms: 2, stops: 1, stoppedMinutes: 30 }, { day: "2026-11-17", alarms: 1, stops: 0, stoppedMinutes: 0 }], "alarms", "week", now);
  assert.deepEqual(days.series[0]!.values, [0, 3, 0, 0, 0, 0, 0]);
});

test("Underhåll and Felanmälan: counts and the list, the overdue and the open first, never a reporter's name", () => {
  const upkeep = upkeepShape([
    { title: "Byt filter · FTX1", partName: "FTX1", date: "2026-11-10", state: "late" },
    { title: "Smörj lager · P2", partName: "P2", date: "2026-11-25", state: "dormant" },
    { title: "Batteritest · UPS1", partName: "UPS1", date: "2027-03-01", state: "dormant" },
    { title: "Klar", partName: "P2", date: "2026-11-01", state: "done" },
  ], "30d", now);
  assert.deepEqual(upkeep.counts.map((count) => [count.label, count.value]), [["Förfallna", 1], ["Pågår", 0], ["Kommande", 1]]);
  assert.equal(upkeep.items[0]!.tone, "danger");
  const faults = faultsShape([
    { at: "2026-11-19T06:00:00Z", machine: "Linje 2 › Band", cause: "Stannar", severity: "HIGH", status: "pending", open: true, workOrder: "" },
    { at: "2026-11-10T06:00:00Z", machine: "Press 4", cause: "Läckage", severity: "NORMAL", status: "received", open: true, workOrder: "AO-1062" },
    { at: "2026-11-18T06:00:00Z", machine: "Press 4", cause: "Ljud", severity: "LOW", status: "received", open: false, workOrder: "AO-1049" },
  ], "week", now);
  assert.deepEqual(faults.counts.map((count) => count.value), [2, 2, 1]);
  assert.deepEqual(faults.counts.map((count) => count.label), ["Nya i veckan", "Öppna", "Att godkänna"], "short enough for a small card");
  assert.equal(faults.items[0]!.title, "Linje 2 › Band: Stannar");
  assert.match(faults.items[0]!.detail, /Hög · Väntar på godkännande/);
});

test("Trender: whole periods back in time with short names, and a good direction only where it is clear", () => {
  const weeks = trendMoments("week", now, 3);
  assert.deepEqual(weeks.map((moment) => periodLabel("week", moment)), ["v. 45", "v. 46", "v. 47"]);
  assert.equal(periodRange("week", weeks[0]!).from.toISOString(), "2026-11-01T23:00:00.000Z");
  assert.deepEqual(trendMoments("month", now, 2).map((moment) => periodLabel("month", moment)), ["okt", "nov"]);
  assert.equal(periodLabel("year", trendMoments("year", now, 2)[0]!), "2025");
  assert.ok(TREND_METRICS.includes("invoiced_amount") && !TREND_METRICS.includes("work_orders_open"), "only measures that count over a period");
  assert.equal(trendPeriod(["invoiced_amount"], null), "month");
  assert.equal(trendPeriod(["invoiced_amount", "hours_week"], "30d"), "month", "a period one of them lacks falls back");
  assert.equal(METRIC_BETTER.invoiced_amount, "up");
  assert.equal(METRIC_BETTER.invoices_overdue, "down");
  assert.equal(METRIC_BETTER.hours_week, undefined, "neutral where it is unclear");
  for (const key of Object.keys(METRIC_BETTER)) assert.ok(METRICS.some((metric) => metric.key === key));
});

test("the new cards read their data on the server with the pages' own readers and rights", () => {
  const machines = readFileSync("lib/boards/cards/machines-server.ts", "utf8");
  assert.match(machines, /partMachineStatus/);
  assert.match(machines, /requireMaintenance\(maintenanceCallerOf\(viewer\), "read"\)/);
  assert.match(readFileSync("lib/boards/cards/maintenance-server.ts", "utf8"), /planningMaintenance\(caller/);
  assert.match(readFileSync("lib/boards/cards/calendar-server.ts", "utf8"), /canReadPlannedActivity/);
  assert.match(readFileSync("lib/boards/cards/file-server.ts", "utf8"), /extractFile/);
  assert.match(readFileSync("lib/boards/cards/file-server.ts", "utf8"), /prepareAttachmentFile/);
});
