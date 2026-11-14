import { asOwnTree, knownNodeIds, nodePath, visibleNodes, type MachineNode } from "@/lib/operator/machines";
import {
  callsOnCall, DEFAULT_CAUSES, faultReportInputSchema, INACTIVITY_DEFAULT, normalizeUsername, OPERATOR_LOCK_MINUTES, OPERATOR_LOCK_TRIES, operatorMachineStatus,
  operatorPasswordProblem, REPORT_STATUS_TONE, reportStatusLabel, SEVERITY_LABELS, type Intake, type Severity,
} from "@/lib/operator/rules";
import { troubleshootSuggestions } from "@/lib/operator/troubleshoot";
import type { OperatorApi, OperatorPageData } from "@/features/operator/operator-api";
import { OperatorApiError } from "@/features/operator/operator-api";

/**
 * Operatörssidan i den publika demon (2026-10-30): invented operator accounts, an invented machine tree and an
 * invented company, in this browser's memory only – nothing reaches the server and a reload starts over. The same rules as
 * the server (lib/operator/rules.ts): the password rules, five wrong tries lock an account for 15 minutes, a blocked account
 * is refused, an account sees only its machines, Akut (or Hög outside the workday) goes to the on-call person, who
 * acknowledges after a moment. Used by /operator/demo and by Administration › Operatörskonton in the demo.
 */
export const DEMO_OPERATOR_COMPANY = "Exempelfabriken AB";
export const DEMO_OPERATOR_PASSWORD = "Fabrik-Demo-7";
export const DEMO_OPERATOR_HINT = `Demo med påhittade konton. Logga in som Press 4, Linje 2 eller lisa.berg@exempelfabriken.se med lösenordet ${DEMO_OPERATOR_PASSWORD}. Inget sparas.`;
const ON_CALL_PERSON_MS = 4000;

const node = (id: string, name: string, parentId: string | null, objectType: string, reportable = true, operatingState = ""): MachineNode =>
  ({ id, name, parentId, objectType, reportable, alarmFacilityId: id, operatingState });

type DemoAccount = { id: string; username: string; kind: "password" | "microsoft"; shared: boolean; active: boolean; nodeIds: string[]; createdAt: string; lastLoginAt: string | null };
type DemoReport = { id: string; accountId: string; machineId: string; cause: string; text: string; severity: Severity; by: string; at: string; status: "received" | "pending" | "rejected"; workOrder: string; taskStatus: string; onCall: boolean; acknowledgedAt: string | null };

function createStore() {
  const tree: MachineNode[] = [
    node("m-fabrik", "Fabriken Mellanstad", null, "", false),
    node("m-linje2", "Linje 2", "m-fabrik", "Linje", false),
    node("m-press4", "Press 4", "m-linje2", "Press", true, "IN_SERVICE"),
    node("m-pump", "Hydraulpump", "m-press4", "Pump", true, "IN_SERVICE"),
    node("m-motor", "Huvudmotor", "m-press4", "Motor", true, "IN_SERVICE"),
    node("m-band", "Transportband 1", "m-linje2", "Transportband", true, "IN_SERVICE"),
    node("m-station", "Pumpstation 2", null, "", false),
    node("m-p1", "Pump P1", "m-station", "Pump", true, "OUT_OF_SERVICE"),
  ];
  const now = Date.now();
  const ago = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
  const accounts: DemoAccount[] = [
    { id: "op-press4", username: "Press 4", kind: "password", shared: true, active: true, nodeIds: ["m-press4"], createdAt: ago(400), lastLoginAt: ago(3) },
    { id: "op-linje2", username: "Linje 2", kind: "password", shared: true, active: true, nodeIds: ["m-linje2"], createdAt: ago(380), lastLoginAt: ago(26) },
    { id: "op-lisa", username: "lisa.berg@exempelfabriken.se", kind: "password", shared: false, active: true, nodeIds: ["m-fabrik", "m-station"], createdAt: ago(300), lastLoginAt: ago(50) },
    { id: "op-montering", username: "Avdelning Montering", kind: "password", shared: true, active: false, nodeIds: ["m-linje2"], createdAt: ago(200), lastLoginAt: null },
    { id: "op-elin", username: "Elin Ström", kind: "microsoft", shared: false, active: true, nodeIds: [], createdAt: ago(2), lastLoginAt: ago(2) },
  ];
  const reports: DemoReport[] = [
    { id: "r1", accountId: "op-press4", machineId: "m-pump", cause: "Läckage", text: "Droppar olja under pumpen.", severity: "NORMAL", by: "Ali", at: ago(30), status: "received", workOrder: "AO-1062", taskStatus: "IN_PROGRESS", onCall: false, acknowledgedAt: null },
    { id: "r2", accountId: "op-press4", machineId: "m-motor", cause: "Ovanligt ljud", text: "", severity: "LOW", by: "", at: ago(200), status: "received", workOrder: "AO-1049", taskStatus: "COMPLETED", onCall: false, acknowledgedAt: null },
    { id: "r3", accountId: "op-linje2", machineId: "m-band", cause: "Stannar", text: "Stannar ibland vid start.", severity: "HIGH", by: "Kim", at: ago(5), status: "pending", workOrder: "", taskStatus: "", onCall: false, acknowledgedAt: null },
  ];
  return {
    tree, accounts, reports, nextOrder: 1070,
    settings: { causes: [...DEFAULT_CAUSES] as string[], intake: "order" as Intake, inactivityMinutes: INACTIVITY_DEFAULT, aiTroubleshooting: false, pageKey: "demo",
      microsoft: { enabled: false, tenantId: null as string | null, groupId: null as string | null, groupName: "", consentAt: null as string | null, check: null as { ok: boolean; message: string; at: string } | null } },
    tries: new Map<string, { count: number; since: number }>(),
    signedIn: null as string | null,
  };
}
let store = createStore();

