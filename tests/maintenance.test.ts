import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  emptyMaintenance, formatDowntime, highestPriority, maintenanceDowntimeMinutes, maintenanceFacts, maintenanceFactsSchema, maintenanceFromDeviation, maintenanceHasContent, maintenanceListFilterSchema,
  maintenanceMatches, maintenanceTimeIssue, nameplateText, placeHasObjectData, placeObjectOf,
} from "../lib/workflow/maintenance";
import { workflowTaskCompletion, workflowTaskInputSchema, workOrderDataSchema } from "../lib/workflow/task-model";
import { customerFacilityInputSchema } from "../lib/workflow/customer-facility";
import { emptyPlaceRegisterFilter, listPlaceRegister, objectTypeOptions, placeRegisterFilterSchema, placeRegisterMatches } from "../lib/workflow/place-register";
import { TOOL_CATALOG } from "../lib/tools/catalog";
import { itemFieldsSchema } from "../lib/maintenance/model";
import { createLocalWorkspace, parseLocalWorkspace, saveLocalCustomerFacility, saveLocalCustomerRecord } from "../features/kfid/local-workspace-store";
import { createWorkflowPdfReport, defaultWorkflowReportOptions } from "../lib/workflow/report";
import { pdfText } from "../lib/import/pdf-text";

const order = (details: Record<string, unknown> = {}) => ({ executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "", ...details });

test("the maintenance facts are an item's (2026-10-30): an older order's facts are dropped, what it waits for stays", () => {
  const old = workOrderDataSchema.parse(order());
  assert.equal("maintenance" in old, false);
  assert.equal(old.waitingOn, undefined, "nothing is invented for an older order");
  const parsed = workOrderDataSchema.parse(order({ maintenance: { type: "CORRECTIVE", priority: "URGENT", fault: "Brytaren löser ut", waitingOn: "MATERIAL" } }));
  assert.equal("maintenance" in parsed, false, "the old facts are not kept on the order");
  assert.equal(parsed.waitingOn, "MATERIAL", "an older file's waiting reason moves to the order");
  assert.equal(workOrderDataSchema.parse(order({ maintenance: { type: "SOMETHING" } })).waitingOn, undefined, "old junk is dropped, never refused");
  assert.equal(workOrderDataSchema.parse(order({ waitingOn: "CUSTOMER", maintenance: { waitingOn: "MATERIAL" } })).waitingOn, "CUSTOMER", "the order's own value wins");
  const facts = maintenanceFactsSchema.parse({ type: "CORRECTIVE", priority: "URGENT", fault: "  Brytaren löser ut  ", reportedAt: "2026-10-06T06:15:00.000Z" });
  assert.deepEqual(facts, { ...emptyMaintenance(), type: "CORRECTIVE", priority: "URGENT", fault: "Brytaren löser ut", reportedAt: "2026-10-06T06:15:00.000Z" });
  assert.equal(maintenanceFactsSchema.safeParse({ type: "SOMETHING" }).success, false, "only the fixed types");
  assert.equal(maintenanceFactsSchema.safeParse({ cause: "SABOTAGE" }).success, false, "only the fixed causes");
  assert.equal(itemFieldsSchema, maintenanceFactsSchema, "the item's fields are the same facts");
});

test("work order maintenance: nothing is required to complete a corrective order (B7)", () => {
  const task = workflowTaskInputSchema.parse({ kind: "WORK_ORDER", title: "Åtgärda", data: { kind: "WORK_ORDER", details: order({ executionNotes: "Bytt kontaktor", signature: { name: "Signe", confirmed: true, signedAt: null } }) } });
  assert.equal(workflowTaskCompletion(task).ready, true);
});

test("downtime is computed from the two times and never stored", () => {
  assert.equal(maintenanceDowntimeMinutes({ stoppedAt: "2026-10-06T06:00:00.000Z", restoredAt: "2026-10-07T09:15:00.000Z" }), 27 * 60 + 15);
  assert.equal(maintenanceDowntimeMinutes({ stoppedAt: "2026-10-06T06:00:00.000Z", restoredAt: null }), null);
  assert.equal(maintenanceDowntimeMinutes({ stoppedAt: "2026-10-06T06:00:00.000Z", restoredAt: "2026-10-06T05:00:00.000Z" }), null, "backwards gives no downtime");
  assert.equal(maintenanceTimeIssue({ stoppedAt: "2026-10-06T06:00:00.000Z", restoredAt: "2026-10-06T05:00:00.000Z" }), "Åter i drift ligger före stoppet.");
  assert.equal(formatDowntime(27 * 60 + 15), "1 d 3 h 15 min");
  assert.equal(formatDowntime(45), "45 min");
  assert.equal(formatDowntime(120), "2 h");
  assert.equal(formatDowntime(0), "0 min");
  assert.equal(formatDowntime(null), "");
});

