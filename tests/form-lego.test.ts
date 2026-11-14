import assert from "node:assert/strict";
import test from "node:test";
import { kfidFormDocument } from "../lib/workflow/builtin-kfid-form";
import { evaluateForm, formApprovalResult, formApprovalTotals, formRowPending, NEEDS_LIMIT_TEXT, formBand, formCanDeviate, formColumnLabelParts, formCompletion, formDocumentSchema, formRowStarted, initialFormValues, newFormRow, validateFormDocument, type FormTableBlock } from "../lib/workflow/form-document";
import { applyFormPrefill, customerPrefill } from "../lib/workflow/form-prefill";
import { suggestedLimits } from "./helpers/suggested-limits";

/** A company that has pressed "Använd förslagen" under Värden och referenser (2026-10-06). */
const SUGGESTED = suggestedLimits(kfidFormDocument);

/** The building blocks added backwards from Kontroll före idrifttagning and Riskbedömning (2026-09-27). */
const table =(key: string) => kfidFormDocument.blocks.flatMap((block) => block.type === "section" ? block.blocks : []).find((block): block is FormTableBlock => block.type === "table" && block.key === key)!;

test("sections that can be switched off start off, count nothing while off and at least one must be on", () => {
  const values = initialFormValues(kfidFormDocument);
  assert.deepEqual(Object.values(values.sections), [false, false, false, false, false, false]);
  assert.deepEqual(values.tables.iso, [], "measurement rows start empty like the control");
  const off = formCompletion(kfidFormDocument, values);
  assert.ok(off.issues.some((item) => item.message === "Välj minst ett kontrollmoment."));
  assert.ok(!off.issues.some((item) => item.message.startsWith("Isolation")), "a switched-off moment asks for nothing");
  values.sections["kfid-iso"] = true;
  const on = formCompletion(kfidFormDocument, values);
  assert.ok(!on.issues.some((item) => item.message === "Välj minst ett kontrollmoment."));
  assert.ok(on.issues.some((item) => item.message === "Isolation: fyll i minst en rad."));
});

test("Godkänd always follows the condition: a value below its limit stays not approved (Autobedömning is no longer a choice, 2026-10-02)", () => {
  const values = initialFormValues(kfidFormDocument);
  values.sections["kfid-iso"] = true;
  const iso = table("iso");
  values.tables.iso = [{ ...newFormRow(iso, "r1"), cells: { ...newFormRow(iso, "r1").cells, objekt: "Grupp 1", mohm: "0,4", ok: true } }];
  // 2026-10-06: without its limit the row is not judged – no deviation, not approved, a warning that leads to the limit.
  const waiting = evaluateForm(kfidFormDocument, values);
  assert.equal(waiting.cells.iso.r1.ok, null);
  assert.deepEqual(waiting.deviations, []);
  assert.deepEqual(waiting.alerts.map((item) => [item.message, item.column]), [["Isolation, Grupp 1: ej bedömd – ange gräns.", "limit"]]);
  assert.deepEqual(formRowPending(iso, iso.columns.find((column) => column.key === "ok")!, values.tables.iso[0], values, waiting), { text: NEEDS_LIMIT_TEXT, column: iso.columns.find((column) => column.key === "limit") });
  assert.deepEqual(formApprovalTotals(kfidFormDocument, values, waiting), [{ blockId: iso.id, title: "Isolation", ok: 0, total: 1 }]);
  assert.ok(formCompletion(kfidFormDocument, values).issues.some((item) => /Isolation, rad 1: fyll i gräns/.test(item.message)), "the limit is still a required field");
  values.tables.iso[0].cells.limit = 1;
  const auto = evaluateForm(kfidFormDocument, values);
  assert.equal(auto.cells.iso.r1.ok, false, "0,4 MΩ is below the 1 MΩ limit");
  assert.deepEqual(auto.deviations.map((item) => [item.message, item.kind]), [["Isolation, Grupp 1: inte godkänd.", "assessment"]]);
  assert.deepEqual(formApprovalTotals(kfidFormDocument, values, auto), [{ blockId: iso.id, title: "Isolation", ok: 0, total: 1 }]);
});

