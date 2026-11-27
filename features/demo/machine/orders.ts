import { alarmKey, alarmNotifications, alarmRef } from "@/lib/machine/alarm-notice";
import { alarmOrderText, decideAlarm, SYSTEM_CREATOR, triggersOrder, type AlarmMode } from "@/lib/machine/alarm-rules";
import { faultOrderText } from "@/lib/operator/rules";
import { isTaskOpen } from "@/lib/workflow/task-cancel";
import { workflowTaskProgress } from "@/lib/workflow/task-model";
import type { DemoDatabase, DemoTask } from "../demo-data";
import { HUMAN_DECIDES_TEXT, ORIGIN_LABELS, SIMULATED_ON_CALL_TEXT, SIMULATION_MARK } from "./rules";
import type { DemoFaultReport, Diagnosis, OrderOutcome } from "./protocol";

// Demokopplingen: an alarm becomes a marked work order in the demo's memory, by the product's own rules (lib/machine/alarm-rules.ts): only
// a new alarm of level fault or critical counts, the source's mode, the rest after each order, the daily cap, and one open order per
// source. The order is made by "Maskinlarm", is only Planerad and is never closed by the system. What differs from the product is the
// simulated AI's basis and suggestions, added to the description and marked.

type OrderRow = { taskId: string; at: number };
type Notice = { key: string; createdAt: Date; alarm: { sourceName: string; text: string; code: string }; taskId: string };
type Store = { rows: OrderRow[]; notices: Notice[]; restSkippedAt: number };
const stores = new WeakMap<DemoDatabase, Store>();
const storeOf = (db: DemoDatabase) => { let store = stores.get(db); if (!store) { store = { rows: [], notices: [], restSkippedAt: 0 }; stores.set(db, store); } return store; };

export type DemoSourceFacts = { id: string; name: string; alarmMode: AlarmMode; cooldownMinutes: number };
export type DemoAlarm = { type: string; code: string; severity: string; state: string | null; text: string; occurredAt: Date };

const SKIP_TEXT = {
  mode_off: "Ingen arbetsorder: källan står på Av.",
  daily_cap: "Ingen arbetsorder: dygnets tak är nått.",
  open_order: "Ingen ny arbetsorder: källan har redan en öppen order.",
} as const;

const diagnosisBlock = (diagnosis: Diagnosis | null) => {
  if (!diagnosis) return "";
  const suggestions = diagnosis.candidates.map((item, index) => `${index + 1}. ${item.text} (${ORIGIN_LABELS[item.origin]})`).join("\n");
  return [
    `${SIMULATION_MARK}. Underlag: ${[...diagnosis.observed, ...diagnosis.mapping].join(" ")}`,
    suggestions ? `Förslag:\n${suggestions}` : "",
    HUMAN_DECIDES_TEXT,
  ].filter(Boolean).join("\n\n");
};

function makeOrder(db: DemoDatabase, source: DemoSourceFacts, alarm: DemoAlarm, diagnosis: Diagnosis | null, now: Date) {
  const text = alarmOrderText({ sourceName: source.name, code: alarm.code, severity: alarm.severity, text: alarm.text, occurredAt: alarm.occurredAt });
  return addOrder(db, text.title, [text.description, diagnosisBlock(diagnosis)].filter(Boolean).join("\n\n"), SYSTEM_CREATOR, now);
}

