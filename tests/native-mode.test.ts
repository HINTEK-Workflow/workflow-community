import assert from "node:assert/strict";
import { HOME_TILE_KEYS, normalizeNativeLayout } from "../lib/workflow/native-layout";
import test from "node:test";
import {
  continueLabel, dateGroupOf, formPartBar, formStepTarget, jobFlowIndex, jobFlowSteps, MAX_FORM_STEPS, formPartForTarget, formPartLabel, formParts, groupByDate, jobStepRows, nativeModeFor, appColumnFor, NATIVE_MAX_WIDTH,
  nativeMoreSections, nativeTabOf, parseFormPart, parseJobScreen, screenForTarget, typeOfTaskKind,
} from "../lib/workflow/native-mode";
import { formCompletion, formDocumentSchema, initialFormValues } from "../lib/workflow/form-document";
import { APP_COLUMN_WIDTH, detailLevelFor } from "../lib/workflow/detail-level";
import { formFlow, riskFlow, workOrderFlow } from "../lib/workflow/task-flow";
import { resolveMenu } from "../lib/workflow/menu-items";
import { defaultWorkflowPermissionProfile } from "../lib/workflow/permissions";

// Visning 1 (2026-10-09, plan 1P 2026-10-11): level 1 fills a window under 640 px (a phone, or the app column's
// frame) and is drawn in the app column on a wider screen; level 2-3 are the ordinary pages on every device.
test("native mode: level 1 in a window under 640 px; from 640 px it is the app column; level 2-3 are the pages", () => {
  assert.equal(nativeModeFor(1, 390), true);
  assert.equal(nativeModeFor(1, 639), true);
  assert.equal(nativeModeFor(1, 640), false, "from 640 px the app is drawn in the column, whose frame is under 640 px");
  assert.equal(nativeModeFor(1, 844, true), true, "a phone on its side draws the app across the screen (2026-10-13)");
  assert.equal(appColumnFor(1, 844, true), false, "never the narrow column on a phone");
  assert.equal(nativeModeFor(1, APP_COLUMN_WIDTH), true, "inside the column's frame");
  assert.equal(nativeModeFor(2, 390), false);
  assert.equal(nativeModeFor(3, 390), false);
  assert.equal(nativeModeFor(1, 0), false, "before the width is known");
  // The level comes from the person's choice per device.
  assert.equal(nativeModeFor(detailLevelFor({ phone: 1, tablet: 1 }, 390, true), 390), true);
  assert.equal(nativeModeFor(detailLevelFor({}, 390, true), 390), true, "the phone's default is the app (A2, 2026-10-22)");
});

test("app column: level 1 chosen on a tablet or a computer, on every width from 640 px; never at level 2-3", () => {
  const level = (levels: Parameters<typeof detailLevelFor>[0], width: number, touch: boolean) => detailLevelFor(levels, width, touch);
  for (const [width, touch] of [[768, true], [1024, true], [1366, true], [768, false], [1024, false], [1440, false], [1920, false]] as const) {
    assert.equal(appColumnFor(level({ tablet: 1, desktop: 1 }, width, touch), width), true, `${width} px${touch ? " touch" : ""}`);
    assert.equal(appColumnFor(level({ tablet: 2, desktop: 2 }, width, touch), width), false);
    assert.equal(appColumnFor(level({ tablet: 3, desktop: 3 }, width, touch), width), false);
  }
  // The first time: the tablet's own app view (level 1 across the window, tabletApp – 2026-11-23), everything on a computer –
  // neither has the column.
  assert.equal(level(null, 820, true), 1);
  assert.equal(appColumnFor(level(null, 820, true), 820, false, true), false);
  assert.equal(nativeModeFor(level(null, 820, true), 820, false, true), true);
  assert.equal(appColumnFor(level(null, 1440, false), 1440), false);
  // A phone's window never gets the column; the frame is narrower than the switch point.
  assert.equal(appColumnFor(1, 390), false);
  assert.equal(appColumnFor(1, 639), false);
  assert.equal(appColumnFor(1, 640), true);
  assert.equal(appColumnFor(1, 0), false, "before the width is known");
  assert.ok(APP_COLUMN_WIDTH >= 500 && APP_COLUMN_WIDTH <= 600 && APP_COLUMN_WIDTH < NATIVE_MAX_WIDTH);
  // Together they cover every width exactly once at level 1: either the window or the column draws the app.
  for (const width of [320, 390, 639, 640, 768, 1024, 1440]) assert.notEqual(nativeModeFor(1, width), appColumnFor(1, width), `${width} px`);
});

test("native mode: date groups follow the day and the current week (Monday to Sunday)", () => {
  // 2026-10-09 is a Friday.
  const today = "2026-10-09";
  assert.equal(dateGroupOf("2026-10-09", today), "today");
  assert.equal(dateGroupOf("2026-10-10", today), "week");
  assert.equal(dateGroupOf("2026-10-11", today), "week", "Sunday ends the week");
  assert.equal(dateGroupOf("2026-10-12", today), "later", "next Monday is later");
  assert.equal(dateGroupOf("2026-10-08", today), "overdue");
  assert.equal(dateGroupOf("2026-10-08", today, { open: false }), "earlier", "a finished job is not late");
  assert.equal(dateGroupOf("", today), "none");
  assert.equal(dateGroupOf("not a day", today), "none");
  assert.equal(dateGroupOf("2026-10-11T12:00:00", "2026-10-05"), "week", "a Monday's week runs to Sunday");
  assert.equal(dateGroupOf("2026-10-12", "2026-10-11"), "later", "on Sunday the next day is next week");
});

