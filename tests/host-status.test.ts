// Serveruppdateringar (2026-10-25): the status file from scripts/ops/host-status.sh read and judged for
// Installation → Drift och säkerhet → Servrar och uppdateringar, the superadmin's notices, and the route's checks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ENABLE_AUTOMATIC_FILE, ENABLE_AUTOMATIC_LINES, evaluateHostStatus, HOST_STATUS_STALE_HOURS, importantPackages, parseHostStatus,
  serverAlarmLines, serverPendingNotices, serverPendingState, serverStatusAccess, serverToastDue, serverUpdateNotices, serverUpdateToastText, serverViews, updateCommands, uptimeText,
} from "../lib/ops/host-status";
import { availableNoticeKinds, noticeKey, noticeKindsOf, noticesToSend, noticeStateText } from "../lib/workflow/notice-channels";
import { orderNotifications } from "../lib/workflow/task-notifications";

const read = (file: string) => readFileSync(file, "utf8");
const now = new Date("2026-10-25T10:00:00Z");

function file(overrides: Record<string, unknown> = {}) {
  return {
    schema: 1, host: "db-server", generatedAt: "2026-10-25T09:23:00Z", os: "Ubuntu 24.04.1 LTS",
    kernel: { running: "6.8.0-45-generic", newestInstalled: "6.8.0-45-generic", newerInstalled: false },
    uptimeSeconds: 1_900_000,
    updates: { listOk: true, pending: 0, security: 0, securityPackages: [], packages: [], securitySince: null, listsUpdatedAt: "2026-10-25T06:00:00Z", listsRefresh: null },
    reboot: { required: false, since: null, packages: [] },
    automatic: { effective: true, enable: "1", updatePackageLists: "1", unattendedUpgrade: "1", unattendedInstalled: true, timer: "enabled", zeroFiles: [], offSince: null },
    apt: { updateSuccess: "2026-10-25T06:00:00Z", update: null, downloadUpgradeable: null, upgrade: null, unattendedUpgrades: "2026-10-25T06:30:00Z" },
    ...overrides,
  };
}
const parse = (value: unknown) => {
  const status = parseHostStatus(JSON.stringify(value));
  assert.ok(status, "a valid status file");
  return status;
};

test("a status file is read; anything else is no status", () => {
  const status = parse(file());
  assert.equal(status.host, "db-server");
  assert.equal(status.automatic.effective, true);
  assert.equal(parseHostStatus("not json"), null);
  assert.equal(parseHostStatus(JSON.stringify(file({ schema: 2 }))), null, "an unknown schema");
  assert.equal(parseHostStatus(JSON.stringify(file({ host: "Hintek DB" }))), null, "a host name with other characters");
  assert.equal(parseHostStatus(JSON.stringify(file({ generatedAt: "igår" }))), null, "no time");
  assert.equal(parseHostStatus(" ".repeat(70_000)), null, "too large");
  // Broken parts do not break the whole file: they read as unknown, and a package name with other characters is dropped.
  const odd = parse(file({ updates: "x", kernel: null, uptimeSeconds: -5, reboot: { required: true, packages: ["linux-image-6.8", "<script>", "a b"] } }));
  assert.equal(odd.updates.pending, 0);
  assert.equal(odd.kernel.running, null);
  assert.equal(odd.uptimeSeconds, null);
  assert.deepEqual(odd.reboot.packages, ["linux-image-6.8"]);
});

