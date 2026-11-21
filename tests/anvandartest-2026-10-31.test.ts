import assert from "node:assert/strict";
import test from "node:test";
import { createSerialRunner, saveOnNewest } from "../lib/workflow/holder-save";
import { draftKeepsWorkOrder } from "../lib/workflow/work-order-link";
import { awaitsAuthorityReport, deviationHref, REPORTABLE_LABEL, selfInspectionReminders, type SelfInspectionView } from "../lib/self-inspection/model";
import { faultOrderText } from "../lib/operator/rules";
import { faultReportNotifications, FAULT_NOTICE_PREFIX } from "../lib/operator/admin-notice";
import { noticeKindsOf } from "../lib/workflow/notice-channels";

/** Användartest 2026-10-31: the confirmed bugs, as far as their rules can be tested without a browser or a database. */

const conflict = () => Object.assign(new Error("Uppgiften har ändrats. Läs in den senaste versionen."), { status: 409 });

test("fel 1: the work order's changes are saved one at a time, so two saves of the same change never refuse each other", async () => {
  // A server with a version check, like /api/workflow-tasks: a save on an older version is refused with 409.
  const server = { version: 1, title: "Byte av elcentral" };
  const read = async () => ({ ...server });
  let sends = 0;
  const send = async (base: typeof server, title: string) => {
    sends += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (base.version !== server.version) throw conflict();
    server.version += 1; server.title = title;
  };
  // What a task page has waiting for the work order, and the order it read when it opened.
  let pending: { title?: string } = { title: "Arbetsorderns nya rubrik" };
  const known = { ...server };
  const run = createSerialRunner();
  const flush = () => run(async () => {
    const sent = pending;
    if (!sent.title) return "nothing";
    await saveOnNewest({ known, read, send: (base) => send(base, sent.title!) });
    if (pending === sent) pending = {};
    return "saved";
  });
  // The save a moment after typing and the one Spara starts first, at the same time (the false "sparades inte").
  const results = await Promise.all([flush(), flush()]);
  assert.deepEqual(results, ["saved", "nothing"], "the second finds nothing left to send");
  assert.equal(sends, 1);
  assert.equal(server.title, "Arbetsorderns nya rubrik");
});

test("fel 1: a save that met a newer version is put on it once; a second refusal or another error is told", async () => {
  let version = 2;
  const sent: number[] = [];
  await saveOnNewest({ known: { version: 1 }, read: async () => ({ version }), send: async (base) => { sent.push(base.version); if (base.version !== version) throw conflict(); version += 1; } });
  assert.deepEqual(sent, [1, 2]);
  await assert.rejects(saveOnNewest({ known: { version: 1 }, read: async () => ({ version: 1 }), send: async () => { throw conflict(); } }), /har ändrats/);
  await assert.rejects(saveOnNewest({ known: { version: 1 }, read: async () => ({ version: 1 }), send: async () => { throw Object.assign(new Error("Behörighet saknas"), { status: 403 }); } }), /Behörighet/);
  // Local has no version to meet: no second try.
  let tries = 0;
  await assert.rejects(saveOnNewest({ known: { version: 1 }, retry: false, read: async () => ({ version: 1 }), send: async () => { tries += 1; throw conflict(); } }));
  assert.equal(tries, 1);
});

test("fel 1: the serial runner keeps the order and is not stopped by a failure", async () => {
  const run = createSerialRunner();
  const log: string[] = [];
  const first = run(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); log.push("a"); throw new Error("a failed"); });
  const second = run(async () => { log.push("b"); return "b"; });
  await assert.rejects(first, /a failed/);
  assert.equal(await second, "b");
  assert.deepEqual(log, ["a", "b"]);
});

test("fel 6 (testflöde): a restored draft never takes a task out of its work order", () => {
  // A saved task: a draft without a work order does not undo the link; a move the draft made is kept.
  assert.equal(draftKeepsWorkOrder({ title: "Kontroll", workOrderId: null }, "wo-1").workOrderId, "wo-1");
  assert.equal(draftKeepsWorkOrder({ title: "Kontroll", workOrderId: "wo-2" }, "wo-1").workOrderId, "wo-2");
  // A new task: the address's work order wins, also over a draft that named another one.
  assert.equal(draftKeepsWorkOrder({ workOrderId: "wo-2" }, "wo-1", { fromAddress: true }).workOrderId, "wo-1");
  assert.equal(draftKeepsWorkOrder({ workOrderId: null }, "wo-1", { fromAddress: true }).workOrderId, "wo-1");
  // Nothing to keep: the draft is as it was.
  const draft = { workOrderId: "wo-3" };
  assert.equal(draftKeepsWorkOrder(draft, null), draft);
  assert.equal(draftKeepsWorkOrder(draft, "wo-3"), draft);
});

