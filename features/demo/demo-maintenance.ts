import { addSwedishDays, swedishDayKey } from "@/lib/swedish-time";
import { maintenanceDowntimeMinutes, type MaintenanceType } from "@/lib/workflow/maintenance";
import { roundOre, workOrderTotals } from "@/lib/workflow/material-prices";
import { withoutStoreRows } from "@/lib/workflow/store-rows";
import type { MaterialRow } from "@/lib/workflow/expenses";
import { DEFAULT_KEY_FIGURE_PERIOD, keyFigureRows, type KeyFigures } from "@/lib/machine/key-figures";
import { MACHINE_EVENTS_PAGE, machineStatus } from "@/lib/machine/place-status";
import {
  attributeWorkOrders, costTotals, countChange, downtimeSummary, hoursOf, isLow, itemTotal, itemTimeProblem, nextFreeNumber, parseQuantity, partDepth, partPath, partStatusOf, pickLocation, rootOf,
  roundQuantity, storeFigures, storeLocationNames, subtreeIds, withdrawal, PART_STATUSES, ITEM_STATUSES, type ItemStatus, type PartListItem, type PartStatus,
} from "@/lib/maintenance/model";
import { PLACE_ALL, PLACE_NONE, placeLevelOf, placePath, placeSubtree, type PlaceLevel, type PlaceListItem } from "@/lib/maintenance/place-model";
import { addInterval, intervalText, occurrenceState, PLAN_UNITS, planOrderTitle, type PlanUnit, type PlanningMaintenance } from "@/lib/maintenance/plan-model";
import type { DemoDatabase, DemoMaintenanceItem, DemoTask, DemoUser } from "./demo-data";

/**
 * Underhåll in the public demo (2026-11-04): the machine tree, maintenance plans, the store and the cost figures, invented and
 * kept in this browser's memory like the rest of the demo. Answers the same shapes as /api/maintenance (app/api/maintenance/route.ts)
 * so the real pages run unchanged. Dates are offsets from today, so the data holds on every weekday. Nothing here is sent anywhere.
 */
export class DemoMaintenanceError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const fail = (status: number, message: string): never => { throw new DemoMaintenanceError(status, message); };

export type MaintenanceContext = { db: DemoDatabase; user: DemoUser; admin: boolean; can: (subject: "maintenance" | "catalogue" | "quotes" | "work-order", action: "read" | "edit") => boolean; now: Date };
type Request = { method: string; url: URL; body: unknown };

type Part = { id: string; parentId: string | null; placeId: string | null; customerId: string | null; name: string; partType: string; marking: string; status: PartStatus; notes: string; runHours: number | null; runHoursAt: string | null; isActive: boolean; version: number };
type Place = { id: string; parentId: string | null; name: string; level: PlaceLevel; notes: string; version: number };
type Extras = { criticality: string; marking: string; cause: string; causeNote: string; version: number };
type OwnItem = { id: string; partId: string; workOrderId: string | null; status: ItemStatus; type: string; priority: string; fault: string; reportedAt: string | null; stoppedAt: string | null; restoredAt: string | null; createdAt: string };
type Plan = { id: string; partId: string; name: string; description: string; unit: PlanUnit; every: number; startDate: string; nextRunHours: number | null; assignedToUserId: string | null; estimatedMinutes: number | null; isActive: boolean; version: number };
type Occurrence = { taskId: string; planId: string; due: string; activated: boolean; pinned: boolean };
type Loc = { id: string; parentId: string | null; name: string; kind: "STORE" | "VEHICLE"; isActive: boolean; seriesStart: number | null };
type StoreItem = { id: string; name: string; unit: string; ownNumber: number | null; homeStoreId: string | null; shelfText: string; articleNo: string; supplierName: string; unitPrice: number | null; minQuantity: number | null; balances: Record<string, number> };
type Move = { id: string; kind: "WITHDRAWAL" | "RETURN" | "RECEIPT" | "COUNT"; itemId: string; locationId: string; change: number; balanceAfter: number; note: string; workOrderId: string | null; partId: string | null; byName: string; at: string; unitPrice: number | null };
type Link = { id: string; partId: string; itemId: string; quantity: number };
type MachineEvent = { id: string; partId: string; occurredAt: string; type: string; code: string; severity: string; state: string | null; text: string; sourceName: string };
type State = { parts: Part[]; places: Place[]; items: OwnItem[]; extras: Map<string, Extras>; plans: Plan[]; occurrences: Occurrence[]; locations: Loc[]; storeItems: StoreItem[]; moves: Move[]; links: Link[]; events: MachineEvent[]; sequence: number };

const states = new WeakMap<DemoDatabase, State>();
const HOURLY_RATE = 795;

const iso = (value: Date) => value.toISOString();
const dayOf = (now: Date, offset: number) => swedishDayKey(addSwedishDays(now, offset));
const atDay = (now: Date, offset: number, hour: number, minute = 0) => {
  const base = addSwedishDays(now, offset);
  const date = new Date(base);
  const [year, month, day] = swedishDayKey(base).split("-").map(Number) as [number, number, number];
  date.setTime(Date.UTC(year, month - 1, day, hour - 1, minute));
  return iso(date);
};