test("native mode: groupByDate keeps the list's order inside each group and leaves empty groups out", () => {
  const items = [
    { id: "a", day: "2026-10-20" }, { id: "b", day: "2026-10-09" }, { id: "c", day: "" }, { id: "d", day: "2026-10-10" },
    { id: "e", day: "2026-10-01" }, { id: "f", day: "2026-10-09" }, { id: "g", day: "2026-10-02", done: true },
  ];
  const groups = groupByDate(items, (item) => item.day, "2026-10-09", (item) => !item.done);
  assert.deepEqual(groups.map((group) => group.label), ["Förfallet", "I dag", "Denna vecka", "Senare", "Utan datum", "Tidigare"]);
  assert.deepEqual(groups.map((group) => group.items.map((item) => item.id)), [["e"], ["b", "f"], ["d"], ["a"], ["c"], ["g"]]);
  assert.deepEqual(groupByDate([], () => "", "2026-10-09"), []);
});

test("native mode: an open job past its Klart senast is Förfallet even when it is booked later (QA 2026-10-10)", () => {
  const items = [{ id: "booked-later-overdue", day: "2026-10-20", overdue: true }, { id: "later", day: "2026-10-20", overdue: false }, { id: "done-overdue", day: "2026-10-20", overdue: true, done: true }];
  const groups = groupByDate(items, (item) => item.day, "2026-10-09", (item) => !item.done, (item) => item.overdue);
  assert.deepEqual(groups.map((group) => [group.label, group.items.map((item) => item.id)]), [["Förfallet", ["booked-later-overdue"]], ["Senare", ["later", "done-overdue"]]]);
});

const orderFlow = (patch: Partial<Parameters<typeof workOrderFlow>[0]> = {}) => workOrderFlow({
  saved: true, title: "Byte av elcentral", status: "IN_PROGRESS", assigned: true, dueDate: "2026-10-20", timerRunning: false, totalDurationSec: 0,
  executionNotes: "", signatureName: "", signatureConfirmed: false, ...patch,
});

test("native mode: a work order's rows say what is done and which step is next", () => {
  const start = jobStepRows({ kind: "WORK_ORDER", flow: orderFlow({ riskStep: { met: false, hint: "" } }) });
  assert.deepEqual(start.rows.map((row) => row.label), ["Riskbedömning", "Utförande", "Material", "Signering"]);
  assert.deepEqual(start.rows.map((row) => row.state), ["Du är här", "Inte påbörjad", "Inga rader", "Inte påbörjad"]);
  assert.equal(start.next?.screen, "risk");
  assert.equal(continueLabel(start.next!), "Fortsätt till riskbedömning");
  assert.deepEqual(start.bar, ["done", "current", "todo", "todo", "todo"], "Beställning, Riskbedömning, Utförande, Signering, Färdigställd; Planering is optional");

  const signing = jobStepRows({ kind: "WORK_ORDER", flow: orderFlow({ riskStep: { met: true, hint: "" }, executionNotes: "Centralen bytt." }), materials: 3, riskLevel: "simplified" });
  assert.deepEqual(signing.rows.map((row) => [row.label, row.state, row.tone]), [
    ["Riskbedömning", "Klar · förenklad", "done"], ["Utförande", "Ifyllt", "done"], ["Material", "3 rader", "done"], ["Signering", "Du är här", "next"]]);
  assert.equal(signing.rows[2].value, undefined, "the count is said once, in the state (simulation 2026-10-10)");
  assert.equal(continueLabel(signing.next!), "Fortsätt till signering");

  const ready = jobStepRows({ kind: "WORK_ORDER", flow: orderFlow({ executionNotes: "Klart", signatureName: "Elin", signatureConfirmed: true }) });
  assert.deepEqual(ready.rows.map((row) => row.label), ["Utförande", "Material", "Signering"], "no risk row when the job has no risk step");
  assert.equal(ready.next?.screen, "signering", "Färdigställ is on the signing screen");
  assert.equal(ready.next?.state, "Klar att färdigställa");

  const done = jobStepRows({ kind: "WORK_ORDER", flow: orderFlow({ status: "COMPLETED", executionNotes: "Klart", signatureName: "Elin", signatureConfirmed: true }), materials: 1 });
  assert.equal(done.next, null);
  assert.equal(done.rows.at(-1)?.state, "Färdigställd");
  assert.ok(done.bar.every((piece) => piece === "done"));
});

test("native mode: a risk assessment and a protocol get their own steps", () => {
  const risk = jobStepRows({ kind: "RISK_ASSESSMENT", risks: 2, flow: riskFlow({ saved: true, title: "Lyft", status: "PLANNED", risks: [{ hazard: "Fall", protectiveMeasure: "Sele" }, { hazard: "Ras", protectiveMeasure: "" }], approvalName: "", approvalConfirmed: false }) });
  assert.deepEqual(risk.rows.map((row) => [row.screen, row.state]), [["risker", "Du är här"], ["godkannande", "Inte påbörjad"]]);
  assert.equal(risk.rows[0].value, "2");

  const protocol = jobStepRows({ kind: "FORM", flow: formFlow({ saved: true, title: "Kontroll plan 2", status: "IN_PROGRESS", issues: [{ field: "form-a", message: "Fyll i A" }], signatureBlocks: [], requirements: [{ field: "form-a", met: false }, { field: "form-b", met: true }] }) });
  assert.deepEqual(protocol.rows.map((row) => [row.label, row.state]), [["Ifyllnad", "Du är här"], ["Färdigställ", "Inte klar"]]);
  const filled = jobStepRows({ kind: "FORM", flow: formFlow({ saved: true, title: "Kontroll", status: "IN_PROGRESS", issues: [], signatureBlocks: [] }) });
  assert.deepEqual(filled.rows.map((row) => [row.label, row.state, row.tone]), [["Ifyllnad", "Ifylld", "done"], ["Färdigställ", "Du är här", "next"]]);
  assert.equal(typeOfTaskKind("WORK_ORDER"), "work-order");
  assert.equal(typeOfTaskKind("FORM"), "control");
});

