import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { haversineKm, roundKm } from "../lib/geo/distance";
import { geocodeAddress } from "../lib/geo/geocode";
import { activeRoutingProvider, roadDistanceAvailable, straightLineProvider } from "../lib/geo/routing";
import { carCostRow, computeCarCost, convertPrice, describeCarCost, expenseTotal, formatKm, formatSek, isCarCostRow, rowAmount, type MaterialRow } from "../lib/workflow/expenses";
import { workOrderDataSchema, workflowTaskInputSchema } from "../lib/workflow/task-model";
import { createWorkflowPdfReport, defaultWorkflowReportOptions, type WorkflowReportTask } from "../lib/workflow/report";
import { threeWayMerge } from "../lib/workflow/task-merge";
import { pdfText } from "../lib/import/pdf-text";

// Göteborg (Gustaf Adolfs torg) and Stockholm (Sergels torg): about 398 km in a straight line, ~470 km by road.
const goteborg = { latitude: 57.7072, longitude: 11.9668 };
const stockholm = { latitude: 59.3326, longitude: 18.0649 };

test("distance: haversine between two Swedish cities, symmetry, zero and rounding", () => {
  const km = haversineKm(goteborg, stockholm);
  assert.ok(km > 395 && km < 402, `straight line Göteborg–Stockholm, got ${km}`);
  assert.equal(haversineKm(stockholm, goteborg), km, "the same both ways");
  assert.equal(haversineKm(goteborg, goteborg), 0);
  // One degree of latitude is about 111,2 km.
  const degree = haversineKm({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
  assert.ok(Math.abs(degree - 111.19) < 0.1);
  assert.equal(roundKm(23.44), 23.4);
  assert.equal(roundKm(23.45), 23.5);
  assert.equal(roundKm(-1), 0);
});

test("routing: only the straight-line provider is active and it is named fågelvägen", async () => {
  assert.equal(activeRoutingProvider().id, straightLineProvider.id);
  assert.equal(roadDistanceAvailable(), false, "no road routing service is agreed");
  const result = await straightLineProvider.distanceKm(goteborg, stockholm);
  assert.equal(result.basis, "straight_line");
  assert.equal(straightLineProvider.label, "fågelvägen");
  assert.ok(result.km > 395 && result.km < 402);
  assert.equal(await geocodeAddress("Storgatan 1, Göteborg"), null, "the address hook is not wired yet");
});

test("car cost: units, round trip, rounding to öre and Swedish decimals", () => {
  const perMil = computeCarCost({ distanceKm: 23.4, roundTrip: true, price: 35, unit: "mil", basis: "straight_line" });
  assert.equal(perMil.totalKm, 46.8);
  assert.equal(perMil.pricePerKm, 3.5);
  assert.equal(perMil.amount, 163.8);
  const perKm = computeCarCost({ distanceKm: 23.4, roundTrip: false, price: 3.5, unit: "km", basis: "manual" });
  assert.equal(perKm.totalKm, 23.4);
  assert.equal(perKm.amount, 81.9);
  // 12,345 km one way × 2 × 1,99 kr/km = 49,13 kr (49,1331 rounded to whole öre); the distance itself is kept to a tenth.
  const odd = computeCarCost({ distanceKm: 12.345, roundTrip: true, price: 1.99, unit: "km", basis: "manual" });
  assert.equal(odd.distanceKm, 12.3);
  assert.equal(odd.totalKm, 24.6);
  assert.equal(odd.amount, 48.95);
  assert.equal(convertPrice(35, "mil", "km"), 3.5);
  assert.equal(convertPrice(3.5, "km", "mil"), 35);
  assert.equal(convertPrice(35, "mil", "mil"), 35);
  assert.equal(formatSek(163.8), "163,80");
  assert.equal(formatSek(1234.5), "1 234,50");
  assert.equal(formatSek(0), "0,00");
  assert.equal(formatKm(46.8), "46,8");
  assert.equal(formatKm(120), "120");
});

test("car cost row: readable text with the basis named, structured facts and a kept id on update", () => {
  const straight = carCostRow(computeCarCost({ distanceKm: 23.4, roundTrip: true, price: 35, unit: "mil", basis: "straight_line" }), "11111111-1111-4111-8111-111111111111");
  assert.equal(straight.name, "Bilkostnad: tur och retur 2 × 23,4 km (fågelvägen) × 35 kr/mil");
  assert.equal(straight.kind, "expense");
  assert.deepEqual([straight.quantity, straight.unit, straight.unitPrice, straight.amount], ["46,8", "km", "3,5", "163,80"]);
  assert.deepEqual(straight.carCost, { distanceKm: 23.4, roundTrip: true, pricePerKm: 3.5, basis: "straight_line" });
  assert.ok(isCarCostRow(straight));
  const manual = carCostRow(computeCarCost({ distanceKm: 31, roundTrip: false, price: 4, unit: "km", basis: "manual" }), "22222222-2222-4222-8222-222222222222");
  assert.equal(manual.name, "Bilkostnad: enkel resa 31 km (enligt bilens mätare) × 4 kr/km");
  assert.ok(!manual.name.includes("fågelvägen"), "a typed distance is never called fågelvägen");
  assert.equal(describeCarCost(computeCarCost({ distanceKm: 5, roundTrip: false, price: 2.5, unit: "km", basis: "straight_line" })), "Bilkostnad: enkel resa 5 km (fågelvägen) × 2,5 kr/km");
  // The schema accepts the row as it is produced.
  const parsed = workOrderDataSchema.parse({ executionNotes: "", deviations: "", materials: [straight, manual], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" });
  assert.deepEqual(parsed.materials[0], straight);
});

test("expenses: total, rows without a readable amount, and quantity × unit price", () => {
  const rows = [
    { id: "a", name: "Kabel", quantity: "5", unit: "m" },
    { id: "b", name: "Parkering", quantity: "1", unit: "st", kind: "expense" as const, unitPrice: "40", amount: "40" },
    { id: "c", name: "Bro", quantity: "2", unit: "st", kind: "expense" as const, unitPrice: "1 250,50", amount: "2 501,00" },
    { id: "d", name: "Okänt", quantity: "", unit: "", kind: "expense" as const, unitPrice: "", amount: "ca 100" },
    { id: "e", name: "Tomt", quantity: "", unit: "", kind: "expense" as const, unitPrice: "", amount: "" },
  ];
  const total = expenseTotal(rows);
  assert.deepEqual(total, { total: 2541, count: 4, missing: 1 }, "material rows never count; an empty amount is not 'missing'");
  assert.equal(rowAmount({ quantity: "3", unitPrice: "12,5" }), 37.5);
  assert.equal(rowAmount({ quantity: "3", unitPrice: "" }), null);
  assert.equal(rowAmount({ quantity: "x", unitPrice: "2" }), null);
});

test("schema: older material rows without kind parse unchanged; expense rows are validated", () => {
  const order = (materials: unknown[]) => ({ executionNotes: "", deviations: "", materials, signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" });
  const old = { id: "33333333-3333-4333-8333-333333333333", name: "Kabel", quantity: "5", unit: "m" };
  const parsed = workOrderDataSchema.parse(order([old]));
  assert.deepEqual(parsed.materials[0], old, "no kind, price or amount is invented");
  assert.equal(parsed.materials[0].kind, undefined);
  const expense = { ...old, kind: "expense", unitPrice: "3,5", amount: "163,80", carCost: { distanceKm: 23.4, roundTrip: true, pricePerKm: 3.5, basis: "straight_line" } };
  assert.deepEqual(workOrderDataSchema.parse(order([expense])).materials[0], expense);
  assert.equal(workOrderDataSchema.safeParse(order([{ ...old, kind: "travel" }])).success, false, "only material or expense");
  assert.equal(workOrderDataSchema.safeParse(order([{ ...expense, carCost: { ...expense.carCost, basis: "guess" } }])).success, false, "only the known bases");
  assert.equal(workOrderDataSchema.safeParse(order([{ ...expense, carCost: { ...expense.carCost, distanceKm: -1 } }])).success, false);
  assert.equal(workOrderDataSchema.safeParse(order([{ ...expense, amount: "x".repeat(41) }])).success, false, "amounts are short free text");
  // The whole task input accepts a work order with both kinds of rows, as Local, the demo and the API use it.
  const task = workflowTaskInputSchema.parse({ kind: "WORK_ORDER", title: "Byte", data: { kind: "WORK_ORDER", details: order([old, expense]) } });
  assert.equal(task.data.kind === "WORK_ORDER" ? task.data.details.materials.length : 0, 2);
});

test("live merge: a car cost row added by one person and a material filled in by another both survive", () => {
  const base: MaterialRow[] = [{ id: "m1", name: "", quantity: "", unit: "" }];
  const mine: MaterialRow[] = [{ id: "m1", name: "Kabel", quantity: "5", unit: "m" }];
  const theirs = [...base, carCostRow(computeCarCost({ distanceKm: 10, roundTrip: true, price: 30, unit: "mil", basis: "manual" }), "cc")];
  const merged = threeWayMerge(base, mine, theirs);
  assert.equal(merged.conflicts.length, 0);
  assert.deepEqual(merged.value.map((row) => row.id), ["m1", "cc"]);
  assert.equal(merged.value[0].name, "Kabel");
  assert.equal(merged.value[1].kind, "expense");
});

test("report: the work order PDF lists the expenses with their amounts, the basis and a sum excluding VAT", async () => {
  const fontBytes = new Uint8Array(await readFile("public/fonts/DejaVuSans.ttf"));
  const car = carCostRow(computeCarCost({ distanceKm: 23.4, roundTrip: true, price: 35, unit: "mil", basis: "straight_line" }), "44444444-4444-4444-8444-444444444444");
  const task: WorkflowReportTask = {
    id: "work", kind: "WORK_ORDER", title: "Byte av central", description: "", status: "COMPLETED", progress: 100, assignedToName: "QA", dueDate: "", totalDurationSec: 0, attachments: [],
    data: { kind: "WORK_ORDER", details: { executionNotes: "Bytt", deviations: "", materials: [
      { name: "Kabel", quantity: "5", unit: "m" },
      car,
      { name: "Parkering", quantity: "1", unit: "st", kind: "expense", unitPrice: "40", amount: "40,00" },
    ], signature: { name: "QA", confirmed: true, signedAt: "2026-10-08T08:00:00.000Z" }, closeNotes: "" } },
  };
  const text = pdfText(Buffer.from(await createWorkflowPdfReport({ company: "QA", tasks: [task], options: defaultWorkflowReportOptions, fontBytes })))!.replace(/\s+/g, " ");
  assert.match(text, /Tid och material/);
  assert.match(text, /Kabel/);
  assert.match(text, /fågelvägen/, "the basis is named in the report");
  assert.match(text, /Parkering/);
  // Without prices the row says what it is and how far, no rate and no amount.
  assert.doesNotMatch(text, /kr\/(km|mil)|163,80|203,80|Summa utgifter/);
  const priced = pdfText(Buffer.from(await createWorkflowPdfReport({ company: "QA", tasks: [task], options: { ...defaultWorkflowReportOptions, prices: true }, fontBytes })))!.replace(/\s+/g, " ");
  assert.match(priced, /kr\/(km|mil)/);
  assert.match(priced, /163,80/);
  assert.match(priced, /Summa utgifter exkl\. moms/);
  assert.match(priced, /203,80/);
  // Without any expense the report reads as before.
  const plain = pdfText(Buffer.from(await createWorkflowPdfReport({ company: "QA", tasks: [{ ...task, data: { kind: "WORK_ORDER", details: { ...task.data.details as Extract<WorkflowReportTask["data"], { kind: "WORK_ORDER" }>["details"], materials: [{ name: "Kabel", quantity: "5", unit: "m" }] } } }], options: defaultWorkflowReportOptions, fontBytes })))!;
  assert.ok(!plain.includes("Summa utgifter"));
});