test("a deviation prefills a corrective order; the highest severity is Akut", () => {
  const now = new Date("2026-10-06T08:00:00.000Z");
  const options = ["Observera", "Åtgärdas", "Akut"];
  const serious = ["Åtgärdas", "Akut"];
  const urgent = maintenanceFromDeviation({ fault: " Läckage vid pump ", severity: "Akut", severityOptions: options, seriousOptions: serious, now });
  assert.deepEqual([urgent.type, urgent.priority, urgent.fault, urgent.reportedAt], ["CORRECTIVE", "URGENT", "Läckage vid pump", now.toISOString()]);
  assert.equal(maintenanceFromDeviation({ severity: "Åtgärdas", severityOptions: options, seriousOptions: serious, now }).priority, "HIGH");
  assert.equal(maintenanceFromDeviation({ severity: "Observera", severityOptions: options, seriousOptions: serious, now }).priority, "NORMAL");
  assert.equal(maintenanceFromDeviation({ fault: "Utan allvarlighet", now }).priority, "", "no severity, no guess");
});

test("the PDF facts list only what is filled in, in Swedish time", () => {
  assert.deepEqual(maintenanceFacts(undefined), []);
  assert.deepEqual(maintenanceFacts(emptyMaintenance()), []);
  assert.equal(maintenanceHasContent(emptyMaintenance()), false);
  const facts = Object.fromEntries(maintenanceFacts({ ...emptyMaintenance(), type: "PREVENTIVE", cause: "OTHER", causeNote: "Fukt", stoppedAt: "2026-10-06T06:00:00.000Z", restoredAt: "2026-10-06T07:30:00.000Z" }));
  assert.deepEqual(Object.keys(facts), ["Typ av underhåll", "Orsak", "Ur drift", "Åter i drift", "Stilleståndstid"]);
  assert.equal(facts["Typ av underhåll"], "Förebyggande");
  assert.equal(facts.Orsak, "Annan: Fukt");
  assert.match(facts["Ur drift"], /08:00/, "06:00 UTC is 08:00 Swedish summer time");
  assert.equal(facts["Stilleståndstid"], "1 h 30 min");
  // Kritikalitet and Märkning (2026-10-24): the work order's own facts beside the priority.
  const marked = Object.fromEntries(maintenanceFacts({ ...emptyMaintenance(), priority: "HIGH", criticality: "A", marking: "E12" }));
  assert.deepEqual(Object.keys(marked), ["Prioritet", "Kritikalitet", "Märkning"]);
  assert.match(marked.Kritikalitet, /^A – /);
  assert.equal(marked["Märkning"], "E12");
  assert.equal(maintenanceHasContent({ ...emptyMaintenance(), marking: "E12" }), true);
  assert.deepEqual([emptyMaintenance().criticality, emptyMaintenance().marking], ["", ""]);
});

test("the work order PDF has an Underhåll block per maintenance item it holds", async () => {
  const font = new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf"));
  const report = async (maintenanceItems?: { partName: string; facts: unknown }[]) => pdfText(Buffer.from(await createWorkflowPdfReport({ company: "QA", fontBytes: font, options: defaultWorkflowReportOptions, tasks: [{
    id: "wo-1", kind: "WORK_ORDER", title: "Byt kontaktor", description: "", status: "IN_PROGRESS", progress: 0, assignedToName: "", dueDate: "", totalDurationSec: 0, attachments: [],
    data: { kind: "WORK_ORDER", details: order({ executionNotes: "Bytt", maintenance: { ...emptyMaintenance(), fault: "Gammalt fel på ordern" } }) }, maintenanceItems,
  }] }))) ?? "";
  const without = await report();
  assert.doesNotMatch(without, /Typ av underhåll/);
  assert.doesNotMatch(without, /Gammalt fel/, "the order's old facts are never printed");
  const withFacts = await report([{ partName: "Hydraulpump", facts: { ...emptyMaintenance(), type: "CORRECTIVE", priority: "HIGH", fault: "Kontaktorn surrar" } }]);
  assert.match(withFacts, /Underhåll · Hydraulpump/);
  assert.match(withFacts, /Avhjälpande/);
  assert.match(withFacts, /Kontaktorn surrar/);
});