test("native mode: step screens are read from the address and requirements lead to their screen", () => {
  assert.equal(parseJobScreen("utforande"), "utforande");
  assert.equal(parseJobScreen("nope"), null);
  assert.equal(parseJobScreen(null), null);
  assert.equal(screenForTarget("task-execution", "WORK_ORDER"), "utforande");
  assert.equal(screenForTarget("task-signature-name", "WORK_ORDER"), "signering");
  assert.equal(screenForTarget("task-complete", "WORK_ORDER"), "signering");
  assert.equal(screenForTarget("task-complete", "FORM"), "fardigstall");
  assert.equal(screenForTarget("form-abc", "FORM"), "formular");
  assert.equal(screenForTarget("task-risk-step", "FORM"), "risk");
  assert.equal(screenForTarget("task-round-safety", "FORM"), "formular", "the round's check stands first on Ifyllnad");
  assert.equal(screenForTarget("task-add-risk", "RISK_ASSESSMENT"), "risker");
  assert.equal(screenForTarget("task-title", "WORK_ORDER"), "plats");
  assert.equal(screenForTarget("something-else", "WORK_ORDER"), null);
});

test("native mode: tabs, the top bar and the Mer list follow the shell's own rules", () => {
  assert.equal(nativeTabOf("stats"), "home");
  assert.equal(nativeTabOf("workflow_task"), "jobs");
  assert.equal(nativeTabOf("work_orders"), "jobs");
  assert.equal(nativeTabOf("new_task"), "new", "Ny uppgift is under the Ny tab");
  assert.equal(nativeTabOf("time"), "time");
  assert.equal(nativeTabOf("customers"), "more");

  const access = { memberRole: "MEMBER" as const, workflowPermissions: defaultWorkflowPermissionProfile(), ai: true, importPage: false };
  const sections = nativeMoreSections(resolveMenu(access, { hidden: [], shortcuts: [] }), { canRead: { projects: false } });
  const labels = sections.map((section) => [section.title ?? "", section.rows.map((row) => row.label)]);
  assert.equal(sections.at(-1)?.title, "Konto");
  assert.deepEqual(sections.at(-1)?.rows.map((row) => row.key), ["notifications", "settings", "display", "ai", "logout"], "Workflow AI sits under Konto");
  assert.ok(sections.some((section) => section.title === "Verktyg"), JSON.stringify(labels));
  const projectRow = sections.flatMap((section) => section.rows).find((row) => row.key === "projects");
  if (projectRow) assert.equal(projectRow.href, "/?view=new_project", "someone who may only create goes to Nytt projekt");
  assert.ok(!sections.flatMap((section) => section.rows).some((row) => row.key === "customer_companies"), "Installation only for the product owner");
});

// Ett formulär på nivå 1: en skärm per del (2026-10-09).
test("native mode: a form's parts are its shown sections, joined to a few steps; loose blocks join their neighbour, switched-off sections none", () => {
  const document = formDocumentSchema.parse({ schema: 2, blocks: [
    { id: "intro", type: "note", title: "Inledning" },
    { id: "a", type: "section", title: "Allmänt", blocks: [{ id: "name", type: "field", key: "namn", label: "Namn", input: "text", required: true }] },
    { id: "b", type: "section", title: "Mätning", taskTitle: "Mätningar", optional: true, defaultOn: false, blocks: [{ id: "volt", type: "field", key: "volt", label: "Spänning", input: "number" }] },
    { id: "c", type: "section", title: "Kontroll", blocks: [{ id: "ok", type: "field", key: "ok", label: "OK", input: "text", required: true }] },
    { id: "tail", type: "note", title: "Slut" },
    { id: "d", type: "section", title: "Sammanfattning", blocks: [{ id: "sum", type: "summary", label: "Sammanfattning" }] },
    { id: "pdf", type: "section", title: "Bara i PDF", blocks: [{ id: "pdfnote", type: "note", title: "Stöd", visibility: { task: false, pdf: true } }] },
  ] });
  const values = initialFormValues(document);
  let parts = formParts(document, values);
  assert.deepEqual(parts.map((part) => part.keys), [["intro", "a"], ["c", "tail", "d"]], "the Sammanfattning on its own follows the section before it");
  assert.deepEqual(parts.map((part) => part.title), ["Allmänt", "Kontroll och Sammanfattning"], "a section only in the PDF is no part");
  // A field in a switched-off section leads to the first part, where the moments are chosen.
  assert.equal(formPartForTarget("form-volt", parts), 1);
  assert.equal(formPartForTarget("form-b", parts), 1);
  assert.equal(formPartForTarget("form-ok", parts), 2);
  assert.equal(formPartForTarget("form-row-ok-r1", parts), 2);
  assert.equal(formPartForTarget("form-ok-r1-value", parts), 2);
  assert.equal(formPartForTarget("form-deviations", parts), 2, "the deviations comment sits in the summary");
  assert.equal(formPartForTarget("task-title", parts), null);
  // Switching the section on makes it a part of its own, with its task heading.
  parts = formParts(document, { ...values, sections: { b: true } });
  assert.deepEqual(parts.map((part) => part.title), ["Allmänt", "Mätningar", "Kontroll och Sammanfattning"]);
  assert.equal(formPartForTarget("form-volt", parts), 2);
  // The step bar: current, nothing left (done) and the rest.
  const open = formCompletion(document, values).issues.map((issue) => issue.blockId);
  assert.deepEqual(formPartBar(formParts(document, values), open, 2), ["todo", "current"]);
  assert.deepEqual(formPartBar(formParts(document, values), ["ok"], 1), ["current", "todo"]);
  assert.deepEqual(formPartBar(formParts(document, values), [], 1), ["current", "done"]);
  // A form without sections is a single part.
  const flat = formDocumentSchema.parse({ schema: 2, blocks: [{ id: "x", type: "field", key: "x", label: "X", input: "text" }] });
  assert.deepEqual(formParts(flat, initialFormValues(flat)).map((part) => part.keys), [["x"]]);
});

