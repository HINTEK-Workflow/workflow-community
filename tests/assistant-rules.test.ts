import assert from "node:assert/strict";
import test from "node:test";
import { actionAnswer, formatRuleAnswer, isPageQuestion, nearestRulePlan, periodOf, planAnswer, searchTerms, singleMatch } from "../lib/ai/assistant-rules";

const now = new Date("2026-09-30T10:00:00Z"); // a Wednesday
const tool = (question: string) => { const plan = planAnswer(question, now); return plan.kind === "tool" ? [plan.tool, plan.input] : plan.kind === "lookup" ? ["lookup", { query: plan.query, prefer: plan.prefer }] : [plan.kind]; };

test("rule-first: ordinary questions are answered with the shared tools, without AI", () => {
  assert.deepEqual(tool("Hjälp"), ["help"]);
  assert.deepEqual(tool("vad kan du hjälpa mig med?"), ["help"]);
  assert.deepEqual(tool("Hej!"), ["greeting"]);
  assert.deepEqual(tool("Tack så mycket"), ["thanks"]);
  assert.deepEqual(tool("Mina uppgifter"), ["list_my_work", { filter: "open" }]);
  assert.deepEqual(tool("vad ska jag göra idag?"), ["list_my_work", { filter: "open" }]);
  assert.deepEqual(tool("mina slutförda arbetsordrar"), ["list_my_work", { filter: "done", query: "arbetsorder" }]);
  assert.deepEqual(tool("mina kontroller"), ["list_my_work", { filter: "open", query: "kontroll" }]);
  assert.deepEqual(tool("hur många uppgifter har jag?"), ["list_my_work", { filter: "open" }]);
  assert.deepEqual(tool("Vad är försenat?"), ["list_notifications", {}]);
  assert.deepEqual(tool("ronder i dag"), ["list_notifications", {}]);
  assert.deepEqual(tool("Min tid den här veckan"), ["list_time_entries", { from: "2026-09-28", to: "2026-10-04" }]);
  assert.deepEqual(tool("hur mycket tid har jag rapporterat förra veckan"), ["list_time_entries", { from: "2026-09-21", to: "2026-09-27" }]);
  assert.deepEqual(tool("hur många timmar jobbade jag i måndags"), ["list_time_entries", { from: "2026-09-28", to: "2026-09-28" }]);
  assert.deepEqual(tool("Planering i morgon"), ["list_planned_activities", { from: "2026-10-01", to: "2026-10-01" }]);
  assert.deepEqual(tool("vad händer på fredag"), ["list_planned_activities", { from: "2026-10-02", to: "2026-10-02" }]);
  assert.deepEqual(tool("planering vecka 41"), ["list_planned_activities", { from: "2026-10-05", to: "2026-10-11" }]);
  assert.deepEqual(tool("pågående projekt"), ["list_projects", { state: "ongoing" }]);
  assert.deepEqual(tool("hur många projekt har vi"), ["list_projects", { state: "ongoing" }]);
  assert.deepEqual(tool("projekt Strömgatan"), ["lookup", { query: "strömgatan", prefer: "project" }]);
  assert.deepEqual(tool("status på Strömgatan"), ["lookup", { query: "strömgatan", prefer: "any" }]);
  assert.deepEqual(tool("vem är ansvarig för projektet Elvägen 3?"), ["lookup", { query: "elvägen 3", prefer: "project" }]);
  assert.deepEqual(tool("visa kund Elkraft"), ["lookup", { query: "elkraft", prefer: "customer" }]);
  assert.deepEqual(tool("kund Elvägen"), ["lookup", { query: "elvägen", prefer: "customer" }]);
  assert.deepEqual(tool("kunder"), ["list_customers", { limit: 25 }]);
  assert.deepEqual(tool("sök centralen A"), ["search", { query: "centralen a" }]);
  assert.deepEqual(tool('Var finns "Transformator T2"'), ["search", { query: "Transformator T2" }]);
  assert.deepEqual(tool("Centralen A"), ["lookup", { query: "centralen", prefer: "any" }], "a short phrase is a lookup");
});

