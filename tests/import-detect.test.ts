import assert from "node:assert/strict";
import test from "node:test";
import { buildPlan, controlPointsOf, detectImport, mapColumns, normalizeDate, normalizeDateTime, normalizeTime, textToControlPoints, textToWorkOrder, textToWorkOrderRows, aiRowsToWorkOrders, type ExtractedFile } from "../lib/import/detect";

const table = (name: string, headers: string[], rows: string[][], sheet?: string): ExtractedFile => ({ name, mimeType: "text/csv", size: 1, kind: "table", headers, rows, sheet });
const text = (name: string, body: string): ExtractedFile => ({ name, mimeType: "text/plain", size: 1, kind: "text", text: body });

test("import rules: a customer list, a project list, work orders and planning are told apart by their columns", () => {
  const customers = detectImport(table("kunder.xlsx", ["Namn", "Företag", "E-post", "Telefon", "Adress", "Postnummer", "Ort"], [["Anna", "Elkraft Norr AB", "anna@example.invalid", "070", "Elvägen 1", "123 45", "Umeå"]]));
  assert.equal(customers.target, "customers");
  assert.ok(customers.confidence >= 0.8, `sure: ${customers.confidence}`);
  assert.deepEqual(customers.questions, []);
  assert.equal(customers.mapping.name, "Namn");
  assert.equal(customers.mapping.postalCode, "Postnummer");

  const projects = detectImport(table("projekt 2026.xlsx", ["Projekt", "Startdatum", "Slutdatum", "Kund", "Arbetsplats", "Ordernummer"], [["Ny central", "2026-10-05", "2026-10-30", "Elkraft Norr AB", "Elvägen 1", "ORD-1"]]));
  assert.equal(projects.target, "projects");
  assert.equal(projects.mapping.reference, "Ordernummer");

  const orders = detectImport(table("arbetsordrar.csv", ["Rubrik", "Beskrivning", "Klart senast", "Projekt", "Ansvarig", "Utfört arbete"], [["Byte av central", "Byt", "15/10/2026", "Ny central", "Elis", ""]]));
  assert.equal(orders.target, "work_orders");
  assert.equal(orders.mapping.dueDate, "Klart senast");
  assert.equal(orders.mapping.executionNotes, "Utfört arbete");

  const planning = detectImport(table("schema v41.xlsx", ["Aktivitet", "Datum", "Start", "Slut", "Projekt"], [["Montage", "2026-10-07", "08:00", "16:00", "Ny central"]]));
  assert.equal(planning.target, "planning");

  const points = detectImport(table("rond.xlsx", ["avsnitt_namn", "kontrollpunkt", "svarstyp"], [["Elcentraler", "Märkning aktuell", "bedomning"]]));
  assert.equal(points.target, "control_points");
});

test("import rules: an unsure file asks what it is, with the likely kinds as the options to click", () => {
  const vague = detectImport(table("lista.xlsx", ["Namn", "Datum", "Kommentar"], [["Något", "2026-10-01", "x"]]));
  assert.equal(vague.target, "unknown");
  assert.equal(vague.questions.length, 1);
  assert.equal(vague.questions[0].kind, "target");
  const values = vague.questions[0].options.map((option) => option.value);
  assert.ok(values.includes("customers") && values.includes("projects") && values.includes("work_orders") && values.includes("unknown"), values.join(","));
  assert.ok(vague.candidates.length >= 2, "several candidates with their confidence");
  // Nothing recognised at all: still a question, never a guess.
  const nothing = detectImport(table("x.csv", ["A", "B"], [["1", "2"]]));
  assert.equal(nothing.target, "unknown");
  assert.deepEqual(nothing.candidates, []);
});

test("import rules: texts – a checklist becomes control points, an order becomes a work order, a JSON form file and a PDF are recognised", () => {
  const checklist = text("rond.txt", "Elcentraler\n1. Märkning aktuell\n2. Jordfelsbrytare provade\n3. Inga lösa kablar\n\nBelysning\n- Nödljus fungerar\n- Armaturer hela");
  const detected = detectImport(checklist);
  assert.equal(detected.target, "control_points");
  const points = textToControlPoints(checklist.text!);
  assert.deepEqual(points.map((row) => [row.avsnitt_namn, row.kontrollpunkt]), [["Elcentraler", "Märkning aktuell"], ["Elcentraler", "Jordfelsbrytare provade"], ["Elcentraler", "Inga lösa kablar"], ["Belysning", "Nödljus fungerar"], ["Belysning", "Armaturer hela"]]);
  const result = controlPointsOf(checklist, new Set());
  assert.equal(result.points, 5);
  assert.deepEqual(result.sections.map((section) => section.title), ["Elcentraler", "Belysning"]);

  const order = text("bestallning.docx", "Byte av elcentral Elvägen 1\nBeställning: byt befintlig central mot ny och utför kontroll före idrifttagning.");
  const detectedOrder = detectImport(order);
  assert.ok(["work_order_text", "unknown"].includes(detectedOrder.target));
  const item = textToWorkOrder(order);
  assert.equal(item.data.title, "Byte av elcentral Elvägen 1");
  assert.match(String(item.data.description), /^Beställning/);

  assert.equal(detectImport({ name: "formular.json", mimeType: "application/json", size: 1, kind: "json", json: { format: "hintek-workflow-forms", version: 1, forms: [] } }).target, "forms_file");
  assert.equal(detectImport({ name: "arbetsyta.hwf", mimeType: "application/json", size: 1, kind: "json", json: { schema: 11, controls: [] } }).target, "hwf_file");
  assert.equal(detectImport({ name: "ritning.pdf", mimeType: "application/pdf", size: 1, kind: "binary" }).target, "attachment");
});