// Kontroller i några större steg (2026-10-12): sections are joined, a pagebreak splits.
const fieldSection = (id: string, title: string, count = 3, extra: object[] = []) => ({ id, type: "section", title, blocks: [
  ...Array.from({ length: count }, (_, index) => ({ id: `${id}${index}`, type: "field", key: `${id}${index}`, label: `F ${id}${index}`, input: "text" })), ...extra] });

test("native mode: many sections become three to five steps of even size, every section kept once and in order", () => {
  const sections = Array.from({ length: 10 }, (_, index) => fieldSection(`s${index}`, `Avsnitt ${index + 1}`));
  const document = formDocumentSchema.parse({ schema: 2, blocks: sections });
  const parts = formParts(document, initialFormValues(document));
  assert.ok(parts.length >= 3 && parts.length <= MAX_FORM_STEPS, String(parts.length));
  assert.deepEqual(parts.flatMap((part) => part.keys), sections.map((section) => section.id), "no section lost, none twice, same order");
  const sizes = parts.map((part) => part.keys.length);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `even steps: ${sizes}`);
  assert.equal(parts[0].title, sizes[0] === 1 ? "Avsnitt 1" : sizes[0] === 2 ? "Avsnitt 1 och Avsnitt 2" : `Avsnitt 1 – Avsnitt ${sizes[0]}`);
  assert.equal(formPartForTarget("form-s9", parts), parts.length, "a field in the last section leads to the last step");
  assert.equal(formPartForTarget("form-s0", parts), 1);
});

test("native mode: few sections stay as they are, and the step count follows the target", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 8, 12, 30].map(formStepTarget), [1, 2, 3, 3, 3, 4, 5, 5, 5]);
  const document = formDocumentSchema.parse({ schema: 2, blocks: [fieldSection("a", "A"), fieldSection("b", "B")] });
  assert.deepEqual(formParts(document, initialFormValues(document)).map((part) => part.keys), [["a"], ["b"]]);
});

test("native mode: a pagebreak ends a step, inside a section and between sections", () => {
  const document = formDocumentSchema.parse({ schema: 2, blocks: [
    fieldSection("a", "A"), fieldSection("b", "B", 3, [{ id: "pb", type: "pagebreak" }]), fieldSection("c", "C"), fieldSection("d", "D"), fieldSection("e", "E"),
    { id: "pb2", type: "pagebreak" }, fieldSection("f", "F"), fieldSection("g", "G"),
  ] });
  const parts = formParts(document, initialFormValues(document));
  // No step crosses a break: a, b | c, d, e | f, g.
  for (const part of parts) {
    const hasA = part.keys.includes("a") || part.keys.includes("b");
    const hasC = ["c", "d", "e"].some((key) => part.keys.includes(key));
    const hasF = ["f", "g"].some((key) => part.keys.includes(key));
    assert.equal([hasA, hasC, hasF].filter(Boolean).length, 1, JSON.stringify(part.keys));
  }
  assert.deepEqual(parts.flatMap((part) => part.keys).filter((key) => key !== "pb2"), ["a", "b", "c", "d", "e", "f", "g"]);
});

test("native mode: the Sammanfattning on its own and the first title section are read with their neighbours", () => {
  const document = formDocumentSchema.parse({ schema: 2, blocks: [
    fieldSection("g", "Grunduppgifter", 1), fieldSection("m", "Mätning", 6), fieldSection("k", "Kontroll", 6),
    { id: "sum", type: "section", title: "Sammanfattning", blocks: [{ id: "summary", type: "summary", label: "Sammanfattning" }] },
  ] });
  const parts = formParts(document, initialFormValues(document));
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.at(-1)!.keys, ["k", "sum"]);
  assert.equal(parts.at(-1)!.summary, true);
  assert.equal(formPartForTarget("form-deviations", parts), 3);
});

