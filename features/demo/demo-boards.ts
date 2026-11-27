import { boardsAccess } from "@/lib/boards/access";
import { cardDefinition, defaultSourceRef, layoutSchema, normalizeLayout, presetLayout, readLayout, type BoardLayout, type BoardPreset, BOARD_PRESETS } from "@/lib/boards/model";
import { metricAccess, metricDefinition, metricOption, metricPeriod, metricsFor, type MetricKey, type MetricViewer } from "@/lib/boards/metrics";
import { deviationSeries, invoiceNet, machineStatusShape, storeBelowMinShape, withPrevious, workOrderSeries } from "@/lib/boards/metric-shapes";
import { inRange, periodDays, periodRange, type Period } from "@/lib/boards/period";
import { cardHasPersonalData, visibilitySchema, type Visibility } from "@/lib/boards/privacy";
import type { CardData, Shape } from "@/lib/boards/shapes";
import { BOARD_TEMPLATE_KEYS, boardTemplate, type BoardTemplateKey } from "@/lib/boards/templates";
import { isoWeekOf } from "@/lib/boards/week";
import { DEVIATION_TYPES, deviationType } from "@/lib/self-inspection/incidents";
import { addSwedishDays, startOfSwedishDay, swedishClock, swedishDayKey, swedishMonday } from "@/lib/swedish-time";
import { expectedWeeklyWorkMinutes } from "@/lib/workflow/work-schedule";
import { workflowSubjectForTask, type WorkflowPermissionAction, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { workStateMatches, workStateOf } from "@/lib/workflow/work-list";
import { workflowTaskProgress } from "@/lib/workflow/task-model";
import type { DemoDatabase, DemoUser } from "./demo-data";
import { demoInvoiceFigures } from "./demo-customer-invoices";
import { demoMachineFigures } from "./demo-maintenance";
import { demoQuoteFigures } from "./demo-quotes";
import { demoSourceCard, demoSourceOptions, demoWithTrend } from "./demo-board-cards";
import { demoDeviationEntries } from "./demo-self-inspection";
import { demoNewsEvents } from "./demo-news";

/**
 * Tavlor i demon (2026-11-19, issue #4): /api/boards answered from memory. A few example boards are ready and published, Ny
 * tavla offers all ten templates, and the editor saves and publishes in this browser only. Every card's figures are counted here from
 * the demo's invented data, with the same measures, periods and shapes as the server (lib/boards/metric-shapes.ts) and the demo
 * person's rights. Own tables, screens and shared links need Workflow's server: the demo answers them empty and their tabs say so.
 */
export class DemoBoardsError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export type DemoBoardsContext = {
  db: DemoDatabase; user: DemoUser; admin: boolean; now: Date;
  can: (subject: WorkflowPermissionSubject, action: WorkflowPermissionAction) => boolean;
};
type Request = { method: string; url: URL; body: unknown };
type DemoBoard = { id: string; name: string; description: string; draft: BoardLayout; revision: number; createdBy: string; updatedBy: string; updatedAt: string;
  published: { id: string; number: number; publishedAt: string; layout: BoardLayout; visibility: Visibility } | null };
type Store = { boards: DemoBoard[]; sequence: number };

const stores = new WeakMap<DemoDatabase, Store>();
const NO_TABLES = "Egna tabeller sparas inte i demon.";
const NO_SCREENS = "Skärmar och delade länkar behöver Workflows server och finns inte i demon.";
const SEEDED: readonly BoardTemplateKey[] = ["week_work", "workshop_screen", "time_attendance", "management_meeting", "production_hall", "daily_planning"];

function storeOf(ctx: DemoBoardsContext): Store {
  let store = stores.get(ctx.db);
  if (!store) {
    const at = (minutes: number) => new Date(ctx.now.getTime() - minutes * 60_000).toISOString();
    store = { sequence: 0, boards: SEEDED.map((key, index) => {
      const template = boardTemplate(key);
      return { id: `demo-board-${index + 1}`, name: template.label, description: template.description, draft: template.layout, revision: 1, createdBy: ctx.db.users[0]!.id, updatedBy: ctx.db.users[0]!.id, updatedAt: at(60 * (index + 1)),
        published: { id: `demo-board-version-${index + 1}`, number: 1, publishedAt: at(60 * (index + 1)), layout: template.layout, visibility: {} } };
    }) };
    stores.set(ctx.db, store);
  }
  return store;
}

const viewerOf = (ctx: DemoBoardsContext): MetricViewer => ({ userId: ctx.user.id, admin: ctx.admin, workflowPermissions: ctx.user.permissions, organization: { disabledModules: [] } });
const rightsOf = (ctx: DemoBoardsContext) => boardsAccess({ admin: ctx.admin, workflowPermissions: ctx.user.permissions });
const userName = (ctx: DemoBoardsContext, id: string) => ctx.db.users.find((user) => user.id === id)?.name ?? "";
const findBoard = (store: Store, id: unknown) => {
  const board = store.boards.find((item) => item.id === id);
  if (!board) throw new DemoBoardsError(404, "Tavlan finns inte.");
  return board;
};
const input = (body: unknown) => (body && typeof body === "object" ? body as Record<string, unknown> : {});

export async function demoBoards(ctx: DemoBoardsContext, request: Request): Promise<unknown> {
  const store = storeOf(ctx);
  const rights = rightsOf(ctx);
  const params = request.url.searchParams;
  if (request.method === "GET") {
    switch (params.get("part")) {
      case "access": return { ...rights, demo: true };
      case "list": {
        if (!rights.read) throw new DemoBoardsError(403, "Du saknar behörighet att se tavlor.");
        return { canEdit: rights.edit, canPublish: rights.publish, items: store.boards.filter((board) => rights.edit || board.published).map((board) => {
          const layout = rights.edit ? board.draft : board.published!.layout;
          return { id: board.id, name: board.name, description: board.description, updatedAt: board.updatedAt, updatedBy: userName(ctx, board.updatedBy), mine: board.createdBy === ctx.user.id,
            cards: layout.cards.length, orientation: layout.orientation, published: board.published ? { number: board.published.number, publishedAt: board.published.publishedAt } : null };
        }) };
      }
      case "board": {
        if (!rights.read) throw new DemoBoardsError(403, "Du saknar behörighet att se tavlor.");
        const board = findBoard(store, params.get("id"));
        if (!rights.edit && !board.published) throw new DemoBoardsError(404, "Tavlan är inte publicerad.");
        return { id: board.id, name: board.name, description: board.description, revision: board.revision, updatedAt: board.updatedAt, draft: rights.edit ? board.draft : null, published: board.published,
          canEdit: rights.edit, canPublish: rights.publish, metrics: rights.edit ? metricsFor(viewerOf(ctx)).map(metricOption) : [] };
      }
      case "feed": {
        if (!rights.read) throw new DemoBoardsError(403, "Du saknar behörighet att se tavlor.");
        const board = findBoard(store, params.get("id"));
        const layout = params.get("draft") === "1" && rights.edit ? board.draft : board.published?.layout;
        if (!layout) throw new DemoBoardsError(404, "Tavlan är inte publicerad.");
        return { at: ctx.now.toISOString(), cards: await demoBoardFeed(ctx, layout) };
      }
      case "publish": {
        const board = findBoard(store, params.get("id"));
        const cards = board.draft.cards.map((card) => ({ id: card.id, personal: cardHasPersonalData(card), people: board.published?.visibility[card.id] ?? "hidden" }));
        return { layout: board.draft, cards, personal: cards.some((card) => card.personal), receivers: { screens: [], links: [] } };
      }
      case "tables": return { items: [] };
      case "screens": return { items: [], canManage: false };
      case "links": return { items: [], defaultUntil: "" };
      case "playlists": return { items: [], canEdit: false };
      case "sources": if (!rights.edit) throw new DemoBoardsError(403, "Du saknar behörighet att ändra tavlor."); return demoSourceOptions(ctx, params.get("kind"), params.get("id"));
      case "table": throw new DemoBoardsError(404, NO_TABLES);
      case "pairing": throw new DemoBoardsError(403, NO_SCREENS);
    }
    throw new DemoBoardsError(404, "Det finns inget sådant svar i demon.");
  }
  const body = input(request.body);
  const edit = () => { if (!rights.edit) throw new DemoBoardsError(403, "Du saknar behörighet att ändra tavlor."); };
  const now = ctx.now.toISOString();
  switch (body.action) {
    case "create_board": {
      edit();
      const data = input(body.board);
      const name = String(data.name ?? "").trim().slice(0, 80);
      if (!name) throw new DemoBoardsError(400, "Ge tavlan ett namn.");
      let layout = presetLayout(BOARD_PRESETS.some((item) => item.key === data.preset) ? data.preset as BoardPreset : "empty");
      let description = "";
      if (typeof data.template === "string" && (BOARD_TEMPLATE_KEYS as readonly string[]).includes(data.template)) { const template = boardTemplate(data.template as BoardTemplateKey); layout = template.layout; description = template.description; }
      if (data.copyOf) { const source = findBoard(store, data.copyOf); layout = readLayout(JSON.parse(JSON.stringify(source.draft))); description = source.description; }
      const board: DemoBoard = { id: `demo-board-new-${++store.sequence}`, name, description, draft: layout, revision: 1, createdBy: ctx.user.id, updatedBy: ctx.user.id, updatedAt: now, published: null };
      store.boards.unshift(board);
      return { id: board.id };
    }
    case "save_board": {
      edit();
      const board = findBoard(store, body.id);
      if (body.revision !== board.revision) throw new DemoBoardsError(409, "Tavlan har ändrats av någon annan. Ladda om sidan för att se den senaste versionen.");
      const data = input(body.board);
      if (typeof data.name === "string" && data.name.trim()) board.name = data.name.trim().slice(0, 80);
      if (typeof data.description === "string") board.description = data.description.trim().slice(0, 300);
      if (data.layout) { const parsed = layoutSchema.safeParse(data.layout); if (!parsed.success) throw new DemoBoardsError(400, parsed.error.issues[0]?.message ?? "Tavlan kunde inte sparas."); board.draft = parsed.data; }
      board.revision += 1; board.updatedBy = ctx.user.id; board.updatedAt = now;
      return { revision: board.revision, updatedAt: now };
    }
    case "publish_board": {
      if (!rights.publish) throw new DemoBoardsError(403, "Du saknar behörighet att publicera tavlor.");
      const board = findBoard(store, body.id);
      const number = (board.published?.number ?? 0) + 1;
      const visibility = visibilitySchema.parse(input(body.publish).visibility ?? {});
      board.published = { id: `${board.id}-v${number}`, number, publishedAt: now, layout: normalizeLayout(JSON.parse(JSON.stringify(board.draft))), visibility };
      return { number, publishedAt: now };
    }
    case "delete_board": {
      edit();
      findBoard(store, body.id);
      store.boards = store.boards.filter((item) => item.id !== body.id);
      return { ok: true };
    }
    case "create_table": case "save_table": case "delete_table": throw new DemoBoardsError(403, NO_TABLES);
    default: throw new DemoBoardsError(403, NO_SCREENS);
  }
}

// ---------- the cards' figures, counted in this browser ----------

async function demoBoardFeed(ctx: DemoBoardsContext, layout: BoardLayout): Promise<Record<string, CardData>> {
  const at = ctx.now.toISOString();
  const feed: Record<string, CardData> = {};
  const viewer = viewerOf(ctx);
  const count = (key: MetricKey, period: Period, now: Date) => countDemoMetric({ ...ctx, now }, key, period);
  for (const stored of layout.cards) {
    const card = stored.data ? stored : { ...stored, data: defaultSourceRef(stored.type) };
    if (!card.data || !cardDefinition(card.type).shapes.length) continue;
    // The newer cards (lib/boards/cards): counted from the demo's data with the same rules as the server.
    if (card.data.kind === "source") {
      try {
        const result = await demoSourceCard(ctx, viewer, card.data.source, count);
        feed[card.id] = result.ok ? (cardDefinition(card.type).shapes.includes(result.data.kind) ? { ok: true, at, data: result.data, ...(result.label ? { label: result.label } : {}) } : { ok: false, at, reason: "missing" }) : { ok: false, at, reason: result.reason };
      } catch { feed[card.id] = { ok: false, at, reason: "failed" }; }
      continue;
    }
    if (card.data.kind !== "metric") { feed[card.id] = { ok: false, at, reason: "missing" }; continue; }
    const key = card.data.metric;
    const label = metricDefinition(key).label;
    const access = metricAccess(key, viewer);
    if (access !== "ok") { feed[card.id] = { ok: false, at, reason: access, label }; continue; }
    try {
      let shape = await countDemoMetric(ctx, key, metricPeriod(key, card.data.period) ?? "week");
      if (!cardDefinition(card.type).shapes.includes(shape.kind)) { feed[card.id] = { ok: false, at, reason: "missing", label }; continue; }
      if (shape.kind === "table" && card.settings.rows) shape = { ...shape, rows: shape.rows.slice(0, card.settings.rows) };
      if (shape.kind === "number") shape = await demoWithTrend(card.data, card, shape, ctx.now, count);
      feed[card.id] = { ok: true, at, data: shape, label };
    } catch {
      feed[card.id] = { ok: false, at, reason: "failed", label };
    }
  }
  return feed;
}

const OPEN_TASK = (status: string) => status !== "COMPLETED" && status !== "CANCELLED";
const hours = (seconds: number) => Math.round((seconds / 3600) * 10) / 10;

async function countDemoMetric(ctx: DemoBoardsContext, key: MetricKey, period: Period): Promise<Shape> {
  const { db, now } = ctx;
  const range = periodRange(period, now);
  const readable = db.tasks.filter((task) => ctx.can(workflowSubjectForTask(task.kind), "read"));
  const team = ctx.admin || ctx.can("team", "read");
  const seconds = (from: Date, to: Date) => db.timeEntries.filter((entry) => inRange(entry.startedAt, from, to))
    .reduce((sum, entry) => sum + entry.durationSec + (!entry.endedAt ? Math.max(0, Math.floor((now.getTime() - Date.parse(entry.startedAt)) / 1000)) : 0), 0);
  const counted = (dates: (string | Date | null | undefined)[]) => withPrevious(period, dates.filter((value) => inRange(value, range.from, range.to)).length, dates.filter((value) => inRange(value, range.previousFrom, range.previousTo)).length);
  const deviations = async () => (await demoDeviationEntries(db, { id: ctx.user.id, admin: ctx.admin, team })).filter((entry) => !entry.personalDataRemovedAt);
  const today = swedishDayKey(now);
  switch (key) {
    case "work_orders_open": return { kind: "number", value: db.tasks.filter((task) => task.kind === "WORK_ORDER" && OPEN_TASK(task.status)).length };
    case "work_orders_by_status": return workOrderSeries(db.tasks.filter((task) => task.kind === "WORK_ORDER" && (OPEN_TASK(task.status) || inRange(task.completedAt, range.from, range.to)))
      .map((task) => workStateOf({ status: task.status, progress: workflowTaskProgress(task) })));
    case "tasks_overdue": return { kind: "number", value: readable.filter((task) => OPEN_TASK(task.status) && task.dueDate && task.dueDate < today)
      .filter((task) => workStateMatches({ status: task.status, progress: workflowTaskProgress(task), dueDate: task.dueDate, state: workStateOf({ status: task.status, progress: workflowTaskProgress(task) }) }, "overdue", today)).length };
    case "tasks_completed_week": return counted(readable.filter((task) => task.status === "COMPLETED").map((task) => task.completedAt));
    case "projects_active": return { kind: "number", value: db.projects.filter((project) => !project.archivedAt && !project.closedAt).length };
    case "deviations_open": return { kind: "number", value: (await deviations()).filter((entry) => entry.status !== "DONE").length };
    case "deviations_new": return counted((await deviations()).map((entry) => entry.createdAt));
    case "deviations_by_type": return deviationSeries((await deviations()).filter((entry) => inRange(entry.createdAt, range.from, range.to)).map((entry) => entry.type));
    case "deviations_latest": return { kind: "events", items: (await deviations()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20).map((entry) => {
      const type = DEVIATION_TYPES[deviationType(entry.type ?? "")];
      return { at: entry.createdAt, title: entry.title || type, level: (entry as { serious?: boolean }).serious ? "error" : entry.status === "DONE" ? "info" : "warning", detail: `${type}${entry.status === "DONE" ? " · Klar" : ""}` };
    }) };
    // The demo's rounds have no "not done" marks; a real company's are counted on the server.
    case "rounds_missed": return withPrevious(period, 0, 0);
    case "hours_week": {
      const expected = period === "week" ? db.users.reduce((sum, user) => sum + expectedWeeklyWorkMinutes(db.organization.weeklyWorkMinutes, user), 0) : 0;
      return { ...withPrevious(period, hours(seconds(range.from, range.to)), hours(seconds(range.previousFrom, range.previousTo))), unit: "h", ...(period === "week" ? { target: Math.round(expected / 6) / 10 } : {}) };
    }
    case "hours_by_week": {
      const monday = swedishMonday(now);
      const weeks = Array.from({ length: 8 }, (_, index) => addSwedishDays(monday, (index - 7) * 7));
      return { kind: "series", labels: weeks.map((start) => `v. ${isoWeekOf(start)}`), series: [{ name: "Timmar", values: weeks.map((start) => hours(seconds(start, addSwedishDays(start, 7)))) }], unit: "h" };
    }
    case "absence_today_count": return { kind: "number", value: new Set(absentToday(db, today).map((absence) => absence.userId)).size };
    case "absence_today": {
      const seen = new Set<string>();
      const rows = absentToday(db, today).filter((absence) => !seen.has(absence.userId) && seen.add(absence.userId)).map((absence) => ({
        person: db.users.find((user) => user.id === absence.userId)?.name ?? "Okänd",
        when: absence.hours ? `${absence.hours.start}–${absence.hours.end}` : absence.to === today ? "I dag" : `Till ${absence.to}`,
      })).sort((a, b) => a.person.localeCompare(b.person, "sv"));
      return { kind: "table", columns: [{ key: "person", label: "Person", type: "text" }, { key: "when", label: "När", type: "text" }], rows, total: rows.length };
    }
    case "planning_today": {
      const start = startOfSwedishDay(now);
      const end = addSwedishDays(start, 1);
      const rows = db.activities.filter((activity) => !activity.deletedAt && activity.status !== "CANCELED" && new Date(activity.startsAt) < end && new Date(activity.endsAt) > start)
        .filter((activity) => { const task = db.tasks.find((item) => item.id === activity.workflowTaskId); return task ? ctx.can(workflowSubjectForTask(task.kind), "read") : true; })
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 60)
        .map((activity) => ({
          time: `${swedishClock(new Date(activity.startsAt) < start ? start : activity.startsAt)}–${swedishClock(activity.endsAt)}`,
          title: db.tasks.find((task) => task.id === activity.workflowTaskId)?.title || activity.title,
          people: activity.assignments.length ? activity.assignments.map((item) => db.users.find((user) => user.id === item.userId)?.name ?? "").filter(Boolean).join(", ") : activity.assignedToName,
        }));
      return { kind: "table", columns: [{ key: "time", label: "Tid", type: "text" }, { key: "title", label: "Jobb", type: "text" }, { key: "people", label: "Vem", type: "text" }], rows, total: rows.length };
    }
    case "quotes_sent": return { kind: "number", value: demoQuoteFigures(ctx).filter((quote) => quote.status === "SENT").length };
    case "quotes_accepted": return counted(demoQuoteFigures(ctx).filter((quote) => quote.status === "ACCEPTED").map((quote) => quote.decidedAt));
    case "invoiced_amount": {
      const days = periodDays(period, now);
      const invoices = demoInvoiceFigures(ctx);
      const net = (from: string, to: string) => Math.round(invoices.filter((invoice) => invoice.issuedOn >= from && invoice.issuedOn < to).reduce((sum, invoice) => sum + invoiceNet(invoice), 0));
      return { ...withPrevious(period, net(days.from, days.to), net(days.previousFrom, days.previousTo)), unit: "kr" };
    }
    case "invoices_overdue": return { kind: "number", value: demoInvoiceFigures(ctx).filter((invoice) => invoice.kind === "INVOICE" && !invoice.paidOn && !invoice.credited && invoice.dueOn && invoice.dueOn < today).length };
    case "customers_new": return counted(db.customers.filter((customer) => !customer.deletedAt).map((customer) => (customer as { createdAt?: string }).createdAt ?? null));
    case "machine_status": { const figures = demoMachineFigures(maintenanceContext(ctx)); return machineStatusShape(figures.parts, figures.faults); }
    case "faults_open": return { kind: "number", value: demoMachineFigures(maintenanceContext(ctx)).faults.length };
    case "store_below_min": return storeBelowMinShape(demoMachineFigures(maintenanceContext(ctx)).store);
    // Nyheter (2026-11-21): the demo's invented posts (features/demo/demo-news.ts).
    case "news_latest": return demoNewsEvents(ctx);
  }
}

const absentToday = (db: DemoDatabase, today: string) => db.absences.filter((absence) => (absence.status ?? "APPROVED") === "APPROVED" && absence.from <= today && absence.to >= today);
const maintenanceContext = (ctx: DemoBoardsContext) => ({ db: ctx.db, user: ctx.user, admin: ctx.admin, now: ctx.now, can: (subject: "maintenance" | "catalogue" | "quotes" | "work-order", action: "read" | "edit") => ctx.can(subject, action) });