test("the work list's maintenance filter", () => {
  assert.deepEqual(maintenanceListFilterSchema.parse({}), { mtype: "", priority: "" });
  assert.equal(maintenanceListFilterSchema.safeParse({ mtype: "NOPE" }).success, false);
  assert.equal(maintenanceMatches([], { mtype: "", priority: "" }), true, "no filter keeps every order");
  assert.equal(maintenanceMatches([], { mtype: "CORRECTIVE" }), false, "an order without items does not match a type");
  assert.equal(maintenanceMatches([{ type: "CORRECTIVE", priority: "HIGH" }], { mtype: "CORRECTIVE", priority: "HIGH" }), true);
  assert.equal(maintenanceMatches([{ type: "CORRECTIVE", priority: "LOW" }], { priority: "HIGH" }), false);
  assert.equal(maintenanceMatches([{ type: "PREVENTIVE", priority: "LOW" }, { type: "CORRECTIVE", priority: "HIGH" }], { mtype: "CORRECTIVE", priority: "HIGH" }), true, "any item of the order");
  assert.equal(highestPriority(["LOW", "", "URGENT", "HIGH"]), "URGENT");
  assert.equal(highestPriority(["NORMAL", null, "SOON"]), "NORMAL", "unknown values are ignored");
  assert.equal(highestPriority([]), "");
});

test("place object data: defaults, fixed states, empty value rows dropped; marking and criticality are not the place's", () => {
  const plain = customerFacilityInputSchema.parse({ name: "Ställverk" });
  assert.deepEqual(placeObjectOf(plain), { objectType: "", operatingState: "", manufacturer: "", model: "", serialNumber: "", installedOn: "", attributes: [] });
  assert.equal(placeHasObjectData(plain), false);
  const object = customerFacilityInputSchema.parse({ name: "Pump", kind: "OBJECT", parentId: "p1", objectType: " Pump ", operatingState: "OUT_OF_SERVICE", manufacturer: "Tillverkare", model: "M1", serialNumber: "123", installedOn: "2020-05-01",
    attributes: [{ label: "Effekt", value: "7,5 kW" }, { label: " ", value: "" }] });
  assert.equal(object.objectType, "Pump");
  assert.deepEqual(object.attributes, [{ label: "Effekt", value: "7,5 kW" }], "a row left empty is dropped");
  assert.equal(nameplateText(object), "Tillverkare · M1 · SN 123");
  // Kritikalitet and Märkning moved to the work order (2026-10-24): an older caller's values are left out, not refused.
  const older = customerFacilityInputSchema.parse({ name: "X", criticality: "A", code: "E12" }) as Record<string, unknown>;
  assert.equal("criticality" in older || "code" in older, false);
  assert.equal(customerFacilityInputSchema.safeParse({ name: "X", operatingState: "BROKEN" }).success, false);
  assert.equal(customerFacilityInputSchema.safeParse({ name: "X", installedOn: "6 maj" }).success, false);
  assert.equal(customerFacilityInputSchema.safeParse({ name: "X", attributes: [{ label: "", value: "utan namn" }] }).success, false, "a value needs to say what it is");
  assert.equal(customerFacilityInputSchema.safeParse({ name: "X", attributes: Array.from({ length: 31 }, (_, index) => ({ label: `V${index}`, value: "1" })) }).success, false, "at most 30 values");
  assert.deepEqual(placeObjectOf({ operatingState: "Z", attributes: "nonsense" }), placeObjectOf({}), "unexpected stored values read as empty");
});

const places = [
  { id: "f1", customerId: "c1", parentId: null, kind: "FACILITY", name: "Verket", isActive: true },
  { id: "b1", customerId: "c1", parentId: "f1", kind: "BUILDING", name: "Hall 1", isActive: true },
  { id: "o1", customerId: "c1", parentId: "b1", kind: "OBJECT", name: "Pump P1", objectType: "Pump", operatingState: "IN_SERVICE" as const, manufacturer: "Tillverkare", serialNumber: "SN-9", isActive: true },
  { id: "o2", customerId: "c1", parentId: "b1", kind: "OBJECT", name: "Elcentral", objectType: "elcentral", operatingState: "OUT_OF_SERVICE" as const, isActive: true },
  { id: "o3", customerId: "c1", parentId: "b1", kind: "OBJECT", name: "Gammal pump", objectType: "Pump", isActive: false },
  { id: "f2", customerId: "c1", parentId: null, kind: "FACILITY", name: "Annexet", isActive: true },
];