test("native mode: the job flow lists the steps with the grouped parts and no Färdigställ of its own", () => {
  const rows = [{ screen: "risk" as const, label: "Riskbedömning" }, { screen: "formular" as const, label: "Ifyllnad" }, { screen: "fardigstall" as const, label: "Färdigställ" }];
  const steps = jobFlowSteps(rows, [{ title: "Allmänt" }, { title: "Mätning" }, { title: "" }]);
  assert.deepEqual(steps.map((step) => step.label), ["Riskbedömning", "Allmänt", "Mätning", "Del 3"]);
  assert.equal(jobFlowIndex(steps, "formular", 2), 2);
  assert.equal(jobFlowIndex(steps, "risk", 1), 0);
  assert.equal(jobFlowIndex(steps, "tid", 1), -1);
  assert.deepEqual(jobFlowSteps(rows, [{ title: "Allmänt" }]).map((step) => step.label), ["Riskbedömning", "Ifyllnad"], "one part: Ifyllnad is a single step");
  const workOrder = [{ screen: "utforande" as const, label: "Utförande" }, { screen: "material" as const, label: "Material" }, { screen: "signering" as const, label: "Signering" }];
  assert.deepEqual(jobFlowSteps(workOrder, []).map((step) => step.screen), ["utforande", "material", "signering"]);
});

test("native mode: the part in the address is kept within the form and labelled Del n av m", () => {
  assert.equal(parseFormPart(null, 4), 1);
  assert.equal(parseFormPart("3", 4), 3);
  assert.equal(parseFormPart("9", 4), 4);
  assert.equal(parseFormPart("0", 4), 1);
  assert.equal(parseFormPart("abc", 4), 1);
  assert.equal(parseFormPart("2", 0), 1);
  assert.equal(formPartLabel(2, 5), "Del 2 av 5");
});

// Ett projekt och ett kundkort på nivå 1 (2026-10-09): a menu of rows, each row a screen of its own (`&step=`).
import { contactRows, parseCustomerScreen, parseProjectScreen, PROJECT_SCREEN_TITLE, screenShown, shortStepLabel, withScreen } from "../lib/workflow/native-mode";

test("native mode: a project's and a customer's screens come from the address; anything else is the menu", () => {
  assert.equal(parseProjectScreen("jobb"), "jobb");
  assert.equal(parseProjectScreen("uppgifter"), "uppgifter");
  assert.equal(parseProjectScreen("utforande"), null, "a job's screen is not a project's");
  assert.equal(parseProjectScreen(null), null);
  assert.equal(PROJECT_SCREEN_TITLE.offerter, "Offerter och utfall");
  assert.equal(parseCustomerScreen("platser"), "platser");
  assert.equal(parseCustomerScreen("redigera"), null, "Redigera kund is the register's own page");
  assert.equal(withScreen("?view=project&projectId=p1", "tid"), "/?view=project&projectId=p1&step=tid");
  assert.equal(withScreen("view=project&projectId=p1&step=tid", null), "/?view=project&projectId=p1");
  assert.equal(withScreen("view=project&projectId=p1&step=tid", "jobb"), "/?view=project&projectId=p1&step=jobb");
  // A panel is always drawn outside the native look; at level 1 only on its own screen.
  assert.equal(screenShown(false, null, []), true, "level 2–3, tablet and computer are unchanged");
  assert.equal(screenShown(false, "tid", ["planering"]), true);
  assert.equal(screenShown(true, null, ["menu"]), true);
  assert.equal(screenShown(true, null, ["planering"]), false, "the menu shows rows, not the panels");
  assert.equal(screenShown(true, "planering", ["planering"]), true);
  assert.equal(screenShown(true, "planering", []), false);
});

test("native mode: contact rows call, write and open the map; empty values give no row", () => {
  const rows = contactRows({ phone: "031-12 34 56", mobile: "+46 70 123 45 67", email: "info@exempel.se", address: "Storgatan 1, 411 01 Göteborg" });
  assert.deepEqual(rows.map((row) => row.key), ["phone", "mobile", "email", "address"]);
  assert.equal(rows[0].href, "tel:031123456");
  assert.equal(rows[1].href, "tel:+46701234567");
  assert.equal(rows[2].href, "mailto:info@exempel.se");
  assert.match(rows[3].href, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Storgatan%201%2C%20411%2001%20G%C3%B6teborg$/);
  assert.deepEqual(contactRows({ phone: " ", mobile: "", email: "inte en adress", address: null }), []);
  assert.deepEqual(contactRows({ phone: "0701", mobile: "0701" }).map((row) => row.key), ["phone"], "the same number once");
});

import { parseSettingsSection, parseTimeScreen, SETTINGS_SECTION_TITLE, timeDayGroups } from "../lib/workflow/native-mode";

test("native mode: Tid groups the week per day, today always; its screens and the settings' screens come from the address", () => {
  const week = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"];
  const entries = [{ id: "c", day: "2026-10-08", durationSec: 1800 }, { id: "a", day: "2026-10-06", durationSec: 3600 }, { id: "b", day: "2026-10-06", durationSec: 600 }, { id: "x", day: "2026-09-30", durationSec: 60 }];
  const groups = timeDayGroups(entries, (entry) => entry.day, week, "2026-10-09");
  assert.deepEqual(groups.map((group) => group.day), ["2026-10-06", "2026-10-08", "2026-10-09"], "Monday first, empty days out except today, other weeks out");
  assert.deepEqual(groups[0].items.map((item) => item.id), ["a", "b"], "the list's own order inside a day");
  assert.equal(groups[0].seconds, 4200);
  assert.equal(groups[2].items.length, 0);
  assert.equal(parseTimeScreen("add"), "add");
  assert.equal(parseTimeScreen("nope"), null);
  assert.equal(parseSettingsSection("sidemenu"), "sidemenu");
  assert.equal(parseSettingsSection("menu"), null, "\"menu\" is the page's own list of rows (screenShown)");
  assert.equal(parseSettingsSection(null), null);
  assert.equal(parseSettingsSection("tables"), null, "Tabeller och mätningar is gone (2026-10-09 natt)");
  assert.equal(SETTINGS_SECTION_TITLE.home, "Hemskärm och flikrad");
});