test("the RCD time limit per standard follows the company's values (here Workflow's suggestions), old short names still judge, and the 1× times are always required", () => {
  const values = initialFormValues(kfidFormDocument);
  values.sections["kfid-rcd"] = true;
  const rcd = table("rcd");
  const row = newFormRow(rcd, "p1");
  values.tables.rcd = [{ ...row, cells: { ...row.cells, place: "JFB 1", std: "IEC 60364-4-41 TT", t1p: 240, t1n: 190, t5p: 30, t5n: 30, ntrip05: true, btnok: true } }];
  // Without the company's values the row waits for them (2026-10-06): not judged, never Godkänd or a deviation.
  const waiting = evaluateForm(kfidFormDocument, values);
  assert.equal(waiting.cells.rcd.p1.ok, null);
  assert.deepEqual(waiting.deviations, []);
  // Only the chosen standard's 1× time is read, with the 5× time and the chosen Uc limit.
  assert.deepEqual(waiting.missingLimits?.rcd?.p1, ["rcd_t1_tt", "rcd_t5", "rcd_uc_50"]);
  assert.deepEqual(formRowPending(rcd, rcd.columns.find((column) => column.key === "ok")!, values.tables.rcd[0], values, waiting), { text: NEEDS_LIMIT_TEXT, column: null });
  assert.deepEqual(waiting.alerts.map((item) => item.message), ["Jordfelsbrytarprov, JFB 1: ej bedömd – ange gräns."]);
  // A row that fails on something the limits do not decide is still not approved.
  values.tables.rcd[0].cells.btnok = false;
  assert.equal(evaluateForm(kfidFormDocument, values).cells.rcd.p1.ok, false);
  values.tables.rcd[0].cells.btnok = true;
  values.limits = SUGGESTED;
  assert.equal(evaluateForm(kfidFormDocument, values).cells.rcd.p1.ok, false, "TT allows at most 200 ms");
  values.tables.rcd[0].cells.std = "IEC 60364-4-41 TN/IT";
  assert.equal(evaluateForm(kfidFormDocument, values).cells.rcd.p1.ok, true, "TN/IT allows 400 ms");
  values.tables.rcd[0].cells.std = "EN 61008 / EN 61009";
  assert.equal(evaluateForm(kfidFormDocument, values).cells.rcd.p1.ok, true, "EN allows 300 ms");
  values.tables.rcd[0].cells.std = "TT";
  assert.equal(evaluateForm(kfidFormDocument, values).cells.rcd.p1.ok, false, "an older protocol's short name TT still allows 200 ms");
  values.tables.rcd[0].cells.std = "IEC 60364-4-41 TN/IT";
  values.tables.rcd[0].cells.t1p = "";
  assert.ok(formCompletion(kfidFormDocument, values).issues.some((item) => item.message === "Jordfelsbrytarprov, Prov 1: fyll i t 1× (+)."));
});

test("Ej mätt counts as not filled in, and an untouched row with only default values does not count", () => {
  const volt = table("volt");
  const row = newFormRow(volt, "v1");
  assert.equal(row.cells.status, "Ej mätt");
  assert.equal(formRowStarted(volt, row), false);
  const values = initialFormValues(kfidFormDocument);
  values.sections["kfid-volt"] = true;
  values.tables.volt = [{ ...row, cells: { ...row.cells, name: "Uttag kök" } }];
  assert.ok(formCompletion(kfidFormDocument, values).issues.some((item) => item.message === "Spänningsprovning, rad 1: fyll i spänning."));
});

test("an example row is filled from the example values, never counts and must be removed", () => {
  const iso = table("iso");
  const example = newFormRow(iso, "e1", { example: true });
  assert.equal(example.example, true);
  assert.equal(example.cells.objekt, "Krets 1");
  const values = initialFormValues(kfidFormDocument);
  values.sections["kfid-iso"] = true;
  values.tables.iso = [example];
  const completion = formCompletion(kfidFormDocument, values);
  assert.ok(completion.issues.some((item) => item.message === "Isolation: ta bort exempelraden före slutförande."));
  assert.ok(completion.issues.some((item) => item.message === "Isolation: fyll i minst en rad."), "the example is not a real row");
  assert.equal(completion.evaluation.deviations.length, 0);
});