test("the badges: updated, pending, security, restart, automatic off, and an old status is no fresh status", () => {
  assert.deepEqual(evaluateHostStatus("db-server", parse(file()), now).badges, ["UPDATED"]);
  assert.deepEqual(evaluateHostStatus("db-server", parse(file({ updates: { listOk: true, pending: 4, security: 0 } })), now).badges, ["PENDING"]);
  const security = evaluateHostStatus("db-server", parse(file({ updates: { listOk: true, pending: 3, security: 2, securityPackages: ["openssl", "linux-image-generic"], packages: [] } })), now);
  assert.deepEqual(security.badges, ["SECURITY", "PENDING"]);
  assert.deepEqual(security.important, ["linux-image-generic", "openssl"], "the kernel first");
  const reboot = evaluateHostStatus("db-server", parse(file({ reboot: { required: true, since: "2026-10-24T00:00:00Z", packages: ["libc6"] } })), now);
  assert.deepEqual(reboot.badges, ["REBOOT"]);
  const newerKernel = evaluateHostStatus("db-server", parse(file({ kernel: { running: "6.8.0-45-generic", newestInstalled: "6.8.0-47-generic", newerInstalled: true } })), now);
  assert.equal(newerKernel.rebootNeeded, true, "a newer installed kernel needs a restart even without the flag");
  // The fynd 2026-10-25: Hostup's file had switched them off on db-server.
  const hostup = evaluateHostStatus("db-server", parse(file({ automatic: { effective: false, enable: "1", updatePackageLists: "0", unattendedUpgrade: "0", unattendedInstalled: true, timer: "enabled", zeroFiles: ["99-hostup-disable-automatic-apt"], offSince: "2026-10-04T03:00:00Z" } })), now);
  assert.deepEqual(hostup.badges, ["AUTO_OFF"]);

  const old = new Date(Date.parse("2026-10-25T09:23:00Z") + (HOST_STATUS_STALE_HOURS + 1) * 3_600_000);
  const stale = evaluateHostStatus("db-server", parse(file({ updates: { listOk: true, pending: 3, security: 3 } })), old);
  assert.deepEqual(stale.badges, ["STALE"], "an old status says nothing about now");
  assert.equal(stale.fresh, false);
  assert.deepEqual(stale.alerts, [], "and gives no notices");
  assert.deepEqual(evaluateHostStatus("db-server", parse(file()), new Date(Date.parse("2026-10-25T09:23:00Z") + HOST_STATUS_STALE_HOURS * 3_600_000)).badges, ["UPDATED"], "26 hours is still fresh");
  assert.deepEqual(evaluateHostStatus("app-server", null, now).badges, ["STALE"], "no file");
  assert.deepEqual(evaluateHostStatus("db-server", parse(file({ generatedAt: "2026-10-27T00:00:00Z" })), now).badges, ["STALE"], "a time in the future is not trusted");
  assert.equal(evaluateHostStatus("db-server", parse(file({ updates: { listsUpdatedAt: "2026-10-20T00:00:00Z" } })), now).listsOld, true, "old package lists are said");
});

test("the notices: security or restart waiting more than three days, automatic updates off at once; one id per state", () => {
  const status = parse(file({
    updates: { listOk: true, pending: 2, security: 2, securityPackages: ["linux-image-generic", "openssl"], securitySince: "2026-10-21T04:00:00Z" },
    reboot: { required: true, since: "2026-10-22T04:00:00Z", packages: [] },
    automatic: { effective: false, zeroFiles: ["99-hostup-disable-automatic-apt"], offSince: "2026-10-04T03:00:00Z" },
  }));
  const view = evaluateHostStatus("db-server", status, now);
  assert.deepEqual(view.alerts.map((alert) => alert.kind), ["security", "auto-off"], "the restart has waited three days, not more");
  const notices = serverUpdateNotices([view]);
  assert.deepEqual(notices.map((notice) => notice.id), ["SERVER_UPDATES:db-server:security:2026-10-21", "SERVER_UPDATES:db-server:auto-off:2026-10-04"]);
  assert.match(notices[0].detail!, /2 säkerhetsuppdateringar sedan 2026-10-21 \(bl\.a\. linux-image-generic, openssl\)/);
  assert.match(notices[1].detail!, /99-hostup-disable-automatic-apt/);
  assert.equal(notices[0].href, "/?view=login_settings&section=servers");
  // The same state a day later is the same notice (sent once); a new state is a new one.
  const later = serverUpdateNotices([evaluateHostStatus("db-server", parse({ ...file(), ...status, generatedAt: "2026-10-26T09:00:00Z" }), new Date("2026-10-26T10:00:00Z"))]);
  assert.equal(noticeKey(later[0]), noticeKey(notices[0]), "security: the same key while the state holds");
  assert.ok(later.some((notice) => notice.id.startsWith("SERVER_UPDATES:db-server:reboot:")), "the restart is due after three days");
  assert.deepEqual(serverUpdateNotices([evaluateHostStatus("db-server", parse(file()), now)]), [], "nothing when all is well");

  // The notice kind is the superadmin's alone, off until chosen, and first in the bell with the other system notices.
  assert.deepEqual(noticeKindsOf(notices[0]), ["SERVER_UPDATES"]);
  assert.equal(availableNoticeKinds({ superadmin: false }).some((kind) => kind.key === "SERVER_UPDATES"), false);
  assert.equal(availableNoticeKinds({ superadmin: true }).some((kind) => kind.key === "SERVER_UPDATES"), true);
  assert.deepEqual(noticesToSend(notices, [], new Set()), [], "nothing chosen, nothing sent");
  assert.equal(noticesToSend(notices, ["SERVER_UPDATES"], new Set([noticeKey(notices[0])])).length, 1, "a notice already sent is not sent again");
  assert.equal(noticeStateText(notices[0], "2026-10-25"), "Sedan 2026-10-21");
  const urgent = { id: "WORK_ORDER:1", title: "Akut", kind: "WORK_ORDER" as const, href: "/", dueDate: "", deadline: null, needsAction: true, urgent: true };
  assert.equal(orderNotifications([urgent, notices[0]])[0].kind, "SERVER_UPDATES");
});