test("rule-first: requests to create or change are answered with where to do it, never done by the assistant", () => {
  const plan = planAnswer("Skapa en arbetsorder för byte av central", now);
  assert.deepEqual(plan, { kind: "action", what: "work_order" });
  const answer = actionAnswer("work_order");
  assert.match(answer.answer, /^Jag skapar och ändrar inget själv/);
  assert.equal(answer.citations[0].href, "/?view=workflow_task&taskType=WORK_ORDER");
  assert.deepEqual(planAnswer("boka ett möte i morgon", now), { kind: "action", what: "planning" });
  assert.deepEqual(planAnswer("registrera 2 timmar på Strömgatan", now), { kind: "action", what: "time" });
});

test("rule-first: interpretation and open questions go to the AI model, with search words as context", () => {
  assert.deepEqual(planAnswer("Sammanfatta avvikelserna i projektet Strömgatan", now), { kind: "ai", reason: "interpretation", searchQuery: "sammanfatta avvikelserna projektet strömgatan" });
  assert.equal(planAnswer("Varför är isolationsvärdet lågt i centralen?", now).kind, "ai");
  assert.equal(planAnswer("Kan du föreslå en åtgärd", now).kind, "ai", "å at the end of a word");
  assert.deepEqual(tool("påminnelser"), ["list_notifications", {}]);
  assert.equal(planAnswer("Hur borde vi lägga upp arbetet med nästa besiktning på pumpstationen?", now).kind, "ai");
  assert.equal(searchTerms("Vilka arbetsordrar finns för Elvägen?"), "arbetsordrar elvägen");
  assert.equal(periodOf("denna månad", now).from, "2026-09-01");
  assert.equal(periodOf("denna månad", now).to, "2026-09-30");
  assert.deepEqual(periodOf("nästa månad", now), { from: "2026-10-01", to: "2026-10-31", label: "nästa månad" });
  assert.deepEqual(periodOf("på onsdag", now), { from: "2026-09-30", to: "2026-09-30", label: "på onsdag" }, "today counts as the coming weekday");
  assert.deepEqual(periodOf("i fredags", now), { from: "2026-09-25", to: "2026-09-25", label: "i fredags" });
  assert.deepEqual(periodOf("v. 1", now).from, "2025-12-29", "ISO week 1 of 2026 starts on 29 December");
});

test("rule answers are short, linked and never list more than ten rows", () => {
  const items = Array.from({ length: 12 }, (_, index) => ({ id: `t${index}`, kind: "WORK_ORDER", title: `Arbetsorder ${index}`, status: "PLANNED", projectName: "Strömgatan" }));
  const work = formatRuleAnswer("list_my_work", "Dina uppgifter", { items, total: 12 });
  assert.match(work.answer, /^Dina uppgifter:\n• Arbetsorder 0 – Arbetsorder, planerad \(Strömgatan\)/);
  assert.match(work.answer, /… och 2 till\./);
  assert.equal(work.citations.length, 10);
  assert.equal(work.citations[0].href, "/?view=workflow_task&taskId=t0&taskType=WORK_ORDER");
  assert.match(formatRuleAnswer("list_my_work", "Antal uppgifter", { items: items.slice(0, 3), total: 27 }).answer, /^Antal uppgifter: 27 ej slutförda\n/);
  const time = formatRuleAnswer("list_time_entries", "Din rapporterade tid den här veckan", { totalDurationSec: 5400, entries: [{ taskId: "a", taskTitle: "Montage", durationSec: 3600 }, { taskId: "a", taskTitle: "Montage", durationSec: 1800 }] });
  assert.match(time.answer, /^Din rapporterade tid den här veckan: 1 h 30 min\n• Montage: 1 h 30 min$/);
  assert.equal(formatRuleAnswer("search", "Sök", { projects: [], tasks: [], controls: [], customers: [] }).answer, "Sök:\nInget hittades som du har behörighet att se.");
  assert.match(formatRuleAnswer("list_notifications", "Påminnelser", { items: [] }).answer, /Inga aktuella påminnelser/);
});

