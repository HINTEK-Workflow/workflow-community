import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  attributeWorkOrders, canEditItem, canReadItem, canWithdraw, costTotals, countChange, downtimeSummary, hoursOf, isLow, itemFieldsSchema, itemInputSchema, itemTimeProblem, itemTotal,
  maintenanceAccess, moveProblem, parseQuantity, partInputSchema, partPath, PART_MAX_DEPTH, pickLocation, quantityText, rootOf, subtreeIds, suggestedOrderQuantity, withdrawal,
} from "../lib/maintenance/model";
import { partOptions } from "../features/maintenance/part-picker";
import { filterPartTree } from "../lib/maintenance/tree-filter";
import { menuItemAllowed, menuKeyOfView, resolveMenu } from "../lib/workflow/menu-items";
import { breadcrumbTrail } from "../lib/workflow/navigation";
import { defaultWorkflowPermissionProfile, noWorkflowPermissionProfile, workflowPermissionMatrix, type WorkflowPermissionProfile } from "../lib/workflow/permissions";

// Underhåll (2026-10-30): the module's rules without a database – who may, the machine tree, the store's balances and
// withdrawals, and the cost and downtime per machine. The server (lib/maintenance/*-server.ts) uses the same functions.

const grants = (...list: string[]): WorkflowPermissionProfile => ({ version: 1, grants: list as WorkflowPermissionProfile["grants"] });
const caller = (permissions: WorkflowPermissionProfile, extra: { admin?: boolean; storageMode?: string } = {}) => ({ admin: false, storageMode: "HINTEK_CLOUD", permissions, ...extra });

test("the right Underhåll: read and edit, Cloud only, opt-in", () => {
  assert.deepEqual(workflowPermissionMatrix.maintenance, ["read", "edit"]);
  const none = maintenanceAccess(caller(noWorkflowPermissionProfile()));
  assert.equal(none.read, false);
  assert.equal(none.edit, false);
  const reader = maintenanceAccess(caller(grants("maintenance:read")));
  assert.equal(reader.read, true);
  assert.equal(reader.edit, false);
  assert.equal(maintenanceAccess(caller(grants("maintenance:read", "maintenance:edit"))).edit, true);
  assert.equal(maintenanceAccess(caller(noWorkflowPermissionProfile(), { admin: true })).edit, true, "an admin always");
  // Local and the demo never: the module is a Cloud feature, like the machine connection.
  const local = maintenanceAccess(caller(defaultWorkflowPermissionProfile(), { admin: true, storageMode: "LOCAL" }));
  assert.equal(local.read || local.edit || local.workOrderEdit, false);
});

test("an item held by a work order is read and changed with the work order's rights too; a draft needs the module's", () => {
  const technician = maintenanceAccess(caller(grants("work-order:read", "work-order:edit")));
  assert.equal(canReadItem(technician, { workOrderId: "wo1" }), true);
  assert.equal(canEditItem(technician, { workOrderId: "wo1" }), true);
  assert.equal(canReadItem(technician, { workOrderId: null }), false, "a draft is the module's");
  assert.equal(canEditItem(technician, { workOrderId: null }), false);
  const reader = maintenanceAccess(caller(grants("work-order:read")));
  assert.equal(canEditItem(reader, { workOrderId: "wo1" }), false, "reading the order is not changing it");
  const planner = maintenanceAccess(caller(grants("maintenance:read", "maintenance:edit")));
  assert.equal(canEditItem(planner, { workOrderId: null }), true);
  // A spare part onto a work order: change the order and see the store.
  assert.equal(canWithdraw(technician), false, "the store is the module's");
  assert.equal(canWithdraw(maintenanceAccess(caller(grants("work-order:read", "work-order:edit", "maintenance:read")))), true);
  assert.equal(canWithdraw(planner), false, "the module alone does not change work orders");
  // Prices follow the price right.
  assert.equal(planner.prices, false);
  assert.equal(maintenanceAccess(caller(grants("maintenance:read", "catalogue:read"))).prices, true);
});

