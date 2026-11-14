import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  ALARM_SAFETY_TEXT, alarmContactsInput, alarmNoticeAllowed, alarmSettingsInput, DEFAULT_ALARM_HOURS, DEFAULT_ESCALATION_MINUTES, escalationDue, escalationSteps, escalationSummary, isNight,
} from "../lib/machine/alarm-escalation";
import { DAY_SUMMARY_MONTHS, durationText, FIGURE_REASON_TEXT, keyFigureRows, machineKeyFigures, MIN_SAMPLES, summariseSpan, type OrderFacts } from "../lib/machine/key-figures";
import { noticePreferenceInput } from "../lib/workflow/notice-channels";
import { alarmDeviationActionSchema, alarmDeviationText } from "../lib/machine/alarm-deviation";

// Integrationsmotorn E6 (2026-10-24, plan avsnitt 7; beslut 2026-10-18): ansvarig och ersättare per objekt med
// eskalering, larmnotiser dygnet runt bara med företagets och personens ja, dygnssammanfattning och nyckeltal.

const at = (iso: string) => new Date(iso);

test("the steps: responsible, then deputy, then everyone else; without contacts only everyone, as before E6", () => {
  assert.deepEqual(escalationSteps({ responsible: null, deputy: null, everyone: ["b", "a"] }), [{ kind: "everyone", userIds: ["a", "b"] }]);
  assert.deepEqual(escalationSteps({ responsible: "r", deputy: "d", everyone: ["a", "r", "d"] }), [
    { kind: "responsible", userIds: ["r"] }, { kind: "deputy", userIds: ["d"] }, { kind: "everyone", userIds: ["a"] },
  ], "nobody is told twice: the responsible and the deputy are not in the last step again");
  assert.deepEqual(escalationSteps({ responsible: null, deputy: "d", everyone: ["a"] }), [{ kind: "deputy", userIds: ["d"] }, { kind: "everyone", userIds: ["a"] }]);
  assert.deepEqual(escalationSteps({ responsible: "r", deputy: "r", everyone: ["r"] }), [{ kind: "responsible", userIds: ["r"] }], "a step with nobody new is left out");
  assert.deepEqual(escalationSteps({ responsible: null, deputy: null, everyone: [] }), []);
});

test("the next step comes after the company's minutes without an acknowledgement, one step at a time", () => {
  const lastAt = at("2026-10-24T10:00:00Z");
  assert.equal(escalationDue({ step: 0, lastAt, now: at("2026-10-24T10:14:59Z"), minutes: 15, steps: 3 }), null);
  assert.equal(escalationDue({ step: 0, lastAt, now: at("2026-10-24T10:15:00Z"), minutes: 15, steps: 3 }), 1);
  assert.equal(escalationDue({ step: 0, lastAt, now: at("2026-10-24T12:00:00Z"), minutes: 15, steps: 3 }), 1, "a job that was away does not take every step at once");
  assert.equal(escalationDue({ step: 2, lastAt, now: at("2026-10-25T10:00:00Z"), minutes: 15, steps: 3 }), null, "the last step is the last");
  assert.equal(escalationDue({ step: 0, lastAt, now: at("2026-10-25T10:00:00Z"), minutes: 15, steps: 1 }), null, "without contacts there is nothing to escalate to");
  assert.equal(DEFAULT_ESCALATION_MINUTES, 15);
});

test("night is 20–06 Swedish time, in summer and in winter", () => {
  assert.equal(isNight(at("2026-06-15T17:59:00Z")), false, "19:59 summer time");
  assert.equal(isNight(at("2026-06-15T18:00:00Z")), true, "20:00 summer time");
  assert.equal(isNight(at("2026-06-15T03:59:00Z")), true, "05:59 summer time");
  assert.equal(isNight(at("2026-06-15T04:00:00Z")), false, "06:00 summer time");
  assert.equal(isNight(at("2026-12-15T18:59:00Z")), false, "19:59 winter time");
  assert.equal(isNight(at("2026-12-15T19:00:00Z")), true, "20:00 winter time");
  assert.equal(isNight(at("2026-12-15T05:00:00Z")), false, "06:00 winter time");
  assert.equal(isNight(at("2026-10-25T01:30:00Z")), true, "the repeated hour in October");
});

