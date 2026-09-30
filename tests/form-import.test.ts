import assert from "node:assert/strict";
import test from "node:test";
import { formDocumentSchema, validateFormDocument } from "../lib/workflow/form-document";
import { IMPORT_EXAMPLE, importColumn, importControlPoints } from "../lib/workflow/form-import";

/** Control points from a spreadsheet (2026-09-28): the proposed column format and friendly names. */
test("rows become sections with a checklist, fields and measured values with configurable limits", () => {
  const rows: Record<string, string>[] = [
    { avsnitt_nr: "3", avsnitt_namn: "Vattennivåer och flöden", punkt_nr: "3.01", kontrollpunkt: "Övre vattennivå", instruktion: "Läs av i styrsystemet och jämför med pegel.", svarstyp: "matvarde", enhet: "m", decimaler: "2", gransvarde_kalla: "vattendom", gransvarde_referens: "Dämningsgräns och sänkningsgräns", frekvens: "rond", obligatorisk: "ja", aktiv: "ja", sortering: "1" },
    { avsnitt_nr: "3", avsnitt_namn: "Vattennivåer och flöden", punkt_nr: "3.07", kontrollpunkt: "Minimitappning uppfylld", svarstyp: "ja_nej", frekvens: "rond", aktiv: "ja", sortering: "2" },
    { avsnitt_nr: "5", avsnitt_namn: "Intag, galler och vattenvägar", punkt_nr: "5.01", kontrollpunkt: "Intagsgaller rent från drivgods och is", svarstyp: "bedomning", foto_vid_avvikelse: "ja", frekvens: "rond", aktiv: "ja", sortering: "3" },
    { avsnitt_namn: "Vattennivåer och flöden", kontrollpunkt: "Turbinflöde", svarstyp: "matvarde", enhet: "m³/s", larm_max: "12,5", gransvarde_kalla: "vattendom", gransvarde_referens: "Deldom 2019, villkor 4", sortering: "4" },
    { avsnitt_namn: "Intag, galler och vattenvägar", kontrollpunkt: "Gallerrensare i funktion", svarstyp: "bedomning", sortering: "5" },
    { avsnitt_namn: "Driftstatus", kontrollpunkt: "Driftläge", svarstyp: "val", valalternativ: "Drift; Stopp; Reserv", sortering: "6" },
    { avsnitt_namn: "Driftstatus", kontrollpunkt: "Gammal punkt", svarstyp: "text", aktiv: "nej" },
    { avsnitt_namn: "Driftstatus", kontrollpunkt: "Okänd", svarstyp: "diagram" },
  ];
  const result = importControlPoints(rows, new Set(["övre_vattennivå"]));
  assert.equal(result.points, 7, "the inactive row is left out");
  assert.deepEqual(result.sections.map((section) => section.title), ["Vattennivåer och flöden", "Intag, galler och vattenvägar", "Driftstatus"]);
  const levels = result.sections[0];
  const level = levels.blocks.find((block) => block.type === "field" && block.label === "Övre vattennivå");
  assert.ok(level?.type === "field" && level.input === "number" && level.unit === "m" && level.trend && level.limitKey === "övre_vattennivå_2", "a taken key gets a new one");
  const flow = result.limits.find((limit) => limit.label === "Turbinflöde")!;
  assert.equal(flow.high, 12.5);
  assert.equal(flow.source, "Vattendomen / tillståndet: Deldom 2019, villkor 4");
  const checklist = result.sections[1].blocks.find((block) => block.type === "checklist");
  assert.ok(checklist?.type === "checklist" && checklist.items.length === 2 && checklist.photos, "points judged OK/Ej OK share one checklist with a camera");
  assert.ok(result.issues.some((item) => item.includes("diagram")));
  // The result is a valid form when added to one.
  const document = formDocumentSchema.parse({ schema: 2, blocks: result.sections, limits: result.limits });
  assert.deepEqual(validateFormDocument(document).issues, []);
});

test("the downloadable example is generic and becomes a valid form", () => {
  const result = importControlPoints(IMPORT_EXAMPLE, new Set());
  assert.deepEqual(result.sections.map((section) => section.title), ["Elcentraler", "Mätvärden"]);
  assert.deepEqual(result.issues, []);
  assert.equal(result.limits[0].source, "Tillverkarens anvisning: Drift- och underhållsinstruktionen");
  assert.deepEqual(validateFormDocument(formDocumentSchema.parse({ schema: 2, blocks: result.sections, limits: result.limits })).issues, []);
});

test("friendly column names are understood", () => {
  assert.equal(importColumn("Kontrollpunkt*"), "kontrollpunkt");
  assert.equal(importColumn("Avsnitt"), "avsnitt_namn");
  assert.equal(importColumn("Larm max"), "larm_max");
  assert.equal(importColumn("okänd kolumn"), null);
});