import { entriesByDay, nativeHiddenHref, nativeHiddenView, nativeMoreTiles, nativeMoreTools, nativeVisibleSections, NATIVE_HIDDEN_VIEWS, NATIVE_MORE_HIDDEN, NATIVE_SETTINGS_HIDDEN, NATIVE_TIME_HIDDEN } from "../lib/workflow/native-mode";
import { commandCandidates, type SearchAccess } from "../lib/search/commands";

// Level 1 is for field work (2026-10-09): heavy desktop pages are left out there and stay in display level 2.
test("native mode: the builders, import, statistics and the company's and Workflow's administration are hidden at level 1", () => {
  for (const view of ["forms", "import", "landing_editor", "project_summary", "facilities", "company", "operator_accounts", "quote_settings",
    "company_features", "company_values", "ai_settings", "credits", "advanced", "integrations", "history_retention", "customer_companies", "pricing_admin",
    "ai_admin", "mailings", "mail_settings", "login_settings", "server_keys", "services", "view_as", "behavior_analytics"]) {
    assert.equal(nativeHiddenView(view), true, view);
  }
  // The work, the field's registers, Mina inställningar and Hjälp stay; a round's QR labels too (2026-10-23: printed from the phone).
  for (const view of ["stats", "tasks", "work_orders", "workflow_task", "projects", "project", "planning", "rounds", "time", "notifications", "customers",
    "place", "place_labels", "report_archive", "self_inspection", "instruments", "tools", "settings", "help", "setup", "quotes", "quote", "new_task", "administration"]) {
    assert.equal(nativeHiddenView(view), false, view);
  }
  assert.equal(nativeHiddenView(null), false);
  // Egenkontroll: reading, Avvikelser and Kompetenskort stay; the editor and the office tabs are in level 2.
  assert.equal(nativeHiddenHref("/?view=self_inspection"), false);
  assert.equal(nativeHiddenHref("/?view=deviations"), false);
  assert.equal(nativeHiddenHref("/?view=self_inspection&edit=1"), true);
  for (const tab of ["review", "versions", "levels"]) assert.equal(nativeHiddenHref(`/?view=self_inspection&tab=${tab}`), true, tab);
  assert.equal(nativeHiddenHref("/?view=advanced&section=integrations"), true);
  assert.equal(nativeHiddenHref("/?view=time&step=reported"), false);
  assert.equal(nativeHiddenHref(""), false);
  assert.ok(!NATIVE_HIDDEN_VIEWS.has("settings"), "Mina inställningar is never hidden");
});