test("the cards: the expected servers in order (a missing file shows), then the others; the newest status per server", () => {
  const older = parse(file({ generatedAt: "2026-10-25T07:00:00Z", updates: { pending: 9 } }));
  const newer = parse(file());
  const other = parse(file({ host: "nas" }));
  const views = serverViews(["app-server", "db-server"], [older, other, newer], now);
  assert.deepEqual(views.map((view) => view.host), ["app-server", "db-server", "nas"]);
  assert.deepEqual(views[0].badges, ["STALE"]);
  assert.equal(views[1].status?.updates.pending, 0, "the newest file wins");
  assert.deepEqual(serverViews([], [], now), [], "Community without files: no cards");
});

test("the exact commands: the database server's re-read, the Hostup fix as a file sorted after the provider's", () => {
  const steps = updateCommands("db-server");
  const all = steps.map((step) => step.command).join("\n");
  assert.equal(steps[0].command, "ssh db-server");
  assert.match(all, /sudo apt update && sudo apt full-upgrade -y/);
  assert.match(all, /sudo systemctl reboot/);
  assert.equal(ENABLE_AUTOMATIC_FILE, "/etc/apt/apt.conf.d/99z-hintek-enable-automatic-apt");
  assert.ok("99z-hintek-enable-automatic-apt" > "99-hostup-disable-automatic-apt", "apt reads the files in order, so the later one wins");
  for (const line of ['APT::Periodic::Update-Package-Lists "1";', 'APT::Periodic::Unattended-Upgrade "1";', 'APT::Periodic::Enable "1";']) {
    assert.ok(ENABLE_AUTOMATIC_LINES.includes(line));
    assert.ok(all.includes(line));
  }
  assert.match(all, /HOST_LABEL=db-server OUT_DIR=\S+ scripts\/ops\/host-status\.sh/, "an installation without its own command gets the script in the repository");
  assert.match(updateCommands("app-server", { "app-server": "sudo own-status" }).map((step) => step.command).join("\n"), /^sudo own-status$/m, "the installation's own command for that server");
  assert.equal(uptimeText(1_900_000), "21 d 23 h");
  assert.equal(uptimeText(null), null);
  assert.deepEqual(importantPackages(["vim", "sudo", "linux-headers-6.8.0-47"]), ["linux-headers-6.8.0-47", "sudo"]);
});