test("the register: levels, filters, search, order and paging", () => {
  const top = listPlaceRegister(places, emptyPlaceRegisterFilter());
  assert.deepEqual(top.items.map((item) => item.place.id), ["f2", "f1"], "top level by name");
  assert.equal(top.items.find((item) => item.place.id === "f1")?.children, 1);
  const objects = listPlaceRegister(places, { ...emptyPlaceRegisterFilter(), level: "objects" });
  assert.deepEqual(objects.items.map((item) => item.place.id), ["o2", "o1", "o3"], "active first, paused last");
  assert.equal(objects.items[1].path, "Verket › Hall 1 › Pump P1");
  const pumps = listPlaceRegister(places, { ...emptyPlaceRegisterFilter(), level: "all", objectType: "pump" });
  assert.deepEqual(pumps.items.map((item) => item.place.id), ["o1", "o3"], "object type ignores case");
  assert.deepEqual(listPlaceRegister(places, { ...emptyPlaceRegisterFilter(), level: "all", state: "OUT_OF_SERVICE" }).items.map((item) => item.place.id), ["o2"]);
  assert.deepEqual(listPlaceRegister(places, { ...emptyPlaceRegisterFilter(), level: "all", q: "sn-9" }).items.map((item) => item.place.id), ["o1"], "search reaches the nameplate");
  assert.equal(placeRegisterMatches(places[2], { ...emptyPlaceRegisterFilter(), level: "top" }), false);
  const many = Array.from({ length: 30 }, (_, index) => ({ id: `p${index}`, customerId: "c1", parentId: null, name: `Plats ${String(index).padStart(2, "0")}`, isActive: true }));
  const first = listPlaceRegister(many, emptyPlaceRegisterFilter());
  assert.deepEqual([first.items.length, first.total, first.pages], [12, 30, 3], "a bounded first page");
  assert.equal(listPlaceRegister(many, emptyPlaceRegisterFilter(), 2).items.length, 24, "Visa fler adds the next page");
  assert.deepEqual(objectTypeOptions(places), ["elcentral", "Pump"]);
  assert.deepEqual(placeRegisterFilterSchema.parse({}), emptyPlaceRegisterFilter());
  assert.equal(placeRegisterFilterSchema.safeParse({ state: "Q" }).success, false);
});

test("Local: object data is saved in the file, and an older file without it opens", () => {
  const empty = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const { workspace: withCustomer, customer } = saveLocalCustomerRecord(empty, { name: "Kund", company: "Kund AB" });
  const saved = saveLocalCustomerFacility(withCustomer, customer.id, { facility: { name: "Pump", operatingState: "IN_SERVICE", objectType: "Pump", attributes: [{ label: "Flöde", value: "12 l/s" }] } });
  const place = saved.customerFacilities[0];
  assert.deepEqual([place.operatingState, place.objectType, place.attributes], ["IN_SERVICE", "Pump", [{ label: "Flöde", value: "12 l/s" }]]);
  const reopened = parseLocalWorkspace(JSON.parse(JSON.stringify(saved)), "org-local");
  assert.equal(reopened.customerFacilities[0].operatingState, "IN_SERVICE");
  // A file written before 2026-10-06 has no object fields on its places.
  const older = JSON.parse(JSON.stringify(saved));
  for (const key of ["objectType", "operatingState", "manufacturer", "model", "serialNumber", "installedOn", "attributes"]) delete older.customerFacilities[0][key];
  const opened = parseLocalWorkspace(older, "org-local");
  assert.deepEqual([opened.customerFacilities[0].operatingState, opened.customerFacilities[0].attributes], ["", []]);
});

test("tools: no maintenance facts on work orders (they are items since 2026-10-30); update_place with the customers scope", () => {
  assert.equal(TOOL_CATALOG.update_place.effect, "update");
  assert.equal(TOOL_CATALOG.update_place.apiScope, "customers:write");
  assert.equal(TOOL_CATALOG.update_place.input.safeParse({ placeId: "p1", operatingState: "IN_SERVICE", attributes: [{ label: "Märkström", value: "63 A" }] }).success, true);
  assert.equal(TOOL_CATALOG.update_place.input.safeParse({ placeId: "p1", operatingState: "X" }).success, false);
  // The maintenance facts are not part of the work order tools any more: a sent `maintenance` is not read.
  const parsed = TOOL_CATALOG.update_task.input.parse({ taskId: "t1", maintenance: { priority: "URGENT" } }) as Record<string, unknown>;
  assert.equal(parsed.maintenance, undefined);
  assert.equal("maintenance" in TOOL_CATALOG.create_work_order.input.shape, false);
  assert.equal(TOOL_CATALOG.create_place.input.safeParse({ customerId: "c1", name: "Pump", objectType: "Pump" }).success, true);
});