test("native mode: Mer and Sök leave the hidden pages out, and Mer has Kalkylator under Verktyg", () => {
  const admin = { memberRole: "OWNER" as const, workflowPermissions: defaultWorkflowPermissionProfile(), ai: true, importPage: true, canBuildForms: true };
  const sections = nativeMoreSections(resolveMenu(admin, { hidden: [], shortcuts: [] }), { productAdmin: true });
  const before = sections.flatMap((section) => section.rows.map((row) => row.key));
  assert.ok(before.includes("import") && before.includes("customer_companies"), JSON.stringify(before));
  const shown = nativeMoreTools(sections);
  const keys = shown.flatMap((section) => section.rows.map((row) => row.key));
  for (const key of ["import", "forms", "customer_companies", "project_summary"]) assert.ok(!keys.includes(key), key);
  assert.ok(keys.includes("settings") && keys.includes("logout"));
  // Slimmer level 1 (2026-10-12): the office rows are not in Mer; the pages themselves are not hidden pages.
  // 2026-10-18 (decision 10): Mer shows the office choices again, last, in their own group before Konto.
  assert.equal(NATIVE_MORE_HIDDEN.size, 0);
  for (const key of ["quotes", "projects", "customers", "purchases"]) assert.ok(keys.includes(key), key);
  const titles = shown.map((section) => section.title ?? "");
  assert.deepEqual(titles.slice(-2), ["Kontor", "Konto"]);
  assert.deepEqual(shown.find((section) => section.title === "Kontor")?.rows.map((row) => row.key), ["purchases", "quotes", "projects", "customers"]);
  assert.ok(!shown.find((section) => section.title === "Verktyg")?.rows.some((row) => row.key === "customers"), "Kunder sits under Kontor only");
  const split = nativeMoreTiles(shown);
  // B3 (2026-10-23): Arbetsordrar is no tile of its own any more; it and Uppgifter are the Jobb tab's one list.
  assert.deepEqual(split.tiles.map((row) => row.key), ["rounds"], "Driftronder is the one tile");
  assert.ok(!split.sections.flatMap((section) => section.rows).some((row) => ["work_orders", "rounds", "tasks", "jobs"].includes(row.key)), "taken out of the rows; both are the Jobb tab's list");
  // Plan 3.2 (2026-11-01): Planering is in Mer, Tid is not when the tab bar has it.
  assert.ok(split.sections.flatMap((section) => section.rows).some((row) => row.key === "planning"), "Planering is in Mer");
  assert.ok(!split.sections.flatMap((section) => section.rows).some((row) => row.key === "time"), "Tid is in the tab bar");
  assert.ok(nativeMoreTiles(shown, { timeTab: false }).sections.flatMap((section) => section.rows).some((row) => row.key === "time"), "without a Tid tab it stays in Mer");
  assert.equal(split.sections.filter((section) => !section.title).length, 1, "Planering and the work are one group");
  assert.ok(split.sections.every((section) => section.rows.length), "no empty group");
  const pair = [{ rows: [{ key: "work_orders", label: "Arbetsordrar", type: "work-order" as const, href: "/?view=work_orders" }] }];
  assert.deepEqual(nativeMoreTiles(pair).sections, [], "with the Jobb tab the list is not repeated in Mer");
  const noTab = nativeMoreTiles(pair, { jobsTab: false });
  assert.deepEqual(noTab.sections[0]?.rows.map((row) => [row.key, row.label, row.href]), [["jobs", "Jobb", "/?view=tasks"]], "without a Jobb button one row Jobb leads to the one list");
  const createOnly = nativeMoreTiles([{ rows: [{ key: "work_orders", label: "Arbetsordrar", type: "work-order", href: "/?view=workflow_task&taskType=WORK_ORDER" }] }]);
  assert.deepEqual(createOnly.sections[0]?.rows.map((row) => row.key), ["work_orders"], "a row that only creates (no right to read the list) stays");
  assert.deepEqual([...NATIVE_TIME_HIDDEN], ["team", "schedule"]);
  assert.deepEqual([...NATIVE_SETTINGS_HIDDEN].sort(), ["advisor", "ai", "apps", "erase", "install", "sidemenu", "start", "theme"]);
  for (const key of ["profile", "security", "display", "home", "notices"] as const) assert.ok(!NATIVE_SETTINGS_HIDDEN.includes(key), key);
  const tools = shown.find((section) => section.title === "Verktyg");
  // Agenter and Nyheter (2026-11-21) come after Kalkylator in Verktyg, then Dokument (0.87.0) last.
  assert.deepEqual(tools?.rows.slice(-4).map((item) => item.key), ["calculator", "agents", "news", "documents"]);
  assert.equal(tools?.rows.at(-4)?.action, "calculator");
  assert.ok(shown.every((section) => section.rows.length), "no empty group");
  // Kalkylator is a page of Verktyg (N19, 2026-11-01): a person who hides it does not get it back in Mer.
  const noCalculator = nativeMoreTools(nativeMoreSections(resolveMenu(admin, { hidden: ["calculators"], shortcuts: [] })));
  assert.ok(!noCalculator.flatMap((section) => section.rows).some((row) => row.key === "calculator"));
  assert.deepEqual(nativeVisibleSections([{ title: "X", rows: [{ key: "import", label: "Import", type: "neutral", href: "/?view=import" }] }]), [], "a group with only hidden rows goes");

  const access: SearchAccess = { admin: true, superadmin: true, local: false, canBuildForms: true, can: () => true,
    features: { credits: true, billing: true, ai: true, integrations: true, landingEditor: true, import: true } };
  const pages = commandCandidates(access);
  const atLevel1 = pages.filter((hit) => !nativeHiddenHref(hit.href)).map((hit) => hit.id);
  for (const id of ["forms", "import", "company", "integrations", "customer_companies", "view_as", "self_inspection_levels"]) assert.ok(!atLevel1.includes(id), id);
  for (const id of ["time", "customers", "settings", "self_inspection", "instruments", "notifications", "help"]) assert.ok(atLevel1.includes(id), id);
});

test("native mode: Rapporterad tid groups the entries per day, newest day first, with the day's total", () => {
  const entries = [{ id: "a", day: "2026-10-09", durationSec: 3600 }, { id: "b", day: "2026-10-09", durationSec: 1800 }, { id: "c", day: "2026-10-01", durationSec: 600 }, { id: "d", day: "2026-10-05", durationSec: 60 }];
  const groups = entriesByDay(entries, (entry) => entry.day);
  assert.deepEqual(groups.map((group) => group.day), ["2026-10-09", "2026-10-05", "2026-10-01"]);
  assert.deepEqual(groups[0].items.map((item) => item.id), ["a", "b"], "the list's own order inside a day");
  assert.equal(groups[0].seconds, 5400);
  assert.deepEqual(entriesByDay([], () => ""), []);
  assert.equal(parseTimeScreen("entry"), "entry", "an entry is changed on its own screen");
  assert.equal(parseTimeScreen("schedule"), "schedule", "Arbetstid is a screen, not a dialog");
  assert.equal(parseTimeScreen("filter"), null, "the filters fold out under their row");
});

// Hem's chosen tiles (2026-10-12): Projekt, Kunder and Sök are no longer offered; an old saved choice still loads.
test("native layout: Projekt, Kunder and Sök are not home tiles, and a saved choice with them is tolerated", () => {
  for (const key of ["projects", "customers", "search"]) assert.ok(!(HOME_TILE_KEYS as readonly string[]).includes(key), key);
  const layout = normalizeNativeLayout({ home: ["jobs", "projects", "customers", "search", "time"], tabs: ["home", "jobs"] });
  assert.deepEqual(layout.home, ["jobs", "time"]);
  assert.deepEqual(layout.tabs, ["home", "jobs"]);
});