function addOrder(db: DemoDatabase, title: string, description: string, creator: string, now: Date) {
  const at = now.toISOString();
  db.sequence += 1;
  const task: DemoTask = {
    id: `demo-task-machine-${db.sequence}`, kind: "WORK_ORDER", title, description: description.slice(0, 5000), status: "PLANNED",
    projectId: null, customerId: null, facilityId: null, assignedToUserId: null, assignedToName: "", dueDate: "",
    data: { kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" }, riskStep: true } as DemoTask["data"],
    version: 1, startedAt: null, completedAt: null, createdBy: creator, updatedBy: creator, createdAt: at, updatedAt: at, revisions: [],
  };
  task.revisions = [{ id: `demo-revision-machine-${db.sequence}`, version: 1, createdAt: at, snapshot: { ...task, revisions: undefined, progress: workflowTaskProgress(task as Parameters<typeof workflowTaskProgress>[0]) } }];
  db.tasks.unshift(task);
  return task;
}

/** What an alarm from the demo's source becomes. Same order of checks as lib/machine/alarm-orders.ts. */
export function considerDemoAlarm(db: DemoDatabase, source: DemoSourceFacts, alarm: DemoAlarm, diagnosis: Diagnosis | null, now: Date): OrderOutcome {
  if (!triggersOrder(alarm)) {
    return { kind: "none", text: alarm.state === "cleared" ? "Larmet släcktes. Det stänger ingen order." : alarm.type === "alarm" ? "Bara fel och kritiska larm ger en arbetsorder." : "Ger ingen arbetsorder." };
  }
  const store = storeOf(db);
  const taskOf = (taskId: string) => db.tasks.find((task) => task.id === taskId);
  const last = store.rows[store.rows.length - 1] ?? null;
  const rowsToday = store.rows.filter((row) => now.getTime() - row.at < 86_400_000).length;
  const lastRowAt = last && last.at > store.restSkippedAt ? new Date(last.at) : null;
  const decision = decideAlarm({ mode: source.alarmMode, now, cooldownMinutes: source.cooldownMinutes, lastRowAt, rowsToday });
  if (decision.act === "skip") {
    if (decision.reason === "cooldown") {
      const open = last ? taskOf(last.taskId) : null;
      if (open && isTaskOpen(open.status)) return { kind: "skipped", reason: "open_order", taskId: open.id, text: SKIP_TEXT.open_order };
      return { kind: "skipped", reason: "cooldown", taskId: last?.taskId ?? null, text: `Ingen ny arbetsorder: ${source.cooldownMinutes} min vila efter förra ordern.` };
    }
    return { kind: "skipped", reason: decision.reason, taskId: null, text: SKIP_TEXT[decision.reason] };
  }
  const open = store.rows.map((row) => taskOf(row.taskId)).find((task) => task && isTaskOpen(task.status));
  if (open) return { kind: "skipped", reason: "open_order", taskId: open.id, text: SKIP_TEXT.open_order };
  const task = makeOrder(db, source, alarm, diagnosis, now);
  store.rows.push({ taskId: task.id, at: now.getTime() });
  store.notices.push({ key: alarmKey(alarmRef({ taskId: task.id }), source.id), createdAt: now, alarm: { sourceName: source.name, text: alarm.text, code: alarm.code }, taskId: task.id });
  return { kind: "created", taskId: task.id, title: task.title };
}

/** The creator the product's fault reports have (lib/operator/maintenance-adapter.ts, which needs the database and so cannot be imported here; tests/demo-machine.test.ts holds them equal). */
export const DEMO_FAULT_CREATOR = "system:operator-fault";
export const DEMO_MACHINE_CREATORS: readonly string[] = [SYSTEM_CREATOR, DEMO_FAULT_CREATOR];

/** A fault report's work order, with the product's own title and text. What is added for the demo stands after it and is marked. An on-call notice is only a row in the demo's bell. */
export function makeDemoFaultOrder(db: DemoDatabase, report: DemoFaultReport, plcAlarm: string | null, diagnosis: Diagnosis | null, now: Date) {
  const text = faultOrderText({ machineLabel: report.machineLabel, cause: report.cause, text: report.text, severity: report.severity, reporter: report.reporter, accountName: report.accountName, label: report.label });
  const task = addOrder(db, text.title, [
    text.description,
    plcAlarm ? `I demon visas också maskinens senaste larm från PLC:n: ${plcAlarm}` : "",
    report.onCall ? SIMULATED_ON_CALL_TEXT : "",
    diagnosisBlock(diagnosis),
  ].filter(Boolean).join("\n\n"), DEMO_FAULT_CREATOR, now);
  if (report.onCall) storeOf(db).notices.push({ key: alarmKey(alarmRef({ taskId: task.id }), `fault-${report.id}`), createdAt: now, alarm: { sourceName: report.machineLabel, text: `Felanmälan, simulerad jour: ${report.cause}`, code: report.label }, taskId: task.id });
  return task;
}

/** The bell's rows, by the product's own function: gone when somebody has taken the order or it is finished. */
export function demoMachineNotices(db: DemoDatabase, canAck: boolean) {
  const store = stores.get(db);
  if (!store) return [];
  return alarmNotifications(store.notices.map((notice) => {
    const task = db.tasks.find((item) => item.id === notice.taskId);
    return { key: notice.key, createdAt: notice.createdAt, alarm: notice.alarm, pendingOpen: false, task: task ? { id: task.id, assignedToUserId: task.assignedToUserId, status: task.status, dueDate: task.dueDate } : null };
  }), { canAck });
}

/** The demo's own shortcut past the rest, so a visitor need not wait. It is said on the page. */
export function skipDemoRest(db: DemoDatabase, now: Date) { storeOf(db).restSkippedAt = now.getTime(); }

/** A person's answer on the order: what the fault was, as a line in the description. */
export function noteCauseOnOrder(db: DemoDatabase, taskId: string, cause: string, now: Date) {
  const task = db.tasks.find((item) => item.id === taskId);
  if (!task) return;
  task.description = `${task.description}\n\nOrsak enligt en människa: ${cause}`.slice(0, 5000);
  task.updatedAt = now.toISOString();
}

/** Färdigställd in the demo's shortcut: the order stops being open, so the next alarm may make a new one. */
export function finishDemoOrder(db: DemoDatabase, taskId: string, now: Date) {
  const task = db.tasks.find((item) => item.id === taskId);
  if (!task || !isTaskOpen(task.status)) return;
  const at = now.toISOString();
  task.status = "COMPLETED";
  task.completedAt = at;
  task.updatedAt = at;
}