test("import rules: dates and times as people write them", () => {
  assert.equal(normalizeDate("2026-10-01"), "2026-10-01");
  assert.equal(normalizeDate("1/10/2026"), "2026-10-01");
  assert.equal(normalizeDate("01.10.26"), "2026-10-01");
  assert.equal(normalizeDate("20261001"), "2026-10-01");
  assert.equal(normalizeDate("1 okt 2026"), "2026-10-01");
  assert.equal(normalizeDate(46296), "2026-10-01", "Excel's serial number");
  assert.equal(normalizeDate("2026-10-01 08:00"), "2026-10-01");
  assert.equal(normalizeDate("snart"), null);
  assert.equal(normalizeTime("8"), "08:00");
  assert.equal(normalizeTime("8.30"), "08:30");
  assert.equal(normalizeTime(0.5), "12:00");
  assert.equal(normalizeDateTime("2026-10-07 08:00"), "2026-10-07T08:00");
  assert.equal(normalizeDateTime("08:00", "2026-10-07"), "2026-10-07T08:00");
  assert.equal(normalizeDateTime("7/10/2026", null, "08:00"), "2026-10-07T08:00");
});

test("import rules: rows become the inputs of the tools that create them, with the issues said per row", () => {
  const file = table("projekt.xlsx", ["Projekt", "Start", "Slut", "Kund", "Ansvarig"], [["Ny central", "2026-10-05", "2026-10-30", "Elkraft Norr AB", "Elin"], ["Utan datum", "", "", "", ""], ["", "", "", "", ""]]);
  const plan = buildPlan(file, "projects", mapColumns("projects", file.headers!), "2026-10-01");
  assert.equal(plan.length, 2, "an empty row is skipped");
  assert.deepEqual(plan[0].data, { name: "Ny central", startDate: "2026-10-05", dueDate: "2026-10-30", description: "", workSite: "", reference: "" });
  assert.deepEqual(plan[0].refs, { customer: "Elkraft Norr AB", responsible: "Elin" });
  assert.deepEqual(plan[0].issues, []);
  assert.deepEqual(plan[1].data, { name: "Utan datum", startDate: "2026-10-01", dueDate: "2026-10-01", description: "", workSite: "", reference: "" });
  assert.deepEqual(plan[1].issues, ["startdatum saknas – sätts till 2026-10-01", "slutdatum saknas – sätts till 2026-10-01"]);

  const customers = table("k.csv", ["Namn", "E-post"], [["", "x@example.invalid"], ["Anna", "anna@example.invalid"]]);
  const customerPlan = buildPlan(customers, "customers", mapColumns("customers", customers.headers!));
  assert.deepEqual(customerPlan[0].issues, ["saknar namn"]);
  assert.equal(customerPlan[1].data.email, "anna@example.invalid");

  const planning = table("s.csv", ["Aktivitet", "Datum", "Start", "Slut"], [["Montage", "2026-10-07", "8", ""], ["Möte", "2026-10-08", "13:00", "14:30"]]);
  const activities = buildPlan(planning, "planning", mapColumns("planning", planning.headers!));
  assert.deepEqual([activities[0].data.startsAt, activities[0].data.endsAt, activities[0].data.kind], ["2026-10-07T08:00", "2026-10-07T09:00", "TASK"]);
  assert.deepEqual(activities[0].issues, ["slut saknas – sätts till en timme efter start"]);
  assert.deepEqual([activities[1].data.startsAt, activities[1].data.endsAt, activities[1].data.kind], ["2026-10-08T13:00", "2026-10-08T14:30", "MEETING"]);
});