function create(db: DemoDatabase, now: Date): State {
  const [kopparlunden, stromkraft, voltberg] = db.customers;
  const part = (id: string, parentId: string | null, name: string, values: Partial<Part> = {}): Part => ({
    id, parentId, placeId: null, customerId: null, name, partType: "", marking: "", status: "IN_SERVICE", notes: "", runHours: null, runHoursAt: null, isActive: true, version: 1, ...values,
  });
  const places: Place[] = [
    { id: "demo-place-elstad", parentId: null, name: "Elstad", level: "CITY", notes: "", version: 1 },
    { id: "demo-place-garage", parentId: "demo-place-elstad", name: "Garage Elvägen 4", level: "SITE", notes: "Garage i två plan med 24 platser.", version: 1 },
    { id: "demo-place-undercentral", parentId: "demo-place-elstad", name: "Undercentral hus B", level: "SITE", notes: "", version: 1 },
    { id: "demo-place-kontor", parentId: "demo-place-elstad", name: "Kontorshuset Strömgatan 18", level: "SITE", notes: "Kontor plan 1–4.", version: 1 },
    { id: "demo-place-kallare", parentId: "demo-place-kontor", name: "Källare", level: "AREA", notes: "Teknikutrymmen.", version: 1 },
    { id: "demo-place-villan", parentId: "demo-place-elstad", name: "Villan Spänningsvägen 7", level: "SITE", notes: "", version: 1 },
  ];
  const parts: Part[] = [
    part("demo-part-ao-laddcentral", null, "Laddcentral LC1", { placeId: "demo-place-garage", customerId: kopparlunden?.id ?? null, partType: "Laddcentral", marking: "LC1", status: "OUT_OF_SERVICE", notes: "Matar tolv laddplatser i garaget." }),
    part("demo-part-lc1-huvudbrytare", "demo-part-ao-laddcentral", "Huvudbrytare", { partType: "Lastbrytare", marking: "Q1" }),
    part("demo-part-lc1-balanserare", "demo-part-ao-laddcentral", "Lastbalanserare", { partType: "Styrenhet", marking: "LB1" }),
    part("demo-part-lc1-matare", "demo-part-lc1-balanserare", "Strömmätare", { partType: "Mätare", marking: "ML1" }),
    part("demo-part-ao-undercentral", null, "Cirkulationspump P2", { placeId: "demo-place-undercentral", customerId: kopparlunden?.id ?? null, partType: "Pump", marking: "P2", status: "OUT_OF_SERVICE", runHours: 8420, runHoursAt: atDay(now, -3, 8), notes: "Cirkulation värmesystem hus B." }),
    part("demo-part-p2-motor", "demo-part-ao-undercentral", "Motor 0,75 kW", { partType: "Elmotor", marking: "M2", runHours: 8420, runHoursAt: atDay(now, -3, 8) }),
    part("demo-part-p2-lager", "demo-part-p2-motor", "Lager drivsida", { partType: "Kullager", marking: "6204" }),
    part("demo-part-p2-kontaktor", "demo-part-ao-undercentral", "Kontaktor K2", { partType: "Kontaktor", marking: "K2" }),
    part("demo-part-ao-lucka-e12", null, "Elcentral E12", { placeId: "demo-place-kontor", customerId: stromkraft?.id ?? null, partType: "Elcentral", marking: "E12", notes: "Gruppcentral för belysning plan 2." }),
    part("demo-part-e12-lucka", "demo-part-ao-lucka-e12", "Frontlucka", { partType: "Täckplåt" }),
    part("demo-part-ftx1", null, "Ventilationsaggregat FTX1", { placeId: "demo-place-kallare", customerId: stromkraft?.id ?? null, partType: "Ventilationsaggregat", marking: "FTX1", status: "SERVICE_SOON", runHours: 21350, runHoursAt: atDay(now, -1, 7), notes: "Från- och tilluft för kontoret, värmeåtervinning." }),
    part("demo-part-ftx1-tillufts", "demo-part-ftx1", "Tilluftsfläkt", { partType: "Fläkt", marking: "TF1" }),
    part("demo-part-ftx1-franlufts", "demo-part-ftx1", "Frånluftsfläkt", { partType: "Fläkt", marking: "FF1" }),
    part("demo-part-ftx1-filter", "demo-part-ftx1", "Filter", { partType: "Filter", marking: "G4/F7" }),
    part("demo-part-ftx1-batteri", "demo-part-ftx1", "Värmebatteri", { partType: "Batteri", marking: "VB1" }),
    part("demo-part-ups1", null, "Reservkraft UPS1", { placeId: "demo-place-kontor", customerId: stromkraft?.id ?? null, partType: "UPS", marking: "UPS1", notes: "Reservkraft för serverrummet." }),
    part("demo-part-ups1-batterier", "demo-part-ups1", "Batteripaket", { partType: "Batteri", marking: "B1" }),
    part("demo-part-villa-pump", null, "Värmepump Villa", { placeId: "demo-place-villan", customerId: voltberg?.id ?? null, partType: "Värmepump", marking: "VP1", runHours: 3120, runHoursAt: atDay(now, -10, 9) }),
  ];

  const locations: Loc[] = [
    { id: "demo-loc-huvud", parentId: null, name: "Huvudförråd", kind: "STORE", isActive: true, seriesStart: 100000 },
    { id: "demo-loc-skap-a", parentId: "demo-loc-huvud", name: "Skåp A", kind: "STORE", isActive: true, seriesStart: null },
    { id: "demo-loc-skap-b", parentId: "demo-loc-huvud", name: "Skåp B", kind: "STORE", isActive: true, seriesStart: null },
    { id: "demo-loc-bil", parentId: null, name: "Servicebil 1", kind: "VEHICLE", isActive: true, seriesStart: 200000 },
  ];
  const sitem = (id: string, ownNumber: number, name: string, balances: Record<string, number>, values: Partial<StoreItem> = {}): StoreItem => ({
    id, ownNumber, name, unit: "st", homeStoreId: "demo-loc-huvud", shelfText: "", articleNo: "", supplierName: "Demogrossisten", unitPrice: null, minQuantity: null, balances, ...values,
  });
  const storeItems: StoreItem[] = [
    sitem("demo-si-kontaktor", 100001, "Kontaktor 3-polig 25 A, 230 V", { "demo-loc-skap-a": 3, "demo-loc-bil": 1 }, { shelfText: "Hylla 2", articleNo: "DK-325", unitPrice: 410, minQuantity: 2 }),
    sitem("demo-si-lager", 100002, "Kullager 6204-2RS", { "demo-loc-skap-a": 4 }, { shelfText: "Hylla 1", articleNo: "KL-6204", unitPrice: 48, minQuantity: 4 }),
    sitem("demo-si-filter-g4", 100003, "Filter G4 592×592", { "demo-loc-skap-b": 2 }, { shelfText: "Golv", articleNo: "FI-G4-592", unitPrice: 135, minQuantity: 4 }),
    sitem("demo-si-filter-f7", 100004, "Filter F7 592×592", { "demo-loc-skap-b": 6 }, { shelfText: "Golv", articleNo: "FI-F7-592", unitPrice: 295, minQuantity: 4 }),
    sitem("demo-si-rem", 100005, "Kilrem SPZ 1000", { "demo-loc-skap-b": 2, "demo-loc-bil": 1 }, { articleNo: "KR-SPZ1000", unitPrice: 89, minQuantity: 2 }),
    sitem("demo-si-jfb", 100006, "Jordfelsbrytare 40 A 30 mA typ A", { "demo-loc-skap-a": 5, "demo-loc-bil": 2 }, { articleNo: "JF-40-30A", unitPrice: 540, minQuantity: 3 }),
    sitem("demo-si-sakring", 100007, "Automatsäkring 16 A C-kurva", { "demo-loc-skap-a": 20, "demo-loc-bil": 6 }, { articleNo: "AS-16C", unitPrice: 62, minQuantity: 10 }),
    sitem("demo-si-ups-batteri", 100008, "UPS-batteri 12 V 9 Ah", { "demo-loc-skap-b": 0 }, { articleNo: "UB-12-9", unitPrice: 360, minQuantity: 2 }),
    sitem("demo-si-fett", 200001, "Smörjfett kullager 400 g", { "demo-loc-bil": 3 }, { homeStoreId: "demo-loc-bil", unitPrice: 98, minQuantity: 1 }),
  ];
  const mv = (id: string, kind: Move["kind"], itemId: string, locationId: string, change: number, after: number, offset: number, values: Partial<Move> = {}): Move => ({
    id, kind, itemId, locationId, change, balanceAfter: after, note: "", workOrderId: null, partId: null, byName: db.users[0]?.name ?? "", at: atDay(now, offset, 10), unitPrice: storeItems.find((item) => item.id === itemId)?.unitPrice ?? null, ...values,
  });
  const moves: Move[] = [
    mv("demo-mv-1", "RECEIPT", "demo-si-lager", "demo-loc-skap-a", 8, 8, -60, { note: "Leverans" }),
    mv("demo-mv-2", "WITHDRAWAL", "demo-si-lager", "demo-loc-skap-a", -2, 6, -35, { workOrderId: "demo-task-ao-undercentral", partId: "demo-part-p2-lager", byName: db.users[1]?.name ?? "" }),
    mv("demo-mv-3", "WITHDRAWAL", "demo-si-lager", "demo-loc-skap-a", -2, 4, -12, { workOrderId: "demo-task-ao-undercentral", partId: "demo-part-p2-lager", byName: db.users[1]?.name ?? "" }),
    mv("demo-mv-4", "WITHDRAWAL", "demo-si-filter-g4", "demo-loc-skap-b", -4, 2, -20, { partId: "demo-part-ftx1-filter", byName: db.users[2]?.name ?? "" }),
    mv("demo-mv-5", "WITHDRAWAL", "demo-si-kontaktor", "demo-loc-skap-a", -1, 3, -4, { workOrderId: "demo-task-ao-undercentral", partId: "demo-part-p2-kontaktor", byName: db.users[1]?.name ?? "" }),
    mv("demo-mv-6", "COUNT", "demo-si-ups-batteri", "demo-loc-skap-b", -2, 0, -9, { note: "Inventering" }),
    mv("demo-mv-7", "RECEIPT", "demo-si-sakring", "demo-loc-skap-a", 20, 20, -30, { note: "Leverans" }),
  ];
  const links: Link[] = [
    { id: "demo-link-1", partId: "demo-part-p2-lager", itemId: "demo-si-lager", quantity: 2 },
    { id: "demo-link-2", partId: "demo-part-p2-kontaktor", itemId: "demo-si-kontaktor", quantity: 1 },
    { id: "demo-link-3", partId: "demo-part-ftx1-filter", itemId: "demo-si-filter-g4", quantity: 4 },
    { id: "demo-link-4", partId: "demo-part-ftx1-filter", itemId: "demo-si-filter-f7", quantity: 4 },
    { id: "demo-link-5", partId: "demo-part-ftx1-tillufts", itemId: "demo-si-rem", quantity: 2 },
    { id: "demo-link-6", partId: "demo-part-ups1-batterier", itemId: "demo-si-ups-batteri", quantity: 4 },
    { id: "demo-link-7", partId: "demo-part-p2-lager", itemId: "demo-si-fett", quantity: 1 },
  ];

  const item = (id: string, partId: string, values: Partial<OwnItem>): OwnItem => ({ id, partId, workOrderId: null, status: "DONE", type: "PREVENTIVE", priority: "NORMAL", fault: "", reportedAt: null, stoppedAt: null, restoredAt: null, createdAt: atDay(now, -30, 9), ...values });
  const items: OwnItem[] = [
    item("demo-mi-filterbyte", "demo-part-ftx1-filter", { fault: "Planerat filterbyte, kvartal 3.", createdAt: atDay(now, -40, 9) }),
    item("demo-mi-fiktfel", "demo-part-ftx1-franlufts", { type: "CORRECTIVE", priority: "HIGH", fault: "Frånluftsfläkten gick tungt och larmade för hög ström.", reportedAt: atDay(now, -18, 8, 30), stoppedAt: atDay(now, -18, 8), restoredAt: atDay(now, -18, 14), createdAt: atDay(now, -18, 8, 30) }),
    item("demo-mi-batteritest", "demo-part-ups1-batterier", { type: "CONDITION", fault: "Årligt batteritest, kapacitet 82 %.", createdAt: atDay(now, -25, 11) }),
    item("demo-mi-villa", "demo-part-villa-pump", { type: "PREVENTIVE", fault: "Service värmepump, byte av filter.", createdAt: atDay(now, -55, 10) }),
  ];

  const events: MachineEvent[] = [
    { id: "demo-ev-1", partId: "demo-part-ao-undercentral", occurredAt: atDay(now, -4, 8, 31), type: "alarm", code: "E21", severity: "fault", state: "raised", text: "Överström motor", sourceName: "Styrenhet P2" },
    { id: "demo-ev-2", partId: "demo-part-ao-undercentral", occurredAt: atDay(now, -4, 8, 30), type: "state", code: "RUN", severity: "info", state: "stopped", text: "Pumpen stoppad", sourceName: "Styrenhet P2" },
    { id: "demo-ev-3", partId: "demo-part-ao-undercentral", occurredAt: atDay(now, -9, 14, 5), type: "alarm", code: "W12", severity: "warning", state: "raised", text: "Hög lagertemperatur", sourceName: "Styrenhet P2" },
    { id: "demo-ev-4", partId: "demo-part-ao-undercentral", occurredAt: atDay(now, -9, 15, 20), type: "alarm", code: "W12", severity: "warning", state: "cleared", text: "Hög lagertemperatur", sourceName: "Styrenhet P2" },
    { id: "demo-ev-5", partId: "demo-part-ao-undercentral", occurredAt: atDay(now, -20, 6, 2), type: "state", code: "RUN", severity: "info", state: "running", text: "Pumpen startad", sourceName: "Styrenhet P2" },
  ];

  return { parts, places, items, extras: new Map(), plans: [], occurrences: [], locations, storeItems, moves, links, events, sequence: 100 };
}

