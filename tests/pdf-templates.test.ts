import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pdfText } from "../lib/import/pdf-text";
import { PDF_DOCUMENTS, PDF_DOCUMENT_TYPES, pdfDocumentDef, pdfTexts, type PdfDocumentType } from "../lib/pdf-templates/catalog";
import { blockMayEdit, blockMayHide, blockVersion, catalogueProblems, fillPlaceholders, resolvePdfDocument, validateBlockText, validateOverride, type PdfDocumentDef, type PdfTemplateOverride } from "../lib/pdf-templates/model";
import { PDF_EXAMPLE_VARIANTS, renderPdfExample } from "../lib/pdf-templates/examples";
import { documentToken, plannedOverrides } from "../lib/pdf-templates/server";
import { pdfTemplatePreviewSchema, pdfTemplateSaveSchema } from "../lib/pdf-templates/input";

// PDF-mallar (2026-11-03): the product owner edits texts, visibility and order of the documents' blocks; the defaults
// live in code and an upgrade reaches every block the owner did not change, while changed ones are flagged.

const fonts = { regular: new Uint8Array(readFileSync("public/fonts/Manrope-Regular.ttf")), bold: new Uint8Array(readFileSync("public/fonts/Manrope-Bold.ttf")), fallback: new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf")) };
const textOf = (bytes: Uint8Array) => (pdfText(Buffer.from(bytes)) ?? "").replace(/\s+/g, " ");

/** A small document of its own, so the upgrade can be shown by changing its defaults. */
const doc = (texts: { title?: string; note?: string; legal?: string } = {}, extra: PdfDocumentDef["blocks"] = []): PdfDocumentDef => ({
  type: "demo", name: "Demo", description: "Prov.", placeholders: { företag: "Företaget", datum: "Datumet" }, groups: { end: "Slut" },
  blocks: [
    { id: "title", kind: "title", name: "Titel", text: texts.title ?? "Offert", required: true },
    { id: "note", kind: "note", name: "Not", text: texts.note ?? "Gäller till {datum}.", placeholders: ["datum"], needs: ["datum"] },
    { id: "legal", kind: "legal", name: "Lagtext", text: texts.legal ?? "Omvänd skattskyldighet.", required: true },
    { id: "fixed", kind: "legal", name: "Fast", text: "Fast text.", required: true, locked: true },
    { id: "a", kind: "section", name: "A", text: "A", group: "end" },
    { id: "b", kind: "section", name: "B", text: "B", group: "end" },
    ...extra,
  ],
});
const override = (def: PdfDocumentDef, blockId: string, patch: Partial<PdfTemplateOverride>): PdfTemplateOverride =>
  ({ documentType: def.type, blockId, text: null, visible: null, orderIndex: null, basedOnVersion: blockVersion(def.blocks.find((block) => block.id === blockId)!), ...patch });
const block = (resolved: ReturnType<typeof resolvePdfDocument>, id: string) => resolved.blocks.find((item) => item.def.id === id)!;

test("the catalogue is sound: unique ids, defaults that pass their own rules, declared placeholders and groups", () => {
  assert.deepEqual(catalogueProblems(PDF_DOCUMENTS), []);
  assert.deepEqual(PDF_DOCUMENT_TYPES, ["quote", "invoice_basis", "invoice", "credit_invoice", "work_order", "protocol", "risk_assessment", "project_report", "staff_register", "self_inspection", "deviation", "payroll", "common"]);
  for (const def of PDF_DOCUMENTS) assert.ok(PDF_EXAMPLE_VARIANTS[def.type as PdfDocumentType].length, `${def.type} has an example`);
});

test("a block without an override follows the default, also after an upgrade changed it", () => {
  const before = resolvePdfDocument(doc(), []);
  assert.equal(block(before, "title").text, "Offert");
  assert.equal(block(before, "title").state, "default");
  const after = resolvePdfDocument(doc({ title: "Anbud" }), []);
  assert.equal(block(after, "title").text, "Anbud", "the new default reaches the block by itself");
  assert.equal(after.flagged + after.legal, 0);
});

test("an override is kept; when the default changed since, it is flagged until the owner keeps it or takes the new default", () => {
  const v1 = doc();
  const own = override(v1, "note", { text: "Giltig t.o.m. {datum}." });
  assert.equal(block(resolvePdfDocument(v1, [own]), "note").state, "custom");
  const v2 = doc({ note: "Offerten gäller till {datum}." });
  const flagged = resolvePdfDocument(v2, [own]);
  assert.equal(block(flagged, "note").text, "Giltig t.o.m. {datum}.", "the owner's text stays");
  assert.equal(block(flagged, "note").state, "changed");
  assert.equal(flagged.flagged, 1);
  // Behåll min text: confirmed against the new default.
  const kept = resolvePdfDocument(v2, [{ ...own, basedOnVersion: blockVersion(v2.blocks[1]!) }]);
  assert.equal(block(kept, "note").state, "custom");
  assert.equal(kept.flagged, 0, "accepting clears the flag");
  // Använd nya förvalet: the override's text is gone.
  assert.equal(block(resolvePdfDocument(v2, [{ ...own, text: null }]), "note").text, "Offerten gäller till {datum}.");
});

test("a required block's new default wins over the owner's text (Lagkrav uppdaterades)", () => {
  const v1 = doc();
  const own = override(v1, "legal", { text: "Köparen redovisar momsen." });
  assert.equal(block(resolvePdfDocument(v1, [own]), "legal").text, "Köparen redovisar momsen.");
  const v2 = doc({ legal: "Omvänd betalningsskyldighet för moms gäller." });
  const resolved = resolvePdfDocument(v2, [own]);
  assert.equal(block(resolved, "legal").text, "Omvänd betalningsskyldighet för moms gäller.");
  assert.equal(block(resolved, "legal").state, "legal");
  assert.equal(resolved.legal, 1);
});

test("a required block can never be hidden and a locked text never changed", () => {
  const def = doc();
  const resolved = resolvePdfDocument(def, [override(def, "title", { visible: false }), override(def, "fixed", { text: "Annan text." })]);
  assert.equal(block(resolved, "title").visible, true, "required stays shown");
  assert.equal(block(resolved, "fixed").text, "Fast text.");
  assert.equal(validateOverride(def.blocks[0]!, { text: null, visible: false, orderIndex: null }, 0), "Blocket krävs och kan inte döljas.");
  assert.equal(validateOverride(def.blocks[3]!, { text: "Annan text.", visible: null, orderIndex: null }, 0), "Texten är ett lagkrav och kan inte ändras.");
  assert.equal(validateOverride(def.blocks[1]!, { text: null, visible: false, orderIndex: null }, 0), null, "an optional block may be hidden");
});

test("a new block appears at its default place; an override of a removed block is ignored", () => {
  const v1 = doc();
  const moved = [override(v1, "a", { orderIndex: 1 }), override(v1, "b", { orderIndex: 0 })];
  const v2 = doc({}, [{ id: "c", kind: "section", name: "C", text: "C", group: "end" }]);
  const resolved = resolvePdfDocument(v2, [...moved, { documentType: "demo", blockId: "gone", text: "Borta", visible: null, orderIndex: null, basedOnVersion: "t0" }]);
  assert.equal(block(resolved, "c").visible, true);
  assert.deepEqual(pdfTextsOrder(v2, [...moved]), ["b", "a", "c"], "the owner's order first, the new block after at its place");
  assert.ok(!resolved.blocks.some((item) => item.def.id === "gone"));
});
function pdfTextsOrder(def: PdfDocumentDef, overrides: PdfTemplateOverride[]) {
  return resolvePdfDocument(def, overrides).blocks.filter((item) => item.def.group === "end").sort((x, y) => x.order - y.order).map((item) => item.def.id);
}

test("placeholders: only the block's own, the needed ones kept, braces only around a placeholder", () => {
  const note = doc().blocks[1]!;
  assert.equal(validateBlockText(note, "Gäller till {datum}."), null);
  assert.equal(validateBlockText(note, "Gäller till {okänd} {datum}."), "Okänd platshållare: {okänd}.");
  assert.equal(validateBlockText(note, "Gäller en månad."), "Platshållaren {datum} måste stå kvar.");
  assert.equal(validateBlockText(note, "Gäller till {datum."), "En klammer står utan platshållare.");
  assert.equal(validateBlockText(note, "  "), "Texten får inte vara tom. Dölj blocket i stället.");
  assert.equal(validateBlockText(doc().blocks[0]!, "Rad ett\nrad två"), "Texten ska stå på en rad.");
  assert.match(validateBlockText(doc().blocks[0]!, "x".repeat(41)) ?? "", /Högst 40 tecken/);
  assert.equal(validateBlockText(note, "Gäller \u0007 till {datum}."), "Texten innehåller otillåtna tecken.");
  assert.equal(fillPlaceholders("För {företag}, {datum}", { företag: "Elfirma AB" }), "För Elfirma AB, ");
  // An upgrade that makes a stored text invalid falls back to the default and flags the block.
  const tighter = doc({ note: "Gäller till {datum}." });
  const broken = resolvePdfDocument({ ...tighter, blocks: tighter.blocks.map((item) => item.id === "note" ? { ...item, placeholders: [], needs: [], text: "Gäller en månad." } : item) }, [override(tighter, "note", { text: "Till {datum}." })]);
  assert.equal(block(broken, "note").text, "Gäller en månad.");
  assert.equal(block(broken, "note").state, "changed");
});

test("the save plan: a text equal to the default is no change, an unchanged text keeps its version until confirmed, orders are whole groups", () => {
  const def = pdfDocumentDef("deviation")!;
  const title = def.blocks.find((item) => item.id === "title.deviation")!;
  assert.deepEqual(plannedOverrides(def, [{ blockId: "title.deviation", text: title.text, visible: null, orderIndex: null }], []).rows, []);
  const stored = [{ blockId: "title.deviation", text: "Avvikelse", basedOnVersion: "old", basedOnText: "Avvikelserapport" }];
  assert.equal(plannedOverrides(def, [{ blockId: "title.deviation", text: "Avvikelse", visible: null, orderIndex: null }], stored).rows[0]!.basedOnVersion, "old");
  assert.equal(plannedOverrides(def, [{ blockId: "title.deviation", text: "Avvikelse", visible: null, orderIndex: null, confirm: true }], stored).rows[0]!.basedOnVersion, blockVersion(title));
  assert.equal(plannedOverrides(def, [{ blockId: "title.deviation", text: "Ny", visible: null, orderIndex: null }], stored).rows[0]!.basedOnVersion, blockVersion(title), "a new text stands on today's default");
  assert.equal(plannedOverrides(def, [{ blockId: "title.deviation", text: null, visible: false, orderIndex: null }], []).errors[0]!.error, "Blocket krävs och kan inte döljas.");
  assert.equal(plannedOverrides(def, [{ blockId: "nope", text: "x", visible: null, orderIndex: null }], []).errors[0]!.error, "Blocket finns inte i mallen.");
  assert.equal(plannedOverrides(def, [{ blockId: "section.photos", text: null, visible: null, orderIndex: 0 }], []).errors[0]!.error, "Ordningen i gruppen är ofullständig.");
  const parts = def.blocks.filter((item) => item.group === "parts").map((item) => item.id);
  const reversed = parts.map((blockId, index) => ({ blockId, text: null, visible: null, orderIndex: parts.length - 1 - index }));
  assert.equal(plannedOverrides(def, reversed, []).errors.length, 0);
  assert.notEqual(documentToken([]), documentToken([{ blockId: "a", updatedAt: new Date("2026-11-03T10:00:00Z") }]));
  assert.notEqual(documentToken([{ blockId: "a", updatedAt: new Date("2026-11-03T10:00:00Z") }]), documentToken([{ blockId: "a", updatedAt: new Date("2026-11-03T10:00:01Z") }]));
});

test("the API's input is capped: lengths, ids and document types", () => {
  assert.equal(pdfTemplateSaveSchema.safeParse({ documentType: "quote", basedOn: "none", blocks: [{ blockId: "title", text: "x".repeat(601), visible: null, orderIndex: null }] }).success, false);
  assert.equal(pdfTemplateSaveSchema.safeParse({ documentType: "elsewhere", basedOn: "none", blocks: [] }).success, false);
  assert.equal(pdfTemplateSaveSchema.safeParse({ documentType: "quote", basedOn: "none", blocks: [{ blockId: "<script>", text: null, visible: null, orderIndex: null }] }).success, false);
  assert.equal(pdfTemplateSaveSchema.safeParse({ documentType: "quote", basedOn: "none", blocks: [], extra: 1 }).success, false);
  assert.equal(pdfTemplatePreviewSchema.safeParse({ documentType: "quote", blocks: [{ blockId: "title", text: "Anbud", visible: null, orderIndex: null, basedOnVersion: "t1" }] }).success, true);
});

test("the generators print the owner's text, leave out a hidden block and follow the order", async () => {
  const quote = pdfDocumentDef("quote")!;
  const on = (def: PdfDocumentDef, blockId: string, patch: Partial<PdfTemplateOverride>) => override(def, blockId, patch);
  const plain = textOf(await renderPdfExample("quote", "quote", null, fonts));
  assert.match(plain, /Offert/);
  assert.match(plain, /Godkänn via länken/);
  const edited = textOf(await renderPdfExample("quote", "quote", [on(quote, "title", { text: "Anbud" }), on(quote, "approval.sent", { visible: false }), on(quote, "sign.company", { text: "Signatur {företag}" })], fonts));
  assert.match(edited, /Anbud/);
  assert.doesNotMatch(edited, /Godkänn via länken/, "a hidden block is not printed");
  assert.match(edited, /Signatur Exempel El AB/, "a placeholder is filled from the data");
  // A required block's hiding is ignored by the generator too.
  assert.match(textOf(await renderPdfExample("quote", "draft", [on(quote, "band.draft", { visible: false })], fonts)), /UTKAST – INTE SKICKAD/);
  // Order: Villkor before Ändringar on an ÄTA.
  const ata = textOf(await renderPdfExample("quote", "ata", [on(quote, "section.changes", { orderIndex: 1 }), on(quote, "section.terms", { orderIndex: 0 })], fonts));
  assert.ok(ata.indexOf("Villkor") < ata.indexOf("Ändringar mot accepterad version"), "the owner's order");
  const defaultAta = textOf(await renderPdfExample("quote", "ata", null, fonts));
  assert.ok(defaultAta.indexOf("Ändringar mot accepterad version") < defaultAta.indexOf("Villkor"), "the default order");
});

test("every document type renders its example with the defaults and with an edited title", async () => {
  for (const def of PDF_DOCUMENTS) {
    const type = def.type as PdfDocumentType;
    for (const variant of PDF_EXAMPLE_VARIANTS[type]) {
      const text = textOf(await renderPdfExample(type, variant.key, null, fonts));
      assert.ok(text.length > 100, `${type}/${variant.key} has text`);
      assert.doesNotMatch(text, /\{[a-zåäö_]+\}/, `${type}/${variant.key}: no placeholder left unfilled`);
    }
    const footer = def.blocks.find((item) => item.kind === "footer");
    if (footer) {
      const values = footer.text.replace(/\{[^}]+\}/g, "").trim();
      assert.ok(textOf(await renderPdfExample(type, null, null, fonts)).includes(values.split(" · ")[0]!), `${type}: the footer note is printed`);
    }
  }
  assert.equal(pdfTexts("deviation").order("parts").join(","), "section.description,section.action,section.investigation,section.history,section.photos");
});