test("reports (2026-10-01): requirement sentences become control points, dated actions work orders, labels neither", () => {
  const inspection = ["Kontrollrapport – elcentral Norra", "Kund: Bostadsbolaget Norra AB", "Adress: Storgatan 14, 352 30 Växjö", "Visuell kontroll",
    "Centralen ska vara märkt med gruppförteckning och kretsnummer.", "Kontrollera att kapslingen är hel och att IP-klassen passar utrymmet.",
    "Jordfelsbrytare", "1. Provtryck testknappen på varje jordfelsbrytare.", "2. Mät utlösningstid vid märkström.",
    "Isolationsmätning", "Isolationsresistansen mellan fas och skyddsjord ska mätas för varje grupp."].join("\n");
  const points = textToControlPoints(inspection);
  assert.deepEqual(points.map((row) => `${row.avsnitt_namn}: ${row.kontrollpunkt}`), [
    "Visuell kontroll: Centralen ska vara märkt med gruppförteckning och kretsnummer.",
    "Visuell kontroll: Kontrollera att kapslingen är hel och att IP-klassen passar utrymmet.",
    "Jordfelsbrytare: Provtryck testknappen på varje jordfelsbrytare.",
    "Jordfelsbrytare: Mät utlösningstid vid märkström.",
    "Isolationsmätning: Isolationsresistansen mellan fas och skyddsjord ska mätas för varje grupp.",
  ]);
  assert.equal(detectImport({ name: "Kontrollrapport.docx", mimeType: "", size: 1, kind: "text", text: inspection }).target, "control_points");

  const service = ["Servicerapport vecka 41", "Kund: Fastighets AB Söder", "Kvarstående åtgärder",
    "Jordfelsbrytaren för laddplats 4 löser ut vid laddning och behöver bytas senast 2026-10-20.",
    "Armaturerna i nedfarten är trasiga och ska ersättas med LED före 2026-10-27."].join("\n");
  const rows = textToWorkOrderRows(service);
  assert.deepEqual(rows.map((row) => [row.title, row.date, row.section]), [
    ["Jordfelsbrytaren för laddplats 4 löser ut vid laddning och behöver bytas", "2026-10-20", "Kvarstående åtgärder"],
    ["Armaturerna i nedfarten är trasiga och ska ersättas med LED", "2026-10-27", "Kvarstående åtgärder"],
  ]);
  assert.equal(detectImport({ name: "Servicerapport.pdf", mimeType: "application/pdf", size: 1, kind: "text", text: service }).target, "work_order_text");
  const orders = aiRowsToWorkOrders(rows);
  assert.deepEqual(orders.map((item) => [item.kind, item.data.dueDate]), [["work_order", "2026-10-20"], ["work_order", "2026-10-27"]]);
});

test("a table is only sure when its required column is found; rows without it are left out, not failed", () => {
  const file = { name: "Projektrapport.xlsx", mimeType: "", size: 1, kind: "table" as const, headers: ["Uppdrag", "Beställare", "Platschef", "Påbörjas", "Ska vara klart", "Plats", "Ordernr"], rows: [["Ombyggnad Norra", "Bostadsbolaget", "Per", "2026-10-12", "2026-11-20", "Storgatan 14", "A-1"]] };
  const detection = detectImport(file);
  assert.equal(detection.target, "projects");
  assert.equal(detection.mapping.name, "Uppdrag");
  assert.equal(detection.mapping.responsible, "Platschef");
  assert.equal(detection.mapping.reference, "Ordernr");
  const missing = buildPlan({ ...file, headers: ["Påbörjas", "Ska vara klart", "Plats"], rows: [["2026-10-12", "2026-11-20", "Storgatan 14"]] }, "projects", { startDate: "Påbörjas", dueDate: "Ska vara klart", workSite: "Plats" });
  assert.equal(missing[0].skip, true);
  assert.equal(detectImport({ ...file, headers: ["Påbörjas", "Ska vara klart", "Beställare", "Plats"], rows: [["2026-10-12", "2026-11-20", "X", "Y"]] }).target, "unknown", "no project name column: the page asks");
});

test("a long manual with only incidental numbered lines is an attachment, never a shaky checklist guess that sends it to AI (2026-10-02: a Metrel manual read as 136 control points and cost credits)", () => {
  const filler = Array.from({ length: 300 }, (_, index) => `Avsnitt ${index} beskriver instrumentets allmänna egenskaper och användningsområde i löpande text.`);
  const specs = Array.from({ length: 15 }, (_, index) => `${index + 1}. Mätområde: 0.01 MΩ till 200 TΩ vid testspänning ${index}00 V.`);
  const detection = detectImport(text("manual.pdf", [...filler.slice(0, 150), ...specs, ...filler.slice(150)].join("\n")));
  assert.equal(detection.target, "attachment");
  assert.deepEqual(detection.questions, []);
});

test("a short, genuinely ambiguous text still asks instead of being taken for an attachment", () => {
  const detection = detectImport(text("anteckning.txt", "Besök hos kunden gick bra. Vi pratade om nästa steg och återkommer nästa vecka."));
  assert.equal(detection.target, "unknown");
  assert.ok(detection.questions.length > 0);
});
