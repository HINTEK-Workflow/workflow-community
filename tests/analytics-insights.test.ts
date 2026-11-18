import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_DEVICE_KEYS, demoDeviceKey, isDemoBrowserKey, kindLabel, landingKeyLabel, slugWords, validCounter } from "../lib/analytics/catalog";
import { demoInsights, rankByCount, siteInsights } from "../lib/analytics/insights";
import { buildReport } from "../lib/analytics/report";

test("a demo visit's screen is one of three groups, sent by the browser, by the website's widths", () => {
  assert.deepEqual([320, 767, 768, 1099, 1100, 2560].map(demoDeviceKey), ["device_mobile", "device_mobile", "device_tablet", "device_tablet", "device_desktop", "device_desktop"]);
  for (const key of DEMO_DEVICE_KEYS) { assert.ok(isDemoBrowserKey(key), key); assert.ok(validCounter("demo", key), key); }
  assert.equal(validCounter("demo", "device_watch"), false);
  assert.deepEqual(DEMO_DEVICE_KEYS.map((key) => kindLabel("demo", key)), ["Mobil", "Surfplatta", "Dator"]);
});

test("a feature page is named in words, not by its address", () => {
  assert.equal(slugWords("maskin-larm"), "Maskin larm");
  assert.equal(landingKeyLabel("page:maskinlarm"), "Undersida: Maskinlarm");
  assert.equal(landingKeyLabel("page:start"), "Startsidan");
});

const rows = [
  { day: "2026-11-16", kind: "landing", key: "page:start", count: 80 },
  { day: "2026-11-16", kind: "landing", key: "page:maskinlarm", count: 20 },
  { day: "2026-11-16", kind: "landing", key: "click:demo", count: 3 },
  { day: "2026-11-16", kind: "landing", key: "click:github", count: 1 },
  { day: "2026-11-16", kind: "landing", key: "device:mobile", count: 60 },
  { day: "2026-11-16", kind: "landing", key: "device:desktop", count: 40 },
  { day: "2026-11-16", kind: "demo", key: "start_button", count: 10 },
  { day: "2026-11-16", kind: "demo", key: "device_mobile", count: 5 },
  { day: "2026-11-16", kind: "demo", key: "device_desktop", count: 5 },
  { day: "2026-11-16", kind: "demo", key: "flow_tour_start", count: 4 },
  { day: "2026-11-16", kind: "demo", key: "flow_tour_done", count: 1 },
  { day: "2026-11-16", kind: "demo", key: "time_lt1", count: 8 },
  { day: "2026-11-16", kind: "demo", key: "time_3to10", count: 2 },
  { day: "2026-11-16", kind: "demo", key: "view:stats", count: 9 },
];

test("the report has the demo's screens in a fixed order", () => {
  const report = buildReport(rows, "2026-11-16", "2026-11-16");
  assert.deepEqual(report.demo.devices.map((row) => [row.key, row.count, row.share]), [["device_mobile", 5, 50], ["device_tablet", 0, 0], ["device_desktop", 5, 50]]);
});

test("the website's lines: views and phone share, presses per view and the top button, the most seen feature page", () => {
  const report = buildReport(rows, "2026-11-16", "2026-11-16");
  const site = siteInsights(report.landing);
  assert.deepEqual(site.facts, [
    "100 sidvisningar, 60 % på mobil.",
    "4 knapptryck, motsvarande 4 % av sidvisningarna. Mest tryckt: Prova demon (3).",
    "Mest besökta undersidan: Maskinlarm (20).",
  ]);
  assert.equal(site.meaning.length, 2, "few go on, and most look on a phone");
  assert.deepEqual(rankByCount(report.landing.clicks).map((row) => row.key), ["click:demo", "click:github"]);
});

test("the demo's lines: starts and phone share, the way in, the tour, time and the most opened page", () => {
  const report = buildReport(rows, "2026-11-16", "2026-11-16");
  const demo = demoInsights(report.demo);
  assert.deepEqual(demo.facts, [
    "10 demostarter, 50 % från mobil.",
    "Vanligaste vägen in: Knapp på startsidan.",
    "25 % av dem som började rundturen gick igenom den.",
    "20 % stannade längre än 3 minuter.",
    "Mest öppnade sidan i demon: Översikt.",
  ]);
  assert.equal(demo.meaning.length, 3);
});

test("nothing counted gives no lines, and a period without a screen count leaves the share out", () => {
  const empty = buildReport([], "2026-11-16", "2026-11-16");
  assert.deepEqual(siteInsights(empty.landing), { facts: [], meaning: [] });
  assert.deepEqual(demoInsights(empty.demo), { facts: [], meaning: [] });
  const old = buildReport([{ day: "2026-11-16", kind: "demo", key: "start_link", count: 2 }], "2026-11-16", "2026-11-16");
  assert.equal(demoInsights(old.demo).facts[0], "2 demostarter.");
});