test("the menu: Underhåll in the work group after Avvikelser, Cloud and the right only", () => {
  const access = (permissions: WorkflowPermissionProfile, extra: { localStorageMode?: boolean; demo?: boolean } = {}) => ({ memberRole: "MEMBER" as const, workflowPermissions: permissions, ...extra });
  assert.equal(menuItemAllowed("maintenance", access(grants("maintenance:read"))), true);
  assert.equal(menuItemAllowed("maintenance", access(grants("work-order:read"))), false);
  assert.equal(menuItemAllowed("maintenance", access(grants("maintenance:read"), { localStorageMode: true })), false, "hidden in Local");
  assert.equal(menuItemAllowed("maintenance", access(grants("maintenance:read"), { demo: true })), true, "shown in the demo (2026-11-13: every button there is)");
  const groups = resolveMenu({ memberRole: "OWNER", workflowPermissions: defaultWorkflowPermissionProfile() }, { hidden: [], shortcuts: [] });
  const work = groups.find((group) => group.some((entry) => entry.key === "rounds"))!.map((entry) => entry.key);
  assert.deepEqual(work.slice(work.indexOf("rounds"), work.indexOf("rounds") + 3), ["rounds", "deviations", "maintenance"]);
  assert.equal(menuKeyOfView("maintenance"), "maintenance");
  assert.deepEqual(breadcrumbTrail({ view: "maintenance" }).map((crumb) => crumb.label), ["Översikt", "Underhåll"]);
  assert.deepEqual(breadcrumbTrail({ view: "maintenance", params: { item: "i1" } }).map((crumb) => crumb.label), ["Översikt", "Underhåll", "Underhållspost"]);
});

const tree = [
  { id: "f", parentId: null, name: "Fabriken" },
  { id: "l2", parentId: "f", name: "Linje 2" },
  { id: "p4", parentId: "l2", name: "Press 4" },
  { id: "hp", parentId: "p4", name: "Hydraulpump" },
  { id: "m", parentId: "p4", name: "Huvudmotor" },
  { id: "s", parentId: null, name: "Pumpstation 2" },
];

test("the machine tree: the way down, everything under a part, the root, no cycles and a fixed depth", () => {
  assert.deepEqual(partPath(tree, "hp"), ["Fabriken", "Linje 2", "Press 4"]);
  assert.deepEqual(partPath(tree, "f"), []);
  assert.deepEqual(subtreeIds(tree, "l2").sort(), ["hp", "l2", "m", "p4"]);
  assert.deepEqual(subtreeIds(tree, "s"), ["s"]);
  assert.equal(rootOf(tree, "hp"), "f");
  assert.equal(moveProblem(tree, "l2", "hp"), "En del kan inte ligga under sig själv.");
  assert.equal(moveProblem(tree, "l2", "l2"), "En del kan inte ligga under sig själv.");
  assert.equal(moveProblem(tree, "m", "s"), "", "a part may move to another tree");
  assert.equal(moveProblem(tree, null, "nowhere"), "Den överordnade delen hittades inte.");
  // A looping tree (never in the database: a trigger refuses it) ends the walk instead of hanging.
  const loop = [{ id: "a", parentId: "b", name: "A" }, { id: "b", parentId: "a", name: "B" }];
  assert.ok(partPath(loop, "a").length <= PART_MAX_DEPTH);
  const deep = Array.from({ length: PART_MAX_DEPTH }, (_, index) => ({ id: `d${index}`, parentId: index ? `d${index - 1}` : null, name: `D${index}` }));
  assert.match(moveProblem(deep, null, `d${PART_MAX_DEPTH - 1}`), /högst 12 nivåer/);
  // The part picker lists the tree in reading order with the way down; paused parts only when chosen.
  const listed = partOptions(tree.map((part) => ({ ...part, placeId: null, customerId: null, ownerName: "", partType: "", marking: "", status: "IN_SERVICE" as const, isActive: part.id !== "m", mainImageId: null, openItems: 0, reported: 0, latitude: null, longitude: null })));
  assert.deepEqual(listed.map((option) => option.label), ["Fabriken", "Fabriken › Linje 2", "Fabriken › Linje 2 › Press 4", "Fabriken › Linje 2 › Press 4 › Hydraulpump", "Pumpstation 2"]);
});

test("a part's input: a name, a root's customer, the status list and run hours", () => {
  assert.equal(partInputSchema.safeParse({ name: " " }).success, false);
  const part = partInputSchema.parse({ name: " Hydraulpump ", partType: "Pump" });
  assert.deepEqual([part.name, part.status, part.parentId, part.customerId, part.runHours], ["Hydraulpump", "IN_SERVICE", null, null, undefined], "hours left out: unchanged on a save");
  assert.equal(partInputSchema.safeParse({ name: "X", status: "BROKEN" }).success, false);
  assert.equal(partInputSchema.safeParse({ name: "X", runHours: -1 }).success, false);
  assert.equal(partInputSchema.safeParse({ name: "X", marking: "x".repeat(41) }).success, false);
});