function state(ctx: MaintenanceContext): State {
  let current = states.get(ctx.db);
  if (!current) {
    current = create(ctx.db, ctx.now);
    states.set(ctx.db, current);
    seedPlans(ctx, current);
  }
  return current;
}

// ---------- plans: the occurrences are real work orders of the demo ----------

const nextId = (s: State, prefix: string) => `demo-${prefix}-${++s.sequence}`;
const memberName = (ctx: MaintenanceContext, id: string | null) => ctx.db.users.find((user) => user.id === id)?.name ?? "";

function planTemplate(ctx: MaintenanceContext) {
  return ctx.db.tasks.find((task) => task.kind === "WORK_ORDER" && task.status === "PLANNED") ?? ctx.db.tasks.find((task) => task.kind === "WORK_ORDER") ?? null;
}

/** The coming days of a calendar plan from its start: the first at or after today, then every interval, at most three. */
function comingDays(plan: Plan, today: string) {
  if (plan.unit === "RUN_HOURS") return [];
  const days: string[] = [];
  let day = plan.startDate;
  for (let guard = 0; guard < 400 && days.length < 3; guard += 1) {
    if (day >= today) days.push(day);
    day = addInterval(day, plan.unit, plan.every);
  }
  return days;
}

function dropOccurrences(ctx: MaintenanceContext, s: State, planId: string) {
  const own = s.occurrences.filter((occurrence) => occurrence.planId === planId && !occurrence.pinned);
  const ids = new Set(own.map((occurrence) => occurrence.taskId));
  s.occurrences = s.occurrences.filter((occurrence) => !ids.has(occurrence.taskId));
  ctx.db.tasks = ctx.db.tasks.filter((task) => !ids.has(task.id));
  ctx.db.maintenanceItems = (ctx.db.maintenanceItems ?? []).filter((row) => !ids.has(row.workOrderId));
}