/** Demokopplingen (2026-11-04): the demo machine on the operator page, signed in as a terminal of its own, without a password. Only /operator/demo?demokoppling=1, only in this window's memory. */
export const DEMO_CONNECTION_MACHINE_ID = "m-flakt-f1";
export const DEMO_CONNECTION_ACCOUNT = "Demomaskinen";
export function enterDemoConnection() {
  if (!store.tree.some((item) => item.id === DEMO_CONNECTION_MACHINE_ID)) {
    store.tree.push(node("m-demomaskinen", "Demomaskinen", null, "", false), node(DEMO_CONNECTION_MACHINE_ID, "Fläkt F1", "m-demomaskinen", "Fläkt", true, "IN_SERVICE"));
    store.accounts.push({ id: "op-demokoppling", username: DEMO_CONNECTION_ACCOUNT, kind: "password", shared: true, active: true, nodeIds: ["m-demomaskinen", "m-fabrik"], createdAt: new Date().toISOString(), lastLoginAt: null });
    store.settings.inactivityMinutes = 480;
    store.settings.aiTroubleshooting = true;
  }
  store.signedIn = "op-demokoppling";
}
/** Unit tests: start over. */
export const resetDemoOperator = () => { store = createStore(); };

const WORKDAY = { startMinutes: 7 * 60, endMinutes: 16 * 60 };
const accountName = (account: DemoAccount) => account.username;

function pageData(account: DemoAccount, now = Date.now()): OperatorPageData {
  // The on-call person acknowledges a little while after the report (the demo's stand-in for "Jag tar den").
  for (const report of store.reports) if (report.onCall && !report.acknowledgedAt && now - Date.parse(report.at) >= ON_CALL_PERSON_MS) report.acknowledgedAt = new Date(Date.parse(report.at) + ON_CALL_PERSON_MS).toISOString();
  const visible = visibleNodes(store.tree, account.nodeIds);
  const open = (id: string) => store.reports.filter((report) => report.machineId === id && (report.status === "pending" || (report.status === "received" && report.taskStatus !== "COMPLETED" && report.taskStatus !== "CANCELLED"))).length;
  return {
    company: DEMO_OPERATOR_COMPANY, account: { name: accountName(account), shared: account.shared, kind: account.kind }, inactivityMinutes: store.settings.inactivityMinutes,
    causes: store.settings.causes, workday: WORKDAY, intake: store.settings.intake, ai: store.settings.aiTroubleshooting,
    machines: asOwnTree(visible).map((item) => ({ ...item, path: nodePath(store.tree, item.id), status: operatorMachineStatus({ openReports: open(item.id), operatingState: item.operatingState, runState: null }) })),
    reports: store.reports.filter((report) => report.accountId === account.id).sort((a, b) => b.at.localeCompare(a.at)).map((report) => {
      const status = reportStatusLabel(report.status, report.taskStatus || null);
      return {
        id: report.id, machine: nodePath(store.tree, report.machineId), cause: report.cause, severity: report.severity, severityLabel: SEVERITY_LABELS[report.severity], workOrder: report.workOrder, by: report.by,
        at: report.at, status, tone: REPORT_STATUS_TONE[status],
        onCall: !report.onCall ? { state: "none" as const } : report.acknowledgedAt ? { state: "acknowledged" as const, at: report.acknowledgedAt } : { state: "waiting" as const },
      };
    }),
  };
}

