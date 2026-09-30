import assert from "node:assert/strict";
import test from "node:test";
import { formatRuleAnswer, periodOf, planAnswer, searchTerms } from "../lib/ai/assistant-rules";

const now = new Date("2026-09-30T10:00:00Z"); // a Wednesday
const tool = (question: string) => { const plan = planAnswer(question, now); return plan.kind === "tool" ? [plan.tool, plan.input] : [plan.kind]; };

test("rule-first: ordinary questions are answered with the shared tools, without AI", () => {
  assert.deepEqual(tool("Hjälp"), ["help"]);
  assert.deepEqual(tool("Mina uppgifter"), ["list_my_work", { filter: "open" }]);
  assert.deepEqual(tool("vad ska jag göra idag?"), ["list_my_work", { filter: "open" }]);
  assert.deepEqual(tool("mina slutförda arbetsordrar"), ["list_my_work", { filter: "done" }]);
  assert.deepEqual(tool("Vad är försenat?"), ["list_notifications", {}]);
  assert.deepEqual(tool("Min tid den här veckan"), ["list_time_entries", { from: "2026-09-28", to: "2026-10-04" }]);
  assert.deepEqual(tool("hur mycket tid har jag rapporterat förra veckan"), ["list_time_entries", { from: "2026-09-21", to: "2026-09-27" }]);
  assert.deepEqual(tool("Planering i morgon"), ["list_planned_activities", { from: "2026-10-01", to: "2026-10-01" }]);
  assert.deepEqual(tool("pågående projekt"), ["list_projects", { state: "ongoing" }]);
  assert.deepEqual(tool("projekt Strömgatan"), ["list_projects", { state: "ongoing", query: "strömgatan" }]);
  assert.deepEqual(tool("kund Elvägen"), ["list_customers", { query: "elvägen", limit: 10 }]);
  assert.deepEqual(tool("sök centralen A"), ["search", { query: "centralen a" }]);
  assert.deepEqual(tool('Var finns "Transformator T2"'), ["search", { query: "Transformator T2" }]);
  assert.deepEqual(tool("Centralen A"), ["search", { query: "centralen" }], "a short phrase is a search");
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
});

test("rule answers are short, linked and never list more than ten rows", () => {
  const items = Array.from({ length: 12 }, (_, index) => ({ id: `t${index}`, kind: "WORK_ORDER", title: `Arbetsorder ${index}`, status: "PLANNED", projectName: "Strömgatan" }));
  const work = formatRuleAnswer("list_my_work", "Dina uppgifter", { items, total: 12 });
  assert.match(work.answer, /^Dina uppgifter:\n• Arbetsorder 0 – Arbetsorder, planerad \(Strömgatan\)/);
  assert.match(work.answer, /… och 2 till\./);
  assert.equal(work.citations.length, 10);
  assert.equal(work.citations[0].href, "/?view=workflow_task&taskId=t0&taskType=WORK_ORDER");
  const time = formatRuleAnswer("list_time_entries", "Din rapporterade tid den här veckan", { totalDurationSec: 5400, entries: [{ taskId: "a", taskTitle: "Montage", durationSec: 3600 }, { taskId: "a", taskTitle: "Montage", durationSec: 1800 }] });
  assert.match(time.answer, /^Din rapporterade tid den här veckan: 1 h 30 min\n• Montage: 1 h 30 min$/);
  assert.equal(formatRuleAnswer("search", "Sök", { projects: [], tasks: [], controls: [], customers: [] }).answer, "Sök:\nInget hittades som du har behörighet att se.");
  assert.match(formatRuleAnswer("list_notifications", "Påminnelser", { items: [] }).answer, /Inget är försenat/);
});