test("e-mail and push at night only when the company chose around the clock and the person said yes; nothing is on by default", () => {
  const day = at("2026-10-24T08:00:00Z");
  const night = at("2026-10-24T23:00:00Z");
  assert.equal(DEFAULT_ALARM_HOURS, "day");
  assert.equal(alarmNoticeAllowed({ now: day, hours: "day", personNight: false }), true);
  assert.equal(alarmNoticeAllowed({ now: night, hours: "day", personNight: true }), false, "the company's default keeps the night quiet (morning list)");
  assert.equal(alarmNoticeAllowed({ now: night, hours: "always", personNight: false }), false, "the person's own yes is needed");
  assert.equal(alarmNoticeAllowed({ now: night, hours: "always", personNight: true }), true);
  assert.equal(alarmNoticeAllowed({ now: night, hours: "bogus", personNight: true }), false);
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  assert.match(schema, /machineAlarmHours\s+String\s+@default\("day"\)/);
  assert.match(schema, /machineAlarmNight\s+Boolean\s+@default\(false\)/);
});

test("what the admin may save, and the person's own night choice", () => {
  assert.equal(alarmSettingsInput.safeParse({ hours: "always", escalationMinutes: 15 }).success, true);
  assert.equal(alarmSettingsInput.safeParse({ hours: "always", escalationMinutes: 4 }).success, false);
  assert.equal(alarmSettingsInput.safeParse({ hours: "always", escalationMinutes: 241 }).success, false);
  assert.equal(alarmSettingsInput.safeParse({ hours: "night", escalationMinutes: 15 }).success, false);
  assert.equal(alarmContactsInput.safeParse({ partId: "f", responsibleUserId: "u", deputyUserId: "u" }).success, false, "two different people");
  assert.equal(alarmContactsInput.safeParse({ partId: "f", responsibleUserId: null, deputyUserId: null }).success, true, "clearing both is allowed");
  assert.equal(noticePreferenceInput.safeParse({ email: true, kinds: ["MACHINE_ALARM"] }).success, true, "an older page without the night field still saves");
  assert.equal(noticePreferenceInput.parse({ email: true, kinds: [], machineAlarmNight: true }).machineAlarmNight, true);
});

test("the summary in words", () => {
  assert.match(escalationSummary({ responsible: null, deputy: null, minutes: 15 }), /alla som får maskinlarm får larmet direkt/);
  assert.equal(escalationSummary({ responsible: "Anna", deputy: "Bertil", minutes: 15 }), "Anna först, Bertil efter 15 minuter utan kvittens, alla som får maskinlarm efter 30 minuter.");
  assert.equal(escalationSummary({ responsible: "Anna", deputy: null, minutes: 10 }), "Anna först, alla som får maskinlarm efter 10 minuter utan kvittens.");
  assert.match(ALARM_SAFETY_TEXT, /inget larm- eller säkerhetssystem och lovar ingen leveranstid/);
});

test("a day in numbers: alarms, faults, stops and minutes stopped from the machine's own run state", () => {
  const from = at("2026-10-23T22:00:00Z");
  const to = at("2026-10-24T22:00:00Z");
  const events = [
    { at: at("2026-10-24T01:00:00Z"), type: "alarm", state: "raised", severity: "fault" },
    { at: at("2026-10-24T01:05:00Z"), type: "state", state: "stopped", severity: "info" },
    { at: at("2026-10-24T02:05:00Z"), type: "state", state: "running", severity: "info" },
    { at: at("2026-10-24T03:00:00Z"), type: "alarm", state: "cleared", severity: "fault" },
    { at: at("2026-10-24T04:00:00Z"), type: "alarm", state: "raised", severity: "warning" },
    { at: at("2026-10-24T21:00:00Z"), type: "state", state: "stopped", severity: "info" },
    { at: at("2026-10-24T21:30:00Z"), type: "state", state: "stopped", severity: "info" },
    { at: at("2026-10-25T01:00:00Z"), type: "alarm", state: "raised", severity: "critical" },
  ];
  assert.deepEqual(summariseSpan({ events, startState: null, from, to }), { events: 7, alarms: 2, faults: 1, stops: 2, stoppedMinutes: 120, endState: "stopped" },
    "60 minutes stopped plus the last hour; a second stopped is not a new stop; outside the day is not counted");
  assert.deepEqual(summariseSpan({ events: [], startState: "stopped", from, to }), { events: 0, alarms: 0, faults: 0, stops: 0, stoppedMinutes: 1440, endState: "stopped" }, "a machine stopped all day");
  assert.equal(summariseSpan({ events: [], startState: null, from, to }).endState, null);
  assert.equal(DAY_SUMMARY_MONTHS, 24);
});