function fillPlan(ctx: MaintenanceContext, s: State, plan: Plan) {
  dropOccurrences(ctx, s, plan.id);
  const template = planTemplate(ctx);
  const part = s.parts.find((row) => row.id === plan.partId);
  if (!template || !part || !plan.isActive) return;
  const today = dayOf(ctx.now, 0);
  const keep = new Set(s.occurrences.filter((occurrence) => occurrence.planId === plan.id).map((occurrence) => occurrence.due));
  for (const due of comingDays(plan, today)) {
    if (keep.has(due)) continue;
    const taskId = nextId(s, "task-plan");
    const stamp = iso(ctx.now);
    const task: DemoTask = {
      ...template, id: taskId, title: planOrderTitle(plan.name, part.name), description: plan.description, status: "PLANNED", projectId: null, customerId: part.customerId, facilityId: null,
      assignedToUserId: plan.assignedToUserId, assignedToName: memberName(ctx, plan.assignedToUserId), dueDate: due, plannedStartDate: due, estimatedMinutes: plan.estimatedMinutes,
      data: { kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" } },
      workOrderId: null, roundScheduleId: null, roundOccurrence: null, cancelledAt: null, cancelledBy: null, cancelReason: "", cancelledFromStatus: null, stage: "", predecessorIds: [],
      version: 1, startedAt: null, completedAt: null, createdBy: ctx.user.id, updatedBy: ctx.user.id, createdAt: stamp, updatedAt: stamp, revisions: [],
    };
    ctx.db.tasks.push(task);
    (ctx.db.maintenanceItems ??= []).push({ id: nextId(s, "maintenance"), partId: part.id, partName: part.name, workOrderId: taskId, status: "OPEN", source: "MANUAL", type: "PREVENTIVE", priority: "NORMAL", fault: "", reportedAt: null, stoppedAt: null, restoredAt: null, createdAt: stamp });
    s.occurrences.push({ taskId, planId: plan.id, due, activated: false, pinned: false });
  }
}

function seedPlans(ctx: MaintenanceContext, s: State) {
  const now = ctx.now;
  const plan = (id: string, partId: string, name: string, unit: PlanUnit, every: number, startOffset: number, values: Partial<Plan> = {}): Plan => ({
    id, partId, name, description: "", unit, every, startDate: dayOf(now, startOffset), nextRunHours: null, assignedToUserId: ctx.db.users[2]?.id ?? null, estimatedMinutes: 60, isActive: true, version: 1, ...values,
  });
  s.plans.push(
    plan("demo-plan-filter", "demo-part-ftx1-filter", "Byt filter", "MONTH", 3, 6, { description: "Byt G4 och F7, kontrollera packningar och torka av huset.", estimatedMinutes: 90 }),
    plan("demo-plan-batteri", "demo-part-ftx1-batteri", "Rengör värmebatteriet", "MONTH", 12, 40, { estimatedMinutes: 120 }),
    plan("demo-plan-lager", "demo-part-p2-lager", "Smörj och kontrollera lager", "RUN_HOURS", 4000, 0, { nextRunHours: 12000, description: "Smörj enligt tillverkarens intervall och lyssna efter ljud." }),
    plan("demo-plan-oversyn", "demo-part-ao-undercentral", "Halvårsöversyn pump och kontaktor", "MONTH", 6, 21, { description: "Kontrollera kontaktorn, motorströmmen och fästen.", estimatedMinutes: 45 }),
    plan("demo-plan-laddtest", "demo-part-ao-laddcentral", "Funktionstest laddplatser", "WEEK", 4, 11, { assignedToUserId: ctx.db.users[1]?.id ?? null, estimatedMinutes: 45 }),
    plan("demo-plan-ups", "demo-part-ups1-batterier", "Batteritest", "MONTH", 12, 150, { estimatedMinutes: 60 }),
  );
  for (const plan of s.plans) fillPlan(ctx, s, plan);
}

// ---------- shared reads ----------

const requireRead = (ctx: MaintenanceContext) => { if (!ctx.can("maintenance", "read")) fail(403, "Du saknar behörighet att se Underhåll."); };
const requireEdit = (ctx: MaintenanceContext) => { if (!ctx.can("maintenance", "edit")) fail(403, "Du saknar behörighet att ändra i Underhåll."); };
const prices = (ctx: MaintenanceContext) => ctx.admin || ctx.can("catalogue", "read") || ctx.can("quotes", "read");

type Row = { id: string; partId: string; partName: string; status: ItemStatus; source: "MANUAL" | "PLAN"; type: string; priority: string; fault: string; reportedAt: string | null; stoppedAt: string | null; restoredAt: string | null; workOrderId: string | null; createdAt: string };

function allItems(ctx: MaintenanceContext, s: State): Row[] {
  const name = (partId: string) => s.parts.find((part) => part.id === partId)?.name ?? "";
  const own = s.items.map((item): Row => ({ ...item, partName: name(item.partId), source: "MANUAL" }));
  const held = (ctx.db.maintenanceItems ?? []).map((item): Row => ({ id: item.id, partId: item.partId, partName: name(item.partId) || item.partName, status: item.status, source: "MANUAL", type: item.type, priority: item.priority, fault: item.fault, reportedAt: item.reportedAt, stoppedAt: item.stoppedAt, restoredAt: item.restoredAt, workOrderId: item.workOrderId, createdAt: item.createdAt }));
  return [...held, ...own];
}
const orderOf = (ctx: MaintenanceContext, id: string | null) => {
  const task = id ? ctx.db.tasks.find((row) => row.id === id) : null;
  return task ? { id: task.id, title: task.title, status: task.status } : null;
};
const itemRow = (ctx: MaintenanceContext, row: Row) => {
  const times = { stoppedAt: row.stoppedAt, restoredAt: row.restoredAt };
  return { id: row.id, partId: row.partId, partName: row.partName, status: row.status, source: row.source, type: row.type, priority: row.priority, fault: row.fault, reportedAt: row.reportedAt, ...times, downtimeMinutes: maintenanceDowntimeMinutes(times), workOrder: orderOf(ctx, row.workOrderId), createdAt: row.createdAt };
};
const openOrders = (ctx: MaintenanceContext, rows: Row[]) => {
  const seen = new Set<string>();
  const out: { id: string; title: string; status: string }[] = [];
  for (const row of rows) {
    const order = orderOf(ctx, row.workOrderId);
    if (order && order.status !== "COMPLETED" && order.status !== "CANCELLED" && !seen.has(order.id)) { seen.add(order.id); out.push(order); }
  }
  return out.slice(0, 20);
};

const storeTotal = (item: StoreItem) => itemTotal(Object.values(item.balances).map((quantity) => ({ quantity })));
const locationNames = (s: State) => storeLocationNames(s.locations.map((row) => ({ id: row.id, parentId: row.parentId, name: row.name })));
const shape = (s: State) => s.parts.map((part) => ({ id: part.id, parentId: part.parentId, name: part.name }));

function spares(s: State, partId: string) {
  const names = locationNames(s);
  return s.links.filter((link) => link.partId === partId).flatMap((link) => {
    const item = s.storeItems.find((row) => row.id === link.itemId);
    if (!item) return [];
    const total = storeTotal(item);
    return [{
      linkId: link.id, itemId: item.id, name: item.name, unit: item.unit, ownNumber: item.ownNumber, articleNo: item.articleNo, supplierName: item.supplierName, quantity: link.quantity, total,
      low: isLow(total, item.minQuantity), minQuantity: item.minQuantity,
      balances: Object.entries(item.balances).map(([locationId, quantity]) => ({ locationId, locationName: names.get(locationId) ?? "", quantity })),
    }];
  });
}

// ---------- reads ----------

function treeAnswer(ctx: MaintenanceContext, s: State) {
  const rows = allItems(ctx, s);
  const customerName = (id: string | null) => { const customer = ctx.db.customers.find((row) => row.id === id); return customer ? customer.company || customer.name : ""; };
  const parts: PartListItem[] = s.parts.map((part) => ({
    id: part.id, parentId: part.parentId, placeId: part.placeId, customerId: part.customerId, ownerName: customerName(part.customerId), name: part.name, partType: part.partType, marking: part.marking,
    status: part.status, isActive: part.isActive, mainImageId: null,
    openItems: rows.filter((row) => row.partId === part.id && row.status === "OPEN").length,
    reported: rows.filter((row) => row.partId === part.id && row.status === "OPEN" && row.type === "CORRECTIVE" && row.reportedAt).length,
  }));
  const places: PlaceListItem[] = s.places.map((place) => ({ ...place, level: placeLevelOf(place.level) }));
  const owners = ctx.can("maintenance", "edit") ? ctx.db.customers.map((customer) => ({ id: customer.id, name: customer.company || customer.name })) : [];
  return { parts, truncated: false, places, owners, canEdit: ctx.can("maintenance", "edit") };
}

function detailAnswer(ctx: MaintenanceContext, s: State, id: string) {
  const part = s.parts.find((row) => row.id === id);
  if (!part) return fail(404, "Delen hittades inte.");
  const all = shape(s);
  const below = subtreeIds(all, id);
  const rows = allItems(ctx, s).filter((row) => below.includes(row.partId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
  const machine = s.parts.find((row) => row.id === rootOf(all, id));
  const customer = ctx.db.customers.find((row) => row.id === part.customerId);
  const pump = below.includes("demo-part-ao-undercentral");
  const edit = ctx.can("maintenance", "edit");
  return {
    part: {
      id: part.id, parentId: part.parentId, placeId: part.placeId, customerId: part.customerId, ownerName: customer ? customer.company || customer.name : "", name: part.name, partType: part.partType, marking: part.marking,
      status: part.status, notes: part.notes, runHours: part.runHours, runHoursAt: part.runHoursAt, runHoursOrigin: "person" as const, runHoursFeed: null, runHoursHeld: null,
      isActive: part.isActive, version: part.version, path: partPath(all, id), depth: partDepth(all, id), placePath: placePath(s.places, machine?.placeId), machinePlaceId: machine?.placeId ?? null,
    },
    images: [], spares: spares(s, id), items: rows.map((row) => itemRow(ctx, row)),
    signals: pump ? [{ id: "demo-signal-1", name: "Driftläge", sourceName: "Styrenhet P2" }, { id: "demo-signal-2", name: "Motorström", sourceName: "Styrenhet P2" }] : [],
    sources: part.id === "demo-part-ao-undercentral" ? [{ id: "demo-source-p2", name: "Styrenhet P2" }] : [],
    workOrders: openOrders(ctx, allItems(ctx, s).filter((row) => below.includes(row.partId))),
    canEdit: edit, canWithdraw: ctx.can("work-order", "edit") && ctx.can("maintenance", "read"), canOrder: false, pricesVisible: prices(ctx),
  };
}

function itemAnswer(ctx: MaintenanceContext, s: State, id: string) {
  const row = allItems(ctx, s).find((item) => item.id === id);
  if (!row) return fail(404, "Underhållsposten hittades inte.");
  const all = shape(s);
  const extra = s.extras.get(id) ?? { criticality: "", marking: "", cause: "", causeNote: "", version: 1 };
  const names = locationNames(s);
  const list = s.parts.length ? openOrders(ctx, allItems(ctx, s).filter((item) => item.partId === row.partId)) : [];
  const order = orderOf(ctx, row.workOrderId);
  const withdrawals = s.moves.filter((move) => move.kind === "WITHDRAWAL" && move.workOrderId && move.workOrderId === row.workOrderId && move.partId === row.partId).map((move) => {
    const stock = s.storeItems.find((item) => item.id === move.itemId);
    return { id: move.id, itemName: stock?.name ?? "", unit: stock?.unit ?? "st", quantity: -move.change, locationName: names.get(move.locationId) ?? "", at: move.at, byName: move.byName, kind: move.kind, returned: s.moves.some((other) => other.kind === "RETURN" && other.note === `ret:${move.id}`) };
  });
  const closed = order ? order.status === "COMPLETED" || order.status === "CANCELLED" : false;
  return {
    item: {
      ...itemRow(ctx, row), ...extra, version: extra.version, workOrderId: row.workOrderId, partPath: [...partPath(all, row.partId), row.partName],
      canEdit: ctx.can("maintenance", "edit") || (Boolean(row.workOrderId) && ctx.can("work-order", "edit")),
      canWithdraw: Boolean(row.workOrderId) && ctx.can("work-order", "edit") && !closed, pricesVisible: prices(ctx),
      withdrawals, spares: spares(s, row.partId), workOrders: order && !list.some((o) => o.id === order.id) ? [order, ...list] : list,
    },
  };
}

function plansAnswer(ctx: MaintenanceContext, s: State, partId: string) {
  const part = s.parts.find((row) => row.id === partId);
  if (!part) return fail(404, "Delen hittades inte.");
  const today = dayOf(ctx.now, 0);
  const occurrence = (row: Occurrence) => {
    const task = ctx.db.tasks.find((item) => item.id === row.taskId);
    return { id: row.taskId, title: task?.title ?? "", due: row.due, state: occurrenceState({ maintenancePlanId: row.planId, maintenanceDue: row.due, maintenanceActivatedAt: row.activated ? "x" : null, status: task?.status ?? "PLANNED" }, today), pinned: row.pinned, assignedToName: task?.assignedToName ?? "" };
  };
  const edit = ctx.can("maintenance", "edit");
  return {
    plans: s.plans.filter((plan) => plan.partId === partId).sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name, "sv")).map((plan) => ({
      id: plan.id, partId: plan.partId, name: plan.name, description: plan.description, unit: plan.unit, every: plan.every, intervalText: intervalText(plan.unit, plan.every), startDate: plan.startDate, nextRunHours: plan.nextRunHours,
      assignedToUserId: plan.assignedToUserId, assignedToName: memberName(ctx, plan.assignedToUserId), estimatedMinutes: plan.estimatedMinutes, isActive: plan.isActive, version: plan.version,
      coming: s.occurrences.filter((row) => row.planId === plan.id).sort((a, b) => a.due.localeCompare(b.due)).map(occurrence), last: null,
    })),
    runHours: part.runHours,
    members: edit ? ctx.db.users.map((user) => ({ id: user.id, name: user.name })) : [],
    canEdit: edit, canActivate: edit || ctx.can("work-order", "edit"),
  };
}

function planningAnswer(ctx: MaintenanceContext, s: State, from: string, to: string) {
  const today = dayOf(ctx.now, 0);
  const occurrences = s.occurrences.filter((row) => row.due >= from && row.due <= to).sort((a, b) => a.due.localeCompare(b.due)).map((row): PlanningMaintenance => {
    const task = ctx.db.tasks.find((item) => item.id === row.taskId);
    const plan = s.plans.find((item) => item.id === row.planId);
    return {
      id: row.taskId, title: task?.title ?? "", partName: s.parts.find((part) => part.id === plan?.partId)?.name ?? "", date: row.due,
      state: occurrenceState({ maintenancePlanId: row.planId, maintenanceDue: row.due, maintenanceActivatedAt: row.activated ? "x" : null, status: task?.status ?? "PLANNED" }, today),
      assignedToUserId: task?.assignedToUserId ?? null, assignedToName: task?.assignedToName ?? "", projectId: null,
    };
  });
  return { occurrences, truncated: false };
}

// ---------- the store ----------

type MoveRow = Move;
const eventRows = (ctx: MaintenanceContext, s: State, rows: readonly MoveRow[]) => {
  const names = locationNames(s);
  return rows.map((row) => {
    const item = s.storeItems.find((stock) => stock.id === row.itemId);
    const order = orderOf(ctx, row.workOrderId);
    return { id: row.id, kind: row.kind, itemId: row.itemId, itemName: item?.name ?? "", unit: item?.unit ?? "st", change: row.change, balanceAfter: row.balanceAfter, note: row.note.startsWith("ret:") ? "" : row.note,
      locationName: names.get(row.locationId) ?? "", workOrder: order ? { id: order.id, title: order.title } : null, byName: row.byName, at: row.at };
  });
};
const costPerOrder = (ctx: MaintenanceContext, rows: readonly MoveRow[], visible: boolean) => {
  if (!visible) return [];
  const orders = new Map<string, { id: string; title: string; value: number; moves: number }>();
  for (const row of rows) {
    const order = orderOf(ctx, row.workOrderId);
    if (!order || (row.kind !== "WITHDRAWAL" && row.kind !== "RETURN")) continue;
    const entry = orders.get(order.id) ?? { id: order.id, title: order.title, value: 0, moves: 0 };
    entry.value = roundQuantity(entry.value + (row.unitPrice === null ? 0 : -row.change * row.unitPrice));
    entry.moves += row.kind === "WITHDRAWAL" ? 1 : -1;
    orders.set(order.id, entry);
  }
  return [...orders.values()].sort((a, b) => b.value - a.value).slice(0, 30);
};
const figureMoves = (rows: readonly MoveRow[]) => rows.map((row) => ({ itemId: row.itemId, kind: row.kind, change: row.change, unitPrice: row.unitPrice, at: new Date(row.at) }));
const sortedMoves = (rows: readonly MoveRow[]) => [...rows].sort((a, b) => b.at.localeCompare(a.at));

function storeAnswer(ctx: MaintenanceContext, s: State, q: string, low: boolean) {
  const text = q.trim().toLocaleLowerCase("sv-SE");
  const visible = prices(ctx);
  const names = locationNames(s);
  const items = s.storeItems.filter((item) => !text || [item.name, item.articleNo, item.supplierName, item.shelfText, String(item.ownNumber ?? "")].some((value) => value.toLocaleLowerCase("sv-SE").includes(text)))
    .sort((a, b) => a.name.localeCompare(b.name, "sv")).map((item) => {
      const total = storeTotal(item);
      return { id: item.id, name: item.name, unit: item.unit, ownNumber: item.ownNumber, homeStoreId: item.homeStoreId, shelfText: item.shelfText, articleNo: item.articleNo, supplierName: item.supplierName, fromRegister: false,
        unitPrice: visible ? item.unitPrice : null, minQuantity: item.minQuantity, total, low: isLow(total, item.minQuantity), balances: { ...item.balances }, parts: s.links.filter((link) => link.itemId === item.id).length };
    });
  const used = s.storeItems.map((item) => item.ownNumber);
  return {
    locations: s.locations.map((row) => ({ id: row.id, parentId: row.parentId, name: names.get(row.id) ?? row.name, label: row.name, kind: row.kind, isActive: row.isActive, seriesStart: row.parentId ? null : row.seriesStart, nextNumber: !row.parentId && row.seriesStart !== null ? nextFreeNumber(row.seriesStart, used) : null })),
    items: low ? items.filter((item) => item.low) : items,
    canEdit: ctx.can("maintenance", "edit"), canOrder: false,
  };
}

function placeCardAnswer(ctx: MaintenanceContext, s: State, locationId: string | null) {
  if (locationId && !s.locations.some((row) => row.id === locationId)) fail(404, "Förrådsplatsen hittades inte.");
  const ids = locationId ? subtreeIds(s.locations.map((row) => ({ id: row.id, parentId: row.parentId, name: row.name })), locationId) : s.locations.map((row) => row.id);
  const names = locationNames(s);
  const visible = prices(ctx);
  const balances = s.storeItems.flatMap((item) => Object.entries(item.balances).filter(([id]) => ids.includes(id)).map(([locId, quantity]) => ({ item, locId, quantity })));
  const moves = sortedMoves(s.moves.filter((move) => ids.includes(move.locationId))).slice(0, 200);
  const lowItems = new Set(s.storeItems.filter((item) => isLow(storeTotal(item), item.minQuantity)).map((item) => item.id));
  const priceMap = visible ? new Map(s.storeItems.map((item) => [item.id, item.unitPrice] as const)) : null;
  return {
    figures: storeFigures({ balances: balances.map((row) => ({ itemId: row.item.id, quantity: row.quantity })), lowItems, prices: priceMap, moves: figureMoves(moves), now: ctx.now }),
    valueTruncated: false, pricesVisible: visible,
    balances: balances.map((row) => ({ itemId: row.item.id, itemName: row.item.name, unit: row.item.unit, ownNumber: row.item.ownNumber, locationId: row.locId, locationName: names.get(row.locId) ?? "", quantity: row.quantity }))
      .sort((a, b) => a.locationName.localeCompare(b.locationName, "sv") || a.itemName.localeCompare(b.itemName, "sv")),
    events: eventRows(ctx, s, moves.slice(0, 50)), costOrders: costPerOrder(ctx, moves, visible), movesTruncated: false,
  };
}

function articleCardAnswer(ctx: MaintenanceContext, s: State, itemId: string) {
  const item = s.storeItems.find((row) => row.id === itemId);
  if (!item) return fail(404, "Artikeln hittades inte.");
  const names = locationNames(s);
  const visible = prices(ctx);
  const balances = Object.entries(item.balances).map(([locationId, quantity]) => ({ locationId, locationName: names.get(locationId) ?? "", isActive: s.locations.find((row) => row.id === locationId)?.isActive ?? true, quantity })).sort((a, b) => a.locationName.localeCompare(b.locationName, "sv"));
  const total = storeTotal(item);
  const moves = sortedMoves(s.moves.filter((move) => move.itemId === itemId));
  const all = shape(s);
  return {
    item: { id: item.id, name: item.name, unit: item.unit, ownNumber: item.ownNumber, homeStoreId: item.homeStoreId, homeStoreName: names.get(item.homeStoreId ?? "") ?? "", shelfText: item.shelfText, articleNo: item.articleNo, supplierName: item.supplierName, fromRegister: false,
      unitPrice: visible ? item.unitPrice : null, ownPrice: visible ? item.unitPrice : null, minQuantity: item.minQuantity, total, low: isLow(total, item.minQuantity) },
    balances,
    figures: storeFigures({ balances: balances.map((row) => ({ itemId: item.id, quantity: row.quantity })), lowItems: new Set(isLow(total, item.minQuantity) ? [item.id] : []), prices: visible ? new Map([[item.id, item.unitPrice]]) : null, moves: figureMoves(moves), now: ctx.now }),
    pricesVisible: visible,
    parts: s.links.filter((link) => link.itemId === itemId).map((link) => ({ id: link.partId, name: s.parts.find((part) => part.id === link.partId)?.name ?? "", path: partPath(all, link.partId).join(" › "), level: partDepth(all, link.partId), quantity: link.quantity })),
    events: eventRows(ctx, s, moves.slice(0, 50)), costOrders: costPerOrder(ctx, moves, visible), canEdit: ctx.can("maintenance", "edit"), canOrder: false,
  };
}

function logAnswer(ctx: MaintenanceContext, s: State, itemId: string) {
  const item = s.storeItems.find((row) => row.id === itemId);
  if (!item) return fail(404, "Artikeln hittades inte.");
  const names = locationNames(s);
  return {
    item: { id: item.id, name: item.name, unit: item.unit },
    rows: sortedMoves(s.moves.filter((move) => move.itemId === itemId)).slice(0, 100).map((row) => {
      const order = orderOf(ctx, row.workOrderId);
      return { id: row.id, kind: row.kind, change: row.change, balanceAfter: row.balanceAfter, note: row.note.startsWith("ret:") ? "" : row.note, locationName: names.get(row.locationId) ?? "", workOrder: order ? { id: order.id, title: order.title } : null, byName: row.byName, at: row.at };
    }),
  };
}

// ---------- cost, events and key figures ----------

function costOf(ctx: MaintenanceContext, s: State, ids: string[]) {
  const visible = prices(ctx);
  const all = shape(s);
  const names = new Map(all.map((part) => [part.id, part.name]));
  const rows = allItems(ctx, s).filter((row) => ids.includes(row.partId));
  const byOrder = new Map<string, Row[]>();
  for (const row of rows) if (row.workOrderId) byOrder.set(row.workOrderId, [...(byOrder.get(row.workOrderId) ?? []), row]);
  const owner = attributeWorkOrders([...byOrder.entries()].map(([id, list]) => ({ id, machinePartId: null, itemParts: list.map((row) => row.partId) })));
  const orders = [...byOrder.keys()].flatMap((orderId) => {
    const task = ctx.db.tasks.find((row) => row.id === orderId);
    if (!task) return [];
    const seconds = ctx.db.timeEntries.filter((entry) => entry.taskId === orderId).reduce((sum, entry) => sum + entry.durationSec, 0);
    const materials = ((task.data as { details?: { materials?: MaterialRow[] } }).details?.materials ?? []).filter((row) => row && typeof row.name === "string");
    const totals = workOrderTotals(withoutStoreRows(materials));
    const partId = owner.get(orderId) ?? ids[0];
    const downtime = downtimeSummary((byOrder.get(orderId) ?? []).map((row) => ({ stoppedAt: row.stoppedAt, restoredAt: row.restoredAt })), ctx.now);
    return [{ orderId, partId, title: task.title, label: names.get(partId) ?? "", status: task.status, hours: hoursOf(seconds), material: roundOre(totals.material.purchase + totals.expenses.total), purchases: 0, downtimeMinutes: downtime.minutes }];
  });
  const withdrawals = s.moves.filter((move) => (move.kind === "WITHDRAWAL" || move.kind === "RETURN") && move.partId && ids.includes(move.partId)).map((move) => ({ quantity: -move.change, unitPrice: move.unitPrice }));
  const totals = costTotals({ orders, withdrawals, hourlyRate: HOURLY_RATE });
  const times = rows.filter((row) => row.status !== "CANCELLED").map((row) => ({ stoppedAt: row.stoppedAt, restoredAt: row.restoredAt }));
  const yearStart = new Date(`${swedishDayKey(ctx.now).slice(0, 4)}-01-01T00:00:00+01:00`);
  const hide = <T extends object>(row: T, keys: (keyof T)[]) => visible ? row : Object.fromEntries(Object.entries(row).map(([key, value]) => [key, keys.includes(key as keyof T) ? null : value]));
  return {
    totals: hide(totals, ["time", "material", "withdrawals", "purchases", "total"]), orders: orders.slice(0, 50).map((row) => hide(row, ["material", "purchases"])), truncated: false,
    downtime: { year: downtimeSummary(times, ctx.now, yearStart), all: downtimeSummary(times, ctx.now) }, pricesVisible: visible, hourlyRateMissing: false,
  };
}

function placeCostAnswer(ctx: MaintenanceContext, s: State, choice: string) {
  const roots = s.parts.filter((part) => !part.parentId);
  const chosen = choice === PLACE_ALL ? roots : choice === PLACE_NONE ? roots.filter((part) => !part.placeId) : roots.filter((part) => part.placeId && placeSubtree(s.places, choice).includes(part.placeId));
  return costOf(ctx, s, chosen.flatMap((part) => subtreeIds(shape(s), part.id)));
}

function eventsAnswer(ctx: MaintenanceContext, s: State, partId: string, page: number) {
  if (!s.parts.some((part) => part.id === partId)) fail(404, "Delen hittades inte.");
  const all = shape(s);
  const ids = subtreeIds(all, partId);
  const rows = s.events.filter((event) => ids.includes(event.partId)).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const depth = partPath(all, partId).length + 1;
  const names = new Map(all.map((part) => [part.id, part.name]));
  const below = (id: string) => id !== partId ? [...partPath(all, id), names.get(id) ?? ""].slice(depth).join(" › ") : "";
  const hasSource = ids.includes("demo-part-ao-undercentral");
  const state = rows.find((event) => event.type === "state");
  const status = machineStatus({ sources: hasSource ? 1 : 0, state: state?.state === "running" || state?.state === "stopped" ? state.state : null, stateAt: state?.occurredAt ?? null, lastHeardAt: rows[0]?.occurredAt ?? null, openOrders: 0, pendingOrders: 0 });
  const take = Math.min(50, Math.max(1, page)) * MACHINE_EVENTS_PAGE;
  return { status, events: rows.slice(0, take).map((event) => ({ id: event.id, occurredAt: event.occurredAt, receivedAt: event.occurredAt, type: event.type, code: event.code, severity: event.severity, state: event.state, text: event.text, sourceName: event.sourceName, below: below(event.partId) })), total: rows.length, page };
}

function figuresAnswer(s: State, partId: string, periodDays: number) {
  if (!s.parts.some((part) => part.id === partId)) fail(404, "Delen hittades inte.");
  const has = subtreeIds(shape(s), partId).includes("demo-part-ao-undercentral");
  const period = ([30, 90, 365, 730] as number[]).includes(periodDays) ? periodDays : DEFAULT_KEY_FIGURE_PERIOD;
  const none = { value: null, samples: 0, reason: "no_data" as const };
  const figures: KeyFigures = has
    ? { periodDays: period, coverageDays: Math.min(period, 21), partialPeriod: period > 21, alarms: 2, faults: 1, stops: 1, orders: 1,
      downtimeMinutes: { value: 38, samples: 1, reason: null }, ackMinutes: { value: 12, samples: 1, reason: null }, doneMinutes: { value: 190, samples: 1, reason: null }, repairMinutes: { value: 95, samples: 1, reason: null },
      ordersPer30Days: { value: 1.4, samples: 1, reason: null }, mtbfHours: { value: 480, samples: 1, reason: null } }
    : { periodDays: period, coverageDays: 0, partialPeriod: false, alarms: 0, faults: 0, stops: 0, orders: 0, downtimeMinutes: none, ackMinutes: none, doneMinutes: none, repairMinutes: none, ordersPer30Days: none, mtbfHours: none };
  return { figures: { periodDays: figures.periodDays, coverageDays: figures.coverageDays, partialPeriod: figures.partialPeriod }, rows: keyFigureRows(figures), truncated: false };
}

// ---------- changes (in memory only) ----------

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const text = (value: unknown, max = 200) => typeof value === "string" ? value.trim().slice(0, max) : "";
const stamp = (value: unknown) => typeof value === "string" && value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
const orNull = (value: unknown) => typeof value === "string" && value ? value : null;
const NOT_IN_DEMO = "Det här går inte att prova i demon. Det kräver ett riktigt konto.";

function savePart(ctx: MaintenanceContext, s: State, id: string | null, version: number | null, raw: unknown) {
  const input = record(raw);
  const name = text(input.name, 120);
  if (!name) fail(422, "Skriv ett namn.");
  const parentId = orNull(input.parentId);
  if (parentId && !s.parts.some((part) => part.id === parentId)) fail(422, "Den överordnade delen hittades inte.");
  if (id && parentId && subtreeIds(shape(s), id).includes(parentId)) fail(422, "En del kan inte ligga under sig själv.");
  const status = partStatusOf(String(input.status ?? "IN_SERVICE"));
  const values = { name, partType: text(input.partType, 80), marking: text(input.marking, 80), status: (PART_STATUSES as readonly string[]).includes(status) ? status : "IN_SERVICE" as PartStatus, notes: text(input.notes, 2000), isActive: input.isActive !== false, parentId };
  if (id) {
    const part = s.parts.find((row) => row.id === id);
    if (!part) return fail(404, "Delen hittades inte.");
    if (version !== part.version) fail(409, "Delen har ändrats av någon annan. Läs in den igen.");
    Object.assign(part, values, { version: part.version + 1 });
    if (!parentId && "placeId" in input) part.placeId = orNull(input.placeId);
    if (!parentId && "customerId" in input) part.customerId = orNull(input.customerId);
    if ("runHours" in input && (typeof input.runHours === "number" || input.runHours === null)) { part.runHours = input.runHours; part.runHoursAt = input.runHours === null ? null : iso(ctx.now); }
    for (const plan of s.plans.filter((row) => row.partId === id)) fillPlan(ctx, s, plan);
    return { id: part.id, version: part.version };
  }
  const part: Part = { id: nextId(s, "part"), placeId: parentId ? null : orNull(input.placeId), customerId: parentId ? null : orNull(input.customerId), runHours: typeof input.runHours === "number" ? input.runHours : null, runHoursAt: typeof input.runHours === "number" ? iso(ctx.now) : null, version: 1, ...values };
  s.parts.push(part);
  return { id: part.id, version: 1 };
}

function savePlace(s: State, id: string | null, version: number | null, raw: unknown) {
  const input = record(raw);
  const name = text(input.name, 120);
  if (!name) fail(422, "Skriv ett namn.");
  const values = { name, parentId: orNull(input.parentId), level: placeLevelOf(String(input.level ?? "SITE")), notes: text(input.notes, 2000) };
  if (id) {
    const place = s.places.find((row) => row.id === id);
    if (!place) return fail(404, "Platsen hittades inte.");
    if (version !== place.version) fail(409, "Platsen har ändrats av någon annan. Läs in den igen.");
    if (values.parentId && placeSubtree(s.places, id).includes(values.parentId)) fail(422, "En plats kan inte ligga under sig själv.");
    Object.assign(place, values, { version: place.version + 1 });
    return { id, version: place.version };
  }
  const place: Place = { id: nextId(s, "place"), version: 1, ...values };
  s.places.push(place);
  return { id: place.id, version: 1 };
}

function saveItem(ctx: MaintenanceContext, s: State, id: string | null, version: number | null, raw: unknown) {
  const input = record(raw);
  const partId = text(input.partId, 100);
  const part = s.parts.find((row) => row.id === partId);
  if (!part) return fail(404, "Delen hittades inte.");
  const fields = {
    type: text(input.type, 20), priority: text(input.priority, 20), fault: text(input.fault, 2000), reportedAt: stamp(input.reportedAt), stoppedAt: stamp(input.stoppedAt), restoredAt: stamp(input.restoredAt),
  };
  const problem = itemTimeProblem(fields);
  if (problem) fail(422, problem);
  const extra: Extras = { criticality: text(input.criticality, 2), marking: text(input.marking, 80), cause: text(input.cause, 20), causeNote: text(input.causeNote, 500), version: 1 };
  const status = (ITEM_STATUSES as readonly string[]).includes(String(input.status)) ? input.status as ItemStatus : "OPEN";
  const workOrderId = orNull(input.workOrderId);
  if (workOrderId && !ctx.db.tasks.some((task) => task.id === workOrderId && task.kind === "WORK_ORDER")) fail(404, "Arbetsordern hittades inte.");
  if (id) {
    const held = (ctx.db.maintenanceItems ?? []).find((row) => row.id === id);
    const own = s.items.find((row) => row.id === id);
    const current = s.extras.get(id);
    if ((current?.version ?? 1) !== version) fail(409, "Posten har ändrats av någon annan. Läs in den igen.");
    s.extras.set(id, { ...extra, version: (current?.version ?? 1) + 1 });
    if (held) Object.assign(held, { ...fields, type: fields.type as MaintenanceType | "", priority: fields.priority as DemoMaintenanceItem["priority"], status });
    else if (own) Object.assign(own, { ...fields, status, partId });
    else fail(404, "Underhållsposten hittades inte.");
    return { id, version: (current?.version ?? 1) + 1 };
  }
  const created = iso(ctx.now);
  const madeId = nextId(s, "maintenance");
  if (workOrderId) (ctx.db.maintenanceItems ??= []).push({ id: madeId, partId, partName: part.name, workOrderId, status, source: "MANUAL", ...fields, type: fields.type as MaintenanceType | "", priority: fields.priority as DemoMaintenanceItem["priority"], createdAt: created });
  else s.items.push({ id: madeId, partId, workOrderId: null, status, ...fields, createdAt: created });
  s.extras.set(madeId, extra);
  return { id: madeId, version: 1 };
}

function move(ctx: MaintenanceContext, s: State, kind: Move["kind"], raw: unknown) {
  const input = record(raw);
  const item = s.storeItems.find((row) => row.id === input.itemId);
  const locationId = String(input.locationId ?? "");
  if (!item) return fail(404, "Artikeln hittades inte.");
  if (kind === "WITHDRAWAL" && !s.locations.some((row) => row.id === locationId) ) {
    const pick = pickLocation(Object.entries(item.balances).map(([id, quantity]) => ({ locationId: id, quantity })), parseQuantity(input.quantity as string | number) ?? 1);
    if (!pick) fail(422, "Det finns inget kvar att ta. Beställ först.");
    return move(ctx, s, kind, { ...input, locationId: pick });
  }
  if (!s.locations.some((row) => row.id === locationId)) return fail(404, "Förrådsplatsen hittades inte.");
  const balance = item.balances[locationId] ?? 0;
  let change: number;
  let note = text(input.note, 300);
  if (kind === "COUNT") {
    const counted = parseQuantity(input.counted as string | number, { allowZero: true });
    if (counted === null) return fail(422, "Ange ett antal.");
    change = countChange(balance, counted);
    item.balances[locationId] = counted;
  } else {
    const quantity = parseQuantity(input.quantity as string | number);
    if (quantity === null) return fail(422, "Ange ett antal större än noll.");
    if (kind === "RECEIPT") { change = quantity; item.balances[locationId] = roundQuantity(balance + quantity); }
    else {
      const result = withdrawal(balance, quantity);
      if (!result.ok) return fail(422, result.problem);
      change = -quantity;
      item.balances[locationId] = result.after;
    }
  }
  const maintenanceItem = orNull(input.maintenanceItemId);
  const partId = maintenanceItem ? allItems(ctx, s).find((row) => row.id === maintenanceItem)?.partId ?? null : null;
  if (kind === "WITHDRAWAL" && !input.workOrderId) fail(422, "Välj arbetsorder.");
  const row: Move = { id: nextId(s, "mv"), kind, itemId: item.id, locationId, change, balanceAfter: item.balances[locationId], note, workOrderId: orNull(input.workOrderId), partId, byName: ctx.user.name, at: iso(ctx.now), unitPrice: item.unitPrice };
  s.moves.push(row);
  note = "";
  return { id: row.id, balanceAfter: row.balanceAfter };
}

function changePlan(ctx: MaintenanceContext, s: State, id: string | null, version: number | null, raw: unknown) {
  const input = record(raw);
  const partId = text(input.partId, 100);
  const name = text(input.name, 120);
  if (!name) fail(422, "Skriv vad som ska göras.");
  const unit = (PLAN_UNITS as readonly string[]).includes(String(input.unit)) ? input.unit as PlanUnit : null;
  const every = typeof input.every === "number" && Number.isInteger(input.every) && input.every >= 1 ? input.every : null;
  if (!unit || !every) return fail(422, "Intervallet ska vara minst 1.");
  const startDate = text(input.startDate, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return fail(422, "Ange ett datum (ÅÅÅÅ-MM-DD).");
  const part = s.parts.find((row) => row.id === (id ? s.plans.find((plan) => plan.id === id)?.partId : partId));
  if (!part) return fail(404, "Delen hittades inte.");
  const values = { name, description: text(input.description, 2000), unit, every, startDate, assignedToUserId: orNull(input.assignedToUserId), estimatedMinutes: typeof input.estimatedMinutes === "number" ? input.estimatedMinutes : null, isActive: input.isActive !== false };
  const nextRunHours = unit === "RUN_HOURS" ? (typeof input.firstRunHours === "number" ? input.firstRunHours : (part.runHours ?? 0) + every) : null;
  if (id) {
    const plan = s.plans.find((row) => row.id === id)!;
    if (version !== plan.version) fail(409, "Planen har ändrats av någon annan. Läs in den igen.");
    Object.assign(plan, values, { nextRunHours, version: plan.version + 1 });
    fillPlan(ctx, s, plan);
    return { id, version: plan.version, created: 0 };
  }
  const plan: Plan = { id: nextId(s, "plan"), partId: part.id, nextRunHours, version: 1, ...values };
  s.plans.push(plan);
  fillPlan(ctx, s, plan);
  return { id: plan.id, version: 1, created: s.occurrences.filter((row) => row.planId === plan.id).length };
}

function mutate(ctx: MaintenanceContext, s: State, body: Record<string, unknown>) {
  const action = String(body.action ?? "");
  const id = typeof body.id === "string" ? body.id : "";
  const version = typeof body.version === "number" ? body.version : null;
  // Activating and moving an occurrence is allowed with the work order's own right (as in Cloud).
  if (action === "activate_order" || action === "postpone_order") {
    if (!ctx.can("maintenance", "edit") && !ctx.can("work-order", "edit")) fail(403, "Du saknar behörighet att ändra arbetsordern.");
    const row = s.occurrences.find((occurrence) => occurrence.taskId === id);
    if (!row) return fail(404, "Arbetsordern hittades inte.");
    if (action === "activate_order") { row.activated = true; return { ok: true }; }
    const day = text(body.day, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return fail(422, "Ange ett datum (ÅÅÅÅ-MM-DD).");
    row.due = day; row.pinned = true;
    const task = ctx.db.tasks.find((item) => item.id === id);
    if (task) Object.assign(task, { dueDate: day, plannedStartDate: day });
    return { ok: true };
  }
  if (action === "create_item" || action === "update_item") {
    const raw = record(body.item);
    const workOrderId = orNull(raw.workOrderId);
    if (!ctx.can("maintenance", "edit") && !(workOrderId && ctx.can("work-order", "edit"))) fail(403, "Du saknar behörighet att ändra underhållsposter.");
    return saveItem(ctx, s, action === "update_item" ? id : null, version, raw);
  }
  requireEdit(ctx);
  switch (action) {
    case "create_place": return savePlace(s, null, null, body.place);
    case "update_place": return savePlace(s, id, version, body.place);
    case "delete_place":
      if (s.places.some((place) => place.parentId === id) || s.parts.some((part) => part.placeId === id)) fail(409, "Platsen används. Flytta eller ta bort det som ligger på den först.");
      s.places = s.places.filter((place) => place.id !== id);
      return { ok: true };
    case "create_part": return savePart(ctx, s, null, null, body.part);
    case "update_part": return savePart(ctx, s, id, version, body.part);
    case "delete_part": {
      const ids = subtreeIds(shape(s), id);
      if (allItems(ctx, s).some((row) => ids.includes(row.partId) && row.workOrderId && !s.occurrences.some((occurrence) => occurrence.taskId === row.workOrderId))) fail(409, "Delen har underhållsposter på arbetsordrar och kan inte tas bort i demon.");
      s.parts = s.parts.filter((part) => !ids.includes(part.id));
      s.items = s.items.filter((row) => !ids.includes(row.partId));
      s.links = s.links.filter((link) => !ids.includes(link.partId));
      s.plans = s.plans.filter((plan) => { if (ids.includes(plan.partId)) { dropOccurrences(ctx, s, plan.id); return false; } return true; });
      return { ok: true };
    }
    case "delete_item": {
      const row = s.items.find((item) => item.id === id);
      if (!row) fail(409, "Den här posten hör till en arbetsorder och tas bort där.");
      s.items = s.items.filter((item) => item.id !== id);
      return { ok: true };
    }
    case "create_plan": return changePlan(ctx, s, null, null, body.plan);
    case "update_plan": return changePlan(ctx, s, id, version, body.plan);
    case "delete_plan": {
      const plan = s.plans.find((row) => row.id === id);
      if (!plan) return fail(404, "Planen hittades inte.");
      dropOccurrences(ctx, s, id);
      s.plans = s.plans.filter((row) => row.id !== id);
      return { ok: true };
    }
    case "link_spare": {
      const itemId = typeof body.itemId === "string" ? body.itemId : "";
      const article = record(body.article);
      let stock = s.storeItems.find((row) => row.id === itemId);
      if (!stock && text(article.name)) {
        stock = { id: nextId(s, "si"), name: text(article.name), unit: text(article.unit, 20) || "st", ownNumber: null, homeStoreId: null, shelfText: "", articleNo: "", supplierName: "", unitPrice: null, minQuantity: null, balances: {} };
        s.storeItems.push(stock);
      }
      if (!stock) return fail(404, "Artikeln hittades inte.");
      const quantity = parseQuantity(body.quantity as string | number) ?? 1;
      s.links.push({ id: nextId(s, "link"), partId: String(body.partId ?? ""), itemId: stock.id, quantity });
      return { ok: true };
    }
    case "unlink_spare": s.links = s.links.filter((link) => link.id !== id); return { ok: true };
    case "add_store_item": {
      const article = record(body.article);
      const name = text(article.name);
      if (!name) return fail(422, "Skriv en benämning.");
      const top = s.locations.find((row) => !row.parentId && row.isActive);
      const ownNumber = top?.seriesStart != null ? nextFreeNumber(top.seriesStart, s.storeItems.map((row) => row.ownNumber)) : null;
      const row: StoreItem = { id: nextId(s, "si"), name, unit: text(article.unit, 20) || "st", ownNumber, homeStoreId: top?.id ?? null, shelfText: text(article.shelfText, 120), articleNo: text(article.articleNo, 60), supplierName: text(article.supplierName, 120), unitPrice: null, minQuantity: null, balances: {} };
      s.storeItems.push(row);
      return { id: row.id, name: row.name, ownNumber: row.ownNumber, created: true };
    }
    case "update_store_item": {
      const row = s.storeItems.find((item) => item.id === id);
      if (!row) return fail(404, "Artikeln hittades inte.");
      const patch = { ...record(body.item), ...("minQuantity" in body ? { minQuantity: body.minQuantity } : {}) };
      if ("minQuantity" in patch) row.minQuantity = patch.minQuantity === null ? null : parseQuantity(patch.minQuantity as string | number, { allowZero: true });
      if ("name" in patch && text(patch.name)) row.name = text(patch.name);
      if ("unit" in patch && text(patch.unit, 20)) row.unit = text(patch.unit, 20);
      if ("shelfText" in patch) row.shelfText = text(patch.shelfText, 120);
      if ("articleNo" in patch) row.articleNo = text(patch.articleNo, 60);
      if ("supplierName" in patch) row.supplierName = text(patch.supplierName, 120);
      if ("unitPrice" in patch) row.unitPrice = typeof patch.unitPrice === "number" ? patch.unitPrice : null;
      return { ok: true };
    }
    case "receive": return move(ctx, s, "RECEIPT", body.move);
    case "count": return move(ctx, s, "COUNT", body.move);
    case "withdraw": return move(ctx, s, "WITHDRAWAL", body.move);
    case "return": {
      const original = s.moves.find((row) => row.id === id && row.kind === "WITHDRAWAL");
      if (!original) return fail(404, "Uttaget hittades inte.");
      if (s.moves.some((row) => row.kind === "RETURN" && row.note === `ret:${id}`)) fail(409, "Uttaget är redan återlämnat.");
      const stock = s.storeItems.find((row) => row.id === original.itemId);
      if (!stock) return fail(404, "Artikeln hittades inte.");
      stock.balances[original.locationId] = roundQuantity((stock.balances[original.locationId] ?? 0) - original.change);
      s.moves.push({ ...original, id: nextId(s, "mv"), kind: "RETURN", change: -original.change, balanceAfter: stock.balances[original.locationId], note: `ret:${id}`, at: iso(ctx.now), byName: ctx.user.name });
      return { ok: true };
    }
    default: return fail(403, NOT_IN_DEMO);
  }
}

/** Answers the parts of /api/maintenance the demo has; a request for one it has not says so (not found for a read, refused for a change). */
export function demoMaintenance(ctx: MaintenanceContext, request: Request) {
  const s = state(ctx);
  const params = request.url.searchParams;
  const id = params.get("id") ?? "";
  if (request.method === "GET") {
    // Planering asks for the maintenance on its calendar whoever opens it: without the right the calendar simply has none (2026-11-04).
    if (params.get("part") === "planning") { try { requireRead(ctx); } catch { return { occurrences: [], truncated: false }; } }
    requireRead(ctx);
    switch (params.get("part")) {
      case "tree": return treeAnswer(ctx, s);
      case "detail": return detailAnswer(ctx, s, id);
      case "item": return itemAnswer(ctx, s, id);
      case "plans": return plansAnswer(ctx, s, id);
      case "planning": return planningAnswer(ctx, s, params.get("from") ?? "", params.get("to") ?? "");
      case "store": return storeAnswer(ctx, s, params.get("q") ?? "", params.get("low") === "1");
      case "store_place": return placeCardAnswer(ctx, s, id || null);
      case "store_article": return articleCardAnswer(ctx, s, id);
      case "log": return logAnswer(ctx, s, params.get("itemId") ?? "");
      case "cost": { if (!s.parts.some((part) => part.id === id)) fail(404, "Delen hittades inte."); return costOf(ctx, s, subtreeIds(shape(s), id)); }
      case "place_cost": return placeCostAnswer(ctx, s, id);
      case "events": return eventsAnswer(ctx, s, id, Number(params.get("page")) || 1);
      case "kpi": return figuresAnswer(s, id, Number(params.get("days")) || DEFAULT_KEY_FIGURE_PERIOD);
      default: return fail(400, "Okänd begäran.");
    }
  }
  return mutate(ctx, s, record(request.body));
}

/** The part names of the demo's tree, for tests and the audit. */
export const demoPartCount = (ctx: MaintenanceContext) => state(ctx).parts.length;