test("one clear match gives the details of a project, a customer or a task", () => {
  const found = { projects: [{ id: "p1", name: "Strömgatan 12" }], tasks: [{ id: "t1", title: "Arbetsorder Strömgatan", kind: "WORK_ORDER", status: "PLANNED" }], controls: [], customers: [] };
  assert.deepEqual(singleMatch("strömgatan 12", found, "any"), { kind: "project", id: "p1" }, "only the project contains the whole query");
  assert.equal(singleMatch("strömgatan", found, "any"), null, "two kinds match: keep the list");
  assert.deepEqual(singleMatch("strömgatan", found, "project"), { kind: "project", id: "p1" });
  assert.equal(singleMatch("strömgatan", { ...found, projects: [...found.projects, { id: "p2", name: "Strömgatan 14" }] }, "project"), null, "two projects: keep the list");
  const project = formatRuleAnswer("get_project", "Om ”Strömgatan 12”", { id: "p1", name: "Strömgatan 12", status: { label: "Pågår" }, startDate: "2026-09-01", dueDate: "2026-10-15", responsibleName: "Elin Bergström", customer: { name: "Brf Kopparlunden" },
    tasks: [{ id: "t1", title: "Byte av central", kind: "WORK_ORDER", status: "IN_PROGRESS", dueDate: "2026-10-03", assignedToName: "Elis" }, { id: "t2", title: "Riskbedömning", kind: "RISK_ASSESSMENT", status: "COMPLETED" }] });
  assert.equal(project.answer, ["Projektet Strömgatan 12:", "• Status: Pågår", "• Tidsram: 2026-09-01 – 2026-10-15", "• Kund: Brf Kopparlunden", "• Ansvarig: Elin Bergström", "Uppgifter: 2, varav 1 öppna:", "• Byte av central – Arbetsorder, pågår, klart 2026-10-03 (Elis)"].join("\n"));
  assert.deepEqual(project.citations.map((item) => item.href), ["/?view=project&projectId=p1", "/?view=workflow_task&taskId=t1&taskType=WORK_ORDER"]);
  const customer = formatRuleAnswer("get_customer", "Kunder", { customer: { id: "c1", name: "Brf Kopparlunden", email: "info@example.invalid", city: "Uppsala" }, facilities: [{ name: "Garaget" }], projects: [{ id: "p1", name: "Laddplatser", status: { label: "Pågår" } }], counts: { WORK_ORDER: 2, FORM: 1 } });
  assert.match(customer.answer, /^Kunden Brf Kopparlunden:\n• Kontakt: info@example.invalid · Uppsala\n• Anläggningar: Garaget\n• Projekt: 1 · Uppgifter: 3\n• Laddplatser – Pågår$/);
  assert.equal(customer.citations[0].href, "/?view=customers&customerId=c1");
  const task = formatRuleAnswer("get_task", "Om", { id: "t1", kind: "WORK_ORDER", title: "Byte av central", status: "IN_PROGRESS", progress: 40, dueDate: "2026-10-03", assignedToName: "Elis", project: { id: "p1", name: "Strömgatan 12" }, totalDurationSec: 5400, attachments: [{}], description: "Byt centralen." });
  assert.equal(task.answer, ["Arbetsorder Byte av central:", "• Status: pågår · 40 % klart", "• Klart senast: 2026-10-03", "• Ansvarig: Elis", "• Projekt: Strömgatan 12", "• Rapporterad tid: 1 h 30 min", "• Bilagor: 1", "Beskrivning: Byt centralen."].join("\n"));
});