test("tick-box checklists are registered point by point like Visuell kontroll", () => {
  const values = initialFormValues(kfidFormDocument);
  values.sections["kfid-vis"] = true;
  values.checklists.vis = { markning: { state: "OK", comment: "" }, dok: { state: "NOT_OK", comment: "" } };
  const completion = formCompletion(kfidFormDocument, values);
  assert.ok(completion.issues.some((item) => item.message === "Visuell kontroll: registrera ”Mekaniskt skydd och infästning OK”."));
  assert.deepEqual(completion.evaluation.deviations.map((item) => item.kind), ["assessment"]);
});

test("levels name a value, a scale is a number in formulas, and the form knows whether it can deviate", () => {
  const bands = [{ from: 1, label: "Låg", tone: "success" as const }, { from: 10, label: "Hög", tone: "danger" as const }];
  assert.equal(formBand(bands, 12)?.label, "Hög");
  assert.equal(formBand(bands, 4)?.label, "Låg");
  assert.equal(formBand(bands, null), null);
  const document = formDocumentSchema.parse({ schema: 2, blocks: [{ id: "s", type: "section", blocks: [
    { id: "t", type: "table", key: "risker", label: "Risker", columns: [
      { id: "a", key: "s", label: "Sannolikhet", input: "scale", options: ["Låg", "Medel", "Hög"] },
      { id: "b", key: "k", label: "Konsekvens", input: "scale", options: ["Låg", "Medel", "Hög"] },
      { id: "c", key: "p", label: "Risk", input: "formula", formula: "[s] * [k]", bands },
    ] },
  ] }] });
  assert.deepEqual(validateFormDocument(document).issues, []);
  const values = initialFormValues(document);
  values.tables.risker = [{ id: "r1", label: "", cells: { s: 3, k: 3 } }];
  assert.equal(evaluateForm(document, values).cells.risker.r1.p, 9);
  assert.equal(formCanDeviate(document), false);
  assert.equal(formCanDeviate(kfidFormDocument), true);
});

test("the builder is told what is wrong with a Godkänd column or a card heading", () => {
  const broken = formDocumentSchema.parse({ schema: 2, blocks: [{ id: "s", type: "section", blocks: [
    { id: "t", type: "table", key: "t", label: "Prov", cardTitle: "{saknas}", columns: [
      { id: "a", key: "v", label: "Värde", input: "number" },
      { id: "b", key: "ok", label: "Godkänd", input: "assessment", mode: "switch", switchKey: "finns_inte" },
    ] },
  ] }] });
  const messages = validateFormDocument(broken).issues.map((item) => item.message);
  assert.ok(messages.includes("Prov, Godkänd: ange villkoret för godkänt."));
  assert.ok(messages.includes("Prov, Godkänd: välj det Ja/nej-fält som slår på villkoret."));
  assert.ok(messages.includes("Prov: rubriken i PDF använder {saknas}, som inte är en kolumn."));
});

test("fields start from the task's customer, facility, responsible person and today, like the control's customer picker", () => {
  const values = initialFormValues(kfidFormDocument);
  // Utfört av starts from the signed-in user (the control's), not from the responsible person (2026-09-28).
  const source = { customer: "Brf Solgläntan", contact: "Anna Berg", email: "anna@example.se", facility: "Elcentral A1, Storgatan 1", assignee: "Elon Strömberg", user: "Elin Elektriker", today: "2026-09-27" };
  const filled = applyFormPrefill(kfidFormDocument, values, source);
  assert.deepEqual([filled.fields.proj, filled.fields.perf, filled.fields.date, filled.fields.client, filled.fields.addr], ["Elcentral A1, Storgatan 1", "Elin Elektriker", "2026-09-27", "Anna Berg", "anna@example.se"]);
  const typed = { ...filled, fields: { ...filled.fields, client: "Någon annan" } };
  assert.equal(applyFormPrefill(kfidFormDocument, typed, { ...source, contact: "Ny" }).fields.client, "Någon annan", "an answer is not replaced");
  assert.equal(applyFormPrefill(kfidFormDocument, typed, { ...source, contact: "Ny kund" }, { kinds: ["contact"], overwrite: true }).fields.client, "Ny kund", "a new customer gives a new contact");
});