test("quantities: Swedish decimals, above zero, four decimals", () => {
  assert.equal(parseQuantity("1,5"), 1.5);
  assert.equal(parseQuantity("0"), null);
  assert.equal(parseQuantity("0", { allowZero: true }), 0);
  assert.equal(parseQuantity("-2"), null);
  assert.equal(parseQuantity("två"), null);
  assert.equal(parseQuantity(String(2_000_000)), null);
  assert.equal(parseQuantity("0,12345"), 0.1235);
  assert.equal(quantityText(0.1 + 0.2), "0,3");
});

test("withdrawals: never below zero, the balance after, and where from", () => {
  assert.deepEqual(withdrawal(5, 2), { ok: true, after: 3 });
  assert.deepEqual(withdrawal(2, 2), { ok: true, after: 0 });
  assert.deepEqual(withdrawal(0.3, 0.1 + 0.2), { ok: true, after: 0 }, "no float dust");
  assert.equal(withdrawal(1, 2).ok, false);
  assert.match((withdrawal(1, 2) as { problem: string }).problem, /bara 1 på platsen/);
  assert.match((withdrawal(0, 1) as { problem: string }).problem, /Beställ först/);
  assert.equal(withdrawal(5, 0).ok, false);
  const balances = [{ locationId: "a", quantity: 1 }, { locationId: "van", quantity: 4 }];
  assert.equal(pickLocation(balances, 1), "a", "the first with enough");
  assert.equal(pickLocation(balances, 3), "van");
  assert.equal(pickLocation(balances, 9), "van", "none has enough: the one with most (the withdrawal then says how many there are)");
  assert.equal(pickLocation([{ locationId: "a", quantity: 0 }], 1), null);
});

test("inventory count, totals, Lågt and Beställ", () => {
  assert.equal(countChange(5, 3), -2);
  assert.equal(countChange(0, 4), 4);
  assert.equal(itemTotal([{ quantity: 2 }, { quantity: 1 }]), 3);
  assert.equal(isLow(3, 4), true);
  assert.equal(isLow(4, 4), false, "at the minimum is not low");
  assert.equal(isLow(0, null), false, "no minimum, never low");
  assert.equal(isLow(0, 0), false);
  assert.equal(suggestedOrderQuantity(3, 4), 5, "up to twice the minimum");
  assert.equal(suggestedOrderQuantity(0, null), 2);
  assert.equal(suggestedOrderQuantity(10, 2), 1, "at least one");
});

test("an item: the maintenance fields, the part and the order, and times in order", () => {
  const item = itemInputSchema.parse({ partId: "hp", type: "CORRECTIVE", priority: "URGENT", fault: " Läcker " });
  assert.deepEqual([item.partId, item.workOrderId, item.status, item.fault], ["hp", null, "OPEN", "Läcker"]);
  assert.equal(itemInputSchema.safeParse({ partId: "" }).success, false, "one machine part");
  assert.equal(itemFieldsSchema.safeParse({ priority: "VERY" }).success, false);
  assert.equal(itemTimeProblem({ stoppedAt: null, restoredAt: "2026-10-30T10:00:00.000Z" }), "Fyll i Ur drift före Åter i drift.");
  assert.equal(itemTimeProblem({ stoppedAt: "2026-10-30T10:00:00.000Z", restoredAt: "2026-10-30T09:00:00.000Z" }), "Åter i drift ligger före stoppet.");
  assert.equal(itemTimeProblem({ stoppedAt: "2026-10-30T09:00:00.000Z", restoredAt: "2026-10-30T10:00:00.000Z" }), "");
});

test("downtime per machine: finished stops, a stop going on, and the year's cut", () => {
  const now = new Date("2026-10-30T12:00:00.000Z");
  const items = [
    { stoppedAt: "2026-10-01T08:00:00.000Z", restoredAt: "2026-10-01T10:00:00.000Z" },
    { stoppedAt: "2025-12-31T23:00:00.000Z", restoredAt: "2026-01-01T01:00:00.000Z" },
    { stoppedAt: "2026-10-30T09:00:00.000Z", restoredAt: null },
    { stoppedAt: null, restoredAt: null },
    { stoppedAt: "2026-10-02T10:00:00.000Z", restoredAt: "2026-10-02T09:00:00.000Z" },
  ];
  assert.deepEqual(downtimeSummary(items, now), { minutes: 240, stops: 2, ongoingMinutes: 180, ongoingStops: 1 });
  assert.deepEqual(downtimeSummary(items, now, new Date("2026-01-01T00:00:00.000Z")), { minutes: 180, stops: 2, ongoingMinutes: 180, ongoingStops: 1 }, "a stop over the new year counts from the year's start");
  assert.deepEqual(downtimeSummary([], now), { minutes: 0, stops: 0, ongoingMinutes: 0, ongoingStops: 0 });
});