// 2026-11-05: what has its own editor is not edited twice. The document is seen here; only the fixed words around it change.
test("a text set in the document's own editor cannot be changed or hidden, and what is stored stays unread", () => {
  const def = pdfDocumentDef("protocol")!;
  const title = def.blocks.find((block) => block.id === "title")!;
  assert.ok(title.elsewhere);
  assert.equal(blockMayEdit(title), false);
  assert.equal(blockMayHide(title), false);
  assert.equal(validateOverride(title, { text: "Annan rubrik", visible: null, orderIndex: null }, 0), title.elsewhere);
  assert.equal(validateOverride(title, { text: null, visible: false, orderIndex: null }, 0), title.elsewhere);
  // The server refuses a change.
  const wanted = { blockId: "title", text: "Annan rubrik", visible: null, orderIndex: null };
  assert.deepEqual(plannedOverrides(def, [wanted], []).errors, [{ blockId: "title", error: title.elsewhere }]);
  // A row saved before the rule came stands, so a save of the rest of the document is not stopped, and no document prints it.
  const stored = { blockId: "title", text: "Gammal rubrik", visible: null, orderIndex: null, basedOnVersion: blockVersion(title), basedOnText: title.text };
  const kept = plannedOverrides(def, [{ blockId: "title", text: "Gammal rubrik", visible: null, orderIndex: null }], [stored]);
  assert.deepEqual(kept.errors, []);
  assert.equal(kept.rows[0]?.text, "Gammal rubrik");
  assert.equal(plannedOverrides(def, [wanted], [stored]).errors.length, 1);
  const resolved = resolvePdfDocument(def, [{ documentType: "protocol", ...stored }]).blocks.find((item) => item.def.id === "title")!;
  assert.equal(resolved.text, title.text);
  // The fixed words around the content are still changed here, once.
  const decision = def.blocks.find((block) => block.id === "decision.label")!;
  assert.equal(blockMayEdit(decision), true);
  assert.deepEqual(plannedOverrides(def, [{ blockId: "decision.label", text: "Omdöme", visible: null, orderIndex: null }], []).errors, []);
});

test("the documents with their own editor say where their content is changed", () => {
  assert.equal(pdfDocumentDef("protocol")!.contentIn?.href, "/?view=forms");
  assert.equal(pdfDocumentDef("self_inspection")!.contentIn?.href, "/?view=self_inspection");
  for (const type of ["quote", "invoice", "common"]) assert.equal(pdfDocumentDef(type)!.contentIn, undefined);
});