test("Kontaktperson is only filled with a real contact person, never the customer's name (2026-10-07)", () => {
  const brf = { name: "Brf Exempelgården", company: "Brf Exempelgården", email: "styrelsen@example.se" };
  // In a project: the project's contact person, or nothing.
  assert.deepEqual(customerPrefill(brf, { contactPerson: "" }), { customer: "Brf Exempelgården", contact: "", email: "styrelsen@example.se" });
  assert.deepEqual(customerPrefill({ ...brf, name: "Styrelsen Brf Exempelgården" }, { contactPerson: null }).contact, "", "the customer's name is not a contact in a project");
  assert.equal(customerPrefill(brf, { contactPerson: "Anna Berg" }).contact, "Anna Berg");
  // Without a project: the customer's Namn / kontaktperson only when it names someone beside the company.
  assert.equal(customerPrefill({ name: "Anna Berg", company: "Brf Solgläntan", email: "" }).contact, "Anna Berg");
  assert.equal(customerPrefill({ name: "Brf Solgläntan", company: "", email: "" }).contact, "");
  assert.equal(customerPrefill(brf).contact, "");
  // A Privatperson is their own contact (simulation 2026-10-10: Kontaktperson stayed empty for Per Ek).
  assert.equal(customerPrefill({ name: "Per Ek", company: "", email: "", customerType: "PRIVATE" }).contact, "Per Ek");
  assert.equal(customerPrefill({ name: "Per Ek", company: "", email: "", customerType: "PRIVATE" }, { contactPerson: "" }).contact, "", "a project's own contact person applies in a project");
  const filled = applyFormPrefill(kfidFormDocument, initialFormValues(kfidFormDocument), customerPrefill(brf, { contactPerson: "" }));
  assert.equal(filled.fields.client ?? "", "", "the control's Kontaktperson stays empty");
});

test("Spara som copies the answers but not signatures, pictures or example rows", async () => {
  const { copyFormValues } = await import("../lib/workflow/form-document");
  const values = initialFormValues(kfidFormDocument);
  values.fields.proj = "Elcentral A1";
  values.tables.iso = [{ id: "r1", label: "", cells: { objekt: "Grupp 1", mohm: "250", bild: ["att-1"] } }, { id: "e1", label: "", cells: { objekt: "Krets 1" }, example: true }];
  values.images.vis_bilder = ["att-2"];
  values.signatures.x = { name: "Elon", confirmed: true, signedAt: "2026-09-27T10:00:00.000Z" };
  const copy = copyFormValues(values);
  assert.equal(copy.fields.proj, "Elcentral A1");
  assert.deepEqual(copy.tables.iso, [{ id: "r1", label: "", cells: { objekt: "Grupp 1", mohm: "250" } }]);
  assert.deepEqual(copy.images, {});
  assert.deepEqual(copy.signatures.x, { name: "Elon", confirmed: false, signedAt: null });
  assert.deepEqual(values.tables.iso[0].cells.bild, ["att-1"], "the original is untouched");
});