const signedInAccount = () => {
  const account = store.accounts.find((item) => item.id === store.signedIn && item.active);
  if (!account) throw new OperatorApiError(401, "Logga in igen.");
  return account;
};

/** The operator page's API in the demo. */
export const demoOperatorApi: OperatorApi = {
  async signIn({ username, password }) {
    const name = normalizeUsername(username);
    const key = name.ok ? name.key : username.trim().toLowerCase();
    const tries = store.tries.get(key);
    if (tries && tries.count >= OPERATOR_LOCK_TRIES && Date.now() - tries.since < OPERATOR_LOCK_MINUTES * 60_000) throw new OperatorApiError(429, `För många försök. Försök igen om ${OPERATOR_LOCK_MINUTES} minuter.`);
    const account = store.accounts.find((item) => item.kind === "password" && item.username.toLowerCase() === key);
    if (!account || password !== DEMO_OPERATOR_PASSWORD) {
      const next = { count: (tries && Date.now() - tries.since < OPERATOR_LOCK_MINUTES * 60_000 ? tries.count : 0) + 1, since: tries?.since && Date.now() - tries.since < OPERATOR_LOCK_MINUTES * 60_000 ? tries.since : Date.now() };
      store.tries.set(key, next);
      throw new OperatorApiError(next.count >= OPERATOR_LOCK_TRIES ? 429 : 401, next.count >= OPERATOR_LOCK_TRIES ? `För många försök. Försök igen om ${OPERATOR_LOCK_MINUTES} minuter.` : "Fel användarnamn eller lösenord.");
    }
    if (!account.active) throw new OperatorApiError(403, "Kontot är spärrat. Kontakta din administratör.");
    store.tries.delete(key);
    store.signedIn = account.id;
    account.lastLoginAt = new Date().toISOString();
    return { path: "/operator/demo" };
  },
  async logOut() { store.signedIn = null; },
  async load() { return pageData(signedInAccount()); },
  async send(draft) {
    const account = signedInAccount();
    const input = faultReportInputSchema.parse({ machineId: draft.machineId, cause: draft.cause, text: draft.text, severity: draft.severity, reporterName: draft.reporterName });
    const machine = visibleNodes(store.tree, account.nodeIds).find((item) => item.id === input.machineId && item.reportable);
    if (!machine) throw new OperatorApiError(404, "Maskinen finns inte bland dina maskiner.");
    if (!store.settings.causes.includes(input.cause)) throw new OperatorApiError(400, "Välj en orsak i listan.");
    const onCall = callsOnCall(input.severity, new Date(), WORKDAY);
    const pending = store.settings.intake === "approval" && !onCall;
    const workOrder = pending ? "" : `AO-${store.nextOrder++}`;
    const id = `r-${Date.now()}`;
    store.reports.push({ id, accountId: account.id, machineId: machine.id, cause: input.cause, text: input.text, severity: input.severity, by: account.shared ? input.reporterName : "", at: new Date().toISOString(),
      status: pending ? "pending" : "received", workOrder, taskStatus: pending ? "" : "PLANNED", onCall, acknowledgedAt: null });
    return { id, status: pending ? "pending" : "received", workOrder, onCall };
  },
  async troubleshoot({ machineId, cause }) {
    if (!store.settings.aiTroubleshooting) throw new OperatorApiError(404, "Finns inte.");
    const done = store.reports.filter((report) => report.machineId === machineId && report.taskStatus === "COMPLETED").map((report) => ({ label: report.workOrder, at: report.at, cause: report.cause, done: "Bytte tätning och fyllde på olja." }));
    return { suggestions: troubleshootSuggestions({ cause, history: { work: done, alarms: [] } }), note: "Bara ett förslag. Säkerhetsbeslut tas av en person." };
  },
};

// ---------- Administration › Operatörskonton in the demo (/api/operator-accounts) ----------