test("spelling mistakes and count questions are answered by the rules, without AI (2026-10-01)", () => {
  assert.deepEqual(tool("Hur många arbetsordar jag har?"), ["list_my_work", { filter: "open", query: "arbetsorder" }]);
  assert.deepEqual(tool("hur många arbetsordrar har jag totalt"), ["list_my_work", { filter: "all", query: "arbetsorder" }]);
  assert.deepEqual(tool("har jag några kontroler"), ["list_my_work", { filter: "open", query: "kontroll" }]);
  assert.deepEqual(tool("antal pågående uppgifer"), ["list_my_work", { filter: "active" }]);
  assert.deepEqual(tool("mina uppgfiter"), ["list_my_work", { filter: "open" }]);
  assert.deepEqual(tool("vad är förenat?"), ["list_notifications", {}]);
  // Names are not "corrected" into Workflow's words.
  assert.deepEqual(tool("status på Strömgatan"), ["lookup", { query: "strömgatan", prefer: "any" }]);
  const plan = planAnswer("Hur många arbetsordar jag har?", now);
  assert.equal(plan.kind === "tool" && plan.heading, "Antal arbetsordrar|open");
  const answer = formatRuleAnswer("list_my_work", "Antal arbetsordrar|open", { items: [{ id: "w1", kind: "WORK_ORDER", title: "Byt armatur", status: "IN_PROGRESS" }], total: 4, counts: { open: 4, active: 1, planned: 3, action: 0, done: 7, all: 11 } }).answer;
  assert.match(answer, /^Antal arbetsordrar: 4 ej slutförda\n• Pågående: 1 · Planerade: 3 · Behöver åtgärdas: 0 · Slutförda: 7/);
});

test("a control in Mina uppgifter (no kind) links to the control editor", () => {
  const { citations } = formatRuleAnswer("list_my_work", "Dina uppgifter", { items: [{ id: "c1", title: "Elcentral A", status: "DRAFT", completion: 40 }], total: 1 });
  assert.equal(citations[0].href, "/?view=new&id=c1");
});

test("without the AI model, a question that needs it gets the nearest direct answer", () => {
  assert.deepEqual(nearestRulePlan("Sammanfatta läget i mina projekt och vad jag bör prioritera", now), { kind: "tool", tool: "list_projects", input: { state: "ongoing" }, heading: "Pågående projekt" });
  assert.equal(nearestRulePlan("Varför är så mycket försenat?", now)?.kind === "tool" && (nearestRulePlan("Varför är så mycket försenat?", now) as { tool: string }).tool, "list_notifications");
  assert.equal(nearestRulePlan("Skriv en dikt om sommaren", now), null);
  const answer = formatRuleAnswer("list_my_work", "Antal arbetsordrar|open", { items: Array.from({ length: 12 }, (_, index) => ({ id: `w${index}`, kind: "WORK_ORDER", title: `Order ${index}`, status: "PLANNED" })), total: 41, counts: { open: 41, active: 1, planned: 40, action: 0, done: 2 } }).answer;
  assert.ok(!/och \d+ till/.test(answer), answer);
  assert.match(answer, /Alla 41 finns under Mina uppgifter\.$/);
});

test("questions outside Workflow are answered for free, never by AI (2026-10-01)", () => {
  assert.deepEqual(tool("Vad blir det för väder i holsbybrunn idag?"), ["outside"]);
  assert.deepEqual(tool("vem vann fotbollen igår"), ["outside"]);
  // A question that touches work or an installation is not "outside".
  assert.notDeepEqual(tool("påverkar regn elcentralen på byggarbetsplatsen?"), ["outside"]);
  assert.notDeepEqual(tool("planering vid snö nästa vecka"), ["outside"]);
});

test("a question about the page the person is on is recognised (2026-10-01)", () => {
  for (const question of ["Hur fyller jag i den här kontrollen ?", "vad saknas?", "Vad är kvar på den här arbetsordern", "nästa steg", "varför kan jag inte slutföra"]) assert.equal(isPageQuestion(question), true, question);
  for (const question of ["mina uppgifter", "hur många arbetsordrar har jag", "vad blir det för väder"]) assert.equal(isPageQuestion(question), false, question);
});