const order = (created: string, extra: Partial<OrderFacts> = {}): OrderFacts => ({ createdAt: at(created), decidedAt: at(created), acknowledgedAt: null, completedAt: null, stoppedAt: null, restoredAt: null, ...extra });

test("key figures: medians, mean repair time, frequency and MTBF, and why a figure cannot be counted", () => {
  const now = at("2026-10-24T12:00:00Z");
  const empty = machineKeyFigures({ now, periodDays: 90, firstDataAt: null, totals: { events: 0, alarms: 0, faults: 0, stops: 0, stoppedMinutes: 0, hasState: false }, orders: [] });
  assert.equal(empty.ackMinutes.reason, "no_data");
  assert.equal(empty.mtbfHours.reason, "no_data");
  assert.equal(empty.downtimeMinutes.reason, "no_data");

  const young = machineKeyFigures({ now, periodDays: 90, firstDataAt: at("2026-10-21T12:00:00Z"), totals: { events: 10, alarms: 2, faults: 2, stops: 1, stoppedMinutes: 30, hasState: true }, orders: [order("2026-10-22T10:00:00Z")] });
  assert.equal(young.coverageDays, 3);
  assert.equal(young.partialPeriod, true);
  assert.equal(young.ordersPer30Days.reason, "too_little_data", "three days are too few for a rate");
  assert.equal(young.mtbfHours.reason, "too_little_data");
  assert.equal(young.ackMinutes.reason, "too_little_data");
  assert.equal(young.downtimeMinutes.value, 30);

  const orders = [
    order("2026-09-01T10:00:00Z", { acknowledgedAt: at("2026-09-01T10:10:00Z"), completedAt: at("2026-09-01T14:00:00Z"), stoppedAt: "2026-09-01T09:58:00Z", restoredAt: "2026-09-01T11:58:00Z" }),
    order("2026-09-15T10:00:00Z", { acknowledgedAt: at("2026-09-15T10:30:00Z"), completedAt: at("2026-09-15T12:00:00Z"), stoppedAt: "2026-09-15T10:00:00Z", restoredAt: "2026-09-15T11:00:00Z" }),
    order("2026-10-01T10:00:00Z", { acknowledgedAt: at("2026-10-01T10:05:00Z"), completedAt: at("2026-10-02T10:00:00Z"), stoppedAt: "2026-10-01T10:00:00Z", restoredAt: "2026-10-01T13:00:00Z" }),
    order("2026-10-20T10:00:00Z"),
  ];
  const figures = machineKeyFigures({ now, periodDays: 90, firstDataAt: at("2026-07-01T00:00:00Z"), totals: { events: 500, alarms: 6, faults: 4, stops: 3, stoppedMinutes: 360, hasState: true }, orders });
  assert.equal(figures.coverageDays, 90);
  assert.equal(figures.partialPeriod, false);
  assert.equal(figures.orders, 4);
  assert.deepEqual(figures.ackMinutes, { value: 10, samples: 3, reason: null }, "median of 10, 30 and 5 minutes");
  assert.deepEqual(figures.doneMinutes, { value: 240, samples: 3, reason: null }, "median of 240, 120 and 1 440 minutes");
  assert.deepEqual(figures.repairMinutes, { value: 120, samples: 3, reason: null }, "mean of 120, 60 and 180 minutes");
  assert.deepEqual(figures.ordersPer30Days, { value: 1.3, samples: 4, reason: null });
  assert.equal(figures.mtbfHours.value, Math.round(((90 * 1440 - 360) / 4 / 60) * 10) / 10);
  assert.equal(MIN_SAMPLES, 3);

  const noState = machineKeyFigures({ now, periodDays: 30, firstDataAt: at("2026-09-01T00:00:00Z"), totals: { events: 5, alarms: 1, faults: 1, stops: 0, stoppedMinutes: 0, hasState: false }, orders: [] });
  assert.equal(noState.downtimeMinutes.reason, "no_state", "a machine that sends no run state has no downtime of its own");
  const rows = keyFigureRows(noState);
  assert.equal(rows.find((row) => row.key === "downtime")!.value, FIGURE_REASON_TEXT.no_state);
  assert.equal(rows.find((row) => row.key === "ack")!.value, "För lite data");
  assert.equal(rows.find((row) => row.key === "alarms")!.value, "1");
});