test("the task view exactly like the originals (2026-09-27): the new building blocks parse with defaults and the originals use them", async () => {
  const { formRuleSummary } = await import("../lib/workflow/form-document");
  const { riskFormDocument } = await import("../lib/workflow/builtin-risk-form");
  // Additive schema: an older document reads with the defaults, so published versions and protocols are unchanged.
  const plain = formDocumentSchema.parse({ schema: 2, blocks: [{ id: "s", type: "section", title: "A", blocks: [
    { id: "t", type: "table", key: "t", label: "T", columns: [{ id: "c", key: "c", label: "C", input: "number" }] },
    { id: "n", type: "note", title: "N" }, { id: "m", type: "matrix" }, { id: "g", type: "signature", key: "g", label: "G" },
  ] }] });
  assert.deepEqual(plain.task, { layout: "panel", titleKey: "", requiredMarks: true, newTitle: "", tagline: "" });
  assert.equal(plain.moments.placement, "top");
  const section = plain.blocks[0];
  assert.ok(section.type === "section" && section.help === "" && section.taskTitle === "");
  const [plainTable, plainNote, plainMatrix, plainSignature] = section.type === "section" ? section.blocks : [];
  assert.ok(plainTable.type === "table" && plainTable.taskLayout === "same" && plainTable.copyRows && plainTable.emptyTitle === "" && plainTable.itemLabelPlural === "");
  assert.ok(plainTable.type === "table" && plainTable.columns[0].placement === "body" && plainTable.columns[0].cardWidth === "auto" && plainTable.columns[0].line === 1 && plainTable.columns[0].screenWidth === "" && plainTable.columns[0].group === "");
  assert.ok(plainNote.type === "note" && plainNote.style === "folded" && plainNote.width === "full");
  assert.ok(plainMatrix.type === "matrix" && !plainMatrix.tall && plainMatrix.width === "full");
  assert.ok(plainSignature.type === "signature" && plainSignature.statement === "" && plainSignature.placeholder === "");

  // The control: the task's basics inside Grunduppgifter with the moments below, the RCD test as two-line rows on
  // screen but cards in the PDF, and no requirement text under the row (the limits stand beside Standard, 2026-10-05).
  assert.deepEqual(kfidFormDocument.task, { layout: "inline", titleKey: "proj", requiredMarks: false, newTitle: "Ny kontroll", tagline: "Från första mätningen till ett samlat protokoll." });
  const perf = kfidFormDocument.blocks.flatMap((block) => block.type === "section" ? block.blocks : []).find((block) => "key" in block && block.key === "perf");
  assert.ok(perf?.type === "field" && perf.prefill === "user", "Utfört av is the signed-in user, like the control");
  assert.equal(applyFormPrefill(kfidFormDocument, initialFormValues(kfidFormDocument), { user: "Elin Exempel" }).fields.perf, "Elin Exempel");
  assert.equal(kfidFormDocument.moments.placement, "firstSection");
  const rcd = table("rcd");
  assert.equal(rcd.layout, "cards"); assert.equal(rcd.taskLayout, "rows"); assert.equal(rcd.copyRows, false);
  assert.deepEqual(rcd.columns.filter((column) => column.line === 2).map((column) => column.key), ["place", "t1p", "t1n", "t5p", "t5n", "uc", "ntrip05", "btnok"]);
  const values = initialFormValues(kfidFormDocument);
  values.sections["kfid-rcd"] = true;
  values.tables.rcd = [newFormRow(rcd, "r1")];
  values.tables.rcd[0].cells.std = "IEC 60364-4-41 TN/IT";
  assert.equal(rcd.columns.some((column) => column.placement === "note"), false, "no text under the RCD row");

  // The risk assessment: Före → Efter in the card's title row, the two rating groups, the approval statement.
  assert.deepEqual(validateFormDocument(riskFormDocument).issues, []);
  const risks = riskFormDocument.blocks.flatMap((block) => block.type === "section" ? block.blocks : []).find((block): block is FormTableBlock => block.type === "table")!;
  assert.deepEqual(risks.columns.filter((column) => column.placement === "header").map((column) => column.cardLabel), ["Före", "Efter"]);
  assert.deepEqual([...new Set(risks.columns.map((column) => column.group).filter(Boolean))], ["Före skyddsåtgärd", "Kvarvarande risk efter åtgärd", "Handlingsplan"]);
  assert.equal(risks.copyRows, false); assert.equal(risks.itemLabelPlural, "risker");

  // Sammanställ resultat: the control's first draft of the summary.
  const filled = initialFormValues(kfidFormDocument);
  filled.fields.proj = "Elcentral A1"; filled.fields.auto = "YES";
  filled.sections["kfid-iso"] = true; filled.sections["kfid-vis"] = true;
  filled.tables.iso = [{ ...newFormRow(table("iso"), "i1"), cells: { objekt: "Grupp 1", u: "500 V", mohm: "250", limit: "1", comment: "Ny kabel" } }];
  filled.checklists.vis = { markning: { state: "OK", comment: "" } };
  assert.equal(formRuleSummary(kfidFormDocument, filled), [
    "Kontroll av Elcentral A1.", "Isolation: 1 av 1 kontrollrader godkända.", "Isolation — Grupp 1: Ny kabel",
    "Märkning och skyltning utförd: kontrollerat.", "Dokumentation lämnad (schema / ritning): ej bekräftat.", "Mekaniskt skydd och infästning OK: ej bekräftat.", "IP-klass och omgivning lämplig: ej bekräftat.",
    "Beröringsskydd, kapslingar och lock på plats: ej bekräftat.", "Polaritet och funktion hos manöverdon kontrollerad: ej bekräftat.",
    // A conclusion closes the summary (2026-10-01).
    "Bedömning: inga avvikelser hittills, men 5 punkter är inte bekräftade.",
  ].join("\n"));
});