test("the API is the superadmin's alone, read-only, never cached; the files are only read", () => {
  assert.deepEqual(serverStatusAccess(null), { ok: false, status: 401, message: "Logga in för att fortsätta." });
  assert.equal(serverStatusAccess({ role: "USER" }).ok, false);
  assert.equal((serverStatusAccess({ role: "USER" }) as { status: number }).status, 403);
  assert.deepEqual(serverStatusAccess({ role: "SUPERADMIN" }), { ok: true });
  const route = read("app/api/superadmin/server-updates/route.ts");
  assert.match(route, /signedInAuth\(\)/);
  assert.match(route, /serverStatusAccess\(auth\?\.user \?\? null\)/);
  assert.ok(route.indexOf("serverStatusAccess(") < route.indexOf("readServerViews()"), "the check comes before the read");
  assert.match(route, /private, no-store/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  const server = read("lib/ops/host-status-server.ts");
  assert.doesNotMatch(server, /writeFile|child_process|exec\(|spawn/, "the app never writes or runs anything for the servers");
  assert.match(server, /lstat/, "only regular files (no links)");
  // The bell and the notice job tell the superadmin only, never inside an API/MCP call.
  assert.match(read("app/api/task-notifications/route.ts"), /ctx\.user\.role === "SUPERADMIN" && !ctx\.integration \? await serverUpdateNoticeList\(\)/);
  assert.match(read("lib/workflow/notice-delivery.ts"), /if \(userRole === "SUPERADMIN" && memberships\[0\]\) \{[\s\S]*serverUpdateNoticeList\(now, \{ pending: false \}\)/);
});

test("the operations alarm: the same states as the notices, and every expected server without a fresh status", () => {
  const waiting = parse(file({ updates: { listOk: true, pending: 1, security: 1, securityPackages: ["openssl"], securitySince: "2026-10-20T04:00:00Z" } }));
  const old = parse(file({ host: "app-server", generatedAt: "2026-10-23T09:00:00Z" }));
  const lines = serverAlarmLines(serverViews(["app-server", "db-server", "spare"], [waiting, old], now));
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^db-server: säkerhetsuppdateringar väntar\. 1 säkerhetsuppdatering sedan 2026-10-20/);
  // Plain words, no file path (kundresa 2026-11-07, L71).
  assert.equal(lines[1], "app-server: ingen färsk status (49 h gammal). Kontrollera att statusjobbet på servern går.");
  assert.equal(lines[2], "spare: ingen status. Kontrollera att statusjobbet på servern går.");
  assert.deepEqual(serverAlarmLines(serverViews(["db-server"], [parse(file())], now)), [], "nothing when all is well");
  assert.deepEqual(serverAlarmLines(serverViews([], [], now)), [], "an installation that expects no servers");
  // keys:alerts mails the lines every morning while they last.
  const job = read("scripts/integrations/run-key-alerts.ts");
  assert.match(job, /serverAlarmLines\(await readServerViews\(now\)\)/);
  assert.match(job, /config\.delivery\.alerts && config\.alertEmail/);
});

test("Uppdateringar väntar: a bell notice per server and state, never mailed with the alarms, nothing for an old status", () => {
  const waiting = evaluateHostStatus("db-server", parse(file({ updates: { listOk: true, pending: 5, security: 1, securityPackages: ["openssl"], packages: [], securitySince: "2026-10-24T04:00:00Z" } })), now);
  const notices = serverPendingNotices([waiting]);
  assert.equal(notices.length, 1);
  assert.match(notices[0].id, /^SERVER_UPDATES:db-server:pending:[0-9a-f]{8}$/);
  assert.equal(notices[0].title, "db-server: uppdateringar väntar");
  assert.match(notices[0].detail!, /^Väntar: db-server: 5 uppdateringar \(1 säkerhet\)\./);
  assert.equal(notices[0].dueDate, "2026-10-24");
  // The same state an hour later is the same notice; one more security update is a new one; other updates growing is not.
  const later = evaluateHostStatus("db-server", parse(file({ generatedAt: "2026-10-25T09:50:00Z", updates: { listOk: true, pending: 7, security: 1, securityPackages: ["openssl"], packages: [] } })), now);
  assert.equal(serverPendingState(later), serverPendingState(waiting), "more ordinary updates: the same state");
  const more = evaluateHostStatus("db-server", parse(file({ updates: { listOk: true, pending: 6, security: 2, securityPackages: ["openssl", "sudo"], packages: [] } })), now);
  assert.notEqual(serverPendingState(more), serverPendingState(waiting), "new security updates: a new notice");
  const restart = evaluateHostStatus("db-server", parse(file({ reboot: { required: true, since: "2026-10-25T05:00:00Z", packages: [] } })), now);
  assert.match(serverPendingNotices([restart])[0].detail!, /db-server: omstart krävs/);
  assert.deepEqual(serverPendingNotices([evaluateHostStatus("db-server", parse(file()), now)]), [], "nothing waits");
  const old = new Date(Date.parse("2026-10-25T09:23:00Z") + (HOST_STATUS_STALE_HOURS + 1) * 3_600_000);
  // An old or missing status is told as unknown, once per last status (kundresa 2026-11-07, M45: the reminder went quiet).
  const stale = serverPendingNotices([evaluateHostStatus("db-server", parse(file({ updates: { listOk: true, pending: 3, security: 3 } })), old)]);
  assert.equal(stale.length, 1);
  assert.match(stale[0].id, /^SERVER_UPDATES:db-server:stale:\d{4}-\d{2}-\d{2}$/);
  assert.equal(stale[0].title, "db-server: läget är okänt");
  assert.deepEqual(serverPendingNotices([evaluateHostStatus("db-server", null, now)]), [], "never had a status: the page and the ops mail only");
  assert.match(serverAlarmLines([evaluateHostStatus("db-server", null, now)]).join(" "), /db-server: ingen status/, "the ops mail still tells it");
  assert.deepEqual(serverAlarmLines([waiting]), [], "the ops mail keeps to the alerts");
  assert.match(read("lib/workflow/notice-delivery.ts"), /serverUpdateNoticeList\(now, \{ pending: false \}\)/, "mail and push keep to the alerts");
});

test("the toast after signing in: what waits, the superadmin only, once per sign-in", () => {
  const app = evaluateHostStatus("app-server", parse(file({ host: "app-server", updates: { listOk: true, pending: 12, security: 1, securityPackages: ["openssl"], packages: [] } })), now);
  const db = evaluateHostStatus("db-server", parse(file({ updates: { listOk: true, pending: 5, security: 0 }, reboot: { required: true, since: null, packages: [] } })), now);
  const quiet = evaluateHostStatus("nas", parse(file({ host: "nas" })), now);
  const text = serverUpdateToastText([app, db, quiet]);
  assert.equal(text, "Serveruppdateringar väntar: app-server: 12 uppdateringar (1 säkerhet), db-server: 5 uppdateringar (omstart krävs).");
  assert.equal(serverUpdateToastText([quiet]), null, "nothing waits: no toast");
  assert.equal(serverUpdateToastText([evaluateHostStatus("app-server", parse(file({ host: "app-server" })), new Date(Date.parse("2026-10-25T09:23:00Z") + (HOST_STATUS_STALE_HOURS + 1) * 3_600_000))]), "Läget är okänt för app-server: ingen färsk status (27 h gammal).", "a status that stopped: told as unknown (M45)");
  assert.equal(serverUpdateToastText([evaluateHostStatus("app-server", null, now)]), null, "never had a status: no toast at every sign-in");
  const base = { role: "SUPERADMIN", viewAs: null, text, login: "1762412345", closed: null };
  assert.equal(serverToastDue(base), true);
  assert.equal(serverToastDue({ ...base, closed: "1762412345" }), false, "closed in this sign-in");
  assert.equal(serverToastDue({ ...base, closed: "1762400000" }), true, "a new sign-in shows it again");
  assert.equal(serverToastDue({ ...base, role: "USER" }), false, "never another role");
  assert.equal(serverToastDue({ ...base, role: null }), false);
  assert.equal(serverToastDue({ ...base, viewAs: "member" }), false, "not while previewing another role");
  assert.equal(serverToastDue({ ...base, text: null }), false);
  assert.equal(serverToastDue({ ...base, login: null }), false);
});