test("durations in short words", () => {
  assert.equal(durationText(0), "0 min");
  assert.equal(durationText(45), "45 min");
  assert.equal(durationText(60), "1 h");
  assert.equal(durationText(200), "3 h 20 min");
  assert.equal(durationText(1440 * 2 + 240), "2 d 4 h");
});

test("the server: confirmation within 15 minutes, Origin and the admin before the changes; the bell's chain is reused", () => {
  const handler = readFileSync("lib/api-handlers/machine-sources.ts", "utf8");
  const confirmed = /const CONFIRMED_ACTIONS = new Set\(\[([^\]]+)\]\)/.exec(handler)?.[1] ?? "";
  for (const action of ["set_alarm_settings", "set_alarm_contacts"]) assert.match(confirmed, new RegExp(`"${action}"`), action);
  const post = handler.slice(handler.indexOf("export async function POST"));
  assert.ok(post.indexOf("checkOrigin(request)") < post.indexOf("await admin()"));
  assert.ok(post.indexOf("requireFreshAuth(ctx.user.id, ctx.auth, MACHINE_CONFIRM_WINDOW_SECONDS)") < post.indexOf("isAlarmCommand(input)"));
  const admin = readFileSync("lib/machine/alarm-responsibility-admin.ts", "utf8");
  assert.match(admin, /machinePart\.findFirst\(\{ where: \{ id: value\.partId, organizationId \}/, "the machine part is the company's own");
  assert.match(admin, /member\.admin \|\| member\.canReadWorkOrders/, "only members who may read work orders");
  const notices = readFileSync("app/api/notice-settings/route.ts", "utf8");
  assert.match(notices, /where: \{ userId: user\.id \}/, "the night choice is only ever the person's own row");
  const store = readFileSync("lib/machine/alarm-notice-store.ts", "utf8");
  assert.match(store, /acknowledgedAt: null \}, data: \{ acknowledgedAt: new Date\(\), acknowledgedById: input\.userId \}/, "Jag tar den keeps the first acknowledgement");
  const delivery = readFileSync("lib/machine/alarm-delivery.ts", "utf8");
  assert.match(delivery, /kinds: \["MACHINE_ALARM"\]/, "around the clock only for machine alarms");
  assert.match(readFileSync("lib/workflow/notice-delivery.ts", "utf8"), /noticeKindsOf\(item\)\.some\(\(kind\) => only\.kinds\.includes\(kind\)\)/);
  const parts = readFileSync("lib/maintenance/machine-server.ts", "utf8");
  assert.match(parts, /export async function partMachineKeyFigures[\s\S]*?await subtree\(caller, partId\)/, "the key figures need the Underhåll right (subtree checks it)");
});

