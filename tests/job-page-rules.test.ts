// Jobbsidan (simulation 2026-10-10): the rules behind the fixes on the work order, task and protocol pages.
import assert from "node:assert/strict";
import { test } from "node:test";
import { blankTemplateValues, formDocumentSchema, formLeafBlocks, formValuesSchema, initialFormValues, newFormRow, type FormTableBlock } from "../lib/workflow/form-document";
import { BUILTIN_FORMS } from "../lib/workflow/builtin-forms";
import { kfidFormDocument } from "../lib/workflow/builtin-kfid-form";
import { applyFormPrefill } from "../lib/workflow/form-prefill";
import { formHasDocumentation, workflowTaskHasDocumentation, workflowTaskInputSchema } from "../lib/workflow/task-model";
import { isBlankMaterialRow, withoutNewBlankRows, type MaterialRow } from "../lib/workflow/expenses";
import { assigneeReadRefusal, memberMayReadJob } from "../lib/workflow/assignee-access";
import { defaultWorkflowPermissionProfile, noWorkflowPermissionProfile } from "../lib/workflow/permissions";
import { formTargetBlockId, formTargetWorkOrderId } from "../lib/workflow/deviation-target";
import { placeAfterCustomerChange, placeFieldFollowsPlace } from "../lib/workflow/customer-place";
import { formPartForTarget, formParts } from "../lib/workflow/native-mode";

test("a protocol is not documented by what it starts with or fills in by itself (fynd 2)", () => {
  // Kontroll före idrifttagning, filled from the task: the place (also its name), Utfört av, today, contact and e-mail.
  const prefilled = applyFormPrefill(kfidFormDocument, initialFormValues(kfidFormDocument), { facility: "Storgatan 5", user: "Elin", today: "2026-10-10", contact: "Per Ek", email: "per@example.invalid" });
  assert.equal(formHasDocumentation(kfidFormDocument, prefilled), false);
  // A moment switched on and a row added with its defaults and limits is not documentation either.
  const iso = kfidFormDocument.blocks.flatMap((block) => block.type === "section" ? block.blocks : []).find((block): block is FormTableBlock => block.type === "table" && block.key === "iso")!;
  const added = { ...prefilled, sections: { ...prefilled.sections, "kfid-iso": true }, tables: { ...prefilled.tables, iso: [newFormRow(iso, "r1", { limitValue: () => 1 })] } };
  assert.equal(formHasDocumentation(kfidFormDocument, added), false);
  // A measured value is.
  const measured = { ...added, tables: { ...added.tables, iso: [{ ...added.tables.iso[0], cells: { ...added.tables.iso[0].cells, mohm: 250 } }] } };
  assert.equal(formHasDocumentation(kfidFormDocument, measured), true);

  // A field's default value ("Kontrollintervall 12") is preset; another value is an answer.
  const document = formDocumentSchema.parse({ schema: 2, blocks: [{ id: "s", type: "section", title: "Allmänt", blocks: [
    { id: "interval", type: "field", key: "intervall", label: "Kontrollintervall", input: "number", defaultValue: 12 },
    { id: "note", type: "field", key: "notering", label: "Notering", input: "text" },
  ] }] });
  const values = initialFormValues(document);
  assert.equal(formHasDocumentation(document, values), false);
  assert.equal(formHasDocumentation(document, { ...values, fields: { ...values.fields, intervall: 24 } }), true);
  assert.equal(formHasDocumentation(document, { ...values, fields: { ...values.fields, notering: "Lucka saknas" } }), true);
  // The same rule decides the stored status (Cloud, Local and the demo save with workflowTaskHasDocumentation).
  const task = workflowTaskInputSchema.parse({ kind: "FORM", title: "Storgatan 5", data: { kind: "FORM", details: { templateId: "kfid", templateVersion: 1, templateName: "Kontroll före idrifttagning", document: kfidFormDocument, values: prefilled } } });
  assert.equal(workflowTaskHasDocumentation(task), false, "a new protocol stays Planerad until something is filled in");
});

test("a new blank material or expense row is not saved; a saved one stays (fynd 7)", () => {
  const blank: MaterialRow = { id: "e1", kind: "expense", name: "", quantity: "", unit: "", unitPrice: "", amount: "" };
  const filled: MaterialRow = { id: "m1", name: "Kabel", quantity: "2", unit: "m" };
  assert.equal(isBlankMaterialRow(blank), true);
  assert.equal(isBlankMaterialRow(filled), false);
  assert.equal(isBlankMaterialRow({ ...blank, unitPrice: "0" }), false, "a price written is something written");
  const rows = [filled, blank];
  assert.deepEqual(withoutNewBlankRows(rows, new Set(["m1"])).map((row) => row.id), ["m1"]);
  assert.equal(withoutNewBlankRows(rows, new Set(["m1", "e1"])), rows, "a saved row cleared by the person stays");
  assert.deepEqual(withoutNewBlankRows([filled], new Set()).map((row) => row.id), ["m1"], "a new row with something in it is saved");
});