test("the material for a written summary names every deviation's row; the rules' own summary stays as it is", async () => {
  const { formRuleSummary, formSummaryMaterial, initialFormValues, newFormRow, formLeafBlocks } = await import("../lib/workflow/form-document");
  const { kfidFormDocument } = await import("../lib/workflow/builtin-kfid-form");
  const table = formLeafBlocks(kfidFormDocument).find((block) => block.type === "table" && block.key === "iso");
  assert.ok(table && table.type === "table");
  const values = initialFormValues(kfidFormDocument);
  values.fields.auto = "YES";
  values.sections["kfid-iso"] = true;
  values.tables.iso = [{ ...newFormRow(table, "i1"), cells: { objekt: "Grupp 7 – uttag kök", u: "500 V", mohm: "0,2", limit: "1" } }];
  const summary = formRuleSummary(kfidFormDocument, values);
  // 2026-10-05: the summary names the rows that are not approved, and its conclusion counts them.
  assert.match(summary, /^Isolation: 0 av 1 kontrollrader godkända\.$/m);
  assert.match(summary, /^Inte godkända – Isolation: Grupp 7 – uttag kök\.$/m);
  assert.match(summary, /^Bedömning: 1 kontrollrad är inte godkänd – åtgärdas/m);
  const material = formSummaryMaterial(kfidFormDocument, values);
  assert.ok(material.startsWith(summary), "the rules' summary first, unchanged");
  assert.equal(material.match(/Grupp 7/g)?.length, 1, "the row is named once, not again in a second list");
  values.deviationComment = "Åtgärdas av beställaren.";
  assert.match(formSummaryMaterial(kfidFormDocument, values), /Anteckning \(personens egen text; antalen ovan gäller\): Åtgärdas av beställaren\.$/);
  // Nothing wrong: nothing added.
  values.deviationComment = "";
  values.tables.iso = [{ ...newFormRow(table, "i1"), cells: { objekt: "Grupp 1", u: "500 V", mohm: "250", limit: "1" } }];
  assert.equal(formSummaryMaterial(kfidFormDocument, values), formRuleSummary(kfidFormDocument, values));
});