test("fel 4: Anmälningspliktig – what awaits a report, and who hears of it in the bell", () => {
  const entry = { type: "NEAR_MISS", serious: true, reportedToAuthorityAt: null };
  assert.equal(awaitsAuthorityReport(entry), true);
  assert.equal(awaitsAuthorityReport({ ...entry, reportedToAuthorityAt: "2026-10-31T08:00:00.000Z" }), false, "marked reported");
  assert.equal(awaitsAuthorityReport({ ...entry, serious: false }), false);
  assert.equal(awaitsAuthorityReport({ ...entry, type: "RISK_OBSERVATION" }), false, "only a near miss or an accident");
  assert.equal(awaitsAuthorityReport({ ...entry, type: "ACCIDENT" }), true);

  const today = "2026-10-31";
  const view = (who: { canEdit: boolean; team?: boolean }) => ({
    ...who, current: null, myConfirmation: null, me: { id: "me" }, review: { status: "OK", nextDue: null },
    deviations: [
      { id: "d1", kind: "DEVIATION", number: 4, type: "NEAR_MISS", serious: true, reportedToAuthorityAt: null, title: "Stege gled", action: "", status: "OPEN", responsibleId: null, dueDate: "", severity: "NORMAL" },
      { id: "d2", kind: "DEVIATION", number: 5, type: "ACCIDENT", serious: true, reportedToAuthorityAt: "2026-10-31T07:00:00.000Z", title: "Skärsår", action: "", status: "OPEN", responsibleId: null, dueDate: "" },
      { id: "d3", kind: "DEVIATION", number: 6, type: "ACCIDENT", serious: true, reportedToAuthorityAt: null, title: "Fall", action: "", status: "DONE", responsibleId: null, dueDate: "" },
    ],
  }) as unknown as Parameters<typeof selfInspectionReminders>[0] & Pick<SelfInspectionView, "deviations">;
  const reportable = (who: { canEdit: boolean; team?: boolean }) => selfInspectionReminders(view(who), today).filter((item) => item.id.startsWith("self-inspection:reportable:"));
  const [admin] = reportable({ canEdit: true });
  assert.equal(reportable({ canEdit: true }).length, 1, "the one not reported and not done");
  assert.equal(admin.title, `${REPORTABLE_LABEL}: Tillbud 4: Stege gled`);
  assert.equal(admin.href, deviationHref("d1"));
  assert.equal(admin.needsAction, true);
  assert.equal(reportable({ canEdit: false, team: true }).length, 1, "Teamet is told too");
  assert.equal(reportable({ canEdit: false }).length, 0, "an ordinary member is not");
  // The entry keeps the Allvarlighetsgrad the person chose.
  assert.equal((view({ canEdit: true }).deviations[0] as unknown as { severity: string }).severity, "NORMAL");
});

test("fel 5: the operator's number is on the work order, and an untaken fault report is told in the bell", () => {
  const words = { machineLabel: "Fabrik › Press 1", cause: "Ovanligt ljud", text: "Gnisslar", severity: "NORMAL" as const, reporter: "", accountName: "Verkstad" };
  const named = faultOrderText({ ...words, label: "AO-LKNQGS" });
  assert.equal(named.title, "Felanmälan AO-LKNQGS: Ovanligt ljud – Fabrik › Press 1");
  assert.match(named.description, /^Operatörens nummer: AO-LKNQGS\./);
  assert.equal(faultOrderText(words).title, "Felanmälan: Ovanligt ljud – Fabrik › Press 1", "without a number as before");

  const [notice] = faultReportNotifications([{ id: "r1", taskId: "wo 1", label: "AO-LKNQGS", cause: "Ovanligt ljud", machineLabel: "Fabrik › Press 1", createdAt: new Date("2026-10-31T09:00:00.000Z") }]);
  assert.equal(notice.id, `${FAULT_NOTICE_PREFIX}r1`);
  assert.equal(notice.title, "Ny felanmälan AO-LKNQGS: Ovanligt ljud – Fabrik › Press 1");
  assert.equal(notice.href, "/?view=workflow_task&taskId=wo%201&taskType=WORK_ORDER");
  assert.equal(notice.needsAction, true);
  assert.deepEqual(noticeKindsOf(notice), ["ACTION"], "also by e-mail or push to whoever chose Uppgifter som behöver åtgärdas");
});