test("Ansvarig: only someone who may read the job's type (fynd 5)", () => {
  const field = { role: "MEMBER", workflowPermissions: { version: 1, grants: ["work-order:read", "work-order:edit"] } };
  assert.equal(memberMayReadJob(field, "work-order"), true);
  assert.equal(memberMayReadJob(field, "kfid"), false);
  assert.equal(memberMayReadJob({ role: "ADMIN", workflowPermissions: noWorkflowPermissionProfile() }, "kfid"), true, "an administrator reads everything");
  assert.equal(memberMayReadJob({ role: "MEMBER", workflowPermissions: null }, "work-order"), false);
  assert.equal(memberMayReadJob({ role: "MEMBER", workflowPermissions: defaultWorkflowPermissionProfile() }, "work-order"), true);
  assert.match(assigneeReadRefusal("Anna", "kfid"), /^Anna får inte läsa Kontroll före idrifttagning och kan därför inte vara ansvarig\. Välj någon annan/);
});

test("a deviation target leads to its block, and on a phone to the form part that holds it (fynd 8)", () => {
  const document = formDocumentSchema.parse({ schema: 2, blocks: [
    { id: "a", type: "section", title: "Allmänt", blocks: [{ id: "f", type: "field", key: "namn", label: "Namn", input: "text" }] },
    { id: "b", type: "section", title: "Punkter", blocks: [{ id: "c", type: "checklist", key: "punkter", label: "Punkter", items: [{ id: "p1", text: "Skylt" }] }] },
    { id: "t", type: "section", title: "Mätningar", blocks: [{ id: "tab", type: "table", key: "rader", label: "Mätningar", columns: [{ id: "col-v", key: "v", label: "Värde", input: "number" }] }] },
  ] });
  const values = initialFormValues(document);
  values.tables.rader = [{ id: "row-9", label: "", cells: { v: 3 } }];
  assert.equal(formTargetBlockId(document, values, "row-9"), "tab");
  assert.equal(formTargetBlockId(document, values, "checklist:punkter:p1"), "c");
  assert.equal(formTargetBlockId(document, values, "field:namn"), "f");
  assert.equal(formTargetBlockId(document, values, "row-404"), null);
  assert.equal(formPartForTarget(`form-${formTargetBlockId(document, values, "row-9")}`, formParts(document, values)), 3);
  // The "Arbetsordern är utförd" toast needs a work order made from the target (Fas 2).
  assert.equal(formTargetWorkOrderId(values, "row-9"), null);
  values.tables.rader[0].workOrderId = "wo-1";
  assert.equal(formTargetWorkOrderId(values, "row-9"), "wo-1");
  values.workOrders = { "checklist:punkter:p1": "wo-2" };
  assert.equal(formTargetWorkOrderId(values, "checklist:punkter:p1"), "wo-2");
});

test("the place field keeps text typed by hand; the only place is still chosen (fynd 4)", () => {
  assert.equal(placeFieldFollowsPlace("", ["Storgatan 5"]), true);
  assert.equal(placeFieldFollowsPlace("Storgatan 5", ["Storgatan 5", "Projekt Bageriet"]), true);
  assert.equal(placeFieldFollowsPlace("Projekt Bageriet", ["Storgatan 5", "Projekt Bageriet"]), true);
  assert.equal(placeFieldFollowsPlace("Bageriet ny central", ["Storgatan 5"]), false);
  // The work order's rule, now also for a protocol whose place field was typed first.
  assert.equal(placeAfterCustomerChange([{ id: "p1", customerId: "per", isActive: true }], "per", null), "p1");
});

test("the measuring forms offer the instrument register and the chosen instrument survives a parse (Fas 2)", () => {
  for (const id of ["hintek-isolationsmatning-ebr", "hintek-foljelinematning-ebr"]) {
    const form = BUILTIN_FORMS.find((item) => item.id === id)!;
    const field = formLeafBlocks(form.document).find((block) => block.type === "field" && block.key === "instrument");
    assert.equal(field && field.type === "field" ? field.prefill : null, "instrument", `${id}: Mätinstrument is picked from the register`);
  }
  const document = BUILTIN_FORMS.find((item) => item.id === "hintek-isolationsmatning-ebr")!.document;
  const values = initialFormValues(document);
  values.instruments = { instrument: { id: "inst-1", overdue: true } };
  assert.deepEqual(formValuesSchema.parse(JSON.parse(JSON.stringify(values))).instruments, { instrument: { id: "inst-1", overdue: true } });
});

test("an empty paper template prints the optional parts that a protocol starts with off (Fas 2)", () => {
  const optional = kfidFormDocument.blocks.filter((block) => block.type === "section" && block.optional);
  assert.ok(optional.length > 0);
  const started = initialFormValues(kfidFormDocument);
  assert.ok(optional.some((section) => started.sections[section.id] === false), "a protocol starts with some parts off");
  const blank = blankTemplateValues(kfidFormDocument);
  assert.ok(optional.every((section) => blank.sections[section.id] === true));
});