test("native mode: a notice never leads to a page that is only in display level 2", async () => {
  const { nativeNoticeHref } = await import("@/lib/workflow/native-mode");
  assert.equal(nativeNoticeHref("/?view=self_inspection&tab=review"), "/?view=self_inspection");
  assert.equal(nativeNoticeHref("/?view=self_inspection&tab=competence"), "/?view=self_inspection&tab=competence");
  assert.equal(nativeNoticeHref("/?view=workflow_task&taskId=1"), "/?view=workflow_task&taskId=1");
});

test("native mode: a very tall step is cut in two, by the weight of its tables (2026-10-12)", () => {
  const column = (index: number) => ({ id: `c${index}`, key: `c${index}`, label: `K${index}`, input: "text" });
  const tableSection = (id: string, title: string) => ({ id, type: "section", title, blocks: [{ id: `${id}t`, type: "table", key: `${id}t`, label: title, columns: Array.from({ length: 19 }, (_, index) => column(index)), rowMode: "fixed", fixedRows: ["a", "b"] }] });
  const document = formDocumentSchema.parse({ schema: 2, blocks: [tableSection("p", "Provning"), tableSection("q", "Mer provning"), fieldSection("z", "Avslut", 3)] });
  const parts = formParts(document, initialFormValues(document));
  assert.ok(parts.length >= 3, `heavy sections are not joined into one: ${parts.map((part) => part.keys)}`);
  assert.deepEqual(parts.flatMap((part) => part.keys), ["p", "q", "z"], "nothing lost, same order");
});

test("every Ny screen lights the Ny tab", () => {
  const params = (query: string) => new URLSearchParams(query);
  assert.equal(nativeTabOf("new_project", params("view=new_project")), "new");
  assert.equal(nativeTabOf("customers", params("view=customers&new=1")), "new");
  assert.equal(nativeTabOf("customers", params("view=customers&customerId=1")), "more");
  assert.equal(nativeTabOf("workflow_task", params("view=workflow_task&taskType=WORK_ORDER")), "new");
  assert.equal(nativeTabOf("workflow_task", params("view=workflow_task&taskId=1")), "jobs");
  assert.equal(nativeTabOf("quote", params("view=quote")), "new");
  assert.equal(nativeTabOf("quote", params("view=quote&quoteId=1")), "more");
});

// The flow row's Nästa on a phone (2026-10-12): a long part name is cut to its first part, never mid-word.
test("shortStepLabel: a long name is cut to its first part; short names and names without a part stay whole", () => {
  assert.equal(shortStepLabel("Isolation och Kontinuitet"), "Isolation");
  assert.equal(shortStepLabel("Jordfelsbrytare, spänning och belastning"), "Jordfelsbrytare");
  assert.equal(shortStepLabel("Mätning – utökad kontroll"), "Mätning");
  assert.equal(shortStepLabel("Grunduppgifter"), "Grunduppgifter");
  assert.equal(shortStepLabel("Kontinuitetsmätningsprotokoll"), "Kontinuitetsmätningsprotokoll", "no part to cut at");
});

// B1 (point 5): Mer says the menu's nouns. At the review (2026-10-23) Planering and Projektstatistik left Mer for the
// Projekt screen, and Skapa formulär is under Verktyg; Kalender followed on 2026-10-30 (Planering's view under Projekt).
test("native mode: Mer has the menu's nouns, Planering among them, Skapa formulär under Verktyg", () => {
  const admin = { memberRole: "OWNER" as const, workflowPermissions: defaultWorkflowPermissionProfile(), ai: true, importPage: true, canBuildForms: true };
  const rows = nativeMoreSections(resolveMenu(admin, { hidden: [], shortcuts: [] })).flatMap((section) => section.rows);
  const row = (key: string) => rows.find((item) => item.key === key);
  assert.equal(row("project_planning"), undefined, "Tidplan is a view of Planering");
  assert.equal(row("project_summary"), undefined);
  assert.equal(row("planning")?.label, "Planering");
  assert.equal(row("planning")?.href, "/?view=planning");
  assert.equal(row("time")?.label, "Tid");
  assert.equal(row("customers")?.label, "Kunder");
  assert.equal(row("work_orders")?.href, "/?view=work_orders");
  assert.ok(rows.every((item) => item.subtitle === undefined), "no menu row has a line under it");
  // A job's right alone: Planering but no Projekt; Arbetsordrar leads to the tasks the person may read.
  const jobOnly = { memberRole: "MEMBER" as const, workflowPermissions: { version: 1 as const, grants: ["forms:read" as const] } };
  const jobRows = nativeMoreSections(resolveMenu(jobOnly, { hidden: [], shortcuts: [] }), { canRead: { projects: false, work_orders: false, tasks: true }, canCreate: { work_orders: false } }).flatMap((section) => section.rows);
  assert.equal(jobRows.find((item) => item.key === "projects"), undefined);
  assert.equal(jobRows.find((item) => item.key === "planning")?.href, "/?view=planning");
  assert.equal(jobRows.find((item) => item.key === "work_orders")?.href, "/?view=tasks");
  const tools = nativeMoreSections(resolveMenu(admin, { hidden: [], shortcuts: [] })).find((section) => section.title === "Verktyg");
  // Webb och inlägg (2026-11-20): the company's admin, under Verktyg; Agenter and Nyheter (2026-11-21), Dokument (0.87.0) last.
  assert.deepEqual(tools?.rows.map((item) => item.key), ["report_archive", "self_inspection", "instruments", "calculator", "forms", "import", "web_posts", "agents", "news", "documents"]);
});
