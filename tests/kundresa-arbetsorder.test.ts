import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isAlarmWorkOrder, isFaultWorkOrder } from "../lib/workflow/assign-work-order";
import { MACHINE_ORDER_CREATORS, OPERATOR_FAULT_CREATOR, SYSTEM_CREATOR } from "../lib/machine/alarm-rules";
import { riskFormDocument } from "../lib/workflow/builtin-risk-form";
import { formCompletion, formLeafBlocks, initialFormValues, newFormRow, type FormTableBlock } from "../lib/workflow/form-document";
import { openTasksWarning } from "../lib/workflow/work-order-link";
import { workflowTaskCompletion, workflowTaskInputSchema } from "../lib/workflow/task-model";

/** Kundresan 2026-11-07: arbetsorder, uppgifter, riskbedömning, tid, färdigställande och tilldelning (gren n91-arbetsorder). */
const read = (file: string) => readFileSync(file, "utf8");

test("H1: a fault report's work order is an automatic machine order with its own mark; the server's creator is the same value", () => {
  assert.equal(OPERATOR_FAULT_CREATOR, "system:operator-fault");
  assert.deepEqual([...MACHINE_ORDER_CREATORS].sort(), [OPERATOR_FAULT_CREATOR, SYSTEM_CREATOR].sort());
  assert.match(read("lib/operator/maintenance-adapter.ts"), new RegExp(`FAULT_CREATOR = "${OPERATOR_FAULT_CREATOR}"`), "the adapter's creator is the client's");
  assert.equal(isFaultWorkOrder({ kind: "WORK_ORDER", createdBy: OPERATOR_FAULT_CREATOR }), true);
  assert.equal(isFaultWorkOrder({ kind: "WORK_ORDER", createdBy: SYSTEM_CREATOR }), false);
  assert.equal(isAlarmWorkOrder({ kind: "FORM", createdBy: OPERATOR_FAULT_CREATOR }), false);
  // Always the report's own mark (also an approved one), and the box opens Tilldela from the bell.
  assert.match(read("lib/operator/maintenance-adapter.ts"), /createdBy: FAULT_CREATOR, updatedBy: by,/);
  const editor = read("features/workflow/workflow-task-editor.tsx");
  assert.match(editor, /<AutomaticOrderNotice taskId=\{task\.id\} fault=\{isFaultWorkOrder\(task\)\}/);
  // M26: the bell's assign=1 leaves the address when the dialog closes.
  assert.match(editor, /if \(searchParams\.get\("assign"\) === "1"\) \{ const params = new URLSearchParams\(searchParams\.toString\(\)\); params\.delete\("assign"\);/);
  // Jag tar den on any fault report's order, not only one that went to the on-call person.
  assert.doesNotMatch(read("lib/operator/on-call-store.ts"), /findFirst\(\{ where: \{ organizationId: input\.organizationId, taskId: input\.taskId, onCall: true \}/);
});

test("M25: a fault report's work order has the risk step before Starta tid, like a machine alarm's", () => {
  assert.match(read("lib/operator/maintenance-adapter.ts"), /data: \{ kind: "WORK_ORDER", details: \{\}, riskStep: true \}/);
  assert.match(read("lib/machine/alarm-orders.ts"), /data: \{ kind: "WORK_ORDER", details: \{\}, riskStep: true \}/);
});

test("H4: a new risk is not assessed until the person chooses, and the assessment cannot be completed before every risk has its levels", () => {
  const table = formLeafBlocks(riskFormDocument).find((block): block is FormTableBlock => block.type === "table" && block.key === "risker")!;
  const row = newFormRow(table, "r1");
  for (const key of ["sannolikhet", "konsekvens", "sannolikhet_efter", "konsekvens_efter"]) assert.equal(row.cells[key], undefined, `${key}: nothing chosen in advance`);
  const values = initialFormValues(riskFormDocument);
  values.tables.risker = [{ ...row, cells: { ...row.cells, fara: "Fall från stege", atgard: "Ställning" } }];
  values.signatures.godkand = { name: "QA", confirmed: true, signedAt: null };
  const open = formCompletion(riskFormDocument, values);
  assert.equal(open.ready, false);
  for (const label of ["sannolikhet före", "konsekvens före", "sannolikhet efter", "konsekvens efter"])
    assert.ok(open.issues.some((issue) => issue.message === `Identifierade risker, Risk 1: fyll i ${label}.`), label);
  values.tables.risker = [{ ...values.tables.risker[0], cells: { ...values.tables.risker[0].cells, sannolikhet: 2, konsekvens: 3, sannolikhet_efter: 1, konsekvens_efter: 3 } }];
  assert.equal(formCompletion(riskFormDocument, values).ready, true, "with every level chosen it can be completed");
  // The card's badge says so instead of "1 · Låg".
  assert.match(read("features/workflow/form-table.tsx"), /const NOT_ASSESSED = "Inte bedömd";/);
  // The published Workflow form is released by a migration, so the server binds new tasks to the version without defaults.
  const migration = read("prisma/migrations/20261107120000_builtin_risk_not_assessed/migration.sql");
  assert.match(migration, /'hintek-riskbedomning'/);
  const scale = migration.match(/"key":"sannolikhet","label":"Sannolikhet före"[^}]*\}/)?.[0] ?? "";
  assert.ok(scale, "the scale is in the released document");
  assert.match(scale, /"defaultValue":null/);
});

test("M6: Färdigställ names the order's tasks that are not done and asks for Färdigställ ändå", () => {
  assert.equal(openTasksWarning([]), "");
  assert.equal(openTasksWarning([{ title: "Kontroll A", status: "COMPLETED" }, { title: "Utgått", status: "CANCELLED" }]), "");
  assert.equal(openTasksWarning([{ title: "Kontroll A", status: "PLANNED" }]), "1 uppgift i arbetsordern är inte klar: ”Kontroll A”.");
  assert.equal(openTasksWarning([1, 2, 3, 4, 5].map((n) => ({ title: `K${n}`, status: "IN_PROGRESS" }))), "5 uppgifter i arbetsordern är inte klara: ”K1”, ”K2”, ”K3” och 2 till.");
  assert.match(openTasksWarning([{ title: "", status: "PLANNED" }], true), /^Minst 1 uppgift .*”Utan rubrik”/);
  const dialog = read("features/workflow/complete-task-dialog.tsx");
  assert.match(dialog, /if \(openTasks && !acceptOpen\)/);
  assert.match(dialog, /Färdigställ ändå/);
});

test("M7: a work order's count, list and percentage come from the same requirements", () => {
  const order = (details: Record<string, unknown>) => workflowTaskInputSchema.parse({ version: 0, kind: "WORK_ORDER", title: "Byt central", description: "", status: "PLANNED",
    data: { kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "", ...details } } });
  const shares = [order({}), order({ executionNotes: "Klart" }), order({ executionNotes: "Klart", signature: { name: "QA", confirmed: false, signedAt: null } }),
    order({ executionNotes: "Klart", signature: { name: "QA", confirmed: true, signedAt: null } })].map((task) => {
    const completion = workflowTaskCompletion(task);
    const counted = completion.requirements.filter((item) => item.weight > 0);
    return [counted.filter((item) => item.met).length, counted.length, completion.progress];
  });
  assert.deepEqual(shares, [[0, 3, 0], [1, 3, 32], [2, 3, 63], [3, 3, 95]]);
  // The name shown prefilled counts as filled in and is written into the order by Färdigställ.
  const editor = read("features/workflow/workflow-task-editor.tsx");
  assert.match(editor, /const completion = workflowTaskCompletion\(withShownSigner\(task, userName\)\);/);
  assert.match(editor, /const signed = withShownSigner\(latestTask\.current, userName\);/);
});