test("cost per machine: each work order once, time at the hourly rate, material, withdrawals and purchases", () => {
  const owner = attributeWorkOrders([
    { id: "wo1", machinePartId: "hp", itemParts: ["m"] },
    { id: "wo2", machinePartId: null, itemParts: ["m", "hp"] },
    { id: "wo3", machinePartId: null, itemParts: [] },
  ]);
  assert.deepEqual([...owner], [["wo1", "hp"], ["wo2", "m"]], "the order's own part first, else its oldest item's; none without either");
  assert.equal(hoursOf(5400), 1.5);
  const orders = [{ hours: 6, material: 780, purchases: 3900 }, { hours: 1.5, material: 0, purchases: 0 }];
  const withdrawals = [{ quantity: 2, unitPrice: 390 }, { quantity: -1, unitPrice: 390 }, { quantity: 1, unitPrice: null }];
  assert.deepEqual(costTotals({ orders, withdrawals, hourlyRate: 700 }), { hours: 7.5, time: 5250, material: 780, withdrawals: 390, purchases: 3900, total: 10320, orders: 2 });
  assert.deepEqual(costTotals({ orders, withdrawals, hourlyRate: null }).time, null, "no hourly rate: the hours alone");
  assert.equal(costTotals({ orders, withdrawals, hourlyRate: null }).total, 5070, "and the total without time");
  assert.deepEqual(costTotals({ orders: [], withdrawals: [], hourlyRate: 700 }), { hours: 0, time: 0, material: 0, withdrawals: 0, purchases: 0, total: 0, orders: 0 });
});

test("the server checks: company-bound queries, Origin and Cloud write access on changes, audited changes", () => {
  const route = readFileSync("app/api/maintenance/route.ts", "utf8");
  const post = route.slice(route.indexOf("export async function POST"));
  assert.ok(post.indexOf("checkOrigin(request)") < post.indexOf("await context()") && post.indexOf("requireCloudWriteAccess(ctx)") < post.indexOf("requestSchema.parse"));
  const images = readFileSync("app/api/maintenance/images/route.ts", "utf8");
  assert.ok(images.indexOf("checkOrigin(request)") < images.lastIndexOf("requireImageUpload("));
  for (const path of ["lib/maintenance/server.ts", "lib/maintenance/store-server.ts", "lib/maintenance/cost-server.ts", "lib/maintenance/machine-server.ts", "lib/maintenance/place-server.ts"]) {
    const source = readFileSync(path, "utf8");
    // Every Prisma read or write of a maintenance table names the caller's company (or goes through a row that did).
    for (const match of source.matchAll(/\.(machinePart|machinePartImage|machinePartArticle|maintenancePlace|storeLocation|storeItem|storeTransaction|maintenanceItem)\.(findFirst|findMany|count|updateMany|deleteMany)\(\{ where: \{([^}]*)/g))
      assert.match(match[3], /organizationId/, `${path}: ${match[0].slice(0, 80)}`);
  }
  const store = readFileSync("lib/maintenance/store-server.ts", "utf8");
  assert.match(store, /quantity: \{ gte: quantity \} \}, data: \{ quantity: \{ decrement: quantity \} \}/, "a withdrawal is a conditional update: never below zero, also at the same moment");
  assert.match(store, /maintenance_store_count/, "an inventory count is audited");
  const sql = readFileSync("prisma/migrations/20261031090000_maintenance_module/migration.sql", "utf8");
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^COMMIT;\s*$/m);
  assert.match(sql, /CHECK \("quantity" >= 0\)/);
  assert.match(sql, /"MachinePart_customer_root_check" CHECK \("parentId" IS NULL OR "customerId" IS NULL\)/);
  assert.match(sql, /CREATE TRIGGER "MachinePart_tree"/);
  assert.doesNotMatch(sql, /^\s*(DELETE|TRUNCATE|DROP TABLE)\b|DROP COLUMN/im, "the module's migration removes nothing");
  const removal = readFileSync("prisma/migrations/20261031090100_machine_objects_removed/migration.sql", "utf8");
  assert.match(removal, /NOT EXISTS \(SELECT 1 FROM "WorkflowTask" t WHERE t\."facilityId" = f\."id"\)/, "a place something else hangs on stays");
  assert.match(removal, /NOT EXISTS \(SELECT 1 FROM "CustomerFacility" c WHERE c\."parentId" = f\."id"\)/);
});