test("the migration is additive, the job is in the four lists, the summary is pruned after 24 months, no manufacturer", () => {
  const sql = readFileSync("prisma/migrations/20261024210000_machine_alarm_escalation/migration.sql", "utf8");
  assert.doesNotMatch(sql, /^\s*(DELETE|UPDATE|TRUNCATE|DROP)\b/im);
  assert.match(sql, /FOREIGN KEY \("organizationId", "userId"\) REFERENCES "OrganizationMember"\("organizationId", "userId"\) ON DELETE CASCADE/);
  assert.match(sql, /FOREIGN KEY \("facilityId", "organizationId"\) REFERENCES "CustomerFacility"\("id", "organizationId"\) ON DELETE CASCADE/);
  assert.match(sql, /CHECK \("machineAlarmHours" IN \('day', 'always'\) AND "machineEscalationMinutes" BETWEEN 5 AND 240\)/);
  assert.match(sql, /CHECK \("role" IN \('responsible', 'deputy'\)\)/);
  assert.match(readFileSync("scripts/ops/run-job.sh", "utf8"), /\|machine:alarms\) ;;/);
  assert.match(readFileSync("package.json", "utf8"), /"machine:alarms": "tsx scripts\/ops\/job\.ts machine:alarms scripts\/machine\/run-alarms\.ts"/);
  if (existsSync("ops/cron/hintek-workflow")) assert.match(readFileSync("ops/cron/hintek-workflow", "utf8"), /^\*\/5 \* \* \* \*\s+root .*run-job\.sh machine:alarms$/m);
  assert.match(readFileSync("lib/workflow/system-cleanup.ts", "utf8"), /machineDaySummary\.deleteMany/);
  const retention = readFileSync("scripts/history/run-retention.ts", "utf8");
  assert.ok(retention.indexOf("summariseMachineDays") < retention.indexOf("await pruneSystemLogs"), "the days are counted before the events are pruned");
  for (const path of ["lib/machine/alarm-escalation.ts", "lib/machine/alarm-escalation-store.ts", "lib/machine/alarm-delivery.ts", "lib/machine/key-figures.ts", "lib/machine/key-figures-server.ts",
    "lib/machine/day-summary-store.ts", "lib/machine/alarm-responsibility-admin.ts", "features/integrations/machine-alarm-responsibility.tsx"])
    assert.doesNotMatch(readFileSync(path, "utf8"), /teltonika|rutos|rut200|siemens|schneider/i, path);
  assert.match(readFileSync("features/integrations/machine-alarm-responsibility.tsx", "utf8"), /data\.safety/, "the page says Workflow is not an alarm or safety system");
});

test("Skapa avvikelse: the entry's text and class from the alarm, and the server's checks", () => {
  const text = alarmDeviationText({ orderTitle: "Larm: Motor 2 överström", sourceName: "PLC hall 1", code: "E12", severity: "critical", text: "Motor 2\növerström", occurredAt: "2026-10-24 10:00" });
  assert.equal(text.title, "Larm: Motor 2 överström");
  assert.equal(text.category, "IMMEDIATE", "a critical alarm is Omedelbar åtgärd");
  assert.match(text.description, /^Från ett maskinlarm: PLC hall 1, kod E12 \(kritiskt\), 2026-10-24 10:00\.\nMaskinens text: Motor 2 överström/);
  assert.equal(alarmDeviationText({ orderTitle: "", sourceName: "", code: "E1", severity: "fault", text: "", occurredAt: "x" }).category, "ROUTINE");
  assert.equal(alarmDeviationActionSchema.safeParse({ action: "create_deviation_from_alarm", taskId: "" }).success, false);
  const server = readFileSync("lib/machine/alarm-deviation-server.ts", "utf8");
  assert.match(server, /selfInspectionAccess\(\{ active: true, admin: ctx\.admin \}\)\.reportDeviation/, "only those who may report deviations");
  assert.match(server, /if \(!canReadMachineEvents\(ctx\)\) throw new ApiError\(403/);
  assert.match(server, /createdBy: SYSTEM_CREATOR/, "only an automatic order");
  assert.match(server, /workOrderId: task\.id/, "linked both ways through the order");
  const route = readFileSync("app/api/self-inspection/route.ts", "utf8");
  const post = route.slice(route.indexOf("export async function POST"));
  assert.ok(post.indexOf("checkOrigin(request)") < post.indexOf("createDeviationFromAlarmOrder") && post.indexOf("requireCloudWriteAccess(ctx)") < post.indexOf("createDeviationFromAlarmOrder"));
});