test("M5, M3, M4: a new work order waits for Spara; a draft's work order is linked before the receipt; Starta tid retries on a newer version", () => {
  const editor = read("features/workflow/workflow-task-editor.tsx");
  assert.match(editor, /const newWorkOrderWaits = kind === "WORK_ORDER" && !task\.id && !taskId;/);
  assert.match(editor, /const autosaveOn = !preview && !nativeNew && !newWorkOrderWaits &&/);
  assert.match(editor, /const saved = await save\(linked\.status, null, \{ quiet: true \}\);[\s\S]{0,700}if \(saved\) announce\(WORK_ORDER_CREATED_FROM_DRAFT\);/);
  // A risk answer is saved at once, and leaving the page sends what is left with keepalive.
  assert.match(editor, /saveSoon\.current \? 0 : AUTOSAVE_DELAY_MS/);
  assert.match(editor, /onChange=\{\(check\) => holder\.patch\(\{ data: \(data\) => withRiskCheck\(data, check\) \}, \{ now: true \}\)\}/);
  assert.match(editor, /leaving && body\.length < 60_000 \? \{ keepalive: true \}/);
  const route = read("app/api/workflow-tasks/route.ts");
  assert.match(route, /if \(!changed\.count\) throw new TimerVersionConflict\(\);/);
  assert.match(route, /if \(attempt >= 3\) throw new ApiError\(409, "Uppgiften har ändrats\. Läs in den senaste versionen\."\);/);
  assert.match(editor, /Tiden startade inte/);
});