test("the machine tree's search and Driftstatus: a match keeps the parts above it, the chips count only matches", () => {
  const part = (id: string, parentId: string | null, name: string, status: "IN_SERVICE" | "SERVICE_SOON" | "OUT_OF_SERVICE" | "DECOMMISSIONED" = "IN_SERVICE", marking = "") => ({ id, parentId, name, partType: "", marking, status });
  const parts = [part("root", null, "Fabriken"), part("line", "root", "Linje 2"), part("press", "line", "Press 4", "OUT_OF_SERVICE", "P4"), part("pump", "press", "Hydraulpump", "SERVICE_SOON", "P4-HP1"), part("band", "line", "Transportband"), part("other", null, "Lagret", "DECOMMISSIONED")];
  const ids = (result: { shown: readonly { id: string }[] }) => result.shown.map((row) => row.id);

  const all = filterPartTree(parts, { filter: "all", q: "" });
  assert.equal(all.filtering, false);
  assert.equal(all.shown, parts, "nothing chosen: the tree as it is");
  assert.deepEqual(all.counts, { all: 6, REPORTED: 0, IN_SERVICE: 3, SERVICE_SOON: 1, OUT_OF_SERVICE: 1, DECOMMISSIONED: 1 });

  const soon = filterPartTree(parts, { filter: "SERVICE_SOON", q: "" });
  assert.equal(soon.filtering, true);
  assert.deepEqual(ids(soon), ["root", "line", "press", "pump"], "the way down to the match stays; its siblings do not");

  const searched = filterPartTree(parts, { filter: "all", q: "p4-hp" });
  assert.deepEqual(ids(searched), ["root", "line", "press", "pump"], "the marking is searched, any case");
  assert.deepEqual(searched.counts, { all: 1, REPORTED: 0, IN_SERVICE: 0, SERVICE_SOON: 1, OUT_OF_SERVICE: 0, DECOMMISSIONED: 0 }, "the chips count the matches, not the parts above them");

  assert.deepEqual(ids(filterPartTree(parts, { filter: "IN_SERVICE", q: "hydraul" })), [], "both must hold");
  const looping = [part("a", "b", "Aa"), part("b", "a", "Bb")];
  assert.deepEqual(ids(filterPartTree(looping, { filter: "all", q: "aa" })), ["a", "b"], "a looping parent ends the walk");
});

test("Underhåll and Förråd have Projekt's head: no pills of their own, the shared filter row, the title once on a phone", () => {
  const page = readFileSync("features/maintenance/maintenance-page.tsx", "utf8");
  const store = readFileSync("features/maintenance/maintenance-store.tsx", "utf8");
  const header = readFileSync("features/maintenance/maintenance-header.tsx", "utf8");
  assert.doesNotMatch(page, /role="tablist"/);
  assert.match(page, /<ListFilterBar testId="maintenance-tree-filter"/);
  assert.match(store, /<ListFilterBar testId="store"/);
  assert.doesNotMatch(store, /Bara lågt saldo/);
  assert.match(header, /<PageHeader title=/);
  assert.match(header, /<NativeLargeTitle inBar>/, "level 1: the top bar has the title");
  assert.doesNotMatch(page, /<PageHeader title="Underhåll"/);
});

test("no manufacturer text in the module (the caution principle)", () => {
  for (const path of ["lib/maintenance/model.ts", "lib/maintenance/server.ts", "lib/maintenance/store-server.ts", "features/maintenance/maintenance-page.tsx", "features/maintenance/maintenance-store.tsx", "features/maintenance/maintenance-header.tsx", "lib/maintenance/tree-filter.ts", "features/maintenance/maintenance-item-editor.tsx", ...(existsSync("scripts/qa/seed-maintenance-demo.ts") ? ["scripts/qa/seed-maintenance-demo.ts"] : [])])
    assert.doesNotMatch(readFileSync(path, "utf8"), /teltonika|siemens|schneider|abb\b|skf\b|parker|bosch rexroth/i, path);
});