export class DemoOperatorError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function demoOperatorAdminView() {
  const tree = store.tree;
  return {
    settings: { organizationId: "demo", ...store.settings },
    pageUrl: `${typeof window === "undefined" ? "" : window.location.origin}/operator/demo`,
    product: { aiTroubleshooting: false },
    adapter: "demo",
    tree: tree.map((item) => ({ ...item, path: nodePath(tree, item.id) })),
    accounts: store.accounts.map((account) => {
      const chosen = knownNodeIds(tree, account.nodeIds);
      return { id: account.id, name: accountName(account), username: account.username, kind: account.kind, shared: account.shared, active: account.active, lastLoginAt: account.lastLoginAt, createdAt: account.createdAt, nodeIds: chosen,
        scopeLabel: chosen.length ? chosen.map((id) => nodePath(tree, id)).join(", ") : "inga maskiner", needsMachines: account.kind === "microsoft" && account.active && !chosen.length };
    }),
    pending: store.reports.filter((report) => report.status === "pending").map((report) => ({
      id: report.id, machine: nodePath(tree, report.machineId), cause: report.cause, text: report.text, severity: SEVERITY_LABELS[report.severity],
      by: report.by ? `${report.by} (${accountName(store.accounts.find((item) => item.id === report.accountId)!)})` : accountName(store.accounts.find((item) => item.id === report.accountId)!), at: report.at, photos: 0,
      status: "Väntar på godkännande", tone: "neutral",
    })),
  };
}

/** The admin's changes in the demo; Microsoft and Ny adress need a server and say so. */
export function demoOperatorAdminAction(input: Record<string, unknown>) {
  const find = (id: unknown) => { const account = store.accounts.find((item) => item.id === id); if (!account) throw new DemoOperatorError(404, "Operatörskontot hittades inte."); return account; };
  switch (input.action) {
    case "create": {
      const name = normalizeUsername(String(input.username ?? ""));
      if (!name.ok) throw new DemoOperatorError(400, name.error);
      const problem = operatorPasswordProblem(String(input.password ?? ""), { username: name.username, company: DEMO_OPERATOR_COMPANY });
      if (problem) throw new DemoOperatorError(400, problem);
      if (store.accounts.some((item) => item.username.toLowerCase() === name.key)) throw new DemoOperatorError(409, "Det finns redan ett operatörskonto med det namnet.");
      const id = `op-${Date.now()}`;
      store.accounts.push({ id, username: name.username, kind: "password", shared: !name.email, active: input.active !== false, nodeIds: knownNodeIds(store.tree, (input.nodeIds as string[] | undefined) ?? []), createdAt: new Date().toISOString(), lastLoginAt: null });
      return { id };
    }
    case "update": {
      const account = find(input.id);
      if (typeof input.active === "boolean") account.active = input.active;
      if (Array.isArray(input.nodeIds)) account.nodeIds = knownNodeIds(store.tree, input.nodeIds as string[]);
      return { ok: true };
    }
    case "password": {
      const account = find(input.id);
      const problem = operatorPasswordProblem(String(input.password ?? ""), { username: account.username, company: DEMO_OPERATOR_COMPANY });
      if (problem) throw new DemoOperatorError(400, problem);
      return { ok: true };
    }
    case "remove": store.accounts = store.accounts.filter((item) => item.id !== find(input.id).id); return { ok: true };
    case "settings":
      if (Array.isArray(input.causes)) store.settings.causes = (input.causes as string[]).map((item) => item.trim()).filter(Boolean);
      if (input.intake === "order" || input.intake === "approval") store.settings.intake = input.intake;
      if (typeof input.inactivityMinutes === "number") store.settings.inactivityMinutes = input.inactivityMinutes;
      return { ok: true };
    case "approve": case "reject": {
      const report = store.reports.find((item) => item.id === input.reportId && item.status === "pending");
      if (!report) throw new DemoOperatorError(404, "Felanmälan finns inte i godkännandelistan.");
      if (input.action === "reject") { report.status = "rejected"; return { workOrder: "" }; }
      report.status = "received"; report.taskStatus = "PLANNED"; report.workOrder = `AO-${store.nextOrder++}`;
      return { workOrder: report.workOrder };
    }
    default: throw new DemoOperatorError(403, "Microsoft och ny adress kräver en server och kan inte provas i demon.");
  }
}
