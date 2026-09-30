import assert from "node:assert/strict";
import test from "node:test";
import { kfidFormDocument } from "../lib/workflow/builtin-kfid-form";
import { evaluateForm, formApprovalTotals, formBand, formCanDeviate, formCompletion, formDocumentSchema, formRowStarted, initialFormValues, newFormRow, validateFormDocument, type FormTableBlock } from "../lib/workflow/form-document";
import { applyFormPrefill } from "../lib/workflow/form-prefill";

/** The building blocks added backwards from Kontroll före idrifttagning and Riskbedömning (2026-09-27). */
const table = (key: string) => kfidFormDocument.blocks.flatMap((block) => block.type === "section" ? block.blocks : []).find((block): block is FormTableBlock => block.type === "table" && block.key === key)!;

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

test("Godkänd follows the condition while Autobedömning is on and the tick while it is off", () => {
  const values = initialFormValues(kfidFormDocument);
  values.sections["kfid-iso"] = true;
  const iso = table("iso");
  values.tables.iso = [{ ...newFormRow(iso, "r1"), cells: { ...newFormRow(iso, "r1").cells, objekt: "Grupp 1", mohm: "0,4", ok: true } }];
  values.fields.auto = "NO";
  assert.equal(evaluateForm(kfidFormDocument, values).cells.iso.r1.ok, true, "by hand");
  values.fields.auto = "YES";
  const auto = evaluateForm(kfidFormDocument, values);
  assert.equal(auto.cells.iso.r1.ok, false, "0,4 MΩ is below the 1 MΩ limit");
  assert.deepEqual(auto.deviations.map((item) => [item.message, item.kind]), [["Isolation, Grupp 1: inte godkänd.", "assessment"]]);
  assert.deepEqual(formApprovalTotals(kfidFormDocument, values, auto), [{ blockId: iso.id, title: "Isolation", ok: 0, total: 1 }]);
});

test("the RCD time limit per profile comes from VÄXLA, and times are only required with Autobedömning", () => {
  const values = initialFormValues(kfidFormDocument);
  values.sections["kfid-rcd"] = true;
  values.fields.auto = "YES";
  const rcd = table("rcd");
  const row = newFormRow(rcd, "p1");
  values.tables.rcd = [{ ...row, cells: { ...row.cells, place: "JFB 1", std: "TT", t1p: 240, t1n: 190, t5p: 30, t5n: 30, btnok: true } }];
  assert.equal(evaluateForm(kfidFormDocument, values).cells.rcd.p1.ok, false, "TT allows at most 200 ms");
  values.tables.rcd[0].cells.std = "TNIT";
  assert.equal(evaluateForm(kfidFormDocument, values).cells.rcd.p1.ok, true, "TNIT allows 400 ms");
  values.tables.rcd[0].cells.t1p = "";
  assert.ok(formCompletion(kfidFormDocument, values).issues.some((item) => item.message === "Jordfelsbrytarprov, Prov 1: fyll i t 1× +."));
  values.fields.auto = "NO";
  assert.ok(!formCompletion(kfidFormDocument, values).issues.some((item) => item.message.includes("t 1× +")), "no times needed when judged by hand");
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
  // screen but cards in the PDF, and the profile's limits as a note computed per row.
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
  values.tables.rcd[0].cells.std = "TNIT";
  const note = evaluateForm(kfidFormDocument, values).cells.rcd.r1.note;
  assert.equal(note, "Profil TNIT: 1× ≤ 400 ms, 5× ≤ 40 ms. Autobedömningen använder tider och testknapp; granska övriga provvärden separat.");
  assert.equal(rcd.columns.find((column) => column.key === "note")?.pdf, "hide");

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
  ].join("\n"));
});