test("the RCD test as in V1 (2026-10-05): the Standard label shows the chosen standard's limits, the Uc label and the judgement follow the chosen Uc limit", () => {
  const rcd = table("rcd");
  const column = (key: string) => rcd.columns.find((item) => item.key === key)!;
  const values = initialFormValues(kfidFormDocument);
  values.sections["kfid-rcd"] = true;
  const row = newFormRow(rcd, "r1");
  values.tables.rcd = [{ ...row, cells: { ...row.cells, place: "JFB 1", std: "IEC 60364-4-41 TN/IT", t1p: 380, t1n: 390, t5p: 30, t5n: 30, ntrip05: true, btnok: true, uc: 30 } }];
  assert.equal(formColumnLabelParts(rcd, evaluateForm(kfidFormDocument, values).cells.rcd.r1, column("std")).hint, "gräns saknas", "without the company's value the hint says so");
  values.limits = SUGGESTED;
  const cells = values.tables.rcd[0].cells;
  const labels = () => {
    const result = evaluateForm(kfidFormDocument, values).cells.rcd.r1;
    return { std: formColumnLabelParts(rcd, result, column("std")), uclim: formColumnLabelParts(rcd, result, column("uclim")), ok: result.ok };
  };
  assert.deepEqual(labels().std, { label: "", hint: "1× ≤ 400 ms, 5× ≤ 40 ms" });
  assert.deepEqual(labels().uclim, { label: "Uc ≤ 50 Vac", hint: "" });
  assert.equal(labels().ok, true);
  cells.std = "IEC 60364-4-41 TT";
  assert.equal(labels().std.hint, "1× ≤ 200 ms, 5× ≤ 40 ms");
  assert.equal(labels().ok, false, "380 ms is too slow under TT");
  cells.std = "EN 61008 / EN 61009";
  cells.t1p = 280; cells.t1n = 290;
  assert.equal(labels().std.hint, "1× ≤ 300 ms, 5× ≤ 40 ms");
  assert.equal(labels().ok, true);
  cells.uclim = "≤ 25";
  assert.deepEqual(labels().uclim, { label: "Uc ≤ 25 Vac", hint: "" });
  assert.equal(labels().ok, false, "30 V is above a 25 V limit");
  cells.uc = "";
  assert.equal(labels().ok, true, "an Uc that was not measured is not judged");
  cells.uclim = "25"; cells.uc = 20;
  assert.equal(labels().uclim.label, "Uc ≤ 25 Vac", "an older protocol's short value still works");
  assert.equal(labels().ok, true);
  // Both tick boxes are confirmed by hand, as in V1 (2026-10-05).
  cells.ntrip05 = false;
  assert.equal(labels().ok, false, "0,5× IΔn ej utlöst must be ticked");
  cells.ntrip05 = true; cells.btnok = false;
  assert.equal(labels().ok, false, "Testknapp OK must be ticked");
  cells.btnok = true;
  assert.equal(labels().ok, true);
  cells.std = "";
  assert.equal(labels().std.hint, "", "no standard, no limits");
  // The decorating columns are only labels on screen: never printed.
  for (const key of ["std_limits", "uclim_label"]) assert.equal(column(key).pdf, "hide");
});

test("instrument review (2026-10-05): 5× IΔn is left empty where the tester cannot run it, a measured 5× is always judged", () => {
  const rcd = table("rcd");
  const column = (key: string) => rcd.columns.find((item) => item.key === key)!;
  const values = initialFormValues(kfidFormDocument);
  values.sections["kfid-rcd"] = true;
  const row = newFormRow(rcd, "r1");
  values.tables.rcd = [{ ...row, cells: { ...row.cells, place: "JFB 1", std: "EN 61008 / EN 61009", type: "A", idn: "30", t1p: 25, t1n: 30, t5p: "", t5n: "", ntrip05: true, btnok: true } }];
  values.limits = SUGGESTED;
  const cells = values.tables.rcd[0].cells;
  const result = () => evaluateForm(kfidFormDocument, values).cells.rcd.r1;
  assert.equal(result().ok, false, "at 30 mA type A the 5× test is needed");
  assert.equal(formColumnLabelParts(rcd, result(), column("std")).hint, "1× ≤ 300 ms, 5× ≤ 40 ms");
  cells.idn = "300";
  assert.equal(result().ok, true, "the tester cannot run 5× at 300 mA type A");
  assert.equal(formColumnLabelParts(rcd, result(), column("std")).hint, "1× ≤ 300 ms, 5× provas inte");
  cells.type = "AC";
  assert.equal(result().ok, false, "type AC can run 5× at 300 mA");
  cells.type = "B"; cells.idn = "500";
  assert.equal(result().ok, true);
  cells.t5p = 60; cells.t5n = 60;
  assert.equal(result().ok, false, "a measured 5× time above 40 ms still fails");
  cells.t5p = 20;
  assert.equal(result().ok, false, "both 5× times are judged");
  cells.t5n = 20;
  assert.equal(result().ok, true);
  cells.t5n = "";
  assert.equal(result().ok, false, "half a 5× test is not approved");
  cells.t5p = ""; cells.t1n = "";
  assert.equal(result().ok, false, "both 1× times are always needed");
  for (const key of ["t5p", "t5n"]) assert.equal(column(key).required, false);
  for (const key of ["t1p", "t1n"]) assert.equal(column(key).required, true);
  // Completion no longer asks for 5×; Godkänd does whenever 5× can be run.
  cells.t1n = 30; cells.idn = "30"; cells.type = "A";
  const issues = formCompletion(kfidFormDocument, values).issues.map((item) => item.message);
  assert.ok(!issues.some((message) => message.includes("t 5×")), issues.join("; "));
  assert.ok(issues.some((message) => message.startsWith("Inte godkänt – Jordfelsbrytarprov")), "the missing 5× makes the row not approved: " + issues.join("; "));
});

test("instrument review (2026-10-05): a left-hand phase sequence is not approved, a missing one is not judged", () => {
  const volt = table("volt");
  const values = initialFormValues(kfidFormDocument);
  values.sections["kfid-volt"] = true;
  const row = newFormRow(volt, "v1");
  values.tables.volt = [{ ...row, cells: { ...row.cells, name: "Huvudmatning", status: "400 Vac", rotation: "Höger" } }];
  const cells = values.tables.volt[0].cells;
  const ok = () => evaluateForm(kfidFormDocument, values).cells.volt.v1.ok;
  assert.equal(ok(), true);
  cells.rotation = "Vänster";
  assert.equal(ok(), false);
  // 2026-10-06: at 400 Vac a rotation not measured is not judged (never Godkänd), with a warning, like the older editor.
  cells.rotation = "Ej mätt";
  assert.equal(ok(), "Ej bedömd – ange rotation");
  const evaluation = evaluateForm(kfidFormDocument, values);
  assert.deepEqual(evaluation.deviations, [], "not judged is no deviation");
  assert.deepEqual(evaluation.alerts.map((item) => [item.message, item.column]), [["Spänningsprovning, Huvudmatning: ej bedömd – ange rotation.", "rotation"]]);
  assert.deepEqual(formApprovalResult(kfidFormDocument, values, evaluation).notApproved.map((item) => item.state), [null]);
  cells.rotation = "";
  assert.equal(ok(), "Ej bedömd – ange rotation");
  cells.status = "230 Vac";
  assert.equal(ok(), true, "single phase has no rotation to judge");
  cells.status = "Avvikande";
  assert.equal(ok(), false);
});

test("instrument review (2026-10-05): every moment and measurement table carries its own guidance", () => {
  const sections = kfidFormDocument.blocks.filter((block) => block.type === "section" && block.optional);
  for (const section of sections) assert.ok(section.type === "section" && section.help.length > 80, section.id);
  for (const key of ["iso", "cont", "volt", "rcd", "zs"]) assert.ok(table(key).emptyTitle.startsWith("Inga "), key);
  assert.ok(table("rcd").emptyTitle.includes("jordfelsbrytare"));
});

test("a formula at another column's label is validated: only a formula, and only at an ordinary column of the same table", () => {
  const parse = (columns: unknown[]) => formDocumentSchema.parse({ schema: 2, blocks: [{ id: "t", type: "table", key: "t", label: "Tabell", columns }] });
  const base = [{ id: "a", key: "a", label: "A", input: "choice", options: ["x", "y"] }];
  const messages = (columns: unknown[]) => validateFormDocument(parse(columns)).issues.map((item) => item.message);
  assert.deepEqual(messages([...base, { id: "h", key: "h", label: "H", input: "formula", formula: "[a]", placement: "hint", labelFor: "a" }]), []);
  assert.deepEqual(messages([...base, { id: "h", key: "h", label: "H", input: "formula", formula: "[a]", placement: "label", labelFor: "saknas" }]), ["Tabell, H: välj kolumnen vars etikett formeln visas vid."]);
  assert.deepEqual(messages([...base, { id: "h", key: "h", label: "H", input: "text", placement: "hint", labelFor: "a" }]), ["Tabell, H: bara en formelkolumn kan visas vid en annan kolumns etikett."]);
  // Documents without the new setting keep their stored form, so their hash does not change.
  const stored = parse(base).blocks[0];
  assert.equal(stored.type === "table" && "labelFor" in stored.columns[0], false);
});
